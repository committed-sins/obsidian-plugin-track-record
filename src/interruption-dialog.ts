import { Modal, Setting } from 'obsidian';
import { recordSubjects, type RecordEntry } from './records';
import { type TimerObservation } from './presence';
import { instant, localDateTime, localDateTimeToUtc } from './timestamps';
import { errorMessage } from './plugin-helpers';
import type TrackRecordPlugin from './main';

export class TimerInterruptionDialog extends Modal
{
    constructor(private plugin: TrackRecordPlugin, private observation: TimerObservation, private record: RecordEntry, private onClosed: () => void)
    {
        super(plugin.app);
    }

    onClose(): void
    {
        this.onClosed();
    }

    onOpen(): void
    {
        const observation = this.observation;
        this.titleEl.setText('Timer kept running while you were away');
        this.contentEl.createEl('p', { text: recordSubjects(this.record).map(subject => subject.path.replace(/\.md$/i, '')).join(', ') });
        const label = observation.reason === 'quit' ? 'Obsidian began closing' : observation.reason === 'unload' ? 'Plugin stopped (last active)' : 'Last active (approximate; closing time was not recorded)';
        this.contentEl.createEl('p', { text: `${label}: ${this.plugin.formatTimestamp(observation.at)}` });
        this.contentEl.createEl('p', { text: 'Was this intentional? The record stays open until you choose an end time. Dismiss to decide later using Review timers that ran while away.' });
        let custom = localDateTime(new Date(instant(observation.at)));
        new Setting(this.contentEl).setName('Other end time').setDesc('Local time; saved as UTC.').addText(text =>
        {
            text.inputEl.type = 'datetime-local';
            text.inputEl.step = '1';
            text.setValue(custom).onChange(value =>
            {
                custom = value;
            });
        });
        const feedback = this.contentEl.createEl('p', { cls: 'track-record-warning' });
        const resolve = async (end?: string): Promise<void> =>
        {
            let success = false;
            await this.plugin.run(async () =>
            {
                try { await this.plugin.resolveInterruption(observation, end); success = true; }
                catch (error) { feedback.setText(errorMessage(error)); throw error; }
            });
            if (success) { this.close(); await this.plugin.reviewInterruptedTimers(false); }
        };
        new Setting(this.contentEl).addButton(button => button.setButtonText('Continue timing').setCta().onClick(() => resolve()))
            .addButton(button => button.setButtonText(observation.reason === 'quit' ? 'End when Obsidian closed' : 'End at last active time').onClick(() => resolve(observation.at)))
            .addButton(button => button.setButtonText('Use other end time').onClick(async () =>
            {
                try { await resolve(localDateTimeToUtc(custom)); }
                catch (error) { feedback.setText(errorMessage(error)); }
            }));
    }
}
