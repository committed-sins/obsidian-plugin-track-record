import { Notice, Plugin, moment, type TFile } from 'obsidian';
import { DEFAULTS, validateSettings, type Settings } from './settings';
import { ownedOpenTimers, validateRecord, validateUserName, type RecordEntry, type Subject } from './records';
import { formatElapsed, instant, utcTimestamp } from './timestamps';
import { LegacyTimer } from './legacy-timer';
import { matchesObservation, observationKey, observeTimers, pendingObservations, readPresence, unresolvedObservations, type PresenceReason, type TimerObservation } from './presence';
import { errorMessage, objectProperties } from './plugin-helpers';
import { RecordVault, type RecordSnapshot } from './record-vault';
import { RecordEntryDialog } from './record-entry-dialog';
import { TimerInterruptionDialog } from './interruption-dialog';
import { LegacyTimerRecoveryDialog } from './legacy-recovery-dialog';
import { RecordHistoryView } from './record-history-view';
import { RecordSettingsTab } from './record-settings-tab';

const TIMER_VIEW = 'track-record-timer';
const STATUS_VIEW = 'track-record-status';
const LEGACY_VIEW = 'track-record-history';
const VIEW_TYPES = [TIMER_VIEW, STATUS_VIEW, LEGACY_VIEW];
const LOCAL_KEY = 'track-record:timer:v1';
const USER_KEY = 'track-record:user-name:v1';
const PRESENCE_KEY = 'track-record:presence:v1';
const LEGACY_PROFILES = [
    validateSettings({ ...DEFAULTS, startProperty: 'time_start', endProperty: 'time_end', statusStartProperty: 'time_start' }),
    validateSettings({ ...DEFAULTS, startProperty: 'timer.start', endProperty: 'timer.end', statusStartProperty: 'time_start' })
];

export default class TrackRecordPlugin extends Plugin
{
    settings: Settings = { ...DEFAULTS };
    legacyTimer!: LegacyTimer;
    userName = '';
    records!: RecordVault;
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
    presenceReady: Promise<void> = Promise.resolve();
    private presenceInitialized = false;
    private presenceEnabled = true;
    private quitting = false;
    private pendingInterruptions: TimerObservation[] = [];
    private offeredInterruptions = new Set<string>();
    private interruptionModal: TimerInterruptionDialog | null = null;

    async onload(): Promise<void>
    {
        try {
            const saved: unknown = await this.loadData();
            const savedProperties = objectProperties(saved);
            this.settings = validateSettings(saved ?? DEFAULTS);
            this.readProfiles = Array.isArray(savedProperties?.readProfiles) ? savedProperties.readProfiles.map((profile: unknown) => validateSettings(profile)) : [];
            this.ready = true;
        }
        catch (error) {
            new Notice(`Track Record: ${errorMessage(error)} Fix settings before writing.`, 10000);
            this.settings = { ...DEFAULTS };
            // Do not overwrite malformed saved configuration or enable writes with fallback mappings.
            this.ready = false;
        }
        const savedUser: unknown = this.app.loadLocalStorage(USER_KEY);
        try { this.userName = validateUserName(savedUser ?? ''); }
        catch (error) { new Notice(`Track Record: ${errorMessage(error)} Set the current user in settings.`); this.ready = false; }
        try { this.pendingInterruptions = pendingObservations(readPresence(this.app.loadLocalStorage(PRESENCE_KEY))); }
        catch (error) { this.presenceEnabled = false; new Notice(`Track Record: ${errorMessage(error)} Timer reminders are unavailable.`, 12000); }
        this.records = new RecordVault(this.app, () => this.profiles());
        // Read-only compatibility path until the user explicitly recovers an old preview draft.
        this.legacyTimer = new LegacyTimer({
            read: (): unknown => this.app.loadLocalStorage(LOCAL_KEY),
            write: value => this.app.saveLocalStorage(LOCAL_KEY, value)
        }, this.records, this.session);
        this.registerView(TIMER_VIEW, leaf => new RecordHistoryView(leaf, this, 'time', TIMER_VIEW));
        this.registerView(STATUS_VIEW, leaf => new RecordHistoryView(leaf, this, 'status', STATUS_VIEW));
        // Keep existing workspace leaves functional without rewriting the user's layout.
        this.registerView(LEGACY_VIEW, leaf => new RecordHistoryView(leaf, this, 'time', LEGACY_VIEW));
        this.addSettingTab(new RecordSettingsTab(this));
        this.bar = this.addStatusBarItem();
        this.bar.addClass('track-record-bar');
        this.registerDomEvent(this.bar, 'click', () =>
        {
            void this.openHistory();
        });
        this.registerInterval(window.setInterval(() => this.updateBar(), 1000));
        this.addRibbonIcon('timer', 'Track Record: open timer view', () =>
        {
            void this.openHistory();
        });
        this.addRibbonIcon('workflow', 'Track Record: open status view', () =>
        {
            void this.openHistory('status');
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
            id: 'open-history', name: 'Open timer view', callback: () =>
            {
                void this.openHistory();
            }
        });
        this.addCommand({
            id: 'open-status-history', name: 'Open status view', callback: () =>
            {
                void this.openHistory('status');
            }
        });
        this.addCommand({
            id: 'review-interrupted-timers', name: 'Review timers that ran while away', callback: () =>
            {
                void this.reviewInterruptedTimers();
            }
        });
        this.registerInterval(window.setInterval(() => this.checkpointPresence('active'), 30000));
        this.registerEvent(this.app.workspace.on('quit', () =>
        {
            this.quitting = true;
            this.checkpointPresence('quit');
        }));
        this.addCommand({
            id: 'recover-timer', name: 'Recover legacy timer', callback: () =>
            {
                void this.recoverTimer();
            }
        });
        this.registerEvent(this.app.workspace.on('file-open', file =>
        {
            if (file && this.records.isSubject(file)) this.selected = this.records.cachedSubject(file);
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
            } catch (error) { new Notice(`Track Record: ${errorMessage(error)}`); }
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
            if (file && this.records.isSubject(file)) this.selected = this.records.cachedSubject(file);
            this.updateBar();
            try {
                if (this.legacyTimer.get()) new Notice('Track Record: a local timer from an older preview is available. Use Recover legacy timer before starting a new timer.', 12000);
            } catch (error) { new Notice(`Track Record: ${errorMessage(error)}`, 12000); }
            this.presenceReady = this.initializePresence();
        });
    }

