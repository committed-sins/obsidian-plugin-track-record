import { moment } from 'obsidian';
import { instant } from './timestamps';

type DateFactory = (timestamp: number) => unknown;

function isDateFactory(value: unknown): value is DateFactory
{
    return typeof value === 'function';
}

function hasDateFormatter(value: unknown): value is { format(pattern: string): unknown }
{
    return typeof value === 'object' && value !== null && 'format' in value && typeof value.format === 'function';
}

export function formatLocalTimestamp(value: string, pattern: string): string
{
    // Obsidian provides Moment at runtime; its type declarations are resolved separately.
    const createDate: unknown = moment;
    if (!isDateFactory(createDate)) throw Error('Obsidian’s date formatter is unavailable.');
    const date = createDate(instant(value));
    if (!hasDateFormatter(date)) throw Error('Obsidian could not format the date.');
    const formatted = date.format(pattern);
    if (typeof formatted !== 'string') throw Error('Obsidian could not format the date.');
    return formatted;
}
