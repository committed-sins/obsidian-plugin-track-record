import { TFile, TFolder, parseYaml, stringifyYaml, type App } from 'obsidian';
import { closeTimerText, frontmatter, hasRecordTag, matchFrontmatter, parseRecordProperties, recordPath } from './record-markdown';
import type { Settings } from './settings';
import { recordSubjects, validateRecord, validateSubject, type RecordEntry, type Subject } from './records';
import { chooseRecordPath, createOnce, type Writer } from './record-writer';
import { errorMessage, objectProperties } from './plugin-helpers';

export function renderRecord(record: RecordEntry): string
{
    return `---\n${stringifyYaml(frontmatter(record))}---\n\n${renderNotes(record.settings.notesHeading, record.note)}`;
}

export function renderNotes(heading: string, note: string): string
{
    return `## ${heading}\n\n${note}`;
}

export interface RecordSnapshot
{
    records: RecordEntry[];
    errors: string[];
}

export class RecordVault implements Writer
{
    constructor(private app: App, private readProfiles: () => Settings[])
    {
    }

    async read(path: string): Promise<string | null>
    {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) return null;
        if (!(file instanceof TFile)) throw Error('Record destination is a folder.');
        return this.app.vault.read(file);
    }

    async create(path: string, content: string): Promise<void>
    {
        await this.ensureFolder(path.slice(0, path.lastIndexOf('/')));
        await this.app.vault.create(path, content);
    }

    private async ensureFolder(path: string): Promise<void>
    {
        const parts = path.split('/');
        for (let i = 1; i <= parts.length; i++) {
            const folder = parts.slice(0, i).join('/');
            const existing = this.app.vault.getAbstractFileByPath(folder);
            if (existing instanceof TFolder) continue;
            if (existing) throw Error(`A file blocks folder ${folder}.`);
            try { await this.app.vault.createFolder(folder); }
            catch (error) {
                if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw error;
            }
        }
    }

    isSubject(file: TFile, profiles = this.readProfiles()): boolean
    {
        if (file.extension !== 'md' || !withinFolder(file.path, profiles[0].notesFolder)) return false;
        const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return !data?.track_record && !hasRecordTag(data, profiles);
    }

    noteFiles(subjectsOnly: boolean, profiles = this.readProfiles()): TFile[]
    {
        const files = this.markdownFiles([profiles[0].notesFolder]);
        return subjectsOnly ? files.filter(file => this.isSubject(file, profiles)) : files;
    }

    private markdownFiles(paths: Iterable<string>): TFile[]
    {
        const files: TFile[] = [];
        const visited = new Set<string>();
        const folders: TFolder[] = [];
        for (const path of paths) {
            const folder = !path || path === '/' ? this.app.vault.getRoot() : this.app.vault.getFolderByPath(path);
            if (folder) folders.push(folder);
        }
        while (folders.length) {
            const folder = folders.pop()!;
            if (visited.has(folder.path)) continue;
            visited.add(folder.path);
            for (const file of folder.children) {
                if (file instanceof TFolder) folders.push(file);
                else if (file instanceof TFile && file.extension === 'md') files.push(file);
            }
        }
        return files;
    }

    cachedSubject(file: TFile): Subject
    {
        const id: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.id;
        return { path: file.path, ...(typeof id === 'string' && id.trim() ? { id } : {}) };
    }

    async subject(file: TFile): Promise<Subject>
    {
        if (!this.isSubject(file)) throw Error('Choose a Markdown note from the configured Notes folder.');
        const data = await this.app.vault.read(file);
        const fm = matchFrontmatter(data);
        const dataProperties = fm ? objectProperties(parseYaml(fm[1]) as unknown) : null;
        if (dataProperties?.track_record || hasRecordTag(dataProperties, this.readProfiles())) throw Error('A record cannot be used as its own subject.');
        const id = dataProperties?.id;
        if (id !== undefined && (typeof id !== 'string' || !id.trim())) throw Error('Subject id must be a non-empty string.');
        if (id) {
            const duplicate = this.noteFiles(false).some(candidate => candidate.path !== file.path && this.cachedSubject(candidate).id === id);
            if (duplicate) throw Error('Duplicate subject ID; resolve it before recording.');
        }
        return validateSubject({ path: file.path, ...(id ? { id } : {}) });
    }

    async resolveSubject(subject: Subject): Promise<Subject>
    {
        if (subject.id) {
            const candidates = this.noteFiles(false).filter(file => this.cachedSubject(file).id === subject.id);
            if (candidates.length > 1) throw Error('Duplicate subject ID; timer retained.');
            if (candidates.length === 1) {
                const resolved = await this.subject(candidates[0]);
                if (resolved.id !== subject.id) throw Error('Subject metadata changed; refresh and retry.');
                return resolved;
            }
        }
        const file = this.app.vault.getAbstractFileByPath(subject.path);
        if (!(file instanceof TFile)) throw Error('Subject is missing or was renamed while this device was closed. Timer retained; restore the subject or its original path.');
        const resolved = await this.subject(file);
        if (subject.id && resolved.id !== subject.id) throw Error('Subject ID changed. Timer retained.');
        return resolved;
    }

    async closeTimers(records: RecordEntry[], end: string): Promise<void>
    {
        // Preflight every candidate before the first write. Every write rechecks fresh content atomically.
        const profiles = this.readProfiles();
        const candidates: { file: TFile; record: RecordEntry }[] = [];
        for (const record of records) {
            const file = this.app.vault.getAbstractFileByPath(record.path!);
            if (!(file instanceof TFile)) throw Error('An open timer disappeared; refresh before retrying.');
            closeTimerText(await this.app.vault.read(file), record, end, parseYaml, profiles);
            candidates.push({ file, record });
        }
        for (const { file, record } of candidates) await this.app.vault.process(file, text => closeTimerText(text, record, end, parseYaml, profiles));
    }

    async saveEntry(entry: RecordEntry): Promise<string>
    {
        validateRecord(entry);
        // Resolve just before writing; never mutate the subject note or its status property.
        const resolved = await Promise.all(recordSubjects(entry).map(subject => this.resolveSubject(subject)));
        entry.subject = resolved[0];
        entry.subjects = resolved;
        const content = renderRecord(entry);
        entry.path ??= await chooseRecordPath(this, entry, content);
        const path = recordPath(entry);
        await createOnce(this, path, content);
        return path;
    }

    async scan(): Promise<RecordSnapshot>
    {
        const profiles = this.readProfiles();
        const records: RecordEntry[] = [], errors: string[] = [];
        let subjectsById: Map<string, TFile[]> | undefined;
        for (const file of this.markdownFiles(recordFolders(profiles))) {
            try {
                const text = await this.app.vault.read(file);
                const fm = matchFrontmatter(text);
                if (!fm) continue;
                const data = objectProperties(parseYaml(fm[1]) as unknown);
                if (!data || (!data.track_record && !hasRecordTag(data, profiles))) continue;
                const record = parseRecordProperties(data, text.slice(fm[0].length), file.path, profiles);
                record.linkPaths = recordSubjects(record).map(target => target.path);
                for (const target of recordSubjects(record)) {
                    if (target.id) subjectsById ??= this.indexSubjectIds(profiles);
                    const matching = target.id ? subjectsById?.get(target.id) ?? [] : [];
                    if (matching.length > 1) errors.push(`${file.path}: duplicate subject ID; attribution is ambiguous.`);
                    const destination = matching.length === 1 ? matching[0] : this.app.metadataCache.getFirstLinkpathDest(target.path, file.path);
                    if (destination && withinFolder(destination.path, profiles[0].notesFolder)) target.path = destination.path;
                }
                records.push(record);
            } catch (error) { errors.push(`${file.path}: ${errorMessage(error)}`); }
        }
        return { records, errors };
    }

    private indexSubjectIds(profiles: Settings[]): Map<string, TFile[]>
    {
        const index = new Map<string, TFile[]>();
        for (const file of this.noteFiles(true, profiles)) {
            const id = this.cachedSubject(file).id;
            if (!id) continue;
            const files = index.get(id) ?? [];
            files.push(file);
            index.set(id, files);
        }
        return index;
    }
}

export function recordFolders(profiles: Settings[]): Set<string>
{
    const folders = new Set(profiles.flatMap(profile => [profile.timerFolder, profile.statusFolder]));
    if (profiles[0].recordSearchFolder) folders.add(profiles[0].recordSearchFolder);
    return folders;
}

function withinFolder(path: string, folder: string): boolean
{
    return !folder || folder === '/' || path.startsWith(folder + '/');
}
