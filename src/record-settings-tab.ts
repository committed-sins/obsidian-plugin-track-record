import { AbstractInputSuggest, PluginSettingTab, Setting, TFolder, type App } from 'obsidian';
import { validateSettings, type Settings } from './settings';
import { validateUserName } from './records';
import { utcTimestamp } from './timestamps';
import { recordPath } from './record-markdown';
import { errorMessage } from './plugin-helpers';
import type TrackRecordPlugin from './main';

class FolderSuggest extends AbstractInputSuggest<TFolder>
{
    constructor(private vaultApp: App, input: HTMLInputElement, private choose: (path: string) => void)
    {
        super(vaultApp, input);
    }

    protected getSuggestions(query: string): TFolder[]
    {
        return this.vaultApp.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && !!file.path && file.path.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.path.localeCompare(b.path));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void
    {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void
    {
        this.setValue(folder.path);
        this.choose(folder.path);
        this.close();
    }
}

export class RecordSettingsTab extends PluginSettingTab
{
    constructor(private plugin: TrackRecordPlugin)
    {
        super(plugin.app, plugin);
    }

    display(): void
    {
        this.containerEl.empty();
        this.containerEl.createEl('p', { text: 'Timer and status records can share a folder or use separate folders. Tags identify the record type wherever a file is stored.' });
        const draft = { ...this.plugin.settings };
        let userName = this.plugin.userName;
        const formatSetting = new Setting(this.containerEl).setName('Date/time display format').setDesc('Local time. Moment format, e.g. YYYY-MM-DD HH:mm:ss or DD.MM.YYYY HH:mm. Used in history, running timers and interruption reminders. Stored timestamps and filenames are unchanged.');
        const formatPreview = formatSetting.descEl.createDiv({ cls: 'track-record-setting-example' });
        const updateFormatPreview = (): void =>
        {
            formatPreview.setText(`Example: ${this.plugin.formatTimestamp(utcTimestamp(), draft.dateTimeFormat)}`);
        };
        formatSetting.addText(text => text.setValue(draft.dateTimeFormat).onChange(value =>
        {
            draft.dateTimeFormat = value;
            updateFormatPreview();
        }));
        updateFormatPreview();
        new Setting(this.containerEl).setName('Notes heading').setDesc('Heading text for the Markdown notes section (level 2). Applies to new records; existing records stay unchanged.').addText(text => text.setValue(draft.notesHeading).onChange(value =>
        {
            draft.notesHeading = value;
        }));
        new Setting(this.containerEl).setName('Current user').setHeading();
        new Setting(this.containerEl).setName('User name').setDesc('Optional local setting. Use the same name on your devices. Empty closes only timers without a user; a configured name closes only that user’s timers. This is an organizational label, not access control.').addText(text => text.setValue(userName).onChange(value =>
        {
            userName = value;
        }));
        for (const kind of ['time', 'status'] as const) {
            new Setting(this.containerEl).setName(kind === 'time' ? 'Timer' : 'Status').setHeading();
            const folderKey = kind === 'time' ? 'timerFolder' : 'statusFolder';
            const tagKey = kind === 'time' ? 'timeTag' : 'statusTag';
            const filenameKey = kind === 'time' ? 'timerFilename' : 'statusFilename';
            let preview: HTMLElement | null = null;
            const updatePreview = (): void =>
            {
                if (!preview) return;
                try {
                    const start = utcTimestamp(new Date(Date.now() - 60000));
                    const example = this.plugin.newEntry({ path: 'Example.md' }, kind, start, utcTimestamp(), 'active', '');
                    preview.setText(`Example: ${recordPath({ ...example, settings: validateSettings(draft) })}`);
                } catch (error) { preview.setText(errorMessage(error)); }
            };
            new Setting(this.containerEl).setName('Save in folder').setDesc('Folder path relative to the vault root. Choose an existing folder or type a new path. This is not a tag.').addText(text =>
            {
                text.setPlaceholder('records/track-record').setValue(draft[folderKey]).onChange(value =>
                {
                    draft[folderKey] = value;
                    updatePreview();
                });
                new FolderSuggest(this.plugin.app, text.inputEl, value =>
                {
                    draft[folderKey] = value;
                    updatePreview();
                });
            });
            new Setting(this.containerEl).setName('Identify by tag').setDesc('Obsidian tag in the tags property. A slash creates a nested tag, not a folder. A leading # is optional here.').addText(text => text.setPlaceholder(kind === 'time' ? '#record/time' : '#record/status').setValue('#' + draft[tagKey]).onChange(value =>
            {
                draft[tagKey] = value;
                updatePreview();
            }));
            const filenameSetting = new Setting(this.containerEl).setName('Filename format').setDesc('Editable base: {type}, {timestamp}, {date}. A fixed .{hash}.md suffix is always appended. Timestamp is UTC to seconds.').addText(text => text.setValue(draft[filenameKey]).onChange(value =>
            {
                draft[filenameKey] = value;
                updatePreview();
            }));
            preview = filenameSetting.descEl.createDiv({ cls: 'track-record-setting-example' });
            const labels = kind === 'time'
                ? { timerSubjectProperty: 'Subject link property', userProperty: 'User property', startProperty: 'Start property', endProperty: 'End property' }
                : { statusSubjectProperty: 'Subject link property', statusStartProperty: 'Effective-time property', statusProperty: 'Status value property' };
            for (const key of Object.keys(labels) as (keyof Settings)[]) {
                new Setting(this.containerEl).setName(labels[key as keyof typeof labels]!).setDesc('Dot notation creates nested YAML, e.g. record.start. Flat names work too. Subject suggestions: contexts or projects; links are stored as a list.').addText(text => text.setValue(draft[key]).onChange(value =>
                {
                    draft[key] = value;
                    updatePreview();
                }));
            }
            updatePreview();
        }
        const feedback = this.containerEl.createEl('p');
        new Setting(this.containerEl).addButton(button => button.setButtonText('Save settings').setCta().onClick(async () =>
        {
            try {
                if (this.plugin.busy) throw Error('Wait for the current write.');
                validateUserName(userName);
                await this.plugin.saveSettings(draft);
                this.plugin.saveUserName(userName);
                feedback.setText('Saved. User name stays local; records were not migrated.');
            } catch (error) { feedback.setText(errorMessage(error)); }
        }));
    }
}
