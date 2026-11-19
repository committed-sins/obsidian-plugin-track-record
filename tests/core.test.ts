import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify } from 'yaml';
import { DEFAULTS, Timer, chooseRecordPath, createOnce, duration, frontmatter, historyWarnings, instant, localTimestamp, parseRecord, recordPath, sameSubject, timerDraft, validateRecord, validateSettings, type RecordEntry, type TimerDraft } from '../src/core';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const SESSION = '00000000-0000-4000-8000-000000000003';
const NEXT_SESSION = '00000000-0000-4000-8000-000000000004';

function entry(overrides: Partial<RecordEntry> = {}): RecordEntry
{
    return { id: A, session: SESSION, subject: { path: 'notes/Example.md', id: 'subject-1' }, kind: 'time', start: '2026-11-19T09:00:00+01:00', end: '2026-11-19T10:00:00+01:00', created: '2026-11-19T10:00:00+01:00', note: 'A note\n', settings: { ...DEFAULTS }, ...overrides };
}

function render(record: RecordEntry): string
{
    return `---\n${stringify(frontmatter(record))}---\n\n${record.note}`;
}

function memory()
{
    let state: unknown = null;
    const files = new Map<string, string>();
    const local = {
        read: () => structuredClone(state),
        write: (value: TimerDraft | null) =>
        {
            state = structuredClone(value);
        }
    };
    const writer = {
        read: async (path: string) => files.get(path) ?? null,
        create: async (path: string, text: string) =>
        {
            if (files.has(path)) throw Error('exists');
            files.set(path, text);
        }
    };
    return { local, writer, files };
}

test('time record round-trips YAML with quoted timestamps and links', () =>
{
    const original = entry();
    const parsed = parseRecord(render(original), recordPath(original), parse);
    assert.equal(parsed.start, original.start);
    assert.equal(parsed.end, original.end);
    assert.equal(parsed.subject.path, original.subject.path);
    assert.equal(parsed.subject.id, undefined);
    assert.equal(frontmatter(original).track_record, undefined);
    assert.equal(duration(parsed), 3600000);
    assert.equal(parsed.note.trim(), 'A note');
});

test('offset changes use instants rather than local wall clocks', () =>
{
    assert.equal(duration(entry({ start: '2026-10-25T02:30:00+02:00', end: '2026-10-25T02:30:00+01:00' })), 3600000);
});

test('reject impossible dates, ambiguous local times, invalid offsets and non-positive intervals', () =>
{
    for (const value of ['2026-02-29T09:00:00Z', '2026-13-01T09:00Z', '2026-11-19T24:00Z', '2026-11-19T09:00', '2026-11-19T09:00+14:30']) assert.throws(() => instant(value));
    assert.throws(() => validateRecord(entry({ end: '2026-11-19T08:00:00+01:00' })));
    assert.throws(() => validateRecord(entry({ end: entry().start })));
    assert.ok(Number.isFinite(instant('2028-02-29T09:00Z')));
    assert.equal(instant(localTimestamp(new Date('2026-11-19T09:00:00.123Z'))), Date.parse('2026-11-19T09:00:00.123Z'));
});

test('custom mappings are read through profiles kept in plugin settings', () =>
{
    const original = entry({ settings: { ...DEFAULTS, timerFolder: 'other/records', startProperty: 'began', endProperty: 'ended', subjectProperty: 'subjects', timeTag: 'work/interval' } });
    const parsed = parseRecord(render(original), recordPath(original), parse, [DEFAULTS, original.settings]);
    assert.deepEqual(parsed.settings, original.settings);
    assert.equal(parsed.start, original.start);
});

test('invalid folder, reserved fields, duplicate mappings and tags are rejected', () =>
{
    for (const timerFolder of ['../records', '/records', '.obsidian/records', 'records//time', 'C:/records', 'records\\time']) assert.throws(() => validateSettings({ ...DEFAULTS, timerFolder }));
    for (const startProperty of ['id', 'tags', 'created', '__proto__', 'track_record', 'time_end']) assert.throws(() => validateSettings({ ...DEFAULTS, startProperty }));
    assert.equal(validateSettings({ ...DEFAULTS, timeTag: '#time' }).timeTag, 'time');
    assert.throws(() => validateSettings({ ...DEFAULTS, timeTag: DEFAULTS.statusTag }));
    assert.throws(() => validateSettings({ ...DEFAULTS, timeTag: DEFAULTS.statusTag.toUpperCase() }));
});

test('malformed frontmatter and unsupported versions fail without interpretation', () =>
{
    for (const text of ['hello', '---\ntrack_record: [broken\n---\n', '---\ntrack_record:\n  version: 2\n---\n']) assert.throws(() => parseRecord(text, 'bad.md', parse));
    const fm = frontmatter(entry());
    fm.tags = [DEFAULTS.timeTag, DEFAULTS.statusTag];
    assert.throws(() => parseRecord(`---\n${stringify(fm)}---\n`, 'bad.md', parse));
});

