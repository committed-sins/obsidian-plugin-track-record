import { instant, ownedOpenTimers, validateSubject, validateUserName, type RecordEntry } from './core';

export type PresenceReason = 'active' | 'quit' | 'unload';

export interface TimerObservation
{
    path: string;
    start: string;
    user: string;
    at: string;
    reason: PresenceReason;
}

export interface PresenceState
{
    version: 1;
    current: TimerObservation[];
    pending: TimerObservation[];
}

export function observationKey(value: TimerObservation): string
{
    return JSON.stringify([value.path, value.start, value.user]);
}

export function readPresence(value: unknown): PresenceState
{
    if (value === null || value === undefined) return { version: 1, current: [], pending: [] };
    if (typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid local timer reminder; preserved without overwriting.');
    const state = value as PresenceState;
    if (state.version !== 1 || !Array.isArray(state.current) || !Array.isArray(state.pending)) throw Error('Invalid local timer reminder; preserved without overwriting.');
    for (const observation of [...state.current, ...state.pending]) {
        if (!observation || typeof observation !== 'object' || typeof observation.user !== 'string' || validateUserName(observation.user) !== observation.user || !['active', 'quit', 'unload'].includes(observation.reason)) throw Error('Invalid local timer observation.');
        validateSubject({ path: observation.path });
        instant(observation.start);
        instant(observation.at);
    }
    return state;
}

export function pendingObservations(state: PresenceState): TimerObservation[]
{
    // Retain the earliest unacknowledged boundary for each timer across repeated restarts.
    const unique = new Map<string, TimerObservation>();
    for (const observation of [...state.pending, ...state.current]) {
        const key = observationKey(observation);
        const previous = unique.get(key);
        if (!previous || instant(observation.at) < instant(previous.at)) unique.set(key, observation);
    }
    return [...unique.values()];
}

export function observeTimers(records: RecordEntry[], user: string, at: string, reason: PresenceReason): TimerObservation[]
{
    instant(at);
    return ownedOpenTimers(records, user).filter(record => !!record.path).map(record => ({ path: record.path!, start: record.start, user, at, reason }));
}

export function matchesObservation(observation: TimerObservation, record: RecordEntry, user: string): boolean
{
    return observation.user === user && record.path === observation.path && record.start === observation.start && ownedOpenTimers([record], user).length === 1;
}

export function unresolvedObservations(pending: TimerObservation[], records: RecordEntry[], errors: string[]): TimerObservation[]
{
    // Missing or temporarily invalid synced notes may arrive later. Never substitute a new timer.
    if (errors.length) return pending;
    return pending.filter(observation =>
    {
        const record = records.find(candidate => candidate.path === observation.path);
        return !record || matchesObservation(observation, record, observation.user);
    });
}
