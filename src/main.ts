import { AbstractInputSuggest, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, parseYaml, stringifyYaml, type App } from 'obsidian';
import { DEFAULTS, Timer, chooseRecordPath, createOnce, duration, frontmatter, hasRecordTag, historyWarnings, instant, localTimestamp, parseRecord, recordPath, sameSubject, validateRecord, validateSettings, validateSubject, type RecordEntry, type Settings, type Subject, type TimerDraft, type Writer } from './core';

const VIEW = 'track-record-history';
const LOCAL_KEY = 'track-record:timer:v1';

function render(record: RecordEntry): string
{
    return `---\n${stringifyYaml(frontmatter(record))}---\n\n${record.note}`;
}

function message(error: unknown): string
{
    return error instanceof Error ? error.message : String(error);
}

function elapsed(milliseconds: number): string
{
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}

interface Snapshot
{
    records: RecordEntry[];
    errors: string[];
}

export default class TrackRecord extends Plugin
{
    settings: Settings = { ...DEFAULTS };
    timer!: Timer;
    selected: Subject | null = null;
    busy = false;
    readProfiles: Settings[] = [];
    private session = crypto.randomUUID();
    private bar!: HTMLElement;
    private alive = true;
    private ready = false;

    async onload(): Promise<void>
    {
        try {
            const saved = await this.loadData();
            this.settings = validateSettings(saved ?? DEFAULTS);
            this.readProfiles = Array.isArray(saved?.readProfiles) ? saved.readProfiles.map((profile: unknown) => validateSettings(profile)) : [];
            this.ready = true;
        }
        catch (error) {
            new Notice(`Track Record: ${message(error)} Fix settings before writing.`, 10000);
            this.settings = { ...DEFAULTS };
            // Do not overwrite malformed saved configuration or enable writes with fallback mappings.
            this.ready = false;
        }
        this.timer = new Timer({
            read: () => this.app.loadLocalStorage(LOCAL_KEY),
            write: value => this.app.saveLocalStorage(LOCAL_KEY, value)
        }, {
            read: async path =>
            {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file === null) return null;
                if (!(file instanceof TFile)) throw Error('Record destination is a folder.');
                return this.app.vault.read(file);
            },
            create: async (path, content) =>
            {
                await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
                await this.app.vault.create(path, content);
            }
        }, this.session);
        this.registerView(VIEW, leaf => new HistoryView(leaf, this));
        this.addSettingTab(new RecordSettings(this));
        this.bar = this.addStatusBarItem();
        this.bar.addClass('track-record-bar');
        this.registerDomEvent(this.bar, 'click', () =>
        {
            void this.openHistory();
        });
        this.registerInterval(window.setInterval(() => this.updateBar(), 1000));
        this.addRibbonIcon('timer', 'Track Record: history and timer', () =>
        {
            void this.openHistory();
        });
        this.addCommand({
            id: 'start-timer', name: 'Start timer for active note', callback: () =>
            {
                void this.run(async () => this.startTimer());
            }
        });
        this.addCommand({
            id: 'stop-timer', name: 'Stop timer', callback: () =>
            {
                void this.stopTimer();
            }
        });
        this.addCommand({
            id: 'add-time', name: 'Add manual time record for active note', callback: () =>
            {
                void this.prepareModal('time');
            }
        });
        this.addCommand({
            id: 'record-status', name: 'Record status for active note', callback: () =>
            {
                void this.prepareModal('status');
            }
        });
        this.addCommand({
            id: 'open-history', name: 'Open note history and timer', callback: () =>
            {
                void this.openHistory();
            }
        });
        this.addCommand({
            id: 'recover-timer', name: 'Recover interrupted timer', callback: () =>
            {
                void this.recoverTimer();
            }
        });
        this.registerEvent(this.app.workspace.on('file-open', file =>
        {
            if (file && this.isSubject(file)) this.selected = this.cachedSubject(file);
            this.refreshViews();
        }));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) =>
        {
            try {
                const draft = this.timer.get();
                if (draft && !draft.pending && draft.subject.path === oldPath) {
                    draft.subject.path = file.path;
                    this.app.saveLocalStorage(LOCAL_KEY, draft);
                }
                if (this.selected?.path === oldPath) this.selected.path = file.path;
            } catch (error) { new Notice(`Track Record: ${message(error)}`); }
            this.updateBar();
        }));
        this.app.workspace.onLayoutReady(() =>
        {
            if (!this.alive) return;
            const file = this.app.workspace.getActiveFile();
            if (file && this.isSubject(file)) this.selected = this.cachedSubject(file);
            this.updateBar();
            try {
                if (this.timer.get()) new Notice('Track Record: an interrupted timer is available. Open history to choose its end time or retry a pending save.', 12000);
            } catch (error) { new Notice(`Track Record: ${message(error)}`, 12000); }
        });
    }

    onunload(): void
    {
        this.alive = false;
        // Preserve local intent. Closing Obsidian never invents an end time or writes a record.
    }

    async run(action: () => Promise<void>): Promise<void>
    {
        if (this.busy) { new Notice('Track Record: wait for the current operation.'); return; }
        this.busy = true;
        try {
            if (!this.ready) throw Error('Save valid Track Record settings before writing.');
            await action();
        } catch (error) { new Notice(`Track Record: ${message(error)}`, 10000); }
        finally { this.busy = false; this.updateBar(); this.refreshViews(); }
    }

    async ensureFolder(path: string): Promise<void>
    {
        const parts = path.split('/');
        for (let i = 1; i <= parts.length; i++) {
            const folder = parts.slice(0, i).join('/');
            const existing = this.app.vault.getAbstractFileByPath(folder);
            if (existing instanceof TFolder) continue;
            if (existing) throw Error(`A file blocks folder ${folder}.`);
            try { await this.app.vault.createFolder(folder); }
            catch (error) {
                if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw error;
            }
        }
    }

    isSubject(file: TFile): boolean
    {
        const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return file.extension === 'md' && !data?.track_record && !hasRecordTag(data, this.profiles());
    }

    profiles(): Settings[]
    {
        return [this.settings, ...this.readProfiles];
    }

    private cachedSubject(file: TFile): Subject
    {
        const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.id;
        return { path: file.path, ...(typeof id === 'string' && id.trim() ? { id } : {}) };
    }

    async subject(file: TFile): Promise<Subject>
    {
        if (!this.isSubject(file)) throw Error('Open an ordinary Markdown note outside the record folder.');
        const data = await this.app.vault.read(file);
        const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(data);
        const properties = fm ? parseYaml(fm[1]) : null;
        if (properties?.track_record || hasRecordTag(properties, this.profiles())) throw Error('A record cannot be used as its own subject.');
        const id = properties?.id;
        if (id !== undefined && (typeof id !== 'string' || !id.trim())) throw Error('Subject id must be a non-empty string.');
        if (id) {
            const duplicate = this.app.vault.getMarkdownFiles().some(candidate => candidate.path !== file.path && this.app.metadataCache.getFileCache(candidate)?.frontmatter?.id === id);
            if (duplicate) throw Error('Duplicate subject ID; resolve it before recording.');
        }
        return validateSubject({ path: file.path, ...(id ? { id } : {}) });
    }

    async resolveSubject(subject: Subject): Promise<Subject>
    {
        if (subject.id) {
            const candidates = this.app.vault.getMarkdownFiles().filter(file => this.app.metadataCache.getFileCache(file)?.frontmatter?.id === subject.id);
            if (candidates.length > 1) throw Error('Duplicate subject ID; timer retained.');
            if (candidates.length === 1) {
                const resolved = await this.subject(candidates[0]);
                if (resolved.id !== subject.id) throw Error('Subject metadata changed; refresh and retry.');
                return resolved;
            }
        }
        const file = this.app.vault.getAbstractFileByPath(subject.path);
        if (!(file instanceof TFile)) throw Error('Subject is missing or was renamed while this device was closed. Timer retained; restore the subject or its original path.');
        const resolved = await this.subject(file);
        if (subject.id && resolved.id !== subject.id) throw Error('Subject ID changed. Timer retained.');
        return resolved;
    }

    private activeFile(): TFile
    {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isSubject(file)) throw Error('Open the note you want to track first.');
        return file;
    }

    async startTimer(target?: Subject): Promise<void>
    {
        const subject = target ? await this.resolveSubject(target) : await this.subject(this.activeFile());
        const switchTime = localTimestamp();
        const previous = this.timer.get();
        if (previous) {
            const resolved = previous.pending ? previous.pending.subject : await this.resolveSubject(previous.subject);
            await this.timer.finish(switchTime, switchTime, resolved, render);
        }
        this.timer.start(subject, switchTime, this.settings, crypto.randomUUID());
        this.selected = subject;
        new Notice(`Track Record: timer started for ${subject.path}.`);
    }

    async stopTimer(): Promise<void>
    {
        try {
            const draft = this.timer.get();
            if (!draft) throw Error('No local timer is running.');
            if (draft.session !== this.session || draft.pending) { await this.recoverTimer(); return; }
            const end = localTimestamp();
            await this.run(async () =>
            {
                const subject = await this.resolveSubject(draft.subject);
                const path = await this.timer.finish(end, localTimestamp(), subject, render);
                new Notice(`Track Record: saved ${path}.`);
            });
        } catch (error) { new Notice(`Track Record: ${message(error)}`); }
    }

    async recoverTimer(): Promise<void>
    {
        try {
            const draft = this.timer.get();
            if (!draft) throw Error('No local timer to recover.');
            new RecoveryModal(this, draft).open();
        } catch (error) { new Notice(`Track Record: ${message(error)}`); }
    }

    async prepareModal(kind: 'time' | 'status', target?: Subject): Promise<void>
    {
        try {
            const subject = target ? await this.resolveSubject(target) : await this.subject(this.activeFile());
            new EntryModal(this, subject, kind).open();
        } catch (error) { new Notice(`Track Record: ${message(error)}`); }
    }

    async saveEntry(entry: RecordEntry): Promise<string>
    {
        validateRecord(entry);
        // Resolve just before writing; never mutate the subject note or its status property.
        entry.subject = await this.resolveSubject(entry.subject);
        const writer: Writer = {
            read: async p =>
            {
                const file = this.app.vault.getAbstractFileByPath(p);
                if (!file) return null;
                if (!(file instanceof TFile)) throw Error('Destination is a folder.');
                return this.app.vault.read(file);
            },
            create: async (p, content) =>
            {
                await this.ensureFolder(p.slice(0, p.lastIndexOf('/')));
                await this.app.vault.create(p, content);
            }
        };
        const content = render(entry);
        entry.path ??= await chooseRecordPath(writer, entry, content);
        const path = recordPath(entry);
        await createOnce(writer, path, content);
        this.selected = entry.subject;
        return path;
    }

    newEntry(subject: Subject, kind: 'time' | 'status', start: string, end: string, status: string, note: string): RecordEntry
    {
        return validateRecord({
            id: crypto.randomUUID(), kind, subject, start, ...(kind === 'time' ? { end } : { status: status.trim() }),
            created: localTimestamp(), session: this.session, note, settings: { ...this.settings }
        });
    }

    async snapshot(): Promise<Snapshot>
    {
        const records: RecordEntry[] = [], errors: string[] = [];
        // Tags identify records independently of their folder; legacy metadata is read-only compatibility.
        const allFiles = this.app.vault.getMarkdownFiles();
        const subjectsById = new Map<string, TFile[]>();
        for (const file of allFiles.filter(candidate => this.isSubject(candidate))) {
            const id = this.cachedSubject(file).id;
            if (!id) continue;
            const matching = subjectsById.get(id) ?? [];
            matching.push(file);
            subjectsById.set(id, matching);
        }
        const files = allFiles.filter(file =>
        {
            const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
            return data?.track_record || hasRecordTag(data, this.profiles()) || this.profiles().some(profile => [profile.timerFolder, profile.statusFolder].some(folder => file.path.startsWith(folder + '/')));
        });
        for (const file of files) {
            try {
                const text = await this.app.vault.read(file);
                const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
                if (!fm) continue;
                const data = parseYaml(fm[1]);
                if (!data?.track_record && !hasRecordTag(data, this.profiles())) continue;
                const record = parseRecord(text, file.path, parseYaml, this.profiles());
                const matching = record.subject.id ? subjectsById.get(record.subject.id) ?? [] : [];
                if (matching.length > 1) errors.push(`${file.path}: duplicate subject ID; attribution is ambiguous.`);
                const destination = matching.length === 1 ? matching[0] : this.app.metadataCache.getFirstLinkpathDest(record.subject.path, file.path);
                if (destination) record.subject.path = destination.path;
                records.push(record);
            } catch (error) { errors.push(`${file.path}: ${message(error)}`); }
        }
        return { records, errors };
    }

    async openHistory(): Promise<void>
    {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isSubject(file)) {
            try { this.selected = await this.subject(file); }
            catch (error) { new Notice(`Track Record: ${message(error)}`); }
        }
        let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
        if (!leaf) {
            leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
            await leaf.setViewState({ type: VIEW, active: true });
        }
        await this.app.workspace.revealLeaf(leaf);
        this.refreshViews();
    }

    refreshViews(): void
    {
        if (!this.alive) return;
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
            if (leaf.view instanceof HistoryView) void leaf.view.refresh();
        }
    }

    updateBar(): void
    {
        if (!this.alive || !this.bar) return;
        try {
            const draft = this.timer.get();
            const state = draft ? draft.pending ? 'pending save' : draft.session === this.session ? elapsed(Date.now() - instant(draft.start)) : 'interrupted' : 'idle';
            this.bar.setText(`Track Record: ${state}`);
            this.bar.setAttribute('aria-label', 'Open Track Record history and timer');
            for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
                if (leaf.view instanceof HistoryView) leaf.view.updateClock();
            }
        } catch { this.bar.setText('Track Record: recovery needed'); }
    }

    async saveSettings(settings: Settings): Promise<void>
    {
        const next = validateSettings(settings);
        const profiles = [this.settings, ...this.readProfiles];
        const retained = [...new Map(profiles.map(profile => [JSON.stringify(profile), profile])).values()].filter(profile => JSON.stringify(profile) !== JSON.stringify(next));
        await this.saveData({ ...next, readProfiles: retained });
        this.readProfiles = retained;
        this.settings = next;
        this.ready = true;
        this.refreshViews();
    }
}

