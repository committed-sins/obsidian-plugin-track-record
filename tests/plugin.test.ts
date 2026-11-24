import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { App, PluginManifest, TFile as ObsidianFile } from 'obsidian';
import TrackRecord from '../src/main';
import { TFile, TFolder, modals, settings, notices, suggestions, Plugin as MockPlugin } from './obsidian';
import { parse } from 'yaml';

function fixture()
{
    const content = '---\nid: subject-1\nstatus: planned\n---\n\n- [ ] Keep this task\n';
    const source = new TFile('notes/Example.md');
    const files = new Map<string, TFile | TFolder>([[source.path, source], ['notes', new TFolder('notes')]]);
    const texts = new Map([[source.path, content]]);
    const state = new Map<string, unknown>();
    let failCreate = false;
    let failProcess = false;
    const events = new Map<string, (...args: unknown[]) => void>();
    const workspaceEvents = new Map<string, (...args: unknown[]) => void>();
    const app = {
        loadLocalStorage: (key: string) => structuredClone(state.get(key) ?? null),
        saveLocalStorage: (key: string, value: unknown) => state.set(key, structuredClone(value)),
        vault: {
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile),
            read: async (file: TFile) => texts.get(file.path)!,
            process: async (file: TFile, update: (text: string) => string) =>
            {
                if (failProcess) throw Error('disk unavailable');
                const text = update(texts.get(file.path)!);
                texts.set(file.path, text);
                return text;
            },
            createFolder: async (path: string) =>
            {
                files.set(path, new TFolder(path));
            },
            create: async (path: string, text: string) =>
            {
                if (failCreate) throw Error('disk unavailable');
                if (files.has(path)) throw Error('exists');
                files.set(path, new TFile(path));
                texts.set(path, text);
            },
            on: (name: string, callback: (...args: unknown[]) => void) =>
            {
                const previous = events.get(name);
                events.set(name, (...args) =>
                {
                    previous?.(...args); callback(...args);
                });
            }
        },
        metadataCache: {
            getFileCache: (file: TFile) =>
            {
                const match = /^---\n([\s\S]*?)\n---/.exec(texts.get(file.path) ?? '');
                return { frontmatter: match ? parse(match[1]) : null };
            },
            getFirstLinkpathDest: (path: string) => files.get(path) ?? null
        },
        workspace: {
            getActiveFile: () => source,
            getLeavesOfType: () => [],
            on: (name: string, callback: (...args: unknown[]) => void) =>
            {
                workspaceEvents.set(name, callback);
            },
            onLayoutReady: (callback: () => void) => callback()
        }
    };
    return {
        app: app as unknown as App, source: source as unknown as ObsidianFile, texts, content, files, events, workspaceEvents, state,
        plugin: () => new TrackRecord(app as unknown as App, {} as PluginManifest),
        setFailure: (value: boolean) =>
        {
            failCreate = value;
        },
        setProcessFailure: (value: boolean) =>
        {
            failProcess = value;
        }
    };
}

// Exercise real plugin commands against the Obsidian boundary, without pretending to test its UI renderer.
(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () =>
    {
    }
};

test('load and explicit time/status writes never edit the source note', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    assert.equal(f.texts.size, 1);
    const subject = await plugin.subject(f.source);
    await plugin.saveEntry(plugin.newEntry(subject, 'time', '2026-11-19T09:00:00+01:00', '2026-11-19T10:00:00+01:00', '', 'worked'));
    await plugin.saveEntry(plugin.newEntry(subject, 'status', '2026-11-19T11:00:00+01:00', '', 'ongoing', ''));
    assert.equal(f.texts.get(f.source.path), f.content);
    const snapshot = await plugin.snapshot();
    assert.equal(snapshot.records.length, 2);
    assert.deepEqual(snapshot.errors, []);
    assert.equal(snapshot.records.find(record => record.kind === 'status')!.status, 'ongoing');
    plugin.onunload();
    assert.equal(f.texts.size, 3);
});

