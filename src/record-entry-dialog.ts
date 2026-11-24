import { AbstractInputSuggest, Component, FuzzySuggestModal, MarkdownRenderer, Modal, Notice, Setting, type App, type TFile } from 'obsidian';
import { validateSubject, type RecordEntry, type Subject } from './records';
import { localDateTime, localDateTimeToUtc } from './timestamps';
import { renderNotes } from './record-vault';
import { errorMessage } from './plugin-helpers';
import type TrackRecordPlugin from './main';

class NoteLinkPicker extends FuzzySuggestModal<TFile>
{
    constructor(private plugin: TrackRecordPlugin, private choose: (file: TFile) => void, private excluded = new Set<string>(), private subjectsOnly = true)
    {
        super(plugin.app);
        this.setPlaceholder('Find a note...');
    }

    getItems(): TFile[]
    {
        return this.plugin.app.vault.getMarkdownFiles().filter(file => (!this.subjectsOnly || this.plugin.records.isSubject(file)) && !this.excluded.has(file.path));
    }

    getItemText(file: TFile): string
    {
        return file.path.replace(/\.md$/i, '');
    }

    onChooseItem(file: TFile): void
    {
        this.choose(file);
    }
}

class StatusValueSuggest extends AbstractInputSuggest<string>
{
    constructor(app: App, input: HTMLInputElement, private values: string[], private choose: (value: string) => void)
    {
        super(app, input);
    }

    protected getSuggestions(query: string): string[]
    {
        return this.values.filter(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    }

    renderSuggestion(value: string, el: HTMLElement): void
    {
        el.setText(value);
    }

    selectSuggestion(value: string): void
    {
        this.setValue(value);
        this.choose(value);
        this.close();
    }
}

export class RecordEntryDialog extends Modal
{
    private previewComponent = new Component();
    private previewGeneration = 0;

    constructor(private plugin: TrackRecordPlugin, private subject: Subject, private kind: 'time' | 'status', private statuses: string[] = [])
    {
        super(plugin.app);
    }

    onClose(): void
    {
        this.previewGeneration++;
        this.previewComponent.unload();
    }

