const COMBAT_STYLE_MODE: Record<string, number> = {
    attack: 0,
    accurate: 0,
    strength: 1,
    aggressive: 1,
    defence: 2,
    defense: 2,
    defensive: 2
};

export const COMBAT_STYLE_OPTIONS = ['attack', 'strength', 'defence'];

export function parseCombatStyle(name: string): number {
    return COMBAT_STYLE_MODE[name.trim().toLowerCase()] ?? 1;
}

const RANGE_STYLE_MODE: Record<string, number> = {
    accurate: 0,
    rapid: 1,
    longrange: 2,
    'long range': 2,
    'long-range': 2
};

export const RANGE_STYLE_OPTIONS = ['accurate', 'rapid', 'longrange'];

export function parseRangeStyle(name: string): number {
    return RANGE_STYLE_MODE[name.trim().toLowerCase()] ?? 1;
}