test('timer resolves a note renamed while active and preserves the source content', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    await plugin.saveEntry(plugin.newEntry(await plugin.subject(f.source), 'status', '2026-11-19T08:00:00+01:00', '', 'active', ''));
    await plugin.saveEntry(plugin.newEntry(await plugin.subject(f.source), 'time', '2026-11-19T09:00:00+01:00', '', '', '', true));
    const oldPath = f.source.path;
    f.source.path = 'notes/Renamed.md';
    f.files.delete(oldPath);
    f.files.set(f.source.path, f.source);
    f.texts.delete(oldPath);
    f.texts.set(f.source.path, f.content);
    f.events.get('rename')!(f.source, oldPath);
    // Simulate Obsidian's native wikilink update for records without private subject metadata.
    for (const [path, text] of f.texts) {
        if (path !== f.source.path) f.texts.set(path, text.replace('[[notes/Example]]', '[[notes/Renamed]]'));
    }
    await plugin.stopTimer();
    assert.equal(plugin.currentTimer(), null);
    const records = (await plugin.snapshot()).records;
    assert.equal(records.length, 2);
    assert.ok(records.every(record => record.subject.path === f.source.path));
    assert.equal(f.texts.get(f.source.path), f.content);
});

test('starting a timer closes the previous local timer at exactly the new start time', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    const previous = await plugin.subject(f.source);
    await plugin.saveEntry(plugin.newEntry(previous, 'time', '2026-11-19T08:00:00+01:00', '', '', '', true));
    const next = new TFile('notes/Other.md');
    f.files.set(next.path, next);
    f.texts.set(next.path, '---\nid: subject-2\n---\n');
    await plugin.startTimer({ path: next.path, id: 'subject-2' });
    const snapshot = await plugin.snapshot();
    assert.equal(snapshot.records.length, 2);
    const closed = snapshot.records.find(record => record.end)!;
    assert.equal(closed.subject.path, previous.path);
    assert.equal(closed.end, plugin.currentTimer()!.start);
    assert.equal(plugin.currentTimer()!.subject.path, next.path);
});

test('failed automatic stop prevents starting the replacement timer', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    const subject = await plugin.subject(f.source);
    await plugin.saveEntry(plugin.newEntry(subject, 'time', '2026-11-19T08:00:00+01:00', '', '', '', true));
    await plugin.snapshot();
    const id = plugin.currentTimer()!.id;
    f.setProcessFailure(true);
    await assert.rejects(plugin.startTimer(subject), /disk unavailable/);
    assert.equal(plugin.currentTimer()!.id, id);
    assert.equal((await plugin.snapshot()).records.length, 1);
    assert.equal(plugin.currentTimer()!.end, undefined);
});

test('settings retain older property profiles outside Markdown records', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    await plugin.saveEntry(plugin.newEntry(await plugin.subject(f.source), 'time', '2026-11-19T09:00:00+01:00', '2026-11-19T10:00:00+01:00', '', ''));
    await plugin.saveSettings({ ...plugin.settings, timerFolder: 'new/timers', timeTag: 'work/timer', startProperty: 'began' });
    const snapshot = await plugin.snapshot();
    assert.equal(snapshot.records.length, 1);
    assert.deepEqual(snapshot.errors, []);
    assert.ok(plugin.readProfiles.length > 0);
    const newInstance = f.plugin();
    (newInstance as unknown as MockPlugin).data = (plugin as unknown as MockPlugin).data;
    await newInstance.onload();
    assert.equal((await newInstance.snapshot()).records.length, 1);
    assert.ok([...f.texts.values()].every(text => !text.includes('track_record:')));
});

