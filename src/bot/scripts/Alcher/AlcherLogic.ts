import { ALCH_ITEMS, CUSTOM_ALCH_KEY, HIGH_ALCH_SPELL, LOW_ALCH_SPELL, SPELL_HIGH, SPELL_LOW } from '../../api/magic/alchemy.js';

export * from '../../api/magic/alchemy.js';
export { FIRE_STAFF, FIRE_STAVES, pickFireStaff } from '../../api/magic/fireStaves.js';

export const SPELL_OPTIONS = [SPELL_HIGH, SPELL_LOW];
export const SPELL_OPTION_LABELS: Record<string, string> = {
    [SPELL_HIGH]: HIGH_ALCH_SPELL,
    [SPELL_LOW]: LOW_ALCH_SPELL
};

// Why: the chips are for finding an item by name, so they read alphabetically by the label shown; ALCH_ITEMS keeps its richest-first order, which is what the drain runs on.
export const ALCH_OPTIONS: string[] = [
    CUSTOM_ALCH_KEY,
    ...[...ALCH_ITEMS].sort((a, b) => a.label.localeCompare(b.label)).map(i => i.key)
];

export const ALCH_OPTION_LABELS: Record<string, string> = {
    [CUSTOM_ALCH_KEY]: 'Custom item (named below)',
    ...Object.fromEntries(ALCH_ITEMS.map(i => [i.key, `${i.label} (${i.alchValue.toLocaleString()})`]))
};

export function fmtGp(n: number): string {
    const v = Math.round(n);
    const mag = Math.abs(v);
    if (mag >= 1_000_000) {
        return `${(v / 1_000_000).toFixed(1)}m`;
    }
    if (mag >= 10_000) {
        return `${Math.round(v / 1000)}k`;
    }
    if (mag >= 1000) {
        return `${(v / 1000).toFixed(1)}k`;
    }
    return String(v);
}