class EntryModal extends Modal
{
    constructor(private plugin: TrackRecord, private subject: Subject, private kind: 'time' | 'status')
    {
        super(plugin.app);
    }

    onOpen(): void
    {
        this.titleEl.setText(this.kind === 'time' ? 'Add time record' : 'Record status');
        this.contentEl.createEl('p', { text: this.subject.path });
        this.contentEl.createEl('p', { text: 'Creates a linked record. The source note and its status property are unchanged.' });
        let start = localTimestamp(), end = '', status = '', note = '';
        let pending: RecordEntry | null = null;
        new Setting(this.contentEl).setName(this.kind === 'time' ? 'Start' : 'Effective time').setDesc('ISO timestamp including timezone.').addText(text => text.setValue(start).onChange(value =>
        {
            start = value.trim();
        }));
        if (this.kind === 'time') new Setting(this.contentEl).setName('End').setDesc('Must be after start. Overlaps are flagged in history.').addText(text => text.setPlaceholder(localTimestamp()).onChange(value =>
        {
            end = value.trim();
        }));
        else new Setting(this.contentEl).setName('Status').setDesc('Every submission is a separate event, including repeated statuses.').addText(text => text.onChange(value =>
        {
            status = value;
        }));
        new Setting(this.contentEl).setName('Notes').addTextArea(text => text.onChange(value =>
        {
            note = value;
        }));
        const feedback = this.contentEl.createEl('p', { cls: 'track-record-warning' });
        new Setting(this.contentEl).addButton(button => button.setButtonText('Save record').setCta().onClick(async () =>
        {
            if (this.plugin.busy) return;
            button.setDisabled(true);
            // Keep the same entry after an ambiguous save failure so retry cannot mint a second ID.
            let saved = false;
            await this.plugin.run(async () =>
            {
                try {
                    pending ??= this.plugin.newEntry(this.subject, this.kind, start, end, status, note);
                    const path = await this.plugin.saveEntry(pending);
                    saved = true;
                    new Notice(`Track Record: saved ${path}.`);
                } catch (error) { feedback.setText(message(error) + (pending ? ' Retry saves the original submission; reopen the dialog to enter a different record.' : '')); throw error; }
            });
            if (saved) this.close();
            else button.setDisabled(false);
        }));
    }
}