test('settings distinguish Timer and Status folders from tag inputs', async t =>
{
    const previousZone = process.env.TZ;
    process.env.TZ = 'Europe/Vienna';
    t.after(() =>
    {
        if (previousZone === undefined) delete process.env.TZ;
        else process.env.TZ = previousZone;
    });
    settings.length = 0;
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    (plugin as unknown as MockPlugin).settingTabs[0].display();
    const folders = settings.filter(setting => setting.name === 'Save in folder');
    const tags = settings.filter(setting => setting.name === 'Identify by tag');
    assert.equal(folders.length, 2);
    assert.equal(tags.length, 2);
    assert.equal(tags[0].controls[0].text, '#record/time');
    folders[1].controls[0].change('records/statuses');
    tags[1].controls[0].change('#record/state');
    const displaySetting = settings.find(setting => setting.name === 'Date/time display format')!;
    assert.ok(displaySetting.descEl.children.some(node => node.text.startsWith('Example: ')));
    const filenameSettings = settings.filter(setting => setting.name === 'Filename format');
    assert.equal(filenameSettings.length, 2);
    assert.ok(filenameSettings.every(setting => setting.descEl.children.some(node => node.text.startsWith('Example: '))));
    const displayFormat = displaySetting.controls[0];
    assert.equal(displayFormat.text, 'YYYY-MM-DD HH:mm:ss');
    displayFormat.change('DD.MM.YYYY HH:mm');
    assert.match(plugin.formatTimestamp('2026-11-19T09:00:00+01:00'), /^2026-11-19 \d{2}:\d{2}:00$/);
    const save = settings.flatMap(setting => setting.controls).find(control => control.text === 'Save settings')!;
    await save.click();
    assert.equal(plugin.settings.timerFolder, 'records/track-record');
    assert.equal(plugin.settings.statusFolder, 'records/statuses');
    assert.equal(plugin.settings.statusTag, 'record/state');
    assert.equal(plugin.settings.dateTimeFormat, 'DD.MM.YYYY HH:mm');
    assert.match(plugin.formatTimestamp('2026-11-19T09:00:00+01:00'), /^19\.11\.2026 \d{2}:\d{2}$/);
});

test('sidebar exposes current-note timer controls and a ticking timer without losing note scope', async () =>
{
    settings.length = 0;
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    const view = (plugin as unknown as MockPlugin).views.get('track-record-history')!({}) as unknown as { refresh(): Promise<void>; updateClock(): void; contentEl: import('./obsidian').Element };
    await view.refresh();
    const start = settings.flatMap(setting => setting.controls).find(control => control.text === 'Start timer')!;
    assert.ok(start);
    await start.click();
    settings.length = 0;
    await view.refresh();
    assert.ok(settings.flatMap(setting => setting.controls).some(control => control.text === 'Stop timer'));
    const flatten = (node: import('./obsidian').Element): string => node.text + node.children.map(flatten).join();
    view.updateClock();
    assert.match(flatten(view.contentEl), /Running ·/);
    const nodes = (node: import('./obsidian').Element): import('./obsidian').Element[] => [node, ...node.children.flatMap(nodes)];
    assert.equal(nodes(view.contentEl).some(node => node.tag === 'h3'), false);
    const scopes = nodes(view.contentEl).filter(node => ['This note', 'All notes'].includes(node.text));
    assert.equal(scopes[0].attributes.get('aria-pressed'), 'true');
    assert.equal(scopes[1].attributes.get('aria-pressed'), 'false');
    scopes[1].events.get('click')!();
    await view.refresh();
    assert.equal(nodes(view.contentEl).find(node => node.text === 'All notes')!.attributes.get('aria-pressed'), 'true');
    assert.equal(plugin.selected!.path, f.source.path);
});

test('manual dialog validation remains editable and failed saves retry the original ID', async () =>
{
    settings.length = 0;
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    await plugin.prepareModal('time');
    const modal = modals.at(-1)!;
    const start = settings.find(setting => setting.name === 'Start')!.controls[0];
    const end = settings.find(setting => setting.name === 'End')!.controls[0];
    const save = settings.flatMap(setting => setting.controls).find(control => control.text === 'Save record')!;
    await save.click();
    assert.equal(modal.closed, false);
    assert.equal(save.disabled, false);
    assert.equal(start.inputEl.type, 'datetime-local');
    assert.equal(end.inputEl.type, 'datetime-local');
    start.change('2026-11-19T09:00:00');
    end.change('2026-11-19T10:00:00');
    f.setFailure(true);
    await save.click();
    assert.equal(modal.closed, false);
    f.setFailure(false);
    await save.click();
    assert.equal(modal.closed, true);
    assert.equal((await plugin.snapshot()).records.length, 1);
});

