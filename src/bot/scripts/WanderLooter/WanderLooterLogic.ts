import type { WorldTile } from '../../adapter/ClientAdapter.js';
import Tile from '../../geometry/Tile.js';

export const DEFAULT_LOOT = ['Pumpkin'];
export const LOOT_STUCK_MS = 30_000;
export const LOOT_BLACKLIST_MS = 30 * 60_000;

/** A hit this soon before or after a pickup marks that item+tile as dangerous. */
export const DANGER_WINDOW_MS = 15_000;
export const DANGER_RADIUS = 8;

/** Eight compass directions, starting north and going clockwise. */
export const WANDER_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1]
];

export type LootAttemptStatus = 'done' | 'retry' | 'unreachable';
export type LootFailure = 'retrying' | 'blacklisted';

export function normalizeName(name: string | null | undefined): string {
    return (name ?? '').trim().toLowerCase();
}

/** Loot entries are exact, case-insensitive names. */
export function matchesLoot(name: string | null | undefined, configured: readonly string[]): boolean {
    const wanted = normalizeName(name);
    return wanted.length > 0 && configured.some(entry => normalizeName(entry) === wanted);
}

export function tileKey(tile: WorldTile): string {
    return `${tile.x}:${tile.z}:${tile.level}`;
}

export function lootKey(id: number, tile: WorldTile): string {
    return `${id}:${tileKey(tile)}`;
}

/** Bank everything except coins; keep only the desired food amount already in the pack. */
export function shouldDepositOnBank(
    name: string | null | undefined,
    food: string,
    foodCount: number,
    foodWanted: number
): boolean {
    const normalized = normalizeName(name);
    if (normalized.length === 0 || normalized === 'coins') {
        return false;
    }
    return normalized !== normalizeName(food) || foodCount > foodWanted;
}

export function shouldBankLoot(lootSlots: number, bankAt: number, inventoryFull: boolean): boolean {
    return lootSlots > 0 && (lootSlots >= bankAt || inventoryFull);
}

export function shouldIdleBank(now: number, lastLootAt: number, quitMs: number): boolean {
    return now - lastLootAt >= quitMs;
}

/** Failed item+tile attempts are ignored for 30 minutes, immediately when the server says unreachable. */
export class LootBlacklist {
    private readonly blockedUntil = new Map<string, number>();
    private readonly stuck = new Map<string, { first: number; last: number }>();

    constructor(private readonly now: () => number = Date.now) {}

    blocked(id: number, tile: WorldTile): boolean {
        const key = lootKey(id, tile);
        const now = this.now();
        for (const [entry, until] of this.blockedUntil) {
            if (until <= now) {
                this.blockedUntil.delete(entry);
            }
        }
        return (this.blockedUntil.get(key) ?? 0) > now;
    }

    success(id: number, tile: WorldTile): void {
        const key = lootKey(id, tile);
        this.blockedUntil.delete(key);
        this.stuck.delete(key);
    }

    failure(id: number, tile: WorldTile, status: LootAttemptStatus): LootFailure {
        const key = lootKey(id, tile);
        const now = this.now();
        if (status === 'unreachable') {
            this.stuck.delete(key);
            this.blockedUntil.set(key, now + LOOT_BLACKLIST_MS);
            return 'blacklisted';
        }
        const prev = this.stuck.get(key);
        const started = prev && now - prev.last <= LOOT_STUCK_MS ? prev.first : now;
        this.stuck.set(key, { first: started, last: now });
        if (now - started < LOOT_STUCK_MS) {
            return 'retrying';
        }
        this.stuck.delete(key);
        this.blockedUntil.set(key, now + LOOT_BLACKLIST_MS);
        return 'blacklisted';
    }

    /** Damage near a pickup immediately blocks that item+tile for 30 minutes. */
    markUnsafe(id: number, tile: WorldTile): void {
        const now = this.now();
        this.stuck.delete(lootKey(id, tile));
        this.blockedUntil.set(lootKey(id, tile), now + LOOT_BLACKLIST_MS);
    }

    count(): number {
        this.blocked(0, { x: 0, z: 0, level: 0 });
        return this.blockedUntil.size;
    }
}

function shuffledDirections(rand: () => number): Array<readonly [number, number]> {
    const dirs = [...WANDER_DIRECTIONS];
    for (let i = dirs.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [dirs[i], dirs[j]] = [dirs[j]!, dirs[i]!];
    }
    return dirs;
}

/** Prefer the full 30 steps, then a shorter hop, but never return a tile the caller cannot navigate to. */
export function pickWanderTile(
    here: WorldTile,
    distance: number,
    navigable: (tile: Tile) => boolean,
    rand: () => number = Math.random,
    avoidDirection: readonly [number, number] | null = null
): Tile | null {
    if (here.level > 0) {
        const down = new Tile(here.x, here.z, here.level - 1);
        if (navigable(down)) {
            return down;
        }
    }
    const distances = [...new Set([distance, Math.max(1, Math.floor(distance / 2)), 5])];
    const directions = shuffledDirections(rand);
    const forward = avoidDirection
        ? directions.filter(([dx, dz]) => dx * avoidDirection[0] + dz * avoidDirection[1] >= 0)
        : directions;
    // Try forward/sideways first, then allow a backwards hop if that is all the map offers.
    for (const pass of forward === directions ? [directions] : [forward, directions]) {
        for (const steps of distances) {
            for (const [dx, dz] of pass) {
                const tile = new Tile(here.x + dx * steps, here.z + dz * steps, here.level);
                if (navigable(tile)) {
                    return tile;
                }
            }
        }
    }
    return null;
}
