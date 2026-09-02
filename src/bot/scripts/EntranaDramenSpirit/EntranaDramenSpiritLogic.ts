import { castsAvailable } from '../../api/combat/CombatStyleLogic.js';

export const SPELL = 'Wind Strike';
export const SPELL_LEVEL = 1;
export const CAST_TICKS = 5;
export const RUNE_MIN = 200;
export const AIR_RUNE = 'Air rune';
export const MIND_RUNE = 'Mind rune';
export const BRONZE_AXE = 'Bronze axe';
export const CAVE_MONK = 'Cave monk';
/** Lost City cave-monk agree line. */
export const CAVE_MONK_AGREE = 'Well that is a risk I will have to take.';
export const TREE_NEAR = 10;

export const TREE_SPIRIT_ID = 655;
export const DRAMEN_TREE_ID = 1292;
export const ENTRANA_ZOMBIE_ID = 76;
export const ENTRANA_LADDER_ID = 2408;

export const SAFE_SPOT = { x: 2859, z: 9731, level: 0 };
export const TREE_STAND = { x: 2860, z: 9734, level: 0 };
export const LADDER_SURFACE = { x: 2820, z: 3374, level: 0 };
export const DUNGEON_ARRIVAL = { x: 2822, z: 9774, level: 0 };
export const ZOMBIES = { x: 2846, z: 9761, level: 0 };

export const SPIRIT_NAMES = ['Dramen Tree Spirit', 'Tree spirit'];
export const TREE_NAMES = ['Dramen Tree', 'Dramen tree'];

export type LostCityArea = 'dungeon' | 'entranaShip' | 'entrana' | 'mainland' | 'unknown';

export type SpiritAction =
    | { kind: 'wait' }
    | { kind: 'continue-dialog' }
    | { kind: 'pick-monk' }
    | { kind: 'stop'; reason: string }
    | { kind: 'bank-runes' }
    | { kind: 'enter-dungeon' }
    | { kind: 'get-axe' }
    | { kind: 'run-to-safespot' }
    | { kind: 'cast' }
    | { kind: 'walk-to-tree' }
    | { kind: 'chop-tree' };

export type DescendAction = 'done' | 'drive-dialog' | 'open-dialog' | 'climb-ladder';

export interface SpiritSnapshot {
    ingame: boolean;
    done: boolean;
    canContinue: boolean;
    monkOptions: readonly string[];
    magicLevel: number;
    canCast: boolean;
    area: LostCityArea;
    runesProvisioned: boolean;
    hasBronzeAxe: boolean;
    spiritPresent: boolean;
    sawSpirit: boolean;
    onSafeSpot: boolean;
    distanceToTree: number;
}

export interface WorldPos {
    x: number;
    z: number;
    level?: number;
}

/**
 * Same regions as `lostCityArea` in lostcity.ts.
 * Why: Entrana dungeon is z 9650-9850, surface is z 3290-3440, the ship is the same box at level 1.
 */
export function classifyArea(tile: WorldPos | null | undefined): LostCityArea {
    if (!tile) {
        return 'unknown';
    }
    if (tile.x >= 2790 && tile.x <= 2900 && tile.z >= 9650 && tile.z <= 9850) {
        return 'dungeon';
    }
    if (tile.x >= 2790 && tile.x <= 2880 && tile.z >= 3290 && tile.z <= 3440) {
        return (tile.level ?? 0) > 0 ? 'entranaShip' : 'entrana';
    }
    return 'mainland';
}

export function isUnderground(tile: WorldPos | null | undefined): boolean {
    return classifyArea(tile) === 'dungeon';
}

export function onSafeSpot(tile: WorldPos | null | undefined, spot: WorldPos = SAFE_SPOT): boolean {
    if (!tile) {
        return false;
    }
    return tile.x === spot.x && tile.z === spot.z && (tile.level ?? 0) === (spot.level ?? 0);
}

export function chebyshev(a: WorldPos, b: WorldPos): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function isSpiritName(name: string | null | undefined): boolean {
    return (name ?? '').toLowerCase().includes('tree spirit');
}

export function isDramenTreeName(name: string | null | undefined): boolean {
    const n = (name ?? '').toLowerCase();
    return n.includes('dramen') && n.includes('tree');
}