test('duplicate note IDs and malformed record files are visible, never repaired automatically', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    const duplicate = new TFile('duplicate.md');
    f.files.set(duplicate.path, duplicate);
    f.texts.set(duplicate.path, f.content);
    await assert.rejects(plugin.subject(f.source), /Duplicate subject ID/);
    const broken = new TFile('records/track-record/broken.md');
    f.files.set(broken.path, broken);
    f.texts.set(broken.path, '---\ntrack_record:\n  version: 999\n---\n');
    const snapshot = await plugin.snapshot();
    assert.equal(snapshot.errors.length, 1);
    assert.match(snapshot.errors[0], /Unsupported/);
    assert.equal(f.texts.get(f.source.path), f.content);
});

test('invalid saved settings pause commands instead of silently writing with defaults', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    (plugin as unknown as MockPlugin).data = { folder: '../bad' };
    await plugin.onload();
    await plugin.run(async () => plugin.startTimer());
    assert.equal(plugin.currentTimer(), null);
    assert.ok(notices.some(notice => notice.includes('Save valid Track Record settings')));
});

test('running timers survive reload; an optional current user stays local', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    plugin.saveUserName('Desktop');
    await plugin.startTimer();
    const active = plugin.currentTimer()!;
    assert.ok(active.path);
    assert.match(f.texts.get(active.path!)!, /user: Desktop/);
    assert.deepEqual([...f.state.keys()].sort(), ['track-record:presence:v1', 'track-record:user-name:v1']);
    assert.ok(!f.texts.get(active.path!)!.includes('\nid:'));
    const reloaded = f.plugin();
    await reloaded.onload();
    await reloaded.snapshot();
    assert.equal(reloaded.userName, 'Desktop');
    assert.equal(reloaded.currentTimer()!.id, active.id);
    const when = new Date(Date.parse(active.start) + 1000).toISOString();
    await reloaded.closeTimers([reloaded.currentTimer()!], when);
    await reloaded.snapshot();
    assert.equal(reloaded.currentTimer(), null);
});

test('Start closes the same user across devices and leaves other users open', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    plugin.saveUserName('Desktop');
    const subject = await plugin.subject(f.source);
    for (const user of ['Desktop', 'Desktop', 'Phone']) {
        await plugin.saveEntry({ ...plugin.newEntry(subject, 'time', '2026-11-19T08:00:00Z', '', '', '', true), user });
    }
    await plugin.startTimer();
    const records = (await plugin.snapshot()).records;
    const closed = records.filter(record => record.end);
    assert.equal(closed.length, 2);
    assert.equal(records.filter(record => !record.end && record.user === 'Phone').length, 1);
    assert.ok(closed.every(record => record.end === plugin.currentTimer()!.start));
});

test('no configured user closes only unassigned timers, even with a legacy reset-all flag', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    assert.equal(plugin.userName, '');
    const subject = await plugin.subject(f.source);
    await plugin.saveEntry(plugin.newEntry(subject, 'time', '2026-11-19T08:00:00Z', '', '', '', true));
    await plugin.saveEntry({ ...plugin.newEntry(subject, 'time', '2026-11-19T08:00:00Z', '', '', '', true), user: 'Alice' });
    (plugin.settings as unknown as { resetAllTimersActive: boolean }).resetAllTimersActive = true;
    await plugin.startTimer();
    const records = (await plugin.snapshot()).records;
    assert.equal(records.find(record => record.user === 'Alice')!.end, undefined);
    assert.equal(records.filter(record => !record.end).length, 2);
    assert.equal(records.filter(record => !record.user && record.end).length, 1);
});

test('Start preflights every selected timer before closing any of them', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    for (const start of ['2026-11-19T08:00:00Z', '2099-01-01T08:00:00Z']) {
        await plugin.saveEntry(plugin.newEntry(await plugin.subject(f.source), 'time', start, '', '', '', true));
    }
    await assert.rejects(plugin.startTimer(), /End must be after start/);
    const records = (await plugin.snapshot()).records;
    assert.equal(records.length, 2);
    assert.ok(records.every(record => !record.end));
});