class RecoveryModal extends Modal
{
    constructor(private plugin: TrackRecord, private draft: TimerDraft)
    {
        super(plugin.app);
    }

    onOpen(): void
    {
        this.titleEl.setText('Recover timer');
        const draft = this.draft;
        this.contentEl.createEl('p', { text: `${draft.subject.path} · started ${draft.start}` });
        this.contentEl.createEl('p', { text: draft.pending ? 'A save was interrupted. Retry uses the original record ID, content and end time.' : 'Choose the actual end time. No work duration has been inferred while Obsidian was closed.' });
        let end = '';
        if (!draft.pending) new Setting(this.contentEl).setName('Actual end time').setDesc('ISO timestamp with timezone; required.').addText(text => text.onChange(value =>
        {
            end = value.trim();
        }));
        else this.contentEl.createEl('p', { text: `End: ${draft.pending.end}` });
        new Setting(this.contentEl).addButton(button => button.setButtonText(draft.pending ? 'Retry save' : 'Save interval').setCta().onClick(async () =>
        {
            let saved = false;
            await this.plugin.run(async () =>
            {
                const current = this.plugin.timer.get();
                if (JSON.stringify(current) !== JSON.stringify(draft)) throw Error('Timer changed; reopen recovery.');
                const subject = draft.pending ? draft.pending.subject : await this.plugin.resolveSubject(draft.subject);
                const path = await this.plugin.timer.finish(end, localTimestamp(), subject, render);
                new Notice(`Track Record: saved ${path}.`);
                saved = true;
            });
            if (saved) this.close();
        }));
        this.contentEl.createEl('p', { text: 'Discard only removes this device’s timer draft. A previously saved record is never deleted.' });
        new Setting(this.contentEl).addButton(button => button.setButtonText('Discard local draft…').onClick(() =>
        {
            new ConfirmModal(this.plugin, 'Discard this local timer draft?', async () =>
            {
                if (JSON.stringify(this.plugin.timer.get()) !== JSON.stringify(draft)) throw Error('Timer changed; reopen recovery.');
                this.plugin.app.saveLocalStorage(LOCAL_KEY, null);
                this.close();
            }).open();
        }));
    }
}

