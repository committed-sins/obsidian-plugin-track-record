import { recordPath } from './record-markdown';
import { type RecordEntry } from './records';

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
