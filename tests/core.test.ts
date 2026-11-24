import { matchesObservation, pendingObservations, readPresence } from '../src/presence';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify } from 'yaml';
import { DEFAULTS, getProperty, setProperty, validateSettings } from '../src/settings';
import { LegacyTimer as Timer, timerDraft, type TimerDraft } from '../src/legacy-timer';
import { chooseRecordPath, createOnce } from '../src/record-writer';
import { closeTimerText, frontmatter, parseRecord, recordPath } from '../src/record-markdown';
import { duration, historyWarnings, isOpenEnd, ownedOpenTimers, recordSubjects, relatesTo, sameSubject, validateUserName, validateRecord, type RecordEntry } from '../src/records';
import { instant, localTimestamp, utcTimestamp, localDateTime, localDateTimeToUtc } from '../src/timestamps';

const A = '11111111-0000-4000-8000-000000000001';
const B = '22222222-0000-4000-8000-000000000002';
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
    const original = entry({ settings: { ...DEFAULTS, timerFolder: 'other/records', startProperty: 'began', endProperty: 'ended', timerSubjectProperty: 'subjects', timeTag: 'work/interval' } });
    const parsed = parseRecord(render(original), recordPath(original), parse, [DEFAULTS, original.settings]);
    assert.deepEqual(parsed.settings, original.settings);
    assert.equal(parsed.start, original.start);
});

test('invalid folder, reserved fields, duplicate mappings and tags are rejected', () =>
{
    for (const timerFolder of ['../records', '/records', '.obsidian/records', 'records//time', 'C:/records', 'records\\time']) assert.throws(() => validateSettings({ ...DEFAULTS, timerFolder }));
    for (const startProperty of ['id', 'tags', 'created', '__proto__', 'track_record', 'record.end', 'record']) assert.throws(() => validateSettings({ ...DEFAULTS, startProperty }));
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
    const oldSettings = { folder: 'old/records', timeTag: 'record/time', statusTag: 'record/status', timerSubjectProperty: 'contexts', startProperty: 'time_start', endProperty: 'time_end', statusProperty: 'status' };
    const data = frontmatter(entry({ settings: validateSettings(oldSettings) }));
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
    const time = entry({ settings, start: '2026-11-19T00:05:07.123+01:00' });
    assert.equal(recordPath(time), 'timers/Timer - 2026-11-18T230507Z.111111.md');
    assert.equal(recordPath({ ...time, kind: 'status', status: 'active', end: undefined }), 'statuses/Status - 2026-11-18T230507Z.111111.md');
    assert.equal(recordPath({ ...time, settings: { ...settings, timerFilename: 'Work - {date}' } }), 'timers/Work - 2026-11-18.111111.md');
    const previousPath = 'timers/Timer - 2026-11-18T23-05-07Z.111111.md';
    const previousRecord = parseRecord(render(time), previousPath, parse, [settings]);
    assert.equal(recordPath(previousRecord), previousPath);
    assert.equal(previousRecord.start, time.start);
    for (const timerFilename of ['../{hash}', '{unknown} - {hash}', '{hash}.md', 'Timer: {hash}']) assert.throws(() => validateSettings({ ...settings, timerFilename }));
});

