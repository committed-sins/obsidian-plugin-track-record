export function objectProperties(value: unknown): Record<string, unknown> | null
{
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function errorMessage(error: unknown): string
{
    return error instanceof Error ? error.message : String(error);
}
