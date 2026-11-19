export interface Settings
{
    folder: string;
    timeTag: string;
    statusTag: string;
    subjectProperty: string;
    startProperty: string;
    endProperty: string;
    statusProperty: string;
}

export const DEFAULTS: Settings = {
    folder: 'records/track-record', timeTag: 'record/time', statusTag: 'record/status',
    subjectProperty: 'contexts', startProperty: 'time_start', endProperty: 'time_end', statusProperty: 'status'
};

export interface Subject
{
    path: string;
    id?: string;
}

export interface RecordEntry
{
    id: string;
    kind: 'time' | 'status';
    subject: Subject;
    start: string;
    end?: string;
    status?: string;
    created: string;
    session: string;
    note: string;
    settings: Settings;
    path?: string;
}

const RESERVED = new Set(['id', 'tags', 'created', 'track_record', '__proto__', 'constructor', 'prototype']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSettings(input: unknown): Settings
{
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid record settings.');
    const value = input as Record<string, unknown>;
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        if (typeof value[key] !== 'string') throw Error(`Missing setting: ${key}.`);
        result[key] = value[key].trim();
    }
    if (!result.folder || result.folder.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || /[\\:*?"<>|\[\]#^\x00-\x1f]/.test(result.folder)) {
        throw Error('Use a relative record folder without hidden folders, traversal or special characters.');
    }
    for (const tag of [result.timeTag, result.statusTag]) {
        if (!/^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag) || /^\d+$/.test(tag)) throw Error('Use valid tags without a leading #.');
    }
    if (result.timeTag === result.statusTag) throw Error('Time and status tags must differ.');
    const properties = [result.subjectProperty, result.startProperty, result.endProperty, result.statusProperty];
    for (const property of properties) {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(property) || RESERVED.has(property)) throw Error(`Invalid or reserved property: ${property}.`);
    }
    if (new Set(properties).size !== properties.length) throw Error('Record properties must have different names.');
    return result;
}

export function instant(value: string): number
{
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw Error('Use an ISO timestamp with timezone, e.g. 2026-11-19T09:00:00+01:00.');
    const [, year, month, day, hour, minute, second = '0', , zone] = match;
    const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    if (Number(year) < 1000 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > maxDay || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw Error('Invalid calendar date or time.');
    if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59 || (zone.slice(1, 3) === '14' && zone.slice(4) !== '00'))) throw Error('Invalid timezone offset.');
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw Error('Invalid timestamp.');
    return timestamp;
}

