import { ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, parseYaml, stringifyYaml } from 'obsidian';
import { DEFAULTS, Timer, createOnce, duration, frontmatter, historyWarnings, instant, localTimestamp, parseRecord, recordPath, sameSubject, validateRecord, validateSettings, validateSubject, type RecordEntry, type Settings, type Subject, type TimerDraft } from './core';

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
    private session = crypto.randomUUID();
    private bar!: HTMLElement;
    private alive = true;
    private ready = false;

    async onload(): Promise<void>
    {
        try {
            this.settings = validateSettings({ ...DEFAULTS, ...await this.loadData() });
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
        return file.extension === 'md' && !file.path.startsWith(this.settings.folder + '/') && !this.app.metadataCache.getFileCache(file)?.frontmatter?.track_record;
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
        if (properties?.track_record) throw Error('A record cannot be used as its own subject.');
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

    async startTimer(): Promise<void>
    {
        const subject = await this.subject(this.activeFile());
        this.timer.start(subject, localTimestamp(), this.settings, crypto.randomUUID());
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

    async prepareModal(kind: 'time' | 'status'): Promise<void>
    {
        try {
            const subject = await this.subject(this.activeFile());
            new EntryModal(this, subject, kind).open();
        } catch (error) { new Notice(`Track Record: ${message(error)}`); }
    }

    async saveEntry(entry: RecordEntry): Promise<string>
    {
        validateRecord(entry);
        // Resolve just before writing; never mutate the subject note or its status property.
        entry.subject = await this.resolveSubject(entry.subject);
        const path = recordPath(entry);
        await createOnce({
            read: async p =>
            {
                const file = this.app.vault.getAbstractFileByPath(p);
                if (!file) return null;
                if (!(file instanceof TFile)) throw Error('Destination is a folder.');
                return this.app.vault.read(file);
            },
            create: async (p, content) =>
            {
                await this.ensureFolder(entry.settings.folder);
                await this.app.vault.create(p, content);
            }
        }, path, render(entry));
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
        // Only read the current record folder and other indexed notes carrying our schema marker.
        const allFiles = this.app.vault.getMarkdownFiles();
        const subjectsById = new Map<string, TFile[]>();
        for (const file of allFiles.filter(candidate => this.isSubject(candidate))) {
            const id = this.cachedSubject(file).id;
            if (!id) continue;
            const matching = subjectsById.get(id) ?? [];
            matching.push(file);
            subjectsById.set(id, matching);
        }
        const files = allFiles.filter(file => file.path.startsWith(this.settings.folder + '/') || this.app.metadataCache.getFileCache(file)?.frontmatter?.track_record);
        for (const file of files) {
            try {
                const text = await this.app.vault.read(file);
                const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
                if (!fm || !parseYaml(fm[1])?.track_record) continue;
                const record = parseRecord(text, file.path, parseYaml);
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
        } catch { this.bar.setText('Track Record: recovery needed'); }
    }

    async saveSettings(settings: Settings): Promise<void>
    {
        const next = validateSettings(settings);
        await this.saveData(next);
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
        root.addClass('track-record-view');
        root.createEl('h3', { text: 'Track Record' });
        root.createEl('p', { text: 'Time tracking & status history for your notes.' });
        const controls = new Setting(root);
        controls.addButton(button => button.setButtonText('Refresh').onClick(() => this.refresh()));
        try {
            const draft = this.plugin.timer.get();
            if (draft) {
                root.createEl('p', { text: `Local timer: ${draft.subject.path} · ${draft.start}${draft.pending ? ' · pending save' : draft.session !== this.plugin.timer.session ? ' · interrupted' : ''}` });
                controls.addButton(button => button.setButtonText('Stop / recover').onClick(() => this.plugin.stopTimer()));
            }
        } catch (error) { root.createEl('p', { text: message(error), cls: 'track-record-warning' }); }
        const selected = this.plugin.selected;
        root.createEl('h4', { text: selected ? `Note: ${selected.path}` : 'All records' });
        new Setting(root).addButton(button => button.setButtonText('Show all').onClick(() =>
        {
            this.plugin.selected = null;
            void this.refresh();
        }));
        const records = snapshot.records.filter(record => !selected || sameSubject(record.subject, selected));
        const warnings = [...snapshot.errors, ...historyWarnings(snapshot.records)];
        for (const warning of warnings) root.createEl('p', { text: warning, cls: 'track-record-warning' });
        const ambiguousTime = snapshot.errors.length > 0 || warnings.some(warning => /totals are withheld/.test(warning));
        root.createEl('p', { text: ambiguousTime ? 'Work total withheld; review warnings.' : `Recorded work: ${elapsed(records.reduce((total, record) => total + duration(record), 0))}` });
        root.createEl('p', { text: 'Status events describe effective times, not active work. Source status properties are unchanged. Edit a record’s Markdown to correct it, then refresh.' });
        records.sort((a, b) => instant(b.start) - instant(a.start) || a.id.localeCompare(b.id));
        if (!records.length) root.createEl('p', { text: 'No records. Open a note and use the Track Record commands to start tracking.' });
        for (const record of records) {
            const row = root.createDiv({ cls: 'track-record-entry' });
            row.createEl('strong', { text: record.kind === 'time' ? `Work · ${elapsed(duration(record))}` : `Status · ${record.status}` });
            row.createEl('div', { text: record.start + (record.end ? ` → ${record.end}` : '') });
            const source = row.createEl('button', { text: record.subject.path, cls: 'track-record-link' });
            source.addEventListener('click', () =>
            {
                void this.plugin.app.workspace.openLinkText(record.subject.path, record.path ?? '', false);
            });
            const edit = row.createEl('button', { text: 'Open record' });
            edit.addEventListener('click', () =>
            {
                void this.plugin.app.workspace.openLinkText(record.path!, '', false);
            });
        }
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
        this.containerEl.createEl('p', { text: 'Development preview. Explicit commands only; no automatic status observation. One local timer per vault and device. Settings changes affect new records; existing records retain their mappings.' });
        const draft = { ...this.plugin.settings };
        const labels: Record<keyof Settings, string> = {
            folder: 'Record folder', timeTag: 'Time record tag', statusTag: 'Status record tag',
            subjectProperty: 'Subject link property', startProperty: 'Start / effective-time property', endProperty: 'End property', statusProperty: 'Record status property'
        };
        for (const key of Object.keys(labels) as (keyof Settings)[]) {
            new Setting(this.containerEl).setName(labels[key]).addText(text => text.setValue(draft[key]).onChange(value =>
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
                feedback.setText('Saved. Existing records and local timer mappings are unchanged.');
            } catch (error) { feedback.setText(message(error)); }
        }));
    }
}