test('unsafe subject links are refused and renamed notes keep their ID', () =>
{
    assert.throws(() => render(entry({ subject: { path: 'notes/A#heading.md' } })));
    assert.equal(sameSubject(entry().subject, { path: 'renamed.md', id: 'subject-1' }), true);
    assert.equal(sameSubject(entry().subject, { path: entry().subject.path, id: 'other' }), false);
});

test('repeated status visits remain independent events, with zero work duration', () =>
{
    const statuses = ['active', 'paused', 'active'].map((status, index) => entry({ id: `00000000-0000-4000-8000-00000000000${index + 5}`, kind: 'status', end: undefined, status, start: `2026-11-19T${10 + index}:00:00+01:00` }));
    for (const status of statuses) assert.equal(parseRecord(render(status), recordPath(status), parse).status, status.status);
    assert.deepEqual(statuses.map(duration), [0, 0, 0]);
    assert.deepEqual(historyWarnings(statuses), []);
});

test('identical status instants are flagged instead of silently ordered', () =>
{
    const a = entry({ kind: 'status', end: undefined, status: 'active' });
    assert.match(historyWarnings([a, { ...a, id: B, status: 'paused' }]).join(), /order is unknown/);
    assert.match(historyWarnings([a, { ...a, id: B, subject: { path: a.subject.path }, status: 'paused' }]).join(), /order is unknown/);
    assert.match(historyWarnings([{ ...a, id: B, subject: { path: a.subject.path } }, a]).join(), /order is unknown/);
});

test('overlap warnings include different subjects; touching intervals do not overlap', () =>
{
    const a = entry();
    const b = entry({ id: B, subject: { path: 'other.md' }, start: '2026-11-19T09:30:00+01:00' });
    assert.match(historyWarnings([a, b]).join(), /Overlapping/);
    assert.deepEqual(historyWarnings([a, { ...b, start: a.end!, end: '2026-11-19T11:00:00+01:00' }]), []);
    assert.match(historyWarnings([a, a]).join(), /Duplicate/);
});

test('createOnce never overwrites a conflicting destination', async () =>
{
    const m = memory();
    m.files.set('existing.md', 'user content');
    await assert.rejects(createOnce(m.writer, 'existing.md', 'new content'), /Nothing was overwritten/);
    assert.equal(m.files.get('existing.md'), 'user content');
});

test('retry after create success is idempotent, including a late failure', async () =>
{
    const m = memory();
    await createOnce({
        ...m.writer, create: async (path, text) =>
        {
            m.files.set(path, text); throw Error('late failure');
        }
    }, 'record.md', 'same');
    await createOnce(m.writer, 'record.md', 'same');
    assert.equal(m.files.size, 1);
});

test('one local timer, no vault file before explicit stop, settings snapshot preserved', () =>
{
    const m = memory();
    const timer = new Timer(m.local, m.writer, SESSION);
    timer.start(entry().subject, entry().start, DEFAULTS, A);
    assert.throws(() => timer.start(entry().subject, entry().start, DEFAULTS, B), /already exists/);
    assert.equal(m.files.size, 0);
    assert.equal(timer.get()!.settings.timerFolder, DEFAULTS.timerFolder);
});

test('legacy records with embedded mappings remain readable without rewriting', () =>
{
    const oldSettings = { folder: 'old/records', timeTag: 'record/time', statusTag: 'record/status', subjectProperty: 'contexts', startProperty: 'time_start', endProperty: 'time_end', statusProperty: 'status' };
    const data = frontmatter(entry());
    data.track_record = { version: 1, session: SESSION, subject_id: 'subject-1', fields: oldSettings };
    const text = `---\n${stringify(data)}---\nkeep this text`;
    const result = parseRecord(text, 'old/records/original.md', parse);
    assert.equal(result.subject.id, 'subject-1');
    assert.equal(result.settings.timerFolder, 'old/records');
    assert.equal(recordPath(result), 'old/records/original.md');
    assert.equal(result.note, 'keep this text');
});

test('Timer and Status use independent folders and filename formats with UTC seconds', () =>
{
    const settings = { ...DEFAULTS, timerFolder: 'timers', statusFolder: 'statuses' };
    const time = entry({ settings, start: '2026-11-19T09:00:00.123+01:00' });
    assert.equal(recordPath(time), 'timers/Timer - 2026-11-19T08-00-00Z - 000000.md');
    assert.equal(recordPath({ ...time, kind: 'status', status: 'active', end: undefined }), 'statuses/Status - 2026-11-19T08-00-00Z - 000000.md');
    assert.equal(recordPath({ ...time, settings: { ...settings, timerFilename: 'Work - {date} - {hash}' } }), 'timers/Work - 2026-11-19 - 000000.md');
    for (const timerFilename of ['../{hash}', '{unknown} - {hash}', '{type}', '{hash}.md', 'Timer: {hash}']) assert.throws(() => validateSettings({ ...settings, timerFilename }));
});