    onOpen(): void
    {
        this.previewComponent.load();
        this.modalEl.addClass('track-record-entry-modal');
        this.titleEl.setText(this.kind === 'time' ? 'Add time record' : 'Record status');
        this.contentEl.addClass('track-record-modal');
        let start = localDateTime(), end = '', status = '', note = '';
        const subjectNotes = new Set([this.subject.path]);
        let pending: RecordEntry | null = null;
        const subjectSetting = new Setting(this.contentEl).setName('Subject notes').setDesc(this.kind === 'status' ? 'This status applies to every selected note.' : 'Counts once globally and in full for each selected note.');
        subjectSetting.settingEl.addClass('track-record-subject-section');
        subjectSetting.addButton(button => button.setButtonText('Add note...').onClick(() =>
        {
            new NoteLinkPicker(this.plugin, file =>
            {
                subjectNotes.add(file.path); showSubjects();
            }, subjectNotes).open();
        }));
        const subjectsEl = subjectSetting.settingEl.createDiv({ cls: 'track-record-subjects' });
        const showSubjects = (): void =>
        {
            subjectsEl.empty();
            for (const path of subjectNotes) {
                const chip = subjectsEl.createDiv({ cls: 'track-record-subject' });
                chip.createSpan({ text: path.replace(/\.md$/i, '') });
                const remove = chip.createEl('button', { text: '\u00d7', attr: { 'aria-label': `Remove ${path}` } });
                remove.addEventListener('click', () =>
                {
                    subjectNotes.delete(path); showSubjects();
                });
            }
        };
        showSubjects();
        if (this.kind === 'status') new Setting(this.contentEl).setName('Status').setDesc('Choose a previous value or enter a new one.').addText(text =>
        {
            text.setPlaceholder('Choose or enter status...').onChange(value =>
            {
                status = value;
            });
            new StatusValueSuggest(this.plugin.app, text.inputEl, this.statuses, value =>
            {
                status = value;
            });
        });
        new Setting(this.contentEl).setName(this.kind === 'time' ? 'Start' : 'Effective time').addText(text =>
        {
            text.inputEl.type = 'datetime-local';
            text.inputEl.step = '1';
            text.setValue(start).onChange(value =>
            {
                start = value;
            });
        });
        if (this.kind === 'time') new Setting(this.contentEl).setName('End').setDesc('Must be after start.').addText(text =>
        {
            text.inputEl.type = 'datetime-local';
            text.inputEl.step = '1';
            text.onChange(value =>
            {
                end = value;
            });
        });
        const notesSetting = new Setting(this.contentEl).setName('Notes').setDesc(`Markdown, saved under "${this.plugin.settings.notesHeading}".`);
        notesSetting.settingEl.addClass('track-record-notes');
        let editor!: HTMLTextAreaElement;
        notesSetting.addTextArea(text =>
        {
            editor = text.inputEl;
            editor.rows = 9;
            text.setPlaceholder('Write Markdown, [[note links]] or [links](https://...)...').onChange(value =>
            {
                note = value;
            });
        });
        const preview = notesSetting.settingEl.createDiv({ cls: 'track-record-notes-preview' });
        const noteActions = notesSetting.settingEl.createDiv({ cls: 'track-record-note-actions' });
        new Setting(noteActions).addButton(button => button.setButtonText('Insert note link...').onClick(() =>
        {
            new NoteLinkPicker(this.plugin, file =>
            {
                const folder = this.kind === 'time' ? this.plugin.settings.timerFolder : this.plugin.settings.statusFolder;
                const link = this.plugin.app.fileManager.generateMarkdownLink(file, `${folder}/new.md`);
                editor.setRangeText(link, editor.selectionStart, editor.selectionEnd, 'end');
                note = editor.value;
                editor.focus();
            }, new Set(), false).open();
        })).addButton(button => button.setButtonText('Preview Markdown').onClick(async () =>
        {
            const generation = ++this.previewGeneration;
            this.previewComponent.unload();
            this.previewComponent = new Component();
            this.previewComponent.load();
            const rendered = preview.createDiv();
            const folder = this.kind === 'time' ? this.plugin.settings.timerFolder : this.plugin.settings.statusFolder;
            await MarkdownRenderer.render(this.app, renderNotes(this.plugin.settings.notesHeading, note), rendered, `${folder}/new.md`, this.previewComponent);
            if (generation !== this.previewGeneration) { rendered.remove(); return; }
            for (const child of Array.from(preview.children)) if (child !== rendered) child.remove();
        }));
        const feedback = this.contentEl.createEl('p', { cls: 'track-record-warning' });
        const save = async (): Promise<void> =>
        {
            if (this.plugin.busy) return;
            saveButton.setDisabled(true);
            let saved = false;
            await this.plugin.run(async () =>
            {
                try {
                    const subjects = [...subjectNotes].map(path => validateSubject({ path }));
                    if (!subjects.length) throw Error('Link at least one subject note.');
                    pending ??= this.plugin.newEntry(subjects[0], this.kind, localDateTimeToUtc(start), this.kind === 'time' ? localDateTimeToUtc(end) : '', status, note, false, subjects);
                    const path = await this.plugin.saveEntry(pending);
                    saved = true;
                    new Notice(`Track Record: saved ${path}.`);
                } catch (error) { feedback.setText(errorMessage(error) + (pending ? ' Retry saves the original submission; reopen the dialog to enter a different record.' : '')); throw error; }
            });
            if (saved) this.close();
            else saveButton.setDisabled(false);
        };
        let saveButton!: import('obsidian').ButtonComponent;
        new Setting(this.contentEl).setDesc('Ctrl+Enter saves and closes.').addButton(button =>
        {
            saveButton = button;
            button.setButtonText('Save record').setCta().onClick(save);
        });
        this.scope.register(['Mod'], 'Enter', event =>
        {
            event.preventDefault();
            void save();
            return false;
        });
    }
}
