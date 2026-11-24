import { validateSettings, type Settings } from './settings';
import { instant } from './timestamps';
import { recordPath } from './record-markdown';
import { chooseRecordPath, createOnce, type Writer } from './record-writer';
import { UUID_V4, sameSubject, validateRecord, validateSubject, type RecordEntry, type Subject } from './records';

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
    if (draft.version !== 1 || !UUID_V4.test(draft.id) || !UUID_V4.test(draft.session)) throw Error('Invalid local timer state; preserved for recovery.');
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

export class LegacyTimer
{
    constructor(private local: LocalState, private writer: Writer, readonly session: string)
    {
    }

    get(): TimerDraft | null
    {
        return timerDraft(this.local.read());
    }

    discard(): void
    {
        this.local.write(null);
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
