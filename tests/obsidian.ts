import { parse, stringify } from 'yaml';
export { default as moment } from 'moment';

export const parseYaml = parse;
export const stringifyYaml = stringify;
export const notices: string[] = [];
export const modals: Modal[] = [];
export const settings: Setting[] = [];
export const Platform = { isDesktopApp: false, isAndroidApp: false, isIosApp: false };

export class Element
{
    text = '';
    tag = '';
    attributes = new Map<string, string>();
    events = new Map<string, () => unknown>();
    value = '';
    rows = 0;
    selectionStart = 0;
    selectionEnd = 0;
    children: Element[] = [];
    remove(): void
    {
    }
    focus(): void
    {
    }
    setRangeText(value: string): void
    {
        this.value = value;
    }
    setText(text: string): void
    {
        this.text = text;
    }
    addClass(): void
    {
    }
    setAttribute(name: string, value: string): void
    {
        this.attributes.set(name, value);
    }
    addEventListener(name: string, callback: () => unknown): void
    {
        this.events.set(name, callback);
    }
    empty(): void
    {
        this.children = [];
    }
    createEl(_tag: string, options?: { text?: string }): Element
    {
        const child = new Element();
        child.text = options?.text ?? '';
        child.tag = _tag;
        this.children.push(child);
        return child;
    }
    createDiv(options?: { text?: string }): Element
    {
        return this.createEl('div', options);
    }
    createSpan(options?: { text?: string }): Element
    {
        return this.createEl('span', options);
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
    scope = {
        handlers: new Map<string, (event: { preventDefault(): void }) => unknown>(), register(_modifiers: string[], key: string, callback: (event: { preventDefault(): void }) => unknown)
        {
            this.handlers.set(key, callback);
        }
    };
    modalEl = new Element();
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
    onClose(): void
    {
    }
    close(): void
    {
        this.onClose();
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

export const suggestions: AbstractInputSuggest<unknown>[] = [];

export class AbstractInputSuggest<T>
{
    constructor(..._args: unknown[])
    {
        suggestions.push(this);
    }
    setValue(_value: string): void
    {
    }
    close(): void
    {
    }
}

export class Control
{
    inputEl = Object.assign(new Element(), { type: 'text', step: '' });
    text = '';
    disabled = false;
    change: (value: any) => void = () =>
    {
    };
    click: () => unknown = () =>
    {
    };
    setValue(value: string | boolean): this
    {
        this.text = String(value); return this;
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
    setClass(): this
    {
        return this;
    }
    setWarning(): this
    {
        return this;
    }
    onChange(callback: (value: any) => void): this
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
    settingEl = new Element();
    constructor(_element: unknown)
    {
        if (_element instanceof Element) _element.children.push(this.settingEl);
        settings.push(this);
    }
    setName(name: string): this
    {
        this.name = name; return this;
    }
    setHeading(): this
    {
        return this;
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
    addToggle(callback: (control: Control) => void): this
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

export function setIcon(): void
{
}

export class Component
{
    load(): void
    {
    }
    unload(): void
    {
    }
}
export class FuzzySuggestModal<T> extends Modal
{
    setPlaceholder(): void
    {
    }
}
export class MarkdownRenderer
{
    static async render(_app: unknown, markdown: string, el: Element): Promise<void>
    {
        el.setText(markdown);
    }
}
