import { matchesCommonBankLoot } from '../../api/bank/bankRules.js';
import { CASKET_IDS, CLUE_DB } from '../../api/ai/clues/data/cluedb.js';
import Tile from '../../geometry/Tile.js';
import type { SettingsBag, SettingsSchema } from '../../runtime/Settings.js';

export type Style = 'melee' | 'mage' | 'range';

/** How long the safespot may see no adult before the bot rotates off it. */
export const SAFESPOT_BLIND_MS = 20_000;

export interface LadderState {
    index: number;
    spots: number;
    /** HP fell while standing on the current safespot. */
    hurt: boolean;
    /** How long no adult has been in line of sight. */
    blindMs: number;
}

// Why: the tiles are derived as melee-proof, so a hit is the derivation being wrong and the blind window is a dragon body parked across the angle.

/** The safespot index to stand on next. */
export function nextSafespot(s: LadderState): number {
    if (s.spots <= 1) {
        return 0;
    }
    if (!s.hurt && s.blindMs < SAFESPOT_BLIND_MS) {
        return s.index;
    }
    return (s.index + 1) % s.spots;
}

export interface HurtState {
    rangedThreat: boolean;
    onSpot: boolean;
    /** The hp read on the previous pass, or -1 when the bot was off the tile. */
    lastHp: number;
    hp: number;
}

// Why: the King Black Dragon breathes at anything it can see, so on its site a hit on the tile is expected and only the blind clock turns the ladder.

/** Whether hp lost on the current safespot says the tile is wrong. */
export function hurtOnSpot(s: HurtState): boolean {
    return !s.rangedThreat && s.onSpot && s.lastHp >= 0 && s.hp < s.lastHp;
}

export interface RetreatState {
    inLair: boolean;
    /** Standing on one of the site's safespots right now. */
    onSafespot: boolean;
    hpFrac: number;
    retreatHp: number;
    hasFood: boolean;
    spots: number;
}

// Why: eating in dragonfire is a race the bot loses, so the walk out of the fire outranks the bite.
// Why: with no food hp only falls, so there is no threshold left to wait on, and the free immune tile is where the walk to the bank should start.

/** Whether to break off and stand on a safespot rather than hold the tile the bot is on. */
export function retreatDue(s: RetreatState): boolean {
    if (!s.inLair || s.spots <= 0 || s.onSafespot || s.retreatHp <= 0) {
        return false;
    }
    return !s.hasFood || s.hpFrac < s.retreatHp;
}

export interface LootState {
    hpFrac: number;
    panicHp: number;
    retreatHp: number;
}

// Why: a loot burst that checked only whether it needed to eat, which an empty pack never does, kept picking arrows off a demon's feet from 64 hp down to 10.

/** Whether the run is too hurt to keep walking the drop pile, so the retreat or the bank run gets the loop. */
export function lootHalts(s: LootState): boolean {
    return s.hpFrac < s.panicHp || (s.retreatHp > 0 && s.hpFrac < s.retreatHp);
}

export interface HoldState {
    onSafespot: boolean;
    hasFood: boolean;
}

// Why: this and retreatDue pull opposite ways, so a foodless melee run with both open to it steps off the safespot and back forever.

/** Whether the walk back to the fight tile may run. */
export function holdDue(s: HoldState): boolean {
    return s.hasFood || !s.onSafespot;
}

export interface Spot {
    x: number;
    z: number;
}

// Why: nothing in the walker returns a path cost, only a reachable yes or no, and the spots sit within a few tiles of each other where Chebyshev and a walked path agree.

