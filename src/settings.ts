import { hasAsciiControl } from './text-validation';

export interface Settings
{
    notesFolder: string;
    recordSearchFolder: string;
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
    notesHeading: string;
    dateTimeFormat: string;
}

export const DEFAULTS: Settings = {
    notesFolder: '', recordSearchFolder: '',
    timerFolder: 'records/track-record', statusFolder: 'records/track-record',
    timerFilename: '{type} - {timestamp}', statusFilename: '{type} - {timestamp}',
    timeTag: 'record/time', statusTag: 'record/status',
    timerSubjectProperty: 'contexts', statusSubjectProperty: 'contexts', startProperty: 'record.start', endProperty: 'record.end', userProperty: 'record.user',
    statusStartProperty: 'record.start', statusProperty: 'status', notesHeading: 'Notes', dateTimeFormat: 'YYYY-MM-DD HH:mm:ss'
};

const RESERVED = new Set(['id', 'tags', 'created', 'track_record', '__proto__', 'constructor', 'prototype']);
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
    if (!result.notesHeading || result.notesHeading.length > 120 || result.notesHeading.includes('#') || hasAsciiControl(result.notesHeading)) throw Error('Use a non-empty notes heading without # or line breaks (up to 120 characters).');
    if (!result.dateTimeFormat || result.dateTimeFormat.length > 120 || hasAsciiControl(result.dateTimeFormat)) throw Error('Use a date/time display format of 1 to 120 characters without line breaks.');
    result.timerFilename = filenameBase(result.timerFilename);
    result.statusFilename = filenameBase(result.statusFilename);
    for (const folder of [result.timerFolder, result.statusFolder]) validateFolder(folder);
    if (result.notesFolder && result.notesFolder !== '/') validateFolder(result.notesFolder);
    if (result.recordSearchFolder) validateFolder(result.recordSearchFolder);
    result.timeTag = result.timeTag.replace(/^#/, '');
    result.statusTag = result.statusTag.replace(/^#/, '');
    for (const tag of [result.timeTag, result.statusTag]) {
        if (!/^[\p{L}\p{N}\p{S}_-]+(?:\/[\p{L}\p{N}\p{S}_-]+)*$/u.test(tag) || !/[^\p{N}/]/u.test(tag)) throw Error('Use an Obsidian tag without spaces and with at least one non-numeric character.');
    }
    if (result.timeTag.toLowerCase() === result.statusTag.toLowerCase()) throw Error('Timer and status tags must differ (tags are case-insensitive).');
    for (const pattern of [result.timerFilename, result.statusFilename]) {
        if (!pattern || /[{}]/.test(pattern.replace(/\{(type|timestamp|date)\}/g, ''))) throw Error('Use filename tokens {type}, {timestamp}, {date}. The .{hash}.md suffix is appended automatically.');
        if (/[\\/:*?"<>|[\]#^]/.test(pattern) || hasAsciiControl(pattern) || pattern.startsWith('.') || /[. ]$/.test(pattern) || /\.md$/i.test(pattern)) throw Error('Enter a filename pattern without a folder or .md extension.');
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

function validateFolder(folder: string): void
{
    if (!folder || folder.split('/').some(part => !part || part.startsWith('.')) || /[\\:*?"<>|[\]#^]/.test(folder) || hasAsciiControl(folder)) throw Error('Use a vault-relative folder without hidden folders, traversal or special characters.');
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
