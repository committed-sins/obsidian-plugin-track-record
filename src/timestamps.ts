export function instant(value: string): number
{
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw Error('Use an ISO timestamp with timezone, e.g. 2026-11-19T09:00:00+01:00.');
    const [, year, month, day, hour, minute, second = '0', , zone] = match;
    const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    if (Number(year) < 1000 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > maxDay || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw Error('Invalid calendar date or time.');
    if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59 || (zone.slice(1, 3) === '14' && zone.slice(4) !== '00'))) throw Error('Invalid timezone offset.');
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw Error('Invalid timestamp.');
    return timestamp;
}

export function localTimestamp(date = new Date()): string
{
    const pad = (n: number) => String(n).padStart(2, '0');
    const offset = -date.getTimezoneOffset();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function utcTimestamp(date = new Date()): string
{
    return date.toISOString();
}

export function localDateTime(date = new Date()): string
{
    return localTimestamp(date).slice(0, 19);
}

export function localDateTimeToUtc(value: string): string
{
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw Error('Choose a date and time.');
    instant(value + 'Z'); // Validate calendar fields before the local constructor can normalize them.
    const date = new Date(value);
    const normalized = value.length === 16 ? value + ':00' : value;
    if (!Number.isFinite(date.getTime()) || localDateTime(date) !== normalized) throw Error('This local time does not exist because the clocks change. Choose another time.');
    return utcTimestamp(date);
}

export function formatElapsed(milliseconds: number): string
{
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
