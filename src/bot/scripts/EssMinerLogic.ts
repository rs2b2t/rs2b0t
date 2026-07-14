/**
 * Pure EssMiner knowledge — no client imports so it runs under plain
 * `bun test` (ArdyThieverLogic pattern). Mirrors the engine's own pickaxe
 * rules (`skill_mining/scripts/pickaxe_checker.rs2`: usable = worn right hand
 * OR inventory, best tier first, gated on the Mining stat) and the essence
 * mine's region (`essence_mine.rs2` teleports land in mapsquare 45_75).
 */
import { withdrawOp } from '../api/hud/bankOps.js';

/** The mined item (`blankrune` obj, display name). */
export const ESS_ITEM = 'Rune essence';

export const BEST_AVAILABLE = 'Best available';

export interface PickTier {
    tier: string;
    item: string;
    level: number;
}

// levelrequire params from the content's pickaxes.obj, best-first — the same
// order pickaxe_checker walks.
export const PICK_TIERS: readonly PickTier[] = [
    { tier: 'Rune', item: 'Rune pickaxe', level: 41 },
    { tier: 'Adamant', item: 'Adamant pickaxe', level: 31 },
    { tier: 'Mithril', item: 'Mithril pickaxe', level: 21 },
    { tier: 'Steel', item: 'Steel pickaxe', level: 6 },
    { tier: 'Iron', item: 'Iron pickaxe', level: 1 },
    { tier: 'Bronze', item: 'Bronze pickaxe', level: 1 }
];

/** The `pickaxe` dropdown options. */
export const PICK_OPTIONS: string[] = [BEST_AVAILABLE, ...PICK_TIERS.map(t => t.tier)];

/** A specific tier's Mining gate; null for Best available (never gated) or unknown. */
export function requiredMiningLevel(selection: string): number | null {
    return PICK_TIERS.find(t => t.tier.toLowerCase() === selection.trim().toLowerCase())?.level ?? null;
}

export type PickResolution =
    | { kind: 'held'; item: string }
    | { kind: 'withdraw'; item: string }
    | { kind: 'stop'; reason: string };

/**
 * Which pickaxe to use, engine-mirrored: prefer one already held (worn or in
 * the pack), else withdraw from the bank, else stop. `Best available` walks
 * the usable tiers best-first; a specific tier never falls back — the user
 * chose it, so an unusable/unowned choice is a clear stop.
 */
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

/** The essence mine is exactly mapsquare 45_75 (x 2880-2943, z 4800-4863). */
export function inEssMine(x: number, z: number): boolean {
    return (x >> 6) === 45 && (z >> 6) === 75;
}

/** The "Withdraw 1" op off a bank item's op list — see bankOps.withdrawOp. */
export function withdrawOneOp(ops: readonly (string | null)[]): string | null {
    return withdrawOp(ops, '1');
}