class ConfirmModal extends Modal
{
    constructor(private plugin: TrackRecord, private question: string, private action: () => Promise<void>)
    {
        super(plugin.app);
    }

    onOpen(): void
    {
        this.titleEl.setText(this.question);
        new Setting(this.contentEl).addButton(button => button.setButtonText('Confirm discard').setWarning().onClick(async () =>
        {
            await this.plugin.run(this.action);
            this.close();
        })).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()));
    }
}

class HistoryView extends ItemView
{
    private generation = 0;
    private allRecords = false;
    private clock: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, private plugin: TrackRecord)
    {
        super(leaf);
    }

    getViewType(): string
    {
        return VIEW;
    }

    getDisplayText(): string
    {
        return 'Track Record';
    }

    getIcon(): string
    {
        return 'timer';
    }

    async onOpen(): Promise<void>
    {
        await this.refresh();
    }

    async onClose(): Promise<void>
    {
        this.generation++;
        this.clock = null;
    }

    updateClock(): void
    {
        if (!this.clock) return;
        try {
            const draft = this.plugin.timer.get();
            this.clock.setText(!draft ? 'No running timer' : draft.pending ? 'Pending save' : draft.session !== this.plugin.timer.session ? 'Interrupted · choose an end time' : `Running · ${elapsed(Date.now() - instant(draft.start))}`);
        } catch (error) { this.clock.setText(message(error)); }
    }

    async refresh(): Promise<void>
    {
        const generation = ++this.generation;
        let snapshot: Snapshot;
        try { snapshot = await this.plugin.snapshot(); }
        catch (error) { snapshot = { records: [], errors: [message(error)] }; }
        if (generation !== this.generation) return;
        const root = this.contentEl;
        root.empty();
        this.clock = null;
        root.addClass('track-record-view');
        root.createEl('h3', { text: 'Track Record' });
        const selected = this.plugin.selected;
        const current = root.createDiv({ cls: 'track-record-current' });
        current.createEl('div', { text: 'Current note', cls: 'track-record-label' });
        current.createEl('strong', { text: selected ? selected.path.replace(/\.md$/i, '') : 'Open a note to start tracking' });
        let draft: TimerDraft | null = null;
        try {
            draft = this.plugin.timer.get();
        } catch (error) { current.createEl('p', { text: message(error), cls: 'track-record-warning' }); }
        const runningHere = draft && selected && sameSubject(draft.subject, selected);
        if (selected) {
            new Setting(current).addButton(button => button.setButtonText(runningHere ? 'Stop timer' : draft ? 'Start timer here' : 'Start timer').setCta().setDisabled(this.plugin.busy).onClick(async () =>
            {
                if (runningHere) await this.plugin.stopTimer();
                else await this.plugin.run(async () => this.plugin.startTimer(selected));
            }));
            new Setting(current).addButton(button => button.setButtonText('Add time').onClick(() => this.plugin.prepareModal('time', selected)))
                .addButton(button => button.setButtonText('Record status').onClick(() => this.plugin.prepareModal('status', selected)));
        }
        if (draft) {
            const active = root.createDiv({ cls: 'track-record-running' });
            this.clock = active.createEl('strong');
            this.updateClock();
            active.createEl('div', { text: draft.subject.path.replace(/\.md$/i, ''), cls: 'track-record-subtle' });
            active.createEl('div', { text: `Started ${draft.start}`, cls: 'track-record-subtle' });
            if (!runningHere || draft.pending || draft.session !== this.plugin.timer.session) new Setting(active).addButton(button => button.setButtonText(draft.pending || draft.session !== this.plugin.timer.session ? 'Recover timer' : 'Stop timer').onClick(() => this.plugin.stopTimer()));
        }
        root.createEl('h4', { text: 'History' });
        new Setting(root).setName(this.allRecords || !selected ? 'All notes' : 'Current note').addButton(button => button.setButtonText(this.allRecords ? 'This note' : 'All notes').onClick(() =>
        {
            this.allRecords = !this.allRecords;
            return this.refresh();
        })).addButton(button => button.setButtonText('Refresh').onClick(() => this.refresh()));
        const records = snapshot.records.filter(record => this.allRecords || !selected || sameSubject(record.subject, selected));
        const warnings = [...snapshot.errors, ...historyWarnings(snapshot.records)];
        for (const warning of warnings) root.createEl('p', { text: warning, cls: 'track-record-warning' });
        const ambiguousTime = snapshot.errors.length > 0 || warnings.some(warning => /totals are withheld/.test(warning));
        root.createEl('p', { cls: 'track-record-summary', text: ambiguousTime ? 'Work total withheld; review warnings.' : `Recorded work · ${elapsed(records.reduce((total, record) => total + duration(record), 0))}` });
        records.sort((a, b) => instant(b.start) - instant(a.start) || a.id.localeCompare(b.id));
        if (!records.length) root.createEl('p', { text: 'No records. Open a note and use the Track Record commands to start tracking.' });
        for (const record of records) {
            const row = root.createDiv({ cls: 'track-record-entry' });
            row.createEl('strong', { text: record.kind === 'time' ? `Timer · ${elapsed(duration(record))}` : `Status · ${record.status}` });
            row.createEl('div', { text: record.start + (record.end ? ` → ${record.end}` : '') });
            if (this.allRecords || !selected) {
                const source = row.createEl('button', { text: record.subject.path.replace(/\.md$/i, ''), cls: 'track-record-link' });
                source.addEventListener('click', () =>
                {
                    void this.plugin.app.workspace.openLinkText(record.subject.path, record.path ?? '', false);
                });
            }
            const edit = row.createEl('button', { text: 'Open record' });
            edit.addEventListener('click', () =>
            {
                void this.plugin.app.workspace.openLinkText(record.path!, '', false);
            });
        }
    }
}