test('short filename collisions are reported without lengthening or overwriting', async () =>
{
    const m = memory();
    const record = entry();
    const content = render(record);
    m.files.set(recordPath(record), 'a different record');
    await assert.rejects(chooseRecordPath(m.writer, record, content), /already exists/);
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
    const oldSettings = { folder: 'records/track-record', timeTag: 'record/time', statusTag: 'record/status', timerSubjectProperty: 'contexts', startProperty: 'time_start', endProperty: 'time_end', statusProperty: 'status' };
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

test('nested timer properties round-trip while status stays device-independent', () =>
{
    const timer = entry({ user: 'Workstation', end: undefined });
    const data = frontmatter(timer);
    assert.deepEqual(data.record, { start: timer.start, end: null, user: 'Workstation' });
    assert.equal(data['record.start'], undefined);
    const parsed = parseRecord(render(timer), recordPath(timer), parse);
    assert.equal(parsed.user, 'Workstation');
    assert.equal(parsed.end, undefined);
    assert.equal(duration(parsed), 0);
    const status = entry({ kind: 'status', end: undefined, status: 'active' });
    const statusData = frontmatter(status);
    assert.equal(statusData.timer, undefined);
    assert.equal(getProperty(statusData, 'record.start'), status.start);
    assert.equal(parseRecord(render(status), recordPath(status), parse).user, undefined);
});

test('flat property names and nested subject/status paths are supported', () =>
{
    const settings = { ...DEFAULTS, userProperty: 'user', startProperty: 'time_start', endProperty: 'time_end', timerSubjectProperty: 'relations.subject', statusSubjectProperty: 'relations.subject', statusStartProperty: 'state.at', statusProperty: 'state.value' };
    const timer = entry({ settings, user: 'Phone' });
    const data = frontmatter(timer);
    assert.equal(data.user, 'Phone');
    assert.equal(data.time_end, timer.end);
    assert.equal(getProperty(data, 'relations.subject') instanceof Array, true);
    assert.equal(parseRecord(render(timer), recordPath(timer), parse, [settings]).user, 'Phone');
    const status = entry({ settings, kind: 'status', status: 'open', end: undefined });
    assert.deepEqual(frontmatter(status).state, { at: status.start, value: 'open' });
});

test('nested paths reject overlap, scalar parents and prototype pollution', () =>
{
    for (const userProperty of ['record', 'record.start', 'record.start.name', 'record.__proto__.x', 'constructor.x', 'tags.user']) assert.throws(() => validateSettings({ ...DEFAULTS, userProperty }));
    assert.throws(() => setProperty({ record: 'user value' }, 'record.end', 'value'), /parent/);
    assert.throws(() => getProperty({ record: [] }, 'record.start'), /parent/);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('missing, null and empty ends select only the exact current user', () =>
{
    for (const end of [undefined, null, '', '  ']) {
        const record = entry({ user: 'Desktop', end: undefined });
        const data = frontmatter(record);
        if (end === undefined) delete (data.record as Record<string, unknown>).end;
        else setProperty(data, DEFAULTS.endProperty, end);
        const parsed = parseRecord(`---\n${stringify(data)}---\n`, 'record.md', parse);
        assert.equal(isOpenEnd(parsed.end), true);
        assert.equal(ownedOpenTimers([parsed], 'Desktop').length, 1);
        assert.equal(ownedOpenTimers([parsed], 'Phone').length, 0);
        assert.equal(ownedOpenTimers([parsed], '').length, 0);
    }
    assert.equal(isOpenEnd(0), false);
    assert.equal(isOpenEnd(false), false);
});

test('closing a timer preserves body, YAML comments and unrelated nested fields', () =>
{
    const record = entry({ user: 'Desktop', end: undefined });
    const path = recordPath(record);
    const text = render(record).replace('record:', '# keep comment\nrecord:').replace('  end: null', '  extra: keep\n  end: null') + '\n## Details\nDo not change this body.\n';
    const expected = parseRecord(text, path, parse);
    const closed = closeTimerText(text, expected, entry().end!, parse, [DEFAULTS]);
    assert.match(closed, /# keep comment/);
    assert.match(closed, /extra: keep/);
    assert.ok(closed.endsWith('\n## Details\nDo not change this body.\n'));
    assert.equal(parseRecord(closed, path, parse).end, entry().end);
    assert.equal(closeTimerText(closed, expected, entry().end!, parse, [DEFAULTS]), closed);
    assert.throws(() => closeTimerText(text.replace('Desktop', 'Phone'), expected, entry().end!, parse, [DEFAULTS]), /changed/);
    assert.throws(() => closeTimerText(text, expected, record.start, parse, [DEFAULTS]), /End must be/);
    const windowsText = text.replace(/\n/g, '\r\n');
    const windowsClosed = closeTimerText(windowsText, expected, entry().end!, parse, [DEFAULTS]);
    assert.ok(windowsClosed.endsWith('\r\n## Details\r\nDo not change this body.\r\n'));
    assert.ok(!windowsClosed.includes('\r\r\n'));
    assert.equal(parseRecord(windowsClosed, path, parse).end, entry().end);
});

test('optional user names accept empty ownership and reject control characters', () =>
{
    assert.equal(validateUserName('  Alice  '), 'Alice');
    assert.equal(validateUserName('  '), '');
    assert.throws(() => validateUserName('two\nlines'));
});

test('filename suffix is fixed and no identity property is emitted', () =>
{
    const record = entry({ settings: { ...DEFAULTS, timerFilename: 'My note' } });
    assert.equal(recordPath(record), 'records/track-record/My note.111111.md');
    const data = frontmatter(record);
    assert.equal(data.id, undefined);
    assert.equal(data.track_record, undefined);
    const parsed = parseRecord(render(record), recordPath(record), parse);
    assert.equal(parsed.id, `file:${recordPath(record)}`);
    assert.equal(validateSettings({ ...DEFAULTS, timerFilename: 'Legacy - {timestamp} - {hash}' }).timerFilename, 'Legacy - {timestamp}');
});

test('shared timer links count the interval once globally and in full per linked note', () =>
{
    const first = { path: 'Project A.md' }, second = { path: 'Project B.md' };
    const record = entry({ subject: first, subjects: [first, second, first] });
    const parsed = parseRecord(render(record), recordPath(record), parse);
    assert.equal(recordSubjects(parsed).length, 2);
    assert.equal(relatesTo(parsed, first), true);
    assert.equal(relatesTo(parsed, second), true);
    assert.equal([parsed].reduce((total, value) => total + duration(value), 0), 3600000);
    for (const target of [first, second]) assert.equal([parsed].filter(value => relatesTo(value, target)).reduce((total, value) => total + duration(value), 0), 3600000);
});

test('Timer and Status have separate subject properties; status uses record.start without a user', () =>
{
    const settings = { ...DEFAULTS, timerSubjectProperty: 'projects', statusSubjectProperty: 'contexts' };
    const timer = entry({ settings, user: 'Alice' });
    const status = entry({ settings, kind: 'status', end: undefined, status: 'active' });
    assert.ok(Array.isArray(frontmatter(timer).projects));
    assert.equal(frontmatter(timer).contexts, undefined);
    const data = frontmatter(status);
    assert.ok(Array.isArray(data.contexts));
    assert.equal(data.projects, undefined);
    assert.deepEqual(data.record, { start: status.start });
    assert.equal(parseRecord(render(status), recordPath(status), parse, [settings]).status, 'active');
});

test('multiple status subjects and aliased links retain target semantics without duplicate warnings', () =>
{
    const record = entry({ kind: 'status', end: undefined, status: 'active', subjects: [{ path: 'A.md' }, { path: 'B.md' }] });
    const data = frontmatter(record);
    data.contexts = ['[[A|Label]]', '[[B]]', '[[A]]'];
    const parsed = parseRecord(`---\n${stringify(data)}---\n`, 'status.md', parse);
    assert.equal(recordSubjects(parsed).length, 2);
    assert.deepEqual(historyWarnings([parsed]), []);
    const other = entry({ id: B, kind: 'status', end: undefined, status: 'paused', subject: { path: 'B.md' } });
    assert.match(historyWarnings([parsed, other]).join(), /B.md/);
});

test('parallel work by different users is valid; same-user overlaps remain ambiguous', () =>
{
    const alice = entry({ user: 'Alice' });
    const bob = entry({ id: B, user: 'Bob' });
    assert.deepEqual(historyWarnings([alice, bob]), []);
    assert.match(historyWarnings([alice, { ...bob, user: 'Alice' }]).join(), /Overlapping/);
});

test('UTC storage and local picker handle winter, summer and invalid local dates', () =>
{
    const previous = process.env.TZ;
    process.env.TZ = 'Europe/Vienna';
    try {
        assert.equal(utcTimestamp(new Date('2026-11-20T15:00:00+01:00')), '2026-11-20T14:00:00.000Z');
        assert.equal(localDateTime(new Date('2026-11-20T14:00:00Z')), '2026-11-20T15:00:00');
        assert.equal(localDateTimeToUtc('2026-11-20T15:00'), '2026-11-20T14:00:00.000Z');
        assert.equal(localDateTimeToUtc('2026-07-20T15:00:12'), '2026-07-20T13:00:12.000Z');
        assert.throws(() => localDateTimeToUtc('2026-03-29T02:30'), /does not exist/);
        assert.throws(() => localDateTimeToUtc('2026-02-30T12:00'), /Invalid calendar/);
        assert.throws(() => localDateTimeToUtc(''), /Choose a date/);
    } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
});

test('notes heading defaults for older settings and rejects invalid section headings', () =>
{
    assert.equal(validateSettings({}).notesHeading, 'Notes');
    assert.equal(validateSettings({}).dateTimeFormat, 'YYYY-MM-DD HH:mm:ss');
    assert.throws(() => validateSettings({ dateTimeFormat: '' }), /display format/);
    assert.throws(() => validateSettings({ dateTimeFormat: 'YYYY\nMM' }), /display format/);
    assert.equal(validateSettings({ notesHeading: 'Work details' }).notesHeading, 'Work details');
    for (const notesHeading of ['', '# Notes', 'Notes\nBody', 'x'.repeat(121)]) {
        assert.throws(() => validateSettings({ notesHeading }), /notes heading/);
    }
});

test('presence validates local observations and retains the earliest pending boundary per timer', () =>
{
    const observation = { path: 'records/Timer.md', start: '2026-11-19T09:00:00Z', user: 'Alice', at: '2026-11-19T10:00:00Z', reason: 'quit' as const };
    const state = readPresence({ version: 1, pending: [observation], current: [{ ...observation, at: '2026-11-19T11:00:00Z' }] });
    assert.deepEqual(pendingObservations(state), [observation]);
    assert.equal(matchesObservation(observation, entry({ path: observation.path, start: observation.start, end: undefined, user: 'Alice' }), 'Alice'), true);
    assert.equal(matchesObservation(observation, entry({ path: observation.path, start: observation.start, end: undefined, user: 'Bob' }), 'Alice'), false);
    assert.deepEqual(readPresence(null).current, []);
    assert.throws(() => readPresence({ version: 1, pending: [observation], current: [{ ...observation, at: 'not a timestamp' }] }));
});