/** Index of the safespot fewest tiles away, ties going to the earlier one. */
export function nearestSpot(from: Spot, spots: readonly Spot[]): number {
    let best = 0;
    let bestDist = Infinity;
    for (const [i, spot] of spots.entries()) {
        const dist = Math.max(Math.abs(spot.x - from.x), Math.abs(spot.z - from.z));
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

// Why: the client reports an npc at the tile under the centre of its footprint, and the engine measures sight to the south-west corner.

/** The south-west tile of a body the client reports at its centre. */
export function bodyOrigin(tile: Spot, size: number): Spot {
    const back = size >> 1;
    return { x: tile.x - back, z: tile.z - back };
}

export interface Sighting {
    x: number;
    z: number;
    /** When the body was first seen on this tile. */
    since: number;
    at: number;
}

// Why: a wandering body steps a tile a tick, and a click sent at one on the move lands after it has left the range, so the server walks the bot after it.

/** Where a body was last seen, keeping `since` while it holds its tile. */
export function noteSighting(prev: Sighting | undefined, tile: Spot, now: number): Sighting {
    if (prev !== undefined && prev.x === tile.x && prev.z === tile.z) {
        return { ...prev, at: now };
    }
    return { x: tile.x, z: tile.z, since: now, at: now };
}

/** Whether the body has held its tile for `ms`. */
export function settled(s: Sighting | undefined, now: number, ms: number): boolean {
    return s !== undefined && now - s.since >= ms;
}

export interface RetreatAim {
    /** The index a failed attempt rotated to, or null when this retreat is a fresh one. */
    rotated: number | null;
    from: Spot;
    spots: readonly Spot[];
}

// Why: a retry that recomputes the nearest spot from the tile it never left picks the spot that failed, so a rotation only sticks by being carried into the next attempt.

/** Which safespot a retreat walks at, and which one it tries if that one cannot be reached. */
export function retreatAim(a: RetreatAim): { index: number; next: number } {
    const index = a.rotated ?? nearestSpot(a.from, a.spots);
    return { index, next: a.spots.length > 0 ? (index + 1) % a.spots.length : index };
}

// Why: clicking Attack beyond weapon range makes the server walk you into range, which steps off the safespot.
const ATTACK_RANGE: Record<Style, number> = { melee: 1, range: 7, mage: 10 };

export function attackRangeFor(style: Style): number {
    return ATTACK_RANGE[style];
}

// Why: a body on the last tile of the range is one wander step from out of it by the time the click lands, and the third demon run was walked off the tile that way at gap 7.

/** How far a body may stand for the click to be sent. */
export function engageRangeFor(style: Style): number {
    return style === 'melee' ? ATTACK_RANGE.melee : ATTACK_RANGE[style] - 1;
}

// Why: the engine measures range between the closest tiles of the two footprints, and Npc.distance() measures to the centre of one, so a size-4 dragon read 2 at its north and east faces and 3 at its south and west, and a size-3 demon read 1 past its near face.

/** The gap the server measures from `from` to a body the client reports at `tile`. */
export function gapTo(from: Spot, tile: Spot, size: number): number {
    const o = bodyOrigin(tile, size);
    const dx = Math.max(o.x - from.x, from.x - (o.x + size - 1), 0);
    const dz = Math.max(o.z - from.z, from.z - (o.z + size - 1), 0);
    return Math.max(dx, dz);
}

// Why: dragonfire is 5 through the shield and 30 without, rising to 50 when the attack roll beats the defence roll.
// Why: mage and range fight from a tile no footprint touches, and the op trigger is the only thing that breathes, so the shield would only cost the slot the weapon needs.

/** Why melee may not start, or null when it may. */
export function meleeShieldGate(style: Style, hasShield: boolean): string | null {
    if (style !== 'melee' || hasShield) {
        return null;
    }
    return 'melee needs the Dragonfire shield and there is none in the bank or worn. Duke Horacio in Lumbridge Castle hands one out free, or switch to mage or range, which fight from a fire-proof safespot.';
}

/** Every hard trail is a distinct obj all displaying "Clue scroll", so id is the only match. */
export function isClueObj(id: number): boolean {
    return CLUE_DB[id] !== undefined || CASKET_IDS[id] !== undefined;
}

export interface DropFilter {
    loot: ReadonlySet<string>;
    bankCommon: boolean;
    solveClues: boolean;
    buryBones: boolean;
    boneName: string;
}

// Why: clues and burial bones ignore the loot list, so unticking a box cannot silently stop clue solving or leave the bones the run was told to bury.

/** Whether a ground item is worth a slot. */
export function wantsDrop(item: { id: number; name: string | null }, f: DropFilter): boolean {
    if (f.solveClues && isClueObj(item.id)) {
        return true;
    }
    const name = item.name ?? '';
    if (name.length === 0) {
        return false;
    }
    const lower = name.toLowerCase();
    if (f.buryBones && lower === f.boneName.toLowerCase()) {
        return true;
    }
    return f.loot.has(lower) || (f.bankCommon && matchesCommonBankLoot(name, item.id));
}

/** Where the next dusty key comes from. */
export function keyStatus(held: number, banked: number): 'held' | 'bank' | 'fetch' {
    if (held > 0) {
        return 'held';
    }
    return banked > 0 ? 'bank' : 'fetch';
}

// Why: SettingsStore.resolve fills every key with the schema default, so an untouched tile setting reads back as the schema's tile and would beat the tile the chosen site carries.

/** The site's own tile, unless the panel setting has been moved off its schema default. */
export function siteTileOf(schema: SettingsSchema, bag: SettingsBag, key: string | undefined, site: Tile): Tile {
    const def = key === undefined ? undefined : schema[key]?.default;
    if (key === undefined || !(def instanceof Tile)) {
        return site;
    }
    const set = bag.tile(key, site);
    return set.equals(def) ? site : set;
}