export function chopOp(actions: readonly (string | null)[]): string | null {
    const acts = actions.filter((a): a is string => a !== null);
    return acts.find(a => /chop/i.test(a)) ?? acts.find(a => /cut/i.test(a)) ?? null;
}

export function climbDownOp(actions: readonly (string | null)[]): string | null {
    const acts = actions.filter((a): a is string => a !== null);
    return acts.find(a => /climb.*down/i.test(a)) ?? acts.find(a => /^climb$/i.test(a)) ?? null;
}

export function canCastWindStrike(magicLevel: number, wielded: readonly string[], held: (rune: string) => number): boolean {
    if (magicLevel < SPELL_LEVEL) {
        return false;
    }
    return castsAvailable(SPELL, [...wielded], held) >= 1;
}

export function runeShortage(bankAir: number, bankMind: number): string | null {
    const short: string[] = [];
    if (bankAir < RUNE_MIN) {
        short.push(`${AIR_RUNE} (${bankAir} < ${RUNE_MIN})`);
    }
    if (bankMind < RUNE_MIN) {
        short.push(`${MIND_RUNE} (${bankMind} < ${RUNE_MIN})`);
    }
    if (short.length === 0) {
        return null;
    }
    return `bank has ${short.join(' and ')}`;
}

export function pickCaveMonkOption(options: readonly string[]): string | null {
    const fragments = [CAVE_MONK_AGREE, 'risk i will have to take', "i'll take my chances", 'i will take my chances'];
    for (const fragment of fragments) {
        const hit = options.find(o => o.toLowerCase().includes(fragment.toLowerCase()));
        if (hit) {
            return hit;
        }
    }
    return null;
}

/**
 * After the monk warns us, Climb-down on loc 2408 is what actually leaves the surface.
 * Why: the loc action opens dialogue first (`entranaladdertop` has no movement destination), so agree, then climb.
 */
export function nextDescendAction(opts: { underground: boolean; dialogOpen: boolean; warned: boolean }): DescendAction {
    if (opts.underground) {
        return 'done';
    }
    if (opts.dialogOpen) {
        return 'drive-dialog';
    }
    if (!opts.warned) {
        return 'open-dialog';
    }
    return 'climb-ladder';
}

export function magicStopReason(level: number): string {
    return `Magic ${level} < ${SPELL_LEVEL} for ${SPELL}`;
}

export function runeStopReason(): string {
    return `out of ${MIND_RUNE} / ${AIR_RUNE} for ${SPELL}`;
}

export function spiritDeadReason(): string {
    return 'Dramen Tree Spirit is dead';
}

export function decide(snap: SpiritSnapshot): SpiritAction {
    if (!snap.ingame || snap.done) {
        return { kind: 'wait' };
    }
    if (snap.canContinue) {
        return { kind: 'continue-dialog' };
    }
    if (pickCaveMonkOption(snap.monkOptions)) {
        return { kind: 'pick-monk' };
    }
    if (snap.magicLevel < SPELL_LEVEL) {
        return { kind: 'stop', reason: magicStopReason(snap.magicLevel) };
    }

    if (snap.area === 'mainland' || snap.area === 'unknown') {
        if (!snap.runesProvisioned) {
            return { kind: 'bank-runes' };
        }
        if (!snap.canCast) {
            return { kind: 'stop', reason: runeStopReason() };
        }
        return { kind: 'enter-dungeon' };
    }

    if (snap.area === 'entrana' || snap.area === 'entranaShip') {
        if (!snap.canCast) {
            return { kind: 'stop', reason: runeStopReason() };
        }
        return { kind: 'enter-dungeon' };
    }

    if (!snap.canCast) {
        return { kind: 'stop', reason: runeStopReason() };
    }

    if (snap.spiritPresent) {
        if (!snap.onSafeSpot) {
            return { kind: 'run-to-safespot' };
        }
        return { kind: 'cast' };
    }

    if (snap.sawSpirit) {
        return { kind: 'stop', reason: spiritDeadReason() };
    }

    if (!snap.hasBronzeAxe) {
        return { kind: 'get-axe' };
    }

    if (!snap.onSafeSpot && snap.distanceToTree > TREE_NEAR) {
        return { kind: 'walk-to-tree' };
    }
    return { kind: 'chop-tree' };
}
