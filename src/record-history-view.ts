import { ItemView, Setting, setIcon, type WorkspaceLeaf } from 'obsidian';
import { duration, historyWarnings, ownedOpenTimers, recordSubjects, relatesTo } from './records';
import { formatElapsed, instant } from './timestamps';
import { type RecordSnapshot } from './record-vault';
import { errorMessage } from './plugin-helpers';
import type TrackRecordPlugin from './main';

export class RecordHistoryView extends ItemView
{
    private generation = 0;
    private allRecords = false;
    private clocks = new Map<string, HTMLElement>();

    constructor(leaf: WorkspaceLeaf, private plugin: TrackRecordPlugin, private readonly kind: 'time' | 'status', private readonly viewType: string)
    {
        super(leaf);
    }

    getViewType(): string
    {
        return this.viewType;
    }

    getDisplayText(): string
    {
        return this.kind === 'time' ? 'Track Record Timer' : 'Track Record Status';
    }

    getIcon(): string
    {
        return this.kind === 'time' ? 'timer' : 'workflow';
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
            clock.setText(timer ? `Running · ${formatElapsed(Date.now() - instant(timer.start))}` : 'Stopped');
        }
    }

    async refresh(): Promise<void>
    {
        const generation = ++this.generation;
        let snapshot: RecordSnapshot;
        try { snapshot = await this.plugin.snapshot(); }
        catch (error) { snapshot = { records: [], errors: [errorMessage(error)] }; }
        if (generation !== this.generation) return;
        const root = this.contentEl;
        root.empty();
        this.clocks.clear();
        root.addClass('track-record-view');
        const selected = this.plugin.selected;
        const dashboard = root.createDiv({ cls: 'track-record-dashboard' });
        const current = dashboard.createDiv({ cls: 'track-record-current' });
        current.createDiv({ text: 'Current note', cls: 'track-record-label' });
        current.createEl('strong', { text: selected ? selected.path.replace(/\.md$/i, '') : 'Open a note to start tracking' });
        const ownTimers = ownedOpenTimers(snapshot.records, this.plugin.userName);
        const runningHere = selected && ownTimers.some(timer => relatesTo(timer, selected));
        if (selected && this.kind === 'time') {
            new Setting(current).addButton(button => button.setButtonText(runningHere ? 'Stop timer' : ownTimers.length ? 'Start timer here' : 'Start timer').setCta().setDisabled(this.plugin.busy).onClick(async () =>
            {
                if (runningHere) await this.plugin.stopTimer();
                else await this.plugin.run(async () => this.plugin.startTimer(selected));
            })).addButton(button => button.setButtonText('Add time').onClick(() => this.plugin.prepareModal('time', selected)));
        }
        if (selected && this.kind === 'status') new Setting(current).addButton(button => button.setButtonText('Record status').setCta().onClick(() => this.plugin.prepareModal('status', selected)));
        for (const timer of this.kind === 'time' ? this.plugin.activeTimers : []) {
            const active = dashboard.createDiv({ cls: 'track-record-running' });
            this.clocks.set(timer.id, active.createEl('strong'));
            active.createDiv({ text: timer.user ?? 'No user', cls: 'track-record-label' });
            active.createDiv({ text: recordSubjects(timer).map(target => target.path.replace(/\.md$/i, '')).join(', '), cls: 'track-record-subtle' });
            active.createDiv({ text: `Started ${this.plugin.formatTimestamp(timer.start)}`, cls: 'track-record-subtle' });
            if ((timer.user ?? '') === this.plugin.userName && !runningHere) new Setting(active).addButton(button => button.setButtonText('Stop timer').onClick(() => this.plugin.stopTimer()));
        }
        this.updateClock();
        try {
            if (this.plugin.legacyTimer.get()) new Setting(root).setName('Timer from an older preview').addButton(button => button.setButtonText('Recover legacy timer').onClick(() => this.plugin.recoverTimer()));
        } catch (error) { root.createEl('p', { text: errorMessage(error), cls: 'track-record-warning' }); }
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
        const records = snapshot.records.filter(record => record.kind === this.kind && (this.allRecords || !selected || relatesTo(record, selected)));
        const warnings = [...snapshot.errors, ...historyWarnings(snapshot.records.filter(record => record.kind === this.kind))];
        for (const warning of warnings) root.createEl('p', { text: warning, cls: 'track-record-warning' });
        const ambiguousTime = snapshot.errors.length > 0 || warnings.some(warning => /totals are withheld/.test(warning));
        root.createEl('p', { cls: 'track-record-summary', text: this.kind === 'status' ? `${records.length} status ${records.length === 1 ? 'event' : 'events'}` : ambiguousTime ? 'Work total withheld; review warnings.' : `Recorded work · ${formatElapsed(records.reduce((total, record) => total + duration(record), 0))}` });
        records.sort((a, b) => instant(b.start) - instant(a.start) || a.id.localeCompare(b.id));
        if (!records.length) root.createEl('p', { text: 'No records. Open a note and use the Track Record commands to start tracking.' });
        for (const record of records) {
            const row = root.createDiv({ cls: 'track-record-entry' });
            row.createEl('strong', { text: record.kind === 'time' ? `Timer · ${record.end ? formatElapsed(duration(record)) : 'Open'}` : `Status · ${record.status}` });
            row.createDiv({ text: this.plugin.formatTimestamp(record.start) + (record.end ? ` \u2192 ${this.plugin.formatTimestamp(record.end)}` : ''), attr: { title: record.start + (record.end ? ` \u2192 ${record.end}` : '') } });
            if (record.kind === 'time' && record.user) row.createDiv({ text: record.user });
            if (recordSubjects(record).length > 1) row.createDiv({ text: 'Shared record · counts once in the all-notes total' });
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