test('short filename ID collisions expand the suffix rather than overwrite records', async () =>
{
    const m = memory();
    const record = entry();
    const content = render(record);
    m.files.set(recordPath(record), 'a different record');
    const chosen = await chooseRecordPath(m.writer, record, content);
    assert.equal(chosen, recordPath(record, 10));
    await createOnce(m.writer, chosen, content);
    assert.equal(m.files.get(recordPath(record)), 'a different record');
});

test('restart retains draft and explicit end time; never auto-completes', async () =>
{
    const m = memory();
    new Timer(m.local, m.writer, SESSION).start(entry().subject, entry().start, DEFAULTS, A);
    const recovered = new Timer(m.local, m.writer, NEXT_SESSION);
    assert.notEqual(recovered.get()!.session, recovered.session);
    assert.equal(m.files.size, 0);
    await recovered.finish(entry().end!, entry().created, entry().subject, render);
    assert.equal(m.files.size, 1);
    assert.equal(recovered.get(), null);
});

test('failed stop retains a durable pending record and retries the original end time', async () =>
{
    const m = memory();
    const writer = {
        ...m.writer, create: async () =>
        {
            throw Error('disk full');
        }
    };
    const timer = new Timer(m.local, writer, SESSION);
    timer.start(entry().subject, entry().start, DEFAULTS, A);
    await assert.rejects(timer.finish(entry().end!, entry().created, entry().subject, render), /disk full/);
    assert.equal(timer.get()!.pending!.end, entry().end);
    const retry = new Timer(m.local, m.writer, NEXT_SESSION);
    const path = await retry.finish('ignored', 'ignored', entry().subject, render);
    assert.equal(parseRecord(m.files.get(path)!, path, parse).end, entry().end);
    assert.equal(retry.get(), null);
});

test('upgrade retries a pending 0.1.0 timer with its original filename and bytes', async () =>
{
    const m = memory();
    const oldSettings = { folder: 'records/track-record', timeTag: 'record/time', statusTag: 'record/status', subjectProperty: 'contexts', startProperty: 'time_start', endProperty: 'time_end', statusProperty: 'status' };
    const oldPath = `records/track-record/2026-11-19-time-${A}.md`;
    const content = 'original pending record content';
    const pending = { ...entry(), settings: oldSettings };
    m.local.write({ version: 1, id: A, session: SESSION, subject: entry().subject, start: entry().start, settings: oldSettings, pending, content, destination: oldPath } as unknown as TimerDraft);
    const recovered = new Timer(m.local, m.writer, NEXT_SESSION);
    assert.equal(await recovered.finish('ignored', 'ignored', entry().subject, render), oldPath);
    assert.equal(m.files.get(oldPath), content);
    assert.equal(recovered.get(), null);
});

test('failure clearing local draft after successful save can be recovered exactly once', async () =>
{
    const m = memory();
    let failClear = true;
    const local = {
        ...m.local, write: (value: TimerDraft | null) =>
        {
            if (value === null && failClear) throw Error('storage unavailable'); m.local.write(value);
        }
    };
    const timer = new Timer(local, m.writer, SESSION);
    timer.start(entry().subject, entry().start, DEFAULTS, A);
    await assert.rejects(timer.finish(entry().end!, entry().created, entry().subject, render), /storage unavailable/);
    assert.equal(m.files.size, 1);
    failClear = false;
    await timer.finish('ignored', 'ignored', entry().subject, render);
    assert.equal(m.files.size, 1);
    assert.equal(timer.get(), null);
});

test('invalid timer state and invalid stop preserve the local draft', async () =>
{
    assert.throws(() => timerDraft({ version: 2 }), /preserved for recovery/);
    const m = memory();
    const timer = new Timer(m.local, m.writer, SESSION);
    timer.start(entry().subject, entry().start, DEFAULTS, A);
    await assert.rejects(timer.finish(entry().start, entry().created, entry().subject, render), /End must be after/);
    assert.equal(timer.get()!.id, A);
    assert.equal(m.files.size, 0);
});

test('independent device drafts create unique records and surface simultaneous work', async () =>
{
    const a = memory(), b = memory();
    const first = new Timer(a.local, a.writer, SESSION), second = new Timer(b.local, a.writer, NEXT_SESSION);
    first.start(entry().subject, entry().start, DEFAULTS, A);
    second.start(entry().subject, entry().start, DEFAULTS, B);
    await first.finish(entry().end!, entry().created, entry().subject, render);
    await second.finish(entry().end!, entry().created, entry().subject, render);
    const records = [...a.files].map(([path, text]) => parseRecord(text, path, parse));
    assert.equal(records.length, 2);
    assert.match(historyWarnings(records).join(), /Overlapping/);
});