test('unconfigured-user Stop never closes an assigned user timer or adopts an old device name', async () =>
{
    const f = fixture();
    f.state.set('track-record:device-name:v1', 'Alice');
    const plugin = f.plugin();
    await plugin.onload();
    assert.equal(plugin.userName, '');
    const subject = await plugin.subject(f.source);
    await plugin.saveEntry(plugin.newEntry(subject, 'time', '2026-11-19T08:00:00Z', '', '', '', true));
    await plugin.saveEntry({ ...plugin.newEntry(subject, 'time', '2026-11-19T08:00:00Z', '', '', '', true), user: 'Alice' });
    await plugin.stopTimer();
    const records = (await plugin.snapshot()).records;
    assert.equal(records.find(record => record.user === 'Alice')!.end, undefined);
    assert.ok(records.find(record => !record.user)!.end);
});

test('subject picker excludes records and duplicates; Ctrl+Enter saves Markdown under the configured heading', async () =>
{
    settings.length = 0;
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    await plugin.saveSettings({ ...plugin.settings, notesHeading: 'Work details' });
    const other = new TFile('notes/Other.md');
    f.files.set(other.path, other);
    f.texts.set(other.path, 'Other note');
    await plugin.saveEntry(plugin.newEntry(await plugin.subject(f.source), 'status', '2026-11-19T08:00:00Z', '', 'active', ''));
    await plugin.prepareModal('time');
    const entry = modals.at(-1)!;
    await settings.flatMap(setting => setting.controls).find(control => control.text === 'Add note...')!.click();
    const picker = modals.at(-1)! as unknown as { getItems(): TFile[]; onChooseItem(file: TFile): void };
    assert.deepEqual(picker.getItems().map(file => file.path), [other.path]);
    picker.onChooseItem(other);
    assert.deepEqual(picker.getItems(), []);
    settings.find(setting => setting.name === 'Start')!.controls[0].change('2026-11-19T09:00:00');
    settings.find(setting => setting.name === 'End')!.controls[0].change('2026-11-19T10:00:00');
    const markdown = 'Worked with [[notes/Other]] and [reference](https://example.com).';
    const notes = settings.find(setting => setting.name === 'Notes')!.controls[0];
    assert.ok(notes.inputEl.rows >= 9);
    const noteSection = settings.find(setting => setting.name === 'Notes')!.settingEl;
    assert.ok(noteSection.children.some(node => node.children.some(child => child === settings.find(setting => setting.controls.some(control => control.text === 'Preview Markdown'))!.settingEl)));
    assert.equal(entry.contentEl.children.some(node => /Local time \(/.test(node.text)), false);
    notes.change(markdown);
    await settings.flatMap(setting => setting.controls).find(control => control.text === 'Preview Markdown')!.click();
    let prevented = false;
    entry.scope.handlers.get('Enter')!({
        preventDefault: () =>
        {
            prevented = true;
        }
    });
    while (plugin.busy) await new Promise(resolve => setImmediate(resolve));
    assert.equal(prevented, true);
    assert.equal(entry.closed, true);
    const timer = (await plugin.snapshot()).records.find(record => record.kind === 'time')!;
    assert.deepEqual(timer.subjects!.map(subject => subject.path), [f.source.path, other.path]);
    assert.ok(f.texts.get(timer.path!)!.includes('## Work details\n\n' + markdown));
    assert.equal(f.texts.get(f.source.path), f.content);
});

test('Ctrl+Enter keeps invalid records open; subject selections can be removed', async () =>
{
    settings.length = 0;
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    await plugin.prepareModal('time');
    const entry = modals.at(-1)!;
    const nodes = (node: import('./obsidian').Element): import('./obsidian').Element[] => [node, ...node.children.flatMap(nodes)];
    const remove = nodes(entry.contentEl).find(node => node.tag === 'button' && node.text === '\u00d7')!;
    remove.events.get('click')!();
    entry.scope.handlers.get('Enter')!({
        preventDefault: () =>
        {
        }
    });
    while (plugin.busy) await new Promise(resolve => setImmediate(resolve));
    assert.equal(entry.closed, false);
    assert.equal(f.texts.size, 1);
    assert.ok(nodes(entry.contentEl).some(node => /Link at least one/.test(node.text)));
});

test('status suggestions collect distinct configured record values while allowing new values', async () =>
{
    settings.length = 0;
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    await plugin.saveSettings({ ...plugin.settings, statusProperty: 'record.status' });
    for (const status of ['active', 'planned', 'active']) {
        await plugin.saveEntry(plugin.newEntry(await plugin.subject(f.source), 'status', '2026-11-19T08:00:00Z', '', status, ''));
    }
    await plugin.prepareModal('status');
    const fieldOrder = settings.filter(setting => ['Subject notes', 'Status', 'Effective time', 'Notes'].includes(setting.name)).map(setting => setting.name);
    assert.deepEqual(fieldOrder, ['Subject notes', 'Status', 'Effective time', 'Notes']);
    const subjectSection = settings.find(setting => setting.name === 'Subject notes')!.settingEl;
    assert.ok(subjectSection.children.some(node => node.children.some(chip => chip.children.some(label => label.text === 'notes/Example'))));
    const suggest = suggestions.at(-1)! as unknown as { getSuggestions(query: string): string[]; selectSuggestion(value: string): void };
    assert.deepEqual(suggest.getSuggestions(''), ['active', 'planned']);
    assert.deepEqual(suggest.getSuggestions('ACT'), ['active']);
    suggest.selectSuggestion('active');
    settings.find(setting => setting.name === 'Status')!.controls[0].change('custom value');
    await settings.flatMap(setting => setting.controls).find(control => control.text === 'Save record')!.click();
    assert.equal(modals.at(-1)!.closed, true);
    assert.ok((await plugin.snapshot()).records.some(record => record.status === 'custom value'));
});

test('timer and status windows coexist, reopen independently and retain their own history scope', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    await plugin.onload();
    const subject = await plugin.subject(f.source);
    await plugin.saveEntry(plugin.newEntry(subject, 'time', '2026-11-19T09:00:00Z', '2026-11-19T10:00:00Z', '', ''));
    await plugin.saveEntry(plugin.newEntry(subject, 'status', '2026-11-19T09:00:00Z', '', 'ongoing', ''));
    type View = { refresh(): Promise<void>; getDisplayText(): string; getViewType(): string; contentEl: import('./obsidian').Element };
    type Leaf = { type: string; view: View; setViewState(state: { type: string }): Promise<void> };
    const leaves: Leaf[] = [];
    const factories = (plugin as unknown as MockPlugin).views;
    Object.assign(f.app.workspace, {
        getLeavesOfType: (type: string) => leaves.filter(leaf => leaf.type === type),
        getRightLeaf: (split: boolean) =>
        {
            assert.equal(split, true);
            const leaf = { type: '' } as Leaf;
            leaf.setViewState = async state =>
            {
                leaf.type = state.type;
                leaf.view = factories.get(state.type)!(leaf) as unknown as View;
            };
            leaves.push(leaf);
            return leaf;
        },
        revealLeaf: async () =>
        {
        }
    });
    await plugin.openHistory('time');
    await plugin.openHistory('status');
    await plugin.openHistory('time');
    assert.equal(leaves.length, 2);
    const timer = leaves.find(leaf => leaf.type === 'track-record-timer')!.view;
    const status = leaves.find(leaf => leaf.type === 'track-record-status')!.view;
    assert.equal(timer.getDisplayText(), 'Track Record Timer');
    assert.equal(status.getDisplayText(), 'Track Record Status');
    const nodes = (node: import('./obsidian').Element): import('./obsidian').Element[] => [node, ...node.children.flatMap(nodes)];
    const controlsFor = (view: View) => settings.filter(setting => nodes(view.contentEl).includes(setting.settingEl)).flatMap(setting => setting.controls);
    settings.length = 0;
    await timer.refresh();
    assert.equal(nodes(timer.contentEl).some(node => node.text === 'Status \u00b7 ongoing'), false);
    assert.equal(nodes(timer.contentEl).some(node => node.tag === 'button' && node.text === 'Status'), false);
    assert.equal(controlsFor(timer).some(control => control.text === 'Record status'), false);
    nodes(timer.contentEl).find(node => node.text === 'All notes')!.events.get('click')!();
    await timer.refresh();
    settings.length = 0;
    await status.refresh();
    assert.ok(nodes(status.contentEl).some(node => node.text === 'Status \u00b7 ongoing'));
    assert.equal(nodes(status.contentEl).some(node => /Recorded work|Timer \u00b7/.test(node.text)), false);
    assert.equal(controlsFor(status).some(control => control.text === 'Start timer'), false);
    assert.ok(controlsFor(status).some(control => control.text === 'Record status'));
    assert.equal(nodes(timer.contentEl).find(node => node.text === 'All notes')!.attributes.get('aria-pressed'), 'true');
    assert.equal(nodes(status.contentEl).find(node => node.text === 'This note')!.attributes.get('aria-pressed'), 'true');
    assert.equal(plugin.selected!.path, f.source.path);
    // A restored pre-split workspace leaf remains reusable as the timer window.
    const legacy = { type: 'track-record-history' } as Leaf;
    legacy.view = factories.get(legacy.type)!(legacy) as unknown as View;
    leaves.splice(0, leaves.length, legacy);
    await plugin.openHistory('time');
    assert.equal(leaves.length, 1);
    assert.equal(legacy.view.getDisplayText(), 'Track Record Timer');
    assert.equal(legacy.view.getViewType(), 'track-record-history');
    assert.ok((plugin as unknown as MockPlugin).commands.some(command => command.id === 'open-status-history'));
});

