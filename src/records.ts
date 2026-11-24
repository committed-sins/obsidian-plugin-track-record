import { validateSettings, type Settings } from './settings';
import { instant } from './timestamps';
import { hasAsciiControl, hasLineBreakOrNul } from './text-validation';

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    linkPaths?: string[];
}

export function isOpenEnd(value: unknown): boolean
{
    return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

export function validateUserName(value: unknown): string
{
    if (typeof value !== 'string') throw Error('User name must be a string.');
    const name = value.trim();
    if (name.length > 80 || hasAsciiControl(name)) throw Error('Enter an optional user name of at most 80 characters without control characters.');
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

export function validateSubject(input: unknown): Subject
{
    if (!input || typeof input !== 'object') throw Error('Missing subject note.');
    const subject = input as Subject;
    if (typeof subject.path !== 'string' || !subject.path.endsWith('.md') || subject.path.startsWith('/') || subject.path.split('/').some(p => !p || p === '.' || p === '..') || /[\\[\]#|^]/.test(subject.path) || hasLineBreakOrNul(subject.path)) throw Error('This note path cannot be represented by a safe wikilink.');
    if (subject.id !== undefined && (typeof subject.id !== 'string' || !subject.id.trim())) throw Error('Invalid subject ID.');
    return { path: subject.path, ...(subject.id ? { id: subject.id } : {}) };
}

export function validateRecord(input: RecordEntry): RecordEntry
{
    if (typeof input.id !== 'string' || !input.id || (input.session !== undefined && !UUID_V4.test(input.session))) throw Error('Invalid record or session ID.');
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
        if (typeof input.status !== 'string' || !input.status.trim() || input.status.length > 200 || hasLineBreakOrNul(input.status)) throw Error('Enter a non-empty status of at most 200 characters.');
        if (input.end !== undefined) throw Error('A status event has no end time.');
        if (input.user !== undefined) throw Error('Status records have no user property.');
    } else throw Error('Unknown record kind.');
    return input;
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