    onunload(): void
    {
        if (!this.quitting) this.checkpointPresence('unload');
        this.alive = false;
        this.interruptionModal?.close();
        window.clearTimeout(this.refreshTimeout);
        // Closing the app/plugin writes only a local reminder, never an end time.
    }

    private async initializePresence(): Promise<void>
    {
        try {
            const snapshot = await this.snapshot();
            if (!this.alive || !this.presenceEnabled) return;
            this.presenceInitialized = true;
            this.reconcileInterruptions(snapshot.records, snapshot.errors);
            this.checkpointPresence('active');
            this.offerInterruption();
            this.updateBar();
            this.refreshViews();
        } catch (error) { new Notice(`Track Record: could not check interrupted timers: ${errorMessage(error)}`, 10000); }
    }

    checkpointPresence(reason: PresenceReason): void
    {
        if (!this.alive || !this.presenceEnabled || !this.presenceInitialized || (this.quitting && reason !== 'quit')) return;
        try {
            this.app.saveLocalStorage(PRESENCE_KEY, {
                version: 1,
                current: observeTimers(this.activeTimers, this.userName, utcTimestamp(), reason),
                pending: this.pendingInterruptions
            });
        } catch (error) {
            this.presenceEnabled = false;
            new Notice(`Track Record: could not save the local timer reminder: ${errorMessage(error)}`, 10000);
        }
    }

    private reconcileInterruptions(records: RecordEntry[], errors: string[]): void
    {
        if (!this.presenceInitialized) return;
        const pending = unresolvedObservations(this.pendingInterruptions, records, errors);
        const changed = pending.length !== this.pendingInterruptions.length;
        this.pendingInterruptions = pending;
        if (changed) this.checkpointPresence('active');
        this.offerInterruption();
    }

    private offerInterruption(): boolean
    {
        if (!this.alive || !this.presenceEnabled || !this.presenceInitialized || this.interruptionModal) return false;
        const observation = this.pendingInterruptions.find(item => !this.offeredInterruptions.has(observationKey(item)) && this.activeTimers.some(record => matchesObservation(item, record, this.userName)));
        if (!observation) return false;
        this.offeredInterruptions.add(observationKey(observation));
        const record = this.activeTimers.find(candidate => matchesObservation(observation, candidate, this.userName))!;
        this.interruptionModal = new TimerInterruptionDialog(this, observation, record, () =>
        {
            this.interruptionModal = null;
        });
        this.interruptionModal.open();
        return true;
    }

    async reviewInterruptedTimers(notify = true): Promise<void>
    {
        await this.presenceReady;
        this.offeredInterruptions.clear();
        await this.snapshot();
        if (!this.interruptionModal && !this.offerInterruption() && notify) new Notice('Track Record: no matching interrupted timers are currently available.');
    }

    async resolveInterruption(observation: TimerObservation, end?: string): Promise<void>
    {
        if (observation.user !== this.userName) throw Error('Current user changed; reopen the timer reminder.');
        if (!this.pendingInterruptions.some(item => observationKey(item) === observationKey(observation))) throw Error('This reminder has already been resolved.');
        const snapshot = await this.snapshot();
        if (end !== undefined) {
            if (snapshot.errors.length) throw Error('Review invalid records in history before changing timers.');
            const record = snapshot.records.find(candidate => matchesObservation(observation, candidate, this.userName));
            if (record) await this.records.closeTimers([record], end);
        }
        this.pendingInterruptions = this.pendingInterruptions.filter(item => observationKey(item) !== observationKey(observation));
        await this.snapshot();
        this.checkpointPresence('active');
    }

