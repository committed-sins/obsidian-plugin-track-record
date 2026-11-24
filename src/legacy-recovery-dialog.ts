import { Modal, Notice, Setting } from 'obsidian';
import { type TimerDraft } from './legacy-timer';
import { renderRecord } from './record-vault';
import { utcTimestamp } from './timestamps';
import type TrackRecordPlugin from './main';

export class LegacyTimerRecoveryDialog extends Modal
{
    constructor(private plugin: TrackRecordPlugin, private draft: TimerDraft)
    {
        super(plugin.app);
    }

    onOpen(): void
    {
        this.titleEl.setText('Recover timer');
        const draft = this.draft;
        this.contentEl.createEl('p', { text: `${draft.subject.path} · started ${draft.start}` });
        this.contentEl.createEl('p', { text: draft.pending ? 'A save was interrupted. Retry uses the original record ID, content and end time.' : 'Choose the actual end time. No work duration has been inferred while Obsidian was closed.' });
        let end = '';
        if (!draft.pending) new Setting(this.contentEl).setName('Actual end time').setDesc('ISO timestamp with timezone; required.').addText(text => text.onChange(value =>
        {
            end = value.trim();
        }));
        else this.contentEl.createEl('p', { text: `End: ${draft.pending.end}` });
        new Setting(this.contentEl).addButton(button => button.setButtonText(draft.pending ? 'Retry save' : 'Save interval').setCta().onClick(async () =>
        {
            let saved = false;
            await this.plugin.run(async () =>
            {
                const current = this.plugin.legacyTimer.get();
                if (JSON.stringify(current) !== JSON.stringify(draft)) throw Error('Timer changed; reopen recovery.');
                const subject = draft.pending ? draft.pending.subject : await this.plugin.records.resolveSubject(draft.subject);
                const path = await this.plugin.legacyTimer.finish(end, utcTimestamp(), subject, renderRecord);
                new Notice(`Track Record: saved ${path}.`);
                saved = true;
            });
            if (saved) this.close();
        }));
        this.contentEl.createEl('p', { text: 'Discard only removes this device’s timer draft. A previously saved record is never deleted.' });
        new Setting(this.contentEl).addButton(button => button.setButtonText('Discard local draft…').onClick(() =>
        {
            new DiscardDraftConfirmation(this.plugin, 'Discard this local timer draft?', async () =>
            {
                if (JSON.stringify(this.plugin.legacyTimer.get()) !== JSON.stringify(draft)) throw Error('Timer changed; reopen recovery.');
                this.plugin.legacyTimer.discard();
                this.close();
            }).open();
        }));
    }
}

class DiscardDraftConfirmation extends Modal
{
    constructor(private plugin: TrackRecordPlugin, private question: string, private action: () => Promise<void>)
    {
        super(plugin.app);
    }

    onOpen(): void
    {
        this.titleEl.setText(this.question);
        new Setting(this.contentEl).addButton(button => button.setButtonText('Confirm discard').setClass('track-record-discard').onClick(async () =>
        {
            await this.plugin.run(this.action);
            this.close();
        })).addButton(button => button.setButtonText('Cancel').onClick(() => this.close()));
    }
}
