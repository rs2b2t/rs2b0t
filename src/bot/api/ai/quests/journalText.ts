export function normalizeJournal(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

export function matchJournal(
    text: string,
    stages: readonly (readonly [string, number])[],
    flagRules: readonly (readonly [string, string])[]
): { stage: number; flags: Set<string> } | undefined {
    if (text.length === 0) return undefined;
    const hit = stages.find(([needle]) => text.includes(needle));
    if (!hit) return undefined;

    const flags = new Set<string>();
    for (const [needle, flag] of flagRules) {
        if (text.includes(needle)) flags.add(flag);
    }
    return { stage: hit[1], flags };
}
