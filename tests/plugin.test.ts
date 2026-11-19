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
    const events = new Map<string, (...args: unknown[]) => void>();
    const app = {
        loadLocalStorage: (key: string) => structuredClone(state.get(key) ?? null),
        saveLocalStorage: (key: string, value: unknown) => state.set(key, structuredClone(value)),
        vault: {
            getAbstractFileByPath: (path: string) => files.get(path) ?? null,
            getMarkdownFiles: () => [...files.values()].filter(file => file instanceof TFile),
            read: async (file: TFile) => texts.get(file.path)!,
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
                events.set(name, callback);
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
        app: app as unknown as App, source: source as unknown as ObsidianFile, texts, content, files, events,
        plugin: () => new TrackRecord(app as unknown as App, {} as PluginManifest),
        setFailure: (value: boolean) =>
        {
            failCreate = value;
        }
    };
}

// Exercise real plugin commands against the Obsidian boundary, without pretending to test its UI renderer.
(globalThis as unknown as { window: unknown }).window = { setInterval: () => 0 };

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
    plugin.timer.start(await plugin.subject(f.source), '2026-11-19T09:00:00+01:00', plugin.settings, crypto.randomUUID());
    const oldPath = f.source.path;
    f.source.path = 'notes/Renamed.md';
    f.files.delete(oldPath);
    f.files.set(f.source.path, f.source);
    f.texts.delete(oldPath);
    f.texts.set(f.source.path, f.content);
    f.events.get('rename')!(f.source, oldPath);
    await plugin.stopTimer();
    assert.equal(plugin.timer.get(), null);
    const records = (await plugin.snapshot()).records;
    assert.equal(records.length, 2);
    assert.ok(records.every(record => record.subject.path === f.source.path));
    assert.equal(f.texts.get(f.source.path), f.content);
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
    assert.equal(plugin.timer.get(), null);
    assert.ok(notices.some(notice => notice.includes('Save valid Track Record settings')));
});