const PRESENCE = 'track-record:presence:v1';
type Presence = import('../src/presence').PresenceState;

async function interruptedFixture(reason: 'active' | 'quit' | 'unload' = 'quit')
{
    const f = fixture();
    const first = f.plugin();
    await first.onload();
    await first.presenceReady;
    first.saveUserName('Alice');
    await first.saveEntry(first.newEntry(await first.subject(f.source), 'time', '2026-11-19T09:00:00Z', '', '', '', true));
    await first.snapshot();
    if (reason === 'quit') f.workspaceEvents.get('quit')!({});
    else first.checkpointPresence(reason);
    const before = structuredClone(f.state.get(PRESENCE)) as Presence;
    first.onunload();
    if (reason === 'active') f.state.set(PRESENCE, before); // Abrupt process termination skips unload.
    const plugin = f.plugin();
    await plugin.onload();
    await plugin.presenceReady;
    return { ...f, first, plugin, observation: (f.state.get(PRESENCE) as Presence).pending[0] };
}

test('quit records a local boundary; restart prompts without automatically ending the timer', async () =>
{
    settings.length = 0;
    const f = await interruptedFixture();
    assert.equal(f.observation.reason, 'quit');
    assert.equal(f.plugin.currentTimer()!.end, undefined);
    assert.equal(modals.at(-1)!.titleEl.text, 'Timer kept running while you were away');
    const path = f.plugin.currentTimer()!.path!;
    const before = f.texts.get(path);
    await settings.flatMap(setting => setting.controls).find(control => control.text === 'Continue timing')!.click();
    assert.equal(f.texts.get(path), before);
    assert.equal((f.state.get(PRESENCE) as Presence).pending.length, 0);
    assert.equal(f.texts.get(f.source.path), f.content);
});

