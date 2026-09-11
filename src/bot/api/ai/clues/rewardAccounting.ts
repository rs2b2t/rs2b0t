import type { GroundItemSnapshot, WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { RewardQuantity } from './ClueReward.js';

export function quantities(items: readonly RewardQuantity[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const { id, count } of items) result.set(id, (result.get(id) ?? 0) + count);
    return result;
}

export function groundKey(g: GroundItemSnapshot): string {
    return `${g.tile.level}:${g.tile.x}:${g.tile.z}:${g.id}`;
}

export function groundCounts(items: readonly GroundItemSnapshot[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const g of items) result.set(groundKey(g), (result.get(groundKey(g)) ?? 0) + g.count);
    return result;
}

export function distance(a: WorldTile, b: WorldTile): number {
    return a.level === b.level ? Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) : Infinity;
}
