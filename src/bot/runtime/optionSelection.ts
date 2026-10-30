export function selectedOptions(values: readonly string[], options: readonly string[]): string[] {
    if (values.length === 0) return [...options];
    const choices = new Map<string, boolean>();
    for (const value of values) {
        const token = value.trim().toLowerCase();
        const id = /^[+-]/.test(token) ? token.slice(1) : token;
        choices.set(id, !token.startsWith('-'));
    }
    return options.filter(option => choices.get(option.toLowerCase()) === true);
}

export function signedOptions(values: readonly string[], options: readonly string[]): string[] {
    const selected = new Set(selectedOptions(values, options));
    return options.map(option => `${selected.has(option) ? '+' : '-'}${option}`);
}