test('ending at the recorded quit time changes only the observed timer, not a new or other-user timer', async () =>
{
    settings.length = 0;
    const f = await interruptedFixture();
    const observed = f.plugin.currentTimer()!.path!;
    const subject = await f.plugin.subject(f.source);
    const another = f.plugin.newEntry(subject, 'time', '2026-11-19T10:00:00Z', '', '', '', true);
    await f.plugin.saveEntry(another);
    await f.plugin.saveEntry({ ...f.plugin.newEntry(subject, 'time', '2026-11-19T11:00:00Z', '', '', '', true), user: 'Bob' });
    await settings.flatMap(setting => setting.controls).find(control => control.text === 'End when Obsidian closed')!.click();
    const records = (await f.plugin.snapshot()).records;
    assert.equal(records.find(record => record.path === observed)!.end, f.observation.at);
    assert.equal(records.filter(record => !record.end).length, 2);
    assert.equal(f.texts.get(f.source.path), f.content);
});

test('crash fallback and plugin unload are labelled as last active; dismissed reminders survive restart', async () =>
{
    for (const reason of ['active', 'unload'] as const) {
        const f = await interruptedFixture(reason);
        const modal = modals.at(-1)!;
        const flatten = (node: import('./obsidian').Element): string => node.text + node.children.map(flatten).join();
        assert.match(flatten(modal.contentEl), /last active|Last active/);
        modal.close();
        f.plugin.checkpointPresence('active');
        const next = new TrackRecord(f.app, {} as PluginManifest);
        await next.onload();
        await next.presenceReady;
        assert.equal((f.state.get(PRESENCE) as Presence).pending[0].at, f.observation.at);
        assert.equal(modals.at(-1)!.closed, false);
    }
});

