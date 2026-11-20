import { parseDocument, Scalar } from 'yaml';

export interface Settings
{
    timerFolder: string;
    statusFolder: string;
    timerFilename: string;
    statusFilename: string;
    timeTag: string;
    statusTag: string;
    timerSubjectProperty: string;
    statusSubjectProperty: string;
    startProperty: string;
    endProperty: string;
    userProperty: string;
    statusStartProperty: string;
    statusProperty: string;
}

export const DEFAULTS: Settings = {
    timerFolder: 'records/track-record', statusFolder: 'records/track-record',
    timerFilename: '{type} - {timestamp}', statusFilename: '{type} - {timestamp}',
    timeTag: 'record/time', statusTag: 'record/status',
    timerSubjectProperty: 'contexts', statusSubjectProperty: 'contexts', startProperty: 'record.start', endProperty: 'record.end', userProperty: 'record.user',
    statusStartProperty: 'record.start', statusProperty: 'status'
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
    subjects?: Subject[];
    start: string;
    end?: string;
    user?: string;
    status?: string;
    created: string;
    session?: string;
    note: string;
    settings: Settings;
    path?: string;
    linkPath?: string;
    linkPaths?: string[];
}

const RESERVED = new Set(['id', 'tags', 'created', 'track_record', '__proto__', 'constructor', 'prototype']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSettings(input: unknown): Settings
{
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid record settings.');
    const value = input as Record<string, unknown>;
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
        const raw = value[key] ?? ((key === 'timerFolder' || key === 'statusFolder') ? value.folder : (key === 'timerSubjectProperty' || key === 'statusSubjectProperty') ? value.subjectProperty : key === 'statusStartProperty' ? value.startProperty : undefined) ?? DEFAULTS[key];
        if (typeof raw !== 'string') throw Error(`Invalid setting: ${key}.`);
        result[key] = raw.trim();
    }
    result.timerFilename = filenameBase(result.timerFilename);
    result.statusFilename = filenameBase(result.statusFilename);
    for (const folder of [result.timerFolder, result.statusFolder]) {
        if (!folder || folder.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || /[\\:*?"<>|\[\]#^\x00-\x1f]/.test(folder)) throw Error('Use a vault-relative folder without hidden folders, traversal or special characters.');
    }
    result.timeTag = result.timeTag.replace(/^#/, '');
    result.statusTag = result.statusTag.replace(/^#/, '');
    for (const tag of [result.timeTag, result.statusTag]) {
        if (!/^[\p{L}\p{N}\p{S}_-]+(?:\/[\p{L}\p{N}\p{S}_-]+)*$/u.test(tag) || !/[^\p{N}/]/u.test(tag)) throw Error('Use an Obsidian tag without spaces and with at least one non-numeric character.');
    }
    if (result.timeTag.toLowerCase() === result.statusTag.toLowerCase()) throw Error('Timer and status tags must differ (tags are case-insensitive).');
    for (const pattern of [result.timerFilename, result.statusFilename]) {
        if (!pattern || /[{}]/.test(pattern.replace(/\{(type|timestamp|date)\}/g, ''))) throw Error('Use filename tokens {type}, {timestamp}, {date}. The .{hash}.md suffix is appended automatically.');
        if (/[\\/:*?"<>|\[\]#^\x00-\x1f]/.test(pattern) || pattern.startsWith('.') || /[. ]$/.test(pattern) || /\.md$/i.test(pattern)) throw Error('Enter a filename pattern without a folder or .md extension.');
        if (pattern.length > 140) throw Error('Filename pattern is too long.');
    }
    for (const properties of [[result.timerSubjectProperty, result.startProperty, result.endProperty, result.userProperty], [result.statusSubjectProperty, result.statusStartProperty, result.statusProperty]]) {
        for (const property of properties) propertySegments(property);
        for (let i = 0; i < properties.length; i++) {
            if (properties.some((other, j) => i !== j && (properties[i] === other || properties[i].startsWith(other + '.')))) throw Error('Property paths must not overlap or be parents of each other.');
        }
    }
    return result;
}

export function filenameBase(value: string): string
{
    // Interpret the previous preview's final hash token as the now-fixed suffix.
    return value.replace(/[ ._-]*\{hash\}$/, '').trim();
}

export function propertySegments(path: string): string[]
{
    const segments = path.split('.');
    if (segments.some(part => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part)) || RESERVED.has(segments[0])) throw Error(`Invalid or reserved property path: ${path}.`);
    return segments;
}

export function getProperty(data: Record<string, unknown>, path: string): unknown
{
    let current: unknown = data;
    for (const part of propertySegments(path)) {
        if (current === null || current === undefined) return undefined;
        if (typeof current !== 'object' || Array.isArray(current)) throw Error(`Cannot read nested property ${path}: a parent is not an object.`);
        current = Object.hasOwn(current, part) ? (current as Record<string, unknown>)[part] : undefined;
    }
    return current;
}

export function setProperty(data: Record<string, unknown>, path: string, value: unknown): void
{
    const segments = propertySegments(path);
    let current = data;
    for (const part of segments.slice(0, -1)) {
        if (!Object.hasOwn(current, part)) current[part] = {};
        const next = current[part];
        if (!next || typeof next !== 'object' || Array.isArray(next)) throw Error(`Cannot write nested property ${path}: a parent is not an object.`);
        current = next as Record<string, unknown>;
    }
    current[segments.at(-1)!] = value;
}

export function isOpenEnd(value: unknown): boolean
{
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function validateUserName(value: string): string
{
    const name = value.trim();
    if (name.length > 80 || /[\r\n\x00-\x1f]/.test(name)) throw Error('Enter an optional user name of at most 80 characters without control characters.');
    return name;
}

export function ownedOpenTimers(records: RecordEntry[], user: string): RecordEntry[]
{
    const owner = validateUserName(user);
    return records.filter(record => record.kind === 'time' && isOpenEnd(record.end) && (record.user ?? '') === owner);
}

export function recordSubjects(record: RecordEntry): Subject[]
{
    return [...new Map((record.subjects ?? [record.subject]).map(subject => [subject.path, subject])).values()];
}

export function relatesTo(record: RecordEntry, subject: Subject): boolean
{
    return recordSubjects(record).some(target => sameSubject(target, subject));
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
    if (typeof input.id !== 'string' || !input.id || (input.session !== undefined && !UUID.test(input.session))) throw Error('Invalid record or session ID.');
    const subjects = recordSubjects(input);
    if (!subjects.length) throw Error('Link at least one subject note.');
    for (const subject of subjects) validateSubject(subject);
    validateSettings(input.settings);
    instant(input.created);
    const start = instant(input.start);
    if (typeof input.note !== 'string') throw Error('Invalid record note.');
    if (input.kind === 'time') {
        if (input.end !== undefined && instant(input.end) <= start) throw Error('End must be after start.');
        if (input.user !== undefined) validateUserName(input.user);
        if (input.status !== undefined) throw Error('A time record cannot contain a status.');
    } else if (input.kind === 'status') {
        if (typeof input.status !== 'string' || !input.status.trim() || input.status.length > 200 || /[\r\n\x00]/.test(input.status)) throw Error('Enter a non-empty status of at most 200 characters.');
        if (input.end !== undefined) throw Error('A status event has no end time.');
        if (input.user !== undefined) throw Error('Status records have no user property.');
    } else throw Error('Unknown record kind.');
    return input;
}

export function recordPath(entry: RecordEntry): string
{
    validateRecord(entry);
    if (entry.path) {
        validateSubject({ path: entry.path });
        return entry.path;
    }
    const timestamp = new Date(instant(entry.start)).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
    const hash = entry.id.replace(/-/g, '').slice(0, 6);
    if (!/^[0-9a-f]{6}$/i.test(hash)) throw Error('A new note needs a six-character random filename suffix.');
    const tokens: Record<string, string> = { type: entry.kind === 'time' ? 'Timer' : 'Status', timestamp, date: timestamp.slice(0, 10) };
    const pattern = entry.kind === 'time' ? entry.settings.timerFilename : entry.settings.statusFilename;
    const name = filenameBase(pattern).replace(/\{(type|timestamp|date)\}/g, (_, token: string) => tokens[token]);
    return `${entry.kind === 'time' ? entry.settings.timerFolder : entry.settings.statusFolder}/${name}.${hash}.md`;
}

export function frontmatter(entry: RecordEntry): Record<string, unknown>
{
    validateRecord(entry);
    const s = entry.settings;
    const result: Record<string, unknown> = {
        tags: [entry.kind === 'time' ? s.timeTag : s.statusTag], created: entry.created,
    };
    setProperty(result, entry.kind === 'time' ? s.timerSubjectProperty : s.statusSubjectProperty, [...new Set(recordSubjects(entry).map(subject => `[[${subject.path.slice(0, -3)}]]`))]);
    setProperty(result, entry.kind === 'time' ? s.startProperty : s.statusStartProperty, entry.start);
    if (entry.kind === 'time') {
        setProperty(result, s.endProperty, entry.end ?? null);
        if (entry.user) setProperty(result, s.userProperty, entry.user);
    } else setProperty(result, s.statusProperty, entry.status);
    return result;
}

// Parser is injected: Obsidian provides YAML at runtime; tests use an independent YAML parser.
export function parseRecord(text: string, path: string, parseYaml: (yaml: string) => unknown, profiles: Settings[] = [DEFAULTS]): RecordEntry
{
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!match) throw Error('Missing frontmatter.');
    const data = parseYaml(match[1]) as Record<string, unknown>;
    if (!data || typeof data !== 'object') throw Error('Invalid frontmatter.');
    const meta = data.track_record as Record<string, unknown> | undefined;
    if (meta && meta.version !== 1) throw Error('Unsupported Track Record schema.');
    if (!meta) {
        const matches: RecordEntry[] = [];
        for (const profile of profiles) {
            if (!hasRecordTag(data, [profile])) continue;
            try { matches.push(readRecord(data, text.slice(match[0].length), path, validateSettings(profile))); }
            catch { /* Another retained profile can describe an older mapping. */ }
        }
        if (!matches.length) throw Error('Record tag found, but its properties do not match a known record profile.');
        const score = (record: RecordEntry): number => (record.user === undefined ? 0 : 2) + (record.end === undefined ? 0 : 1);
        const bestScore = Math.max(...matches.map(score));
        const best = matches.filter(record => score(record) === bestScore);
        const signatures = new Set(best.map(record => JSON.stringify([record.id, record.kind, recordSubjects(record).map(target => target.path).sort(), record.start, record.end, record.user, record.status, record.created])));
        if (signatures.size > 1) throw Error('Record matches conflicting property profiles; review its fields.');
        return best[0];
    }
    return readRecord(data, text.slice(match[0].length), path, validateSettings(meta.fields), meta);
}

export function hasRecordTag(data: Record<string, unknown> | null | undefined, profiles: Settings[]): boolean
{
    const tags = typeof data?.tags === 'string' ? [data.tags] : data?.tags;
    return Array.isArray(tags) && tags.some(tag => typeof tag === 'string' && profiles.some(profile => [profile.timeTag, profile.statusTag].some(expected => expected.toLowerCase() === tag.replace(/^#/, '').toLowerCase())));
}

function readRecord(data: Record<string, unknown>, note: string, path: string, settings: Settings, meta?: Record<string, unknown>): RecordEntry
{
    const tags = typeof data.tags === 'string' ? [data.tags] : data.tags;
    if (!Array.isArray(tags)) throw Error('Missing record tags.');
    const normalizedTags = tags.filter(tag => typeof tag === 'string').map(tag => tag.replace(/^#/, '').toLowerCase());
    const time = normalizedTags.includes(settings.timeTag.toLowerCase());
    const status = normalizedTags.includes(settings.statusTag.toLowerCase());
    if (time === status) throw Error('Ambiguous record type tags.');
    const rawSubjects = getProperty(data, time ? settings.timerSubjectProperty : settings.statusSubjectProperty);
    const subjects = typeof rawSubjects === 'string' ? [rawSubjects] : rawSubjects;
    if (!Array.isArray(subjects) || !subjects.length) throw Error('Link at least one subject note.');
    const targets: Subject[] = [];
    for (const value of subjects) {
        const link = typeof value === 'string' ? /^\[\[([^\[\]#|^]+)(?:\|[^\[\]]*)?\]\]$/.exec(value) : null;
        if (!link) throw Error('Invalid subject link.');
        const target = validateSubject({ path: link[1].endsWith('.md') ? link[1] : link[1] + '.md' });
        if (!targets.some(existing => existing.path === target.path)) targets.push(target);
    }
    if (meta?.subject_id) targets[0].id = String(meta.subject_id);
    const string = (value: unknown): string =>
    {
        if (typeof value !== 'string') throw Error('Expected a string property.');
        return value;
    };
    const end = time ? getProperty(data, settings.endProperty) : undefined;
    const user = time ? getProperty(data, settings.userProperty) : undefined;
    const start = string(getProperty(data, time ? settings.startProperty : settings.statusStartProperty));
    return validateRecord({
        id: typeof data.id === 'string' ? data.id : `file:${path}`, kind: time ? 'time' : 'status', subject: targets[0], subjects: targets,
        start, ...(time ? { ...(isOpenEnd(end) ? {} : { end: string(end) }), ...(isOpenEnd(user) ? {} : { user: validateUserName(string(user)) }) } : { status: string(getProperty(data, settings.statusProperty)) }),
        created: typeof data.created === 'string' ? data.created : start, ...(meta ? { session: string(meta.session) } : {}), settings, path, note
    });
}

export function sameSubject(a: Subject, b: Subject): boolean
{
    // If only one record has an ID, matching paths remain a fallback until a migration is chosen.
    return a.id && b.id ? a.id === b.id : a.path === b.path;
}

export function duration(entry: RecordEntry): number
{
    return entry.kind === 'time' && entry.end ? instant(entry.end) - instant(entry.start) : 0;
}

export function historyWarnings(records: RecordEntry[]): string[]
{
    const warnings = new Set<string>();
    const ids = new Map<string, RecordEntry>();
    for (const entry of records) {
        if (ids.has(entry.id)) warnings.add(`Duplicate record ID ${entry.id}; totals are withheld.`);
        ids.set(entry.id, entry);
    }
    const groups = new Map<string, { start: number; end: number }[]>();
    for (const record of records.filter(entry => entry.kind === 'time' && entry.end)) {
        const intervals = groups.get(record.user ?? '') ?? [];
        intervals.push({ start: instant(record.start), end: instant(record.end!) });
        groups.set(record.user ?? '', intervals);
    }
    for (const intervals of groups.values()) {
        intervals.sort((a, b) => a.start - b.start);
        let lastEnd = -Infinity;
        for (const interval of intervals) {
            if (interval.start < lastEnd) warnings.add('Overlapping work intervals for the same user; totals are withheld (including simultaneous work on different notes).');
            lastEnd = Math.max(lastEnd, interval.end);
        }
    }
    const idTimes = new Set<string>(), pathTimes = new Set<string>(), idlessTimes = new Set<string>();
    for (const entry of records.filter(record => record.kind === 'status')) {
        for (const subject of recordSubjects(entry)) {
            const time = instant(entry.start);
            const pathKey = JSON.stringify([subject.path, time]);
            const idKey = JSON.stringify([subject.id, time]);
            const ambiguous = subject.id ? idTimes.has(idKey) || idlessTimes.has(pathKey) : pathTimes.has(pathKey);
            if (ambiguous) warnings.add(`Multiple status events at the same instant for ${subject.path}; their order is unknown.`);
            pathTimes.add(pathKey);
            if (subject.id) idTimes.add(idKey);
            else idlessTimes.add(pathKey);
        }
    }
    return [...warnings];
}

export function closeTimerText(text: string, expected: RecordEntry, end: string, parseYaml: (yaml: string) => unknown, profiles: Settings[]): string
{
    const current = parseRecord(text, expected.path!, parseYaml, profiles);
    const currentLinks = recordSubjects(current).map(target => target.path).sort();
    const expectedLinks = (expected.linkPaths ?? (expected.linkPath ? [expected.linkPath] : recordSubjects(expected).map(target => target.path))).slice().sort();
    if (current.kind !== 'time' || current.id !== expected.id || current.start !== expected.start || current.user !== expected.user || JSON.stringify(currentLinks) !== JSON.stringify(expectedLinks) || current.settings.endProperty !== expected.settings.endProperty) throw Error('Timer changed since it was read; refresh before closing it.');
    if (!isOpenEnd(current.end)) {
        if (current.end === end) return text;
        throw Error('Timer was already closed with a different end time.');
    }
    if (instant(end) <= instant(current.start)) throw Error('End must be after start; timer was left open.');
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)!;
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) throw Error('Invalid timer YAML; no changes made.');
    const value = new Scalar(end);
    value.type = Scalar.QUOTE_DOUBLE;
    document.setIn(propertySegments(current.settings.endProperty), value);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const header = document.toString({ lineWidth: 0 }).replace(/\n/g, eol);
    return `---${eol}${header}---${text.slice(match[0].length - (match[0].endsWith('\r\n') ? 2 : match[0].endsWith('\n') ? 1 : 0))}`;
}

export interface Writer
{
    read(path: string): Promise<string | null>;
    create(path: string, content: string): Promise<void>;
}

export async function chooseRecordPath(writer: Writer, entry: RecordEntry, content: string): Promise<string>
{
    if (entry.path) return recordPath(entry);
    const path = recordPath(entry);
    if (await writer.read(path) !== null) throw Error('A note with this filename already exists; no content was overwritten. Retry with a new record.');
    return path;
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
    draft.settings = validateSettings(draft.settings);
    if (draft.pending) {
        draft.pending.settings = validateSettings(draft.pending.settings);
        // Preserve destinations of an interrupted 0.1.0 save, including its original name/content.
        draft.pending.path = draft.destination;
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
            draft.content = render(record);
            draft.destination = await chooseRecordPath(this.writer, record, draft.content);
            record.path = draft.destination;
            this.local.write(draft); // Durable intent, before the asynchronous vault write.
        }
        await createOnce(this.writer, draft.destination!, draft.content!);
        const current = this.get();
        if (!current || current.id !== draft.id || current.content !== draft.content) throw Error('Local timer changed while saving. Record exists; review local state.');
        this.local.write(null);
        return draft.destination!;
    }
}
