import { parse, stringify } from 'yaml';

export const parseYaml = parse;
export const stringifyYaml = stringify;
export const notices: string[] = [];
export const modals: Modal[] = [];
export const settings: Setting[] = [];

export class Element
{
    text = '';
    children: Element[] = [];
    setText(text: string): void
    {
        this.text = text;
    }
    addClass(): void
    {
    }
    setAttribute(): void
    {
    }
    addEventListener(): void
    {
    }
    empty(): void
    {
        this.children = [];
    }
    createEl(_tag: string, options?: { text?: string }): Element
    {
        const child = new Element();
        child.text = options?.text ?? '';
        this.children.push(child);
        return child;
    }
    createDiv(): Element
    {
        return this.createEl('div');
    }
}

export class TFile
{
    extension = 'md';
    constructor(public path: string)
    {
    }
}
export class TFolder
{
    constructor(public path: string)
    {
    }
}
export class Notice
{
    constructor(text: string)
    {
        notices.push(text);
    }
}
export class Plugin
{
    commands: { id: string; callback: () => void }[] = [];
    views = new Map<string, (leaf: unknown) => ItemView>();
    settingTabs: { display(): void }[] = [];
    data: unknown = null;
    constructor(public app: unknown)
    {
    }
    async loadData(): Promise<unknown>
    {
        return this.data;
    }
    async saveData(data: unknown): Promise<void>
    {
        this.data = data;
    }
    registerView(type: string, factory: (leaf: unknown) => ItemView): void
    {
        this.views.set(type, factory);
    }
    addSettingTab(tab: { display(): void }): void
    {
        this.settingTabs.push(tab);
    }
    addStatusBarItem(): Element
    {
        return new Element();
    }
    registerDomEvent(): void
    {
    }
    registerInterval(): void
    {
    }
    addRibbonIcon(): void
    {
    }
    addCommand(command: { id: string; callback: () => void }): void
    {
        this.commands.push(command);
    }
    registerEvent(): void
    {
    }
}
export class Modal
{
    contentEl = new Element();
    titleEl = new Element();
    closed = false;
    constructor(public app: unknown)
    {
    }
    onOpen(): void
    {
    }
    open(): void
    {
        modals.push(this); this.onOpen();
    }
    close(): void
    {
        this.closed = true;
    }
}
export class PluginSettingTab
{
    containerEl = new Element();
}
export class ItemView
{
    contentEl = new Element();
}
export class WorkspaceLeaf
{ }

export class AbstractInputSuggest<T>
{
    setValue(_value: string): void
    {
    }
    close(): void
    {
    }
}

export class Control
{
    inputEl = {};
    text = '';
    disabled = false;
    change: (value: string) => void = () =>
    {
    };
    click: () => unknown = () =>
    {
    };
    setValue(value: string): this
    {
        this.text = value; return this;
    }
    setPlaceholder(): this
    {
        return this;
    }
    setButtonText(value: string): this
    {
        this.text = value; return this;
    }
    setDisabled(value: boolean): this
    {
        this.disabled = value; return this;
    }
    setCta(): this
    {
        return this;
    }
    setWarning(): this
    {
        return this;
    }
    onChange(callback: (value: string) => void): this
    {
        this.change = callback; return this;
    }
    onClick(callback: () => unknown): this
    {
        this.click = callback; return this;
    }
}
export class Setting
{
    name = '';
    controls: Control[] = [];
    constructor(_element: unknown)
    {
        settings.push(this);
    }
    setName(name: string): this
    {
        this.name = name; return this;
    }
    setDesc(): this
    {
        return this;
    }
    addText(callback: (control: Control) => void): this
    {
        return this.add(callback);
    }
    addTextArea(callback: (control: Control) => void): this
    {
        return this.add(callback);
    }
    addButton(callback: (control: Control) => void): this
    {
        return this.add(callback);
    }
    private add(callback: (control: Control) => void): this
    {
        const control = new Control();
        this.controls.push(control);
        callback(control);
        return this;
    }
}
