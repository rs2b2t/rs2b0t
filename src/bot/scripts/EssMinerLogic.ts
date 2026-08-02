import { withdrawOp } from '../api/hud/bankOps.js';

export const ESS_ITEM = 'Rune essence';

export const BEST_AVAILABLE = 'Best available';

export interface PickTier {
    tier: string;
    item: string;
    level: number;
}

export const PICK_TIERS: readonly PickTier[] = [
    { tier: 'Rune', item: 'Rune pickaxe', level: 41 },
    { tier: 'Adamant', item: 'Adamant pickaxe', level: 31 },
    { tier: 'Mithril', item: 'Mithril pickaxe', level: 21 },
    { tier: 'Steel', item: 'Steel pickaxe', level: 6 },
    { tier: 'Iron', item: 'Iron pickaxe', level: 1 },
    { tier: 'Bronze', item: 'Bronze pickaxe', level: 1 }
];

export const PICK_OPTIONS: string[] = [BEST_AVAILABLE, ...PICK_TIERS.map(t => t.tier)];

export function requiredMiningLevel(selection: string): number | null {
    return PICK_TIERS.find(t => t.tier.toLowerCase() === selection.trim().toLowerCase())?.level ?? null;
}

/** Exact tier EssMiner should own: the selected tier, or the level's best tier. */
export function desiredPickaxe(selection: string, miningLevel: number): PickTier | null {
    const specific = PICK_TIERS.find(t => t.tier.toLowerCase() === selection.trim().toLowerCase());
    if (specific) {
        return miningLevel >= specific.level ? specific : null;
    }
    return PICK_TIERS.find(t => miningLevel >= t.level) ?? null;
}

/** Re-check only when a setting change or Mining threshold changes the desired tier. */
export function needsPickaxeCheck(lastCheckedItem: string | null, selection: string, miningLevel: number): boolean {
    return lastCheckedItem !== (desiredPickaxe(selection, miningLevel)?.item ?? null);
}

export type PickResolution =
    | { kind: 'held'; item: string }
    | { kind: 'withdraw'; item: string }
    | { kind: 'stop'; reason: string };

export function resolvePick(selection: string, miningLevel: number, held: readonly string[], bank: readonly string[]): PickResolution {
    const has = (names: readonly string[], item: string): boolean =>
        names.some(n => n.toLowerCase() === item.toLowerCase());
    const specific = PICK_TIERS.find(t => t.tier.toLowerCase() === selection.trim().toLowerCase());
    if (specific && miningLevel < specific.level) {
        return { kind: 'stop', reason: `Mining ${specific.level} required for the ${specific.item} (have ${miningLevel})` };
    }
    const candidates = specific ? [specific] : PICK_TIERS.filter(t => miningLevel >= t.level);
    for (const t of candidates) {
        if (has(held, t.item)) {
            return { kind: 'held', item: t.item };
        }
    }
    for (const t of candidates) {
        if (has(bank, t.item)) {
            return { kind: 'withdraw', item: t.item };
        }
    }
    const want = specific ? specific.item : `usable pickaxe (${candidates.map(t => t.item).join(', ')})`;
    return { kind: 'stop', reason: `no ${want} in inventory, equipment, or bank` };
}

/** Pickaxe name that an EssMiner bank trip must preserve in the pack. */
export function heldPickaxeToKeep(selection: string, miningLevel: number, held: readonly string[]): string | null {
    const pick = resolvePick(selection, miningLevel, held, []);
    return pick.kind === 'held' ? pick.item : null;
}

export function inEssMine(x: number, z: number): boolean {
    return (x >> 6) === 45 && (z >> 6) === 75;
}

export function withdrawOneOp(ops: readonly (string | null)[]): string | null {
    return withdrawOp(ops, '1');
}