test('a synced end or replaced start prevents a stale reminder from modifying the note', async () =>
{
    for (const change of ['end', 'start']) {
        const f = await interruptedFixture();
        const timer = f.plugin.currentTimer()!;
        const path = timer.path!;
        if (change === 'end') await f.plugin.closeTimers([timer], '2026-11-19T10:00:00Z');
        else f.texts.set(path, f.texts.get(path)!.replace('2026-11-19T09:00:00Z', '2026-11-19T10:00:00Z'));
        const changed = f.texts.get(path);
        await f.plugin.resolveInterruption(f.observation, f.observation.at);
        assert.equal(f.texts.get(path), changed);
    }
});

test('already synced closed timers and another configured user do not prompt on reopen', async () =>
{
    const f = await interruptedFixture();
    await f.plugin.closeTimers([f.plugin.currentTimer()!], '2026-11-19T10:00:00Z');
    const count = modals.length;
    const closed = new TrackRecord(f.app, {} as PluginManifest);
    await closed.onload(); await closed.presenceReady;
    assert.equal(modals.length, count);
    const other = await interruptedFixture();
    other.state.set('track-record:user-name:v1', 'Bob');
    const countOther = modals.length;
    const bob = new TrackRecord(other.app, {} as PluginManifest);
    await bob.onload(); await bob.presenceReady;
    assert.equal(modals.length, countOther);
});

test('invalid end, user changes and disk failures preserve the reminder and open timer', async () =>
{
    const f = await interruptedFixture();
    await assert.rejects(f.plugin.resolveInterruption(f.observation, f.observation.start), /End must be after start/);
    f.setProcessFailure(true);
    await assert.rejects(f.plugin.resolveInterruption(f.observation, f.observation.at), /disk unavailable/);
    assert.equal((f.state.get(PRESENCE) as Presence).pending.length, 1);
    f.plugin.saveUserName('Bob');
    await assert.rejects(f.plugin.resolveInterruption(f.observation, f.observation.at), /Current user changed/);
    assert.equal((await f.plugin.snapshot()).records[0].end, undefined);
});

test('late sync arrival of a previously observed timer offers the retained reminder', async () =>
{
    const f = await interruptedFixture();
    const path = f.plugin.currentTimer()!.path!;
    const text = f.texts.get(path)!;
    const file = f.files.get(path)!;
    f.files.delete(path); f.texts.delete(path);
    const next = new TrackRecord(f.app, {} as PluginManifest);
    const count = modals.length;
    await next.onload(); await next.presenceReady;
    assert.equal(modals.length, count);
    assert.equal((f.state.get(PRESENCE) as Presence).pending.length, 1);
    f.files.set(path, file); f.texts.set(path, text);
    await next.snapshot();
    assert.equal(modals.length, count + 1);
    assert.equal(next.currentTimer()!.end, undefined);
});

test('first installation never invents a past boundary; malformed local reminders remain untouched', async () =>
{
    const f = fixture();
    const plugin = f.plugin();
    const count = modals.length;
    await plugin.onload(); await plugin.presenceReady;
    await plugin.startTimer();
    assert.equal(modals.length, count);
    f.state.set(PRESENCE, { version: 999 });
    const next = f.plugin();
    await next.onload(); await next.presenceReady;
    next.checkpointPresence('active');
    assert.deepEqual(f.state.get(PRESENCE), { version: 999 });
    assert.ok(next.currentTimer());
});
