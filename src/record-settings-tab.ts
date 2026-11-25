import { AbstractInputSuggest, PluginSettingTab, Setting, TFolder, type App, type SettingDefinitionRender } from 'obsidian';
import { validateSettings, type Settings } from './settings';
import { validateUserName } from './records';
import { utcTimestamp } from './timestamps';
import { recordPath } from './record-markdown';
import { errorMessage } from './plugin-helpers';
import type TrackRecordPlugin from './main';

type SettingsRow = Omit<SettingDefinitionRender, 'render'> & { render: (setting: Setting) => void };

interface SettingsGroup
{
    type: 'group';
    heading: string;
    items: SettingsRow[];
}

class FolderSuggest extends AbstractInputSuggest<TFolder>
{
    constructor(private vaultApp: App, input: HTMLInputElement, private choose: (path: string) => void)
    {
        super(vaultApp, input);
    }

    protected getSuggestions(query: string): TFolder[]
    {
        const slash = query.lastIndexOf('/');
        const parentPath = query.slice(0, Math.max(0, slash));
        const search = query.slice(slash + 1).toLowerCase();
        const parent = parentPath ? this.vaultApp.vault.getFolderByPath(parentPath) : this.vaultApp.vault.getRoot();
        return (parent?.children ?? []).filter((file): file is TFolder => file instanceof TFolder && file.path.slice(file.path.lastIndexOf('/') + 1).toLowerCase().includes(search)).sort((a, b) => a.path.localeCompare(b.path));
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
        for (const definition of this.getSettingDefinitions()) {
            const rows = 'type' in definition ? definition.items : [definition];
            if ('type' in definition) new Setting(this.containerEl).setName(definition.heading).setHeading();
            for (const row of rows) {
                const setting = new Setting(this.containerEl).setName(row.name).setDesc(row.desc ?? '');
                row.render(setting);
            }
        }
    }

    getSettingDefinitions(): (SettingsRow | SettingsGroup)[]
    {
        const draft = { ...this.plugin.settings };
        let userName = this.plugin.userName;
        return [
            {
                type: 'group', heading: 'Search folders', items: [
                    this.folderSetting('Notes folder', 'Search this folder and its subfolders for subjects and links. Leave blank to allow notes anywhere in the vault.', 'notes', draft.notesFolder, value =>
                    {
                        draft.notesFolder = value;
                    }),
                    this.folderSetting('Additional records folder', 'Read records from this folder and its subfolders as well as current and previous timer and status destinations. Set this if you keep records outside those destinations.', 'records', draft.recordSearchFolder, value =>
                    {
                        draft.recordSearchFolder = value;
                    })
                ]
            },
            {
                name: 'Date/time display format',
                desc: 'Local time in history, running timers and interruption reminders. Use Moment tokens, for example YYYY-MM-DD HH:mm:ss or DD.MM.YYYY HH:mm.',
                render: setting =>
                {
                    const preview = setting.descEl.createDiv({ cls: 'track-record-setting-example' });
                    const updatePreview = (): void =>
                    {
                        preview.setText(`Example: ${this.plugin.formatTimestamp(utcTimestamp(), draft.dateTimeFormat)}`);
                    };
                    setting.addText(text => text.setValue(draft.dateTimeFormat).onChange(value =>
                    {
                        draft.dateTimeFormat = value;
                        updatePreview();
                    }));
                    updatePreview();
                }
            },
            {
                name: 'Notes heading',
                desc: 'Level 2 Markdown heading for the notes section in new records.',
                render: setting =>
                {
                    setting.addText(text => text.setValue(draft.notesHeading).onChange(value =>
                    {
                        draft.notesHeading = value;
                    }));
                }
            },
            {
                type: 'group', heading: 'Current user', items: [{
                    name: 'User name',
                    desc: 'Optional local setting. Use the same name on your devices. Timer actions match the configured user, or timers without a user when left blank.',
                    render: setting =>
                    {
                        setting.addText(text => text.setValue(userName).onChange(value =>
                        {
                            userName = value;
                        }));
                    }
                }]
            },
            this.recordSettings('time', draft),
            this.recordSettings('status', draft),
            {
                name: '',
                searchable: false,
                render: setting =>
                {
                    const feedback = setting.descEl.createDiv();
                    setting.addButton(button => button.setButtonText('Save settings').setCta().onClick(async () =>
                    {
                        try {
                            if (this.plugin.busy) throw Error('Wait for the current write.');
                            validateUserName(userName);
                            await this.plugin.saveSettings(draft);
                            this.plugin.saveUserName(userName);
                            feedback.setText('Settings saved.');
                        } catch (error) { feedback.setText(errorMessage(error)); }
                    }));
                }
            }
        ];
    }