class FolderSuggest extends AbstractInputSuggest<TFolder>
{
    constructor(private vaultApp: App, input: HTMLInputElement, private choose: (path: string) => void)
    {
        super(vaultApp, input);
    }

    protected getSuggestions(query: string): TFolder[]
    {
        return this.vaultApp.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && !!file.path && file.path.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.path.localeCompare(b.path));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void
    {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void
    {
        this.setValue(folder.path);
        this.choose(folder.path);
        this.close();
    }
}

class RecordSettings extends PluginSettingTab
{
    constructor(private plugin: TrackRecord)
    {
        super(plugin.app, plugin);
    }

    display(): void
    {
        this.containerEl.empty();
        this.containerEl.createEl('h2', { text: 'Track Record' });
        this.containerEl.createEl('p', { text: 'Timer and status records can share a folder or use separate folders. Tags identify the record type wherever a file is stored.' });
        const draft = { ...this.plugin.settings };
        for (const kind of ['time', 'status'] as const) {
            this.containerEl.createEl('h3', { text: kind === 'time' ? 'Timer' : 'Status' });
            const folderKey = kind === 'time' ? 'timerFolder' : 'statusFolder';
            const tagKey = kind === 'time' ? 'timeTag' : 'statusTag';
            const filenameKey = kind === 'time' ? 'timerFilename' : 'statusFilename';
            const preview = this.containerEl.createEl('p', { cls: 'track-record-subtle' });
            const updatePreview = (): void =>
            {
                try {
                    const start = localTimestamp(new Date(Date.now() - 60000));
                    const example = this.plugin.newEntry({ path: 'Example.md' }, kind, start, localTimestamp(), 'active', '');
                    preview.setText(`Example: ${recordPath({ ...example, settings: validateSettings(draft) })}`);
                } catch (error) { preview.setText(message(error)); }
            };
            new Setting(this.containerEl).setName('Save in folder').setDesc('Folder path relative to the vault root. Choose an existing folder or type a new path. This is not a tag.').addText(text =>
            {
                text.setPlaceholder('records/track-record').setValue(draft[folderKey]).onChange(value =>
                {
                    draft[folderKey] = value;
                    updatePreview();
                });
                new FolderSuggest(this.plugin.app, text.inputEl, value =>
                {
                    draft[folderKey] = value;
                    updatePreview();
                });
            });
            new Setting(this.containerEl).setName('Identify by tag').setDesc('Obsidian tag in the tags property. A slash creates a nested tag, not a folder. A leading # is optional here.').addText(text => text.setPlaceholder(kind === 'time' ? '#record/time' : '#record/status').setValue('#' + draft[tagKey]).onChange(value =>
            {
                draft[tagKey] = value;
                updatePreview();
            }));
            new Setting(this.containerEl).setName('Filename format').setDesc('Tokens: {type}, {timestamp}, {date}, {hash}. Include {hash}; omit .md. Timestamp is UTC, without milliseconds, using filename-safe hyphens.').addText(text => text.setValue(draft[filenameKey]).onChange(value =>
            {
                draft[filenameKey] = value;
                updatePreview();
            }));
            updatePreview();
        }
        const properties = this.containerEl.createEl('details');
        properties.createEl('summary', { text: 'Properties shared by Timer and Status' });
        const labels = { subjectProperty: 'Subject link property', startProperty: 'Start / effective-time property', endProperty: 'Timer end property', statusProperty: 'Status value property' };
        for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
            new Setting(properties).setName(labels[key]).addText(text => text.setValue(draft[key]).onChange(value =>
            {
                draft[key] = value;
            }));
        }
        const feedback = this.containerEl.createEl('p');
        new Setting(this.containerEl).addButton(button => button.setButtonText('Save settings').setCta().onClick(async () =>
        {
            try {
                if (this.plugin.busy) throw Error('Wait for the current write.');
                await this.plugin.saveSettings(draft);
                feedback.setText('Saved. Earlier mappings are retained in plugin settings; existing notes and local timer drafts are unchanged.');
            } catch (error) { feedback.setText(message(error)); }
        }));
    }
}
