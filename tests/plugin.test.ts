import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { App, PluginManifest, TFile as ObsidianFile } from 'obsidian';
import TrackRecord from '../src/main';
import { TFile, TFolder, modals, settings, notices, Plugin as MockPlugin } from './obsidian';
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
            on: () => undefined,
            onLayoutReady: (callback: () => void) => callback()
        }
    };
    return {
        app: app as unknown as App, source: source as unknown as ObsidianFile, texts, content, files, events, state,
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

test('settings distinguish Timer and Status folders from tag inputs', async () =>
{
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
    const save = settings.flatMap(setting => setting.controls).find(control => control.text === 'Save settings')!;
    await save.click();
    assert.equal(plugin.settings.timerFolder, 'records/track-record');
    assert.equal(plugin.settings.statusFolder, 'records/statuses');
    assert.equal(plugin.settings.statusTag, 'record/state');
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
    const all = settings.flatMap(setting => setting.controls).find(control => control.text === 'All notes')!;
    await all.click();
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
    start.change('2026-11-19T09:00:00+01:00');
    end.change('2026-11-19T10:00:00+01:00');
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
    assert.deepEqual([...f.state.keys()], ['track-record:user-name:v1']);
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