    private folderSetting(name: string, desc: string, placeholder: string, initial: string, change: (value: string) => void): SettingsRow
    {
        return {
            name,
            desc,
            render: setting =>
            {
                setting.addText(text =>
                {
                    text.setPlaceholder(placeholder).setValue(initial).onChange(change);
                    new FolderSuggest(this.plugin.app, text.inputEl, change);
                });
            }
        };
    }

    private recordSettings(kind: 'time' | 'status', draft: Settings): SettingsGroup
    {
        const isTimer = kind === 'time';
        const folderKey = isTimer ? 'timerFolder' : 'statusFolder';
        const tagKey = isTimer ? 'timeTag' : 'statusTag';
        const filenameKey = isTimer ? 'timerFilename' : 'statusFilename';
        const properties: [keyof Settings, string][] = isTimer
            ? [['timerSubjectProperty', 'Subject link property'], ['userProperty', 'User property'], ['startProperty', 'Start property'], ['endProperty', 'End property']]
            : [['statusSubjectProperty', 'Subject link property'], ['statusStartProperty', 'Effective-time property'], ['statusProperty', 'Status value property']];
        let preview: HTMLElement | undefined;
        const updatePreview = (): void =>
        {
            if (!preview) return;
            try {
                const start = utcTimestamp(new Date(Date.now() - 60000));
                const example = this.plugin.newEntry({ path: 'Example.md' }, kind, start, utcTimestamp(), 'active', '');
                preview.setText(`Example: ${recordPath({ ...example, settings: validateSettings(draft) })}`);
            } catch (error) { preview.setText(errorMessage(error)); }
        };
        const change = (key: keyof Settings) => (value: string): void =>
        {
            draft[key] = value;
            updatePreview();
        };
        return {
            type: 'group',
            heading: isTimer ? 'Timer' : 'Status',
            items: [
                this.folderSetting('Save in folder', 'Folder path relative to the vault root. Choose an existing folder or type a new path. Timer and status records can share a folder.', 'records/track-record', draft[folderKey], change(folderKey)),
                {
                    name: 'Identify by tag',
                    desc: 'Obsidian tag in the tags property. A slash creates a nested tag. A leading # is optional.',
                    render: setting =>
                    {
                        setting.addText(text => text.setPlaceholder(isTimer ? '#record/time' : '#record/status').setValue('#' + draft[tagKey]).onChange(change(tagKey)));
                    }
                },
                {
                    name: 'Filename format',
                    desc: 'Available tokens are {type}, {timestamp} and {date}. The timestamp uses UTC in YYYY-MM-DDThhmmssZ format. The .{hash}.md suffix is appended automatically.',
                    render: setting =>
                    {
                        setting.addText(text => text.setValue(draft[filenameKey]).onChange(change(filenameKey)));
                        preview = setting.descEl.createDiv({ cls: 'track-record-setting-example' });
                        updatePreview();
                    }
                },
                ...properties.map(([key, name]): SettingsRow => ({
                    name,
                    desc: key === 'timerSubjectProperty' || key === 'statusSubjectProperty'
                        ? 'Property for the list of linked notes, for example contexts or projects. Use dot notation for nesting.'
                        : 'Use a flat property name or dot notation for nesting, for example record.start.',
                    render: setting =>
                    {
                        setting.addText(text => text.setValue(draft[key]).onChange(change(key)));
                    }
                }))
            ]
        };
    }
}
