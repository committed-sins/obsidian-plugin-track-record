export function hasAsciiControl(value: string): boolean
{
    for (let index = 0; index < value.length; index++) {
        if (value.charCodeAt(index) < 32) return true;
    }
    return false;
}

export function hasLineBreakOrNul(value: string): boolean
{
    return /[\r\n]/.test(value) || value.includes(String.fromCharCode(0));
}