    async run(action: () => Promise<void>): Promise<void>
    {
        if (this.busy) { new Notice('Track Record: wait for the current operation.'); return; }
        this.busy = true;
        try {
            if (!this.ready) throw Error('Save valid Track Record settings before writing.');
            await action();
        } catch (error) { new Notice(`Track Record: ${errorMessage(error)}`, 10000); }
        finally { this.busy = false; this.updateBar(); this.refreshViews(); }
    }

    profiles(): Settings[]
    {
        return [this.settings, ...this.readProfiles, ...LEGACY_PROFILES];
    }

    saveUserName(value: string): void
    {
        if (this.busy) throw Error('Wait for the current operation before changing the current user.');
        const name = validateUserName(value);
        this.app.saveLocalStorage(USER_KEY, name || null);
        this.userName = name;
        this.checkpointPresence('active');
        this.offerInterruption();
        this.updateBar();
        this.refreshViews();
    }

    private activeFile(): TFile
    {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.records.isSubject(file)) throw Error('Open the note you want to track first.');
        return file;
    }

    async startTimer(target?: Subject): Promise<void>
    {
        validateUserName(this.userName);
        if (this.legacyTimer.get()) throw Error('Recover or discard the legacy preview timer before starting a new timer.');
        const subject = target ? await this.records.resolveSubject(target) : await this.records.subject(this.activeFile());
        const switchTime = utcTimestamp();
        const snapshot = await this.snapshot();
        if (snapshot.errors.length) throw Error('Review invalid records in history before changing timers.');
        const previous = ownedOpenTimers(snapshot.records, this.userName);
        await this.records.closeTimers(previous, switchTime);
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
            await this.records.closeTimers(active, end);
            await this.snapshot();
            new Notice(`Track Record: stopped ${active.length} timer(s).`);
        });
    }

    currentTimer(): RecordEntry | null
    {
        return ownedOpenTimers(this.activeTimers, this.userName)[0] ?? null;
    }

    async recoverTimer(): Promise<void>
    {
        try {
            const draft = this.legacyTimer.get();
            if (!draft) throw Error('There is no legacy preview timer. Open Markdown timers can be stopped normally.');
            new LegacyTimerRecoveryDialog(this, draft).open();
        } catch (error) { new Notice(`Track Record: ${errorMessage(error)}`); }
    }

    async prepareModal(kind: 'time' | 'status', target?: Subject): Promise<void>
    {
        try {
            const subject = target ? await this.records.resolveSubject(target) : await this.records.subject(this.activeFile());
            const statuses = kind === 'status' ? [...new Set((await this.snapshot()).records.filter(record => record.kind === 'status').map(record => record.status!))].sort((a, b) => a.localeCompare(b)) : [];
            new RecordEntryDialog(this, subject, kind, statuses).open();
        } catch (error) { new Notice(`Track Record: ${errorMessage(error)}`); }
    }

    async saveEntry(entry: RecordEntry): Promise<string>
    {
        const path = await this.records.saveEntry(entry);
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

    async snapshot(): Promise<RecordSnapshot>
    {
        const generation = ++this.snapshotGeneration;
        const { records, errors } = await this.records.scan();
        if (generation === this.snapshotGeneration) {
            this.activeTimers = records.filter(record => record.kind === 'time' && !record.end);
            this.reconcileInterruptions(records, errors);
            this.checkpointPresence('active');
        }
        return { records, errors };
    }

    async openHistory(kind: 'time' | 'status' = 'time'): Promise<void>
    {
        const file = this.app.workspace.getActiveFile();
        if (file && this.records.isSubject(file)) {
            try { this.selected = await this.records.subject(file); }
            catch (error) { new Notice(`Track Record: ${errorMessage(error)}`); }
        }
        const type = kind === 'time' ? TIMER_VIEW : STATUS_VIEW;
        let leaf = this.app.workspace.getLeavesOfType(type)[0] ?? (kind === 'time' ? this.app.workspace.getLeavesOfType(LEGACY_VIEW)[0] : undefined);
        if (!leaf) {
            leaf = this.app.workspace.getRightLeaf(true) ?? this.app.workspace.getLeaf(true);
            await leaf.setViewState({ type, active: true });
        }
        await this.app.workspace.revealLeaf(leaf);
        this.refreshViews();
    }

    refreshViews(): void
    {
        if (!this.alive) return;
        for (const leaf of VIEW_TYPES.flatMap(type => this.app.workspace.getLeavesOfType(type))) {
            if (leaf.view instanceof RecordHistoryView) void leaf.view.refresh();
        }
    }

    formatTimestamp(value: string, format = this.settings.dateTimeFormat): string
    {
        return moment(instant(value)).format(format);
    }

    updateBar(): void
    {
        if (!this.alive || !this.bar) return;
        try {
            const timer = this.currentTimer();
            const state = timer ? `${this.userName || 'Unassigned'} · ${formatElapsed(Date.now() - instant(timer.start))}` : 'idle';
            this.bar.setText(`Track Record: ${state}`);
            this.bar.setAttribute('aria-label', 'Open Track Record Timer');
            for (const leaf of VIEW_TYPES.flatMap(type => this.app.workspace.getLeavesOfType(type))) {
                if (leaf.view instanceof RecordHistoryView) leaf.view.updateClock();
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
