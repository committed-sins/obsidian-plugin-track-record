import { parseDocument, Scalar } from 'yaml';
import { DEFAULTS, filenameBase, getProperty, propertySegments, setProperty, validateSettings, type Settings } from './settings';
import { instant } from './timestamps';
import { isOpenEnd, recordSubjects, validateRecord, validateSubject, validateUserName, type RecordEntry, type Subject } from './records';

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
    if (entry.kind === 'time' && entry.user) setProperty(result, s.userProperty, entry.user);
    setProperty(result, entry.kind === 'time' ? s.timerSubjectProperty : s.statusSubjectProperty, [...new Set(recordSubjects(entry).map(subject => `[[${subject.path.slice(0, -3)}]]`))]);
    setProperty(result, entry.kind === 'time' ? s.startProperty : s.statusStartProperty, entry.start);
    if (entry.kind === 'time') {
        setProperty(result, s.endProperty, entry.end ?? null);
    } else setProperty(result, s.statusProperty, entry.status);
    return result;
}

// Parser is injected: Obsidian provides YAML at runtime; tests use an independent YAML parser.
export function parseRecord(text: string, path: string, parseYaml: (yaml: string) => unknown, profiles: Settings[] = [DEFAULTS]): RecordEntry
{
    const match = matchFrontmatter(text);
    if (!match) throw Error('Missing frontmatter.');
    const data: unknown = parseYaml(match[1]);
    if (!data || typeof data !== 'object') throw Error('Invalid frontmatter.');
    return parseRecordProperties(data as Record<string, unknown>, text.slice(match[0].length), path, profiles);
}

export function parseRecordProperties(data: Record<string, unknown>, body: string, path: string, profiles: Settings[]): RecordEntry
{
    const meta = data.track_record as Record<string, unknown> | undefined;
    if (meta && meta.version !== 1) throw Error('Unsupported Track Record schema.');
    if (!meta) {
        const matches: RecordEntry[] = [];
        for (const profile of profiles) {
            if (!hasRecordTag(data, [profile])) continue;
            try { matches.push(readRecord(data, body, path, validateSettings(profile))); }
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
    return readRecord(data, body, path, validateSettings(meta.fields), meta);
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
        const link = typeof value === 'string' ? /^\[\[([^[\]#|^]+)(?:\|[^[\]]*)?\]\]$/.exec(value) : null;
        if (!link) throw Error('Invalid subject link.');
        const target = validateSubject({ path: link[1].endsWith('.md') ? link[1] : link[1] + '.md' });
        if (!targets.some(existing => existing.path === target.path)) targets.push(target);
    }
    if (meta?.subject_id !== undefined) {
        if (typeof meta.subject_id !== 'string') throw Error('Expected a string subject ID.');
        targets[0].id = meta.subject_id;
    }
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

export function closeTimerText(text: string, expected: RecordEntry, end: string, parseYaml: (yaml: string) => unknown, profiles: Settings[]): string
{
    const current = parseRecord(text, expected.path!, parseYaml, profiles);
    const currentLinks = recordSubjects(current).map(target => target.path).sort();
    const expectedLinks = (expected.linkPaths ?? recordSubjects(expected).map(target => target.path)).slice().sort();
    if (current.kind !== 'time' || current.id !== expected.id || current.start !== expected.start || current.user !== expected.user || JSON.stringify(currentLinks) !== JSON.stringify(expectedLinks) || current.settings.endProperty !== expected.settings.endProperty) throw Error('Timer changed since it was read; refresh before closing it.');
    if (!isOpenEnd(current.end)) {
        if (current.end === end) return text;
        throw Error('Timer was already closed with a different end time.');
    }
    if (instant(end) <= instant(current.start)) throw Error('End must be after start; timer was left open.');
    const match = matchFrontmatter(text)!;
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) throw Error('Invalid timer YAML; no changes made.');
    const value = new Scalar(end);
    value.type = Scalar.QUOTE_DOUBLE;
    document.setIn(propertySegments(current.settings.endProperty), value);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const header = document.toString({ lineWidth: 0 }).replace(/\n/g, eol);
    return `---${eol}${header}---${text.slice(match[0].length - (match[0].endsWith('\r\n') ? 2 : match[0].endsWith('\n') ? 1 : 0))}`;
}


export function matchFrontmatter(text: string): RegExpExecArray | null
{
    return /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
}