export function localTimestamp(date = new Date()): string
{
    const pad = (n: number) => String(n).padStart(2, '0');
    const offset = -date.getTimezoneOffset();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function validateSubject(input: unknown): Subject
{
    if (!input || typeof input !== 'object') throw Error('Missing subject note.');
    const subject = input as Subject;
    if (typeof subject.path !== 'string' || !subject.path.endsWith('.md') || subject.path.startsWith('/') || subject.path.split('/').some(p => !p || p === '.' || p === '..') || /[\\\[\]#|^\r\n\x00]/.test(subject.path)) throw Error('This note path cannot be represented by a safe wikilink.');
    if (subject.id !== undefined && (typeof subject.id !== 'string' || !subject.id.trim())) throw Error('Invalid subject ID.');
    return { path: subject.path, ...(subject.id ? { id: subject.id } : {}) };
}

export function validateRecord(input: RecordEntry): RecordEntry
{
    if (!UUID.test(input.id) || !UUID.test(input.session)) throw Error('Invalid record or session ID.');
    validateSubject(input.subject);
    validateSettings(input.settings);
    instant(input.created);
    const start = instant(input.start);
    if (typeof input.note !== 'string') throw Error('Invalid record note.');
    if (input.kind === 'time') {
        if (!input.end || instant(input.end) <= start) throw Error('End must be after start.');
        if (input.status !== undefined) throw Error('A time record cannot contain a status.');
    } else if (input.kind === 'status') {
        if (typeof input.status !== 'string' || !input.status.trim() || input.status.length > 200 || /[\r\n\x00]/.test(input.status)) throw Error('Enter a non-empty status of at most 200 characters.');
        if (input.end !== undefined) throw Error('A status event has no end time.');
    } else throw Error('Unknown record kind.');
    return input;
}

export function recordPath(entry: RecordEntry): string
{
    validateRecord(entry);
    return `${entry.settings.folder}/${entry.start.slice(0, 10)}-${entry.kind}-${entry.id}.md`;
}

export function frontmatter(entry: RecordEntry): Record<string, unknown>
{
    validateRecord(entry);
    const s = entry.settings;
    const result: Record<string, unknown> = {
        id: entry.id, tags: [entry.kind === 'time' ? s.timeTag : s.statusTag], created: entry.created,
        [s.subjectProperty]: [`[[${entry.subject.path.slice(0, -3)}]]`],
        [s.startProperty]: entry.start,
        track_record: { version: 1, session: entry.session, subject_id: entry.subject.id ?? null, fields: { ...s } }
    };
    if (entry.kind === 'time') result[s.endProperty] = entry.end;
    else result[s.statusProperty] = entry.status;
    return result;
}

// Parser is injected: Obsidian provides YAML at runtime; tests use an independent YAML parser.
export function parseRecord(text: string, path: string, parseYaml: (yaml: string) => unknown): RecordEntry
{
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!match) throw Error('Missing frontmatter.');
    const data = parseYaml(match[1]) as Record<string, unknown>;
    if (!data || typeof data !== 'object') throw Error('Invalid frontmatter.');
    const meta = data.track_record as Record<string, unknown> | undefined;
    if (!meta || meta.version !== 1) throw Error('Unsupported Track Record schema.');
    const settings = validateSettings(meta.fields);
    const tags = typeof data.tags === 'string' ? [data.tags] : data.tags;
    if (!Array.isArray(tags)) throw Error('Missing record tags.');
    const time = tags.includes(settings.timeTag);
    const status = tags.includes(settings.statusTag);
    if (time === status) throw Error('Ambiguous record type tags.');
    const subjects = data[settings.subjectProperty];
    if (!Array.isArray(subjects) || subjects.length !== 1 || typeof subjects[0] !== 'string') throw Error('Expected exactly one subject link.');
    const link = /^\[\[([^\[\]#|^]+)\]\]$/.exec(subjects[0]);
    if (!link) throw Error('Invalid subject link.');
    const pathValue = link[1].endsWith('.md') ? link[1] : link[1] + '.md';
    const string = (value: unknown): string =>
    {
        if (typeof value !== 'string') throw Error('Expected a string property.');
        return value;
    };
    return validateRecord({
        id: string(data.id), kind: time ? 'time' : 'status', subject: validateSubject({ path: pathValue, ...(meta.subject_id === null ? {} : { id: string(meta.subject_id) }) }),
        start: string(data[settings.startProperty]), ...(time ? { end: string(data[settings.endProperty]) } : { status: string(data[settings.statusProperty]) }),
        created: string(data.created), session: string(meta.session), settings, path, note: text.slice(match[0].length)
    });
}

export function sameSubject(a: Subject, b: Subject): boolean
{
    // If only one record has an ID, matching paths remain a fallback until a migration is chosen.
    return a.id && b.id ? a.id === b.id : a.path === b.path;
}

export function duration(entry: RecordEntry): number
{
    return entry.kind === 'time' ? instant(entry.end!) - instant(entry.start) : 0;
}

export function historyWarnings(records: RecordEntry[]): string[]
{
    const warnings = new Set<string>();
    const ids = new Map<string, RecordEntry>();
    for (const entry of records) {
        if (ids.has(entry.id)) warnings.add(`Duplicate record ID ${entry.id}; totals are withheld.`);
        ids.set(entry.id, entry);
    }
    const intervals = records.filter(entry => entry.kind === 'time').map(entry => ({ start: instant(entry.start), end: instant(entry.end!) })).sort((a, b) => a.start - b.start);
    let lastEnd = -Infinity;
    for (const interval of intervals) {
        if (interval.start < lastEnd) warnings.add('Overlapping work intervals; totals are withheld (including simultaneous work on different notes).');
        lastEnd = Math.max(lastEnd, interval.end);
    }
    const idTimes = new Set<string>(), pathTimes = new Set<string>(), idlessTimes = new Set<string>();
    for (const entry of records.filter(record => record.kind === 'status')) {
        const time = instant(entry.start);
        const pathKey = JSON.stringify([entry.subject.path, time]);
        const idKey = JSON.stringify([entry.subject.id, time]);
        const ambiguous = entry.subject.id ? idTimes.has(idKey) || idlessTimes.has(pathKey) : pathTimes.has(pathKey);
        if (ambiguous) warnings.add(`Multiple status events at the same instant for ${entry.subject.path}; their order is unknown.`);
        pathTimes.add(pathKey);
        if (entry.subject.id) idTimes.add(idKey);
        else idlessTimes.add(pathKey);
    }
    return [...warnings];
}

export interface Writer
{
    read(path: string): Promise<string | null>;
    create(path: string, content: string): Promise<void>;
}

export async function createOnce(writer: Writer, path: string, content: string): Promise<void>
{
    const existing = await writer.read(path);
    if (existing !== null) {
        if (existing !== content) throw Error('Record path already contains different content. Nothing was overwritten; review the existing file.');
        return;
    }
    try { await writer.create(path, content); }
    catch (error) {
        // A create can succeed before reporting failure. Accept only an exact retry.
        if (await writer.read(path) !== content) throw error;
    }
}

export interface TimerDraft
{
    version: 1;
    id: string;
    session: string;
    subject: Subject;
    start: string;
    settings: Settings;
    pending?: RecordEntry;
    content?: string;
    destination?: string;
}

export interface LocalState
{
    read(): unknown;
    write(value: TimerDraft | null): void;
}

export function timerDraft(input: unknown): TimerDraft | null
{
    if (input === null || input === undefined) return null;
    const draft = input as TimerDraft;
    if (draft.version !== 1 || !UUID.test(draft.id) || !UUID.test(draft.session)) throw Error('Invalid local timer state; preserved for recovery.');
    validateSubject(draft.subject);
    instant(draft.start);
    validateSettings(draft.settings);
    if (draft.pending) {
        validateRecord(draft.pending);
        if (draft.pending.id !== draft.id || draft.pending.start !== draft.start || draft.pending.session !== draft.session || !sameSubject(draft.subject, draft.pending.subject) || draft.pending.kind !== 'time' || typeof draft.content !== 'string' || draft.destination !== recordPath(draft.pending)) throw Error('Invalid pending timer; preserved for recovery.');
    } else if (draft.content !== undefined || draft.destination !== undefined) throw Error('Incomplete pending timer; preserved for recovery.');
    return draft;
}

export class Timer
{
    constructor(private local: LocalState, private writer: Writer, readonly session: string)
    {
    }

    get(): TimerDraft | null
    {
        return timerDraft(this.local.read());
    }

    start(subject: Subject, start: string, settings: Settings, id: string): void
    {
        if (this.get()) throw Error('A local timer already exists. Stop or recover it first.');
        const draft: TimerDraft = { version: 1, id, session: this.session, subject: validateSubject(subject), start, settings: validateSettings(settings) };
        timerDraft(draft);
        this.local.write(draft);
    }

    async finish(end: string, created: string, subject: Subject, render: (record: RecordEntry) => string): Promise<string>
    {
        const draft = this.get();
        if (!draft) throw Error('No local timer.');
        if (!draft.pending) {
            const record = validateRecord({ id: draft.id, session: draft.session, subject, kind: 'time', start: draft.start, end, created, note: '', settings: draft.settings });
            if (!sameSubject(draft.subject, subject)) throw Error('Timer subject identity changed.');
            draft.pending = record;
            draft.destination = recordPath(record);
            draft.content = render(record);
            this.local.write(draft); // Durable intent, before the asynchronous vault write.
        }
        await createOnce(this.writer, draft.destination!, draft.content!);
        const current = this.get();
        if (!current || current.id !== draft.id || current.content !== draft.content) throw Error('Local timer changed while saving. Record exists; review local state.');
        this.local.write(null);
        return draft.destination!;
    }
}
