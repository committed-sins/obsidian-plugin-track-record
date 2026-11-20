import { AbstractInputSuggest, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, parseYaml, stringifyYaml, setIcon, type App } from 'obsidian';
import { DEFAULTS, Timer as LegacyTimer, chooseRecordPath, closeTimerText, createOnce, duration, frontmatter, hasRecordTag, historyWarnings, instant, utcTimestamp, localDateTime, localDateTimeToUtc, ownedOpenTimers, parseRecord, recordPath, recordSubjects, relatesTo, sameSubject, validateUserName, validateRecord, validateSettings, validateSubject, type RecordEntry, type Settings, type Subject, type TimerDraft, type Writer } from './core';

const VIEW = 'track-record-history';
const LOCAL_KEY = 'track-record:timer:v1';
const USER_KEY = 'track-record:user-name:v1';

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
    legacyTimer!: LegacyTimer;
    userName = '';
    activeTimers: RecordEntry[] = [];
    selected: Subject | null = null;
    busy = false;
    readProfiles: Settings[] = [];
    private session = crypto.randomUUID();
    private bar!: HTMLElement;
    private alive = true;
    private ready = false;
    private refreshTimeout = 0;
    private snapshotGeneration = 0;

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
        const savedUser = this.app.loadLocalStorage(USER_KEY);
        try { this.userName = validateUserName(savedUser ?? ''); }
        catch (error) { new Notice(`Track Record: ${message(error)} Set the current user in settings.`); this.ready = false; }
        // Read-only compatibility path until the user explicitly recovers an old preview draft.
        this.legacyTimer = new LegacyTimer({
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
            id: 'recover-timer', name: 'Recover legacy timer', callback: () =>
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
                const draft = this.legacyTimer.get();
                if (draft && !draft.pending && draft.subject.path === oldPath) {
                    draft.subject.path = file.path;
                    this.app.saveLocalStorage(LOCAL_KEY, draft);
                }
                if (this.selected?.path === oldPath) this.selected.path = file.path;
            } catch (error) { new Notice(`Track Record: ${message(error)}`); }
            this.updateBar();
        }));
        const refresh = (): void =>
        {
            window.clearTimeout(this.refreshTimeout);
            this.refreshTimeout = window.setTimeout(() =>
            {
                if (this.alive) {
                    void this.snapshot().then(() =>
                    {
                        this.updateBar(); this.refreshViews();
                    });
                }
            }, 250);
        };
        this.registerEvent(this.app.vault.on('create', refresh));
        this.registerEvent(this.app.vault.on('modify', refresh));
        this.registerEvent(this.app.vault.on('delete', refresh));
        this.registerEvent(this.app.vault.on('rename', refresh));
        this.app.workspace.onLayoutReady(() =>
        {
            if (!this.alive) return;
            const file = this.app.workspace.getActiveFile();
            if (file && this.isSubject(file)) this.selected = this.cachedSubject(file);
            this.updateBar();
            try {
                if (this.legacyTimer.get()) new Notice('Track Record: a local timer from an older preview is available. Use Recover legacy timer before starting a new timer.', 12000);
            } catch (error) { new Notice(`Track Record: ${message(error)}`, 12000); }
            void this.snapshot().then(() =>
            {
                this.updateBar(); this.refreshViews();
            });
        });
    }

    onunload(): void
    {
        this.alive = false;
        window.clearTimeout(this.refreshTimeout);
        // Open Markdown timers remain open. No local active-timer state is written.
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
        return [this.settings, ...this.readProfiles,
        validateSettings({ ...DEFAULTS, startProperty: 'time_start', endProperty: 'time_end', statusStartProperty: 'time_start' }),
        validateSettings({ ...DEFAULTS, startProperty: 'timer.start', endProperty: 'timer.end', statusStartProperty: 'time_start' })];
    }

    saveUserName(value: string): void
    {
        if (this.busy) throw Error('Wait for the current operation before changing the current user.');
        const name = validateUserName(value);
        this.app.saveLocalStorage(USER_KEY, name || null);
        this.userName = name;
        this.updateBar();
        this.refreshViews();
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
        validateUserName(this.userName);
        if (this.legacyTimer.get()) throw Error('Recover or discard the legacy preview timer before starting a new timer.');
        const subject = target ? await this.resolveSubject(target) : await this.subject(this.activeFile());
        const switchTime = utcTimestamp();
        const snapshot = await this.snapshot();
        if (snapshot.errors.length) throw Error('Review invalid records in history before changing timers.');
        const previous = ownedOpenTimers(snapshot.records, this.userName);
        await this.closeTimers(previous, switchTime);
        await this.saveEntry(this.newEntry(subject, 'time', switchTime, '', '', '', true));
        await this.snapshot();
        this.selected = subject;
        new Notice(`Track Record: timer started for ${subject.path}.`);
    }

    async stopTimer(): Promise<void>
    {
        const end = utcTimestamp();
        await this.run(async () =>
        {
            validateUserName(this.userName);
            const snapshot = await this.snapshot();
            if (snapshot.errors.length) throw Error('Review invalid records in history before changing timers.');
            const active = ownedOpenTimers(snapshot.records, this.userName);
            if (!active.length) throw Error('No matching open timers.');
            await this.closeTimers(active, end);
            await this.snapshot();
            new Notice(`Track Record: stopped ${active.length} timer(s).`);
        });
    }

    currentTimer(): RecordEntry | null
    {
        return ownedOpenTimers(this.activeTimers, this.userName)[0] ?? null;
    }

    async closeTimers(records: RecordEntry[], end: string): Promise<void>
    {
        // Preflight every candidate before the first write. Every write rechecks fresh content atomically.
        const candidates: { file: TFile; record: RecordEntry }[] = [];
        for (const record of records) {
            const file = this.app.vault.getAbstractFileByPath(record.path!);
            if (!(file instanceof TFile)) throw Error('An open timer disappeared; refresh before retrying.');
            closeTimerText(await this.app.vault.read(file), record, end, parseYaml, this.profiles());
            candidates.push({ file, record });
        }
        for (const { file, record } of candidates) await this.app.vault.process(file, text => closeTimerText(text, record, end, parseYaml, this.profiles()));
    }

    async recoverTimer(): Promise<void>
    {
        try {
            const draft = this.legacyTimer.get();
            if (!draft) throw Error('There is no legacy preview timer. Open Markdown timers can be stopped normally.');
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
        const resolved = await Promise.all(recordSubjects(entry).map(subject => this.resolveSubject(subject)));
        entry.subject = resolved[0];
        entry.subjects = resolved;
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

    newEntry(subject: Subject, kind: 'time' | 'status', start: string, end: string, status: string, note: string, openTimer = false, subjects?: Subject[]): RecordEntry
    {
        if (kind === 'time' && !openTimer && !end.trim()) throw Error('Enter an end time for a manual interval.');
        return validateRecord({
            id: crypto.randomUUID(), kind, subject, ...(subjects ? { subjects } : {}), start, ...(kind === 'time' ? { ...(openTimer ? {} : { end }), ...(this.userName ? { user: validateUserName(this.userName) } : {}) } : { status: status.trim() }),
            created: utcTimestamp(), session: this.session, note, settings: { ...this.settings }
        });
    }

    async snapshot(): Promise<Snapshot>
    {
        const generation = ++this.snapshotGeneration;
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
                record.linkPath = record.subject.path;
                record.linkPaths = recordSubjects(record).map(target => target.path);
                for (const target of recordSubjects(record)) {
                    const matching = target.id ? subjectsById.get(target.id) ?? [] : [];
                    if (matching.length > 1) errors.push(`${file.path}: duplicate subject ID; attribution is ambiguous.`);
                    const destination = matching.length === 1 ? matching[0] : this.app.metadataCache.getFirstLinkpathDest(target.path, file.path);
                    if (destination) target.path = destination.path;
                }
                records.push(record);
            } catch (error) { errors.push(`${file.path}: ${message(error)}`); }
        }
        if (generation === this.snapshotGeneration) this.activeTimers = records.filter(record => record.kind === 'time' && !record.end);
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
            const timer = this.currentTimer();
            const state = timer ? `${this.userName || 'Unassigned'} · ${elapsed(Date.now() - instant(timer.start))}` : 'idle';
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
        this.contentEl.addClass('track-record-modal');
        this.contentEl.createEl('p', { text: `Local time (${Intl.DateTimeFormat().resolvedOptions().timeZone}); saved as UTC.`, cls: 'track-record-subtle' });
        let start = localDateTime(), end = '', status = '', note = '';
        let subjectNotes = this.subject.path;
        let pending: RecordEntry | null = null;
        new Setting(this.contentEl).setName('Subject notes').setDesc(this.kind === 'status' ? 'One note path per line. This status applies to every listed note.' : 'One note path per line. This interval counts once globally and in full for each linked note.').addTextArea(text => text.setValue(subjectNotes).onChange(value =>
        {
            subjectNotes = value;
        }));
        new Setting(this.contentEl).setName(this.kind === 'time' ? 'Start' : 'Effective time').addText(text =>
        {
            text.inputEl.type = 'datetime-local';
            text.inputEl.step = '1';
            text.setValue(start).onChange(value =>
            {
                start = value;
            });
        });
        if (this.kind === 'time') new Setting(this.contentEl).setName('End').setDesc('Must be after start.').addText(text =>
        {
            text.inputEl.type = 'datetime-local';
            text.inputEl.step = '1';
            text.onChange(value =>
            {
                end = value;
            });
        });
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
                    const subjects = subjectNotes.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(path => validateSubject({ path: path.endsWith('.md') ? path : path + '.md' }));
                    if (!subjects.length) throw Error('Link at least one subject note.');
                    pending ??= this.plugin.newEntry(subjects[0], this.kind, localDateTimeToUtc(start), this.kind === 'time' ? localDateTimeToUtc(end) : '', status, note, false, subjects);
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
                const current = this.plugin.legacyTimer.get();
                if (JSON.stringify(current) !== JSON.stringify(draft)) throw Error('Timer changed; reopen recovery.');
                const subject = draft.pending ? draft.pending.subject : await this.plugin.resolveSubject(draft.subject);
                const path = await this.plugin.legacyTimer.finish(end, utcTimestamp(), subject, render);
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
                if (JSON.stringify(this.plugin.legacyTimer.get()) !== JSON.stringify(draft)) throw Error('Timer changed; reopen recovery.');
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
    private clocks = new Map<string, HTMLElement>();

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
        this.clocks.clear();
    }

    updateClock(): void
    {
        for (const [id, clock] of this.clocks) {
            const timer = this.plugin.activeTimers.find(record => record.id === id);
            clock.setText(timer ? `Running · ${elapsed(Date.now() - instant(timer.start))}` : 'Stopped');
        }
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
        this.clocks.clear();
        root.addClass('track-record-view');
        const selected = this.plugin.selected;
        const dashboard = root.createDiv({ cls: 'track-record-dashboard' });
        const current = dashboard.createDiv({ cls: 'track-record-current' });
        current.createEl('div', { text: 'Current note', cls: 'track-record-label' });
        current.createEl('strong', { text: selected ? selected.path.replace(/\.md$/i, '') : 'Open a note to start tracking' });
        const ownTimers = ownedOpenTimers(snapshot.records, this.plugin.userName);
        const runningHere = selected && ownTimers.some(timer => relatesTo(timer, selected));
        if (selected) {
            new Setting(current).addButton(button => button.setButtonText(runningHere ? 'Stop timer' : ownTimers.length ? 'Start timer here' : 'Start timer').setCta().setDisabled(this.plugin.busy).onClick(async () =>
            {
                if (runningHere) await this.plugin.stopTimer();
                else await this.plugin.run(async () => this.plugin.startTimer(selected));
            })).addButton(button => button.setButtonText('Add time').onClick(() => this.plugin.prepareModal('time', selected)))
                .addButton(button => button.setButtonText('Record status').onClick(() => this.plugin.prepareModal('status', selected)));
        }
        for (const timer of this.plugin.activeTimers) {
            const active = dashboard.createDiv({ cls: 'track-record-running' });
            this.clocks.set(timer.id, active.createEl('strong'));
            active.createEl('div', { text: timer.user ?? 'No user', cls: 'track-record-label' });
            active.createEl('div', { text: recordSubjects(timer).map(target => target.path.replace(/\.md$/i, '')).join(', '), cls: 'track-record-subtle' });
            active.createEl('div', { text: `Started ${new Date(instant(timer.start)).toLocaleString()}`, cls: 'track-record-subtle' });
            if ((timer.user ?? '') === this.plugin.userName && !runningHere) new Setting(active).addButton(button => button.setButtonText('Stop timer').onClick(() => this.plugin.stopTimer()));
        }
        this.updateClock();
        try {
            if (this.plugin.legacyTimer.get()) new Setting(root).setName('Timer from an older preview').addButton(button => button.setButtonText('Recover legacy timer').onClick(() => this.plugin.recoverTimer()));
        } catch (error) { root.createEl('p', { text: message(error), cls: 'track-record-warning' }); }
        const toolbar = root.createDiv({ cls: 'track-record-history-toolbar' });
        toolbar.createEl('strong', { text: 'History' });
        const scope = toolbar.createDiv({ cls: 'track-record-scope' });
        scope.setAttribute('role', 'group');
        scope.setAttribute('aria-label', 'History scope');
        for (const [label, all] of [['This note', false], ['All notes', true]] as const) {
            const button = scope.createEl('button', { text: label });
            const active = all === (this.allRecords || !selected);
            button.setAttribute('aria-pressed', String(active));
            if (active) button.addClass('is-active');
            if (!all && !selected) button.disabled = true;
            button.addEventListener('click', () =>
            {
                this.allRecords = all;
                void this.refresh();
            });
        }
        const refresh = toolbar.createEl('button', { cls: 'track-record-refresh', attr: { 'aria-label': 'Refresh history', title: 'Refresh history' } });
        setIcon(refresh, 'refresh-cw');
        refresh.addEventListener('click', () =>
        {
            void this.refresh();
        });
        const records = snapshot.records.filter(record => this.allRecords || !selected || relatesTo(record, selected));
        const warnings = [...snapshot.errors, ...historyWarnings(snapshot.records)];
        for (const warning of warnings) root.createEl('p', { text: warning, cls: 'track-record-warning' });
        const ambiguousTime = snapshot.errors.length > 0 || warnings.some(warning => /totals are withheld/.test(warning));
        root.createEl('p', { cls: 'track-record-summary', text: ambiguousTime ? 'Work total withheld; review warnings.' : `Recorded work · ${elapsed(records.reduce((total, record) => total + duration(record), 0))}` });
        records.sort((a, b) => instant(b.start) - instant(a.start) || a.id.localeCompare(b.id));
        if (!records.length) root.createEl('p', { text: 'No records. Open a note and use the Track Record commands to start tracking.' });
        for (const record of records) {
            const row = root.createDiv({ cls: 'track-record-entry' });
            row.createEl('strong', { text: record.kind === 'time' ? `Timer · ${record.end ? elapsed(duration(record)) : 'Open'}` : `Status · ${record.status}` });
            row.createEl('div', { text: new Date(instant(record.start)).toLocaleString() + (record.end ? ` \u2192 ${new Date(instant(record.end)).toLocaleString()}` : ''), attr: { title: record.start + (record.end ? ` \u2192 ${record.end}` : '') } });
            if (record.kind === 'time' && record.user) row.createEl('div', { text: record.user });
            if (recordSubjects(record).length > 1) row.createEl('div', { text: 'Shared record · counts once in the all-notes total' });
            if (this.allRecords || !selected) {
                for (const target of recordSubjects(record)) {
                    const source = row.createEl('button', { text: target.path.replace(/\.md$/i, ''), cls: 'track-record-link' });
                    source.addEventListener('click', () =>
                    {
                        void this.plugin.app.workspace.openLinkText(target.path, record.path ?? '', false);
                    });
                }
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
        let userName = this.plugin.userName;
        this.containerEl.createEl('h3', { text: 'Current user' });
        new Setting(this.containerEl).setName('User name').setDesc('Optional local setting. Use the same name on your devices. Empty closes only timers without a user; a configured name closes only that user’s timers. This is an organizational label, not access control.').addText(text => text.setValue(userName).onChange(value =>
        {
            userName = value;
        }));
        for (const kind of ['time', 'status'] as const) {
            this.containerEl.createEl('h3', { text: kind === 'time' ? 'Timer' : 'Status' });
            const folderKey = kind === 'time' ? 'timerFolder' : 'statusFolder';
            const tagKey = kind === 'time' ? 'timeTag' : 'statusTag';
            const filenameKey = kind === 'time' ? 'timerFilename' : 'statusFilename';
            const preview = this.containerEl.createEl('p', { cls: 'track-record-subtle' });
            const updatePreview = (): void =>
            {
                try {
                    const start = utcTimestamp(new Date(Date.now() - 60000));
                    const example = this.plugin.newEntry({ path: 'Example.md' }, kind, start, utcTimestamp(), 'active', '');
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
            new Setting(this.containerEl).setName('Filename format').setDesc('Editable base: {type}, {timestamp}, {date}. A fixed .{hash}.md suffix is always appended. Timestamp is UTC to seconds.').addText(text => text.setValue(draft[filenameKey]).onChange(value =>
            {
                draft[filenameKey] = value;
                updatePreview();
            }));
            const labels = kind === 'time'
                ? { timerSubjectProperty: 'Subject link property', userProperty: 'User property', startProperty: 'Start property', endProperty: 'End property' }
                : { statusSubjectProperty: 'Subject link property', statusStartProperty: 'Effective-time property', statusProperty: 'Status value property' };
            for (const key of Object.keys(labels) as (keyof Settings)[]) {
                new Setting(this.containerEl).setName(labels[key as keyof typeof labels]!).setDesc('Dot notation creates nested YAML, e.g. record.start. Flat names work too. Subject suggestions: contexts or projects; links are stored as a list.').addText(text => text.setValue(draft[key]).onChange(value =>
                {
                    draft[key] = value;
                    updatePreview();
                }));
            }
            updatePreview();
        }
        const feedback = this.containerEl.createEl('p');
        new Setting(this.containerEl).addButton(button => button.setButtonText('Save settings').setCta().onClick(async () =>
        {
            try {
                if (this.plugin.busy) throw Error('Wait for the current write.');
                validateUserName(userName);
                await this.plugin.saveSettings(draft);
                this.plugin.saveUserName(userName);
                feedback.setText('Saved. User name stays local; records were not migrated.');
            } catch (error) { feedback.setText(message(error)); }
        }));
    }
}
