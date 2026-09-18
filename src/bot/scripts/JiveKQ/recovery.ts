import { BOW, GEAR } from './loadout.js';
import { near, type Point } from './policy.js';

export interface RecoveryItem { id: number; count: number }
export interface DeathReport { at: number; tile: Point; items: RecoveryItem[]; ground: RecoveryItem[] }
export interface Casualty { name: string; session: string; trip: number; death: DeathReport }

export function deathReport(value: unknown, now: number): DeathReport | null {
    if (!value || typeof value !== 'object') return null;
    const d = value as Record<string, unknown>;
    if (typeof d.at !== 'number' || !Number.isFinite(d.at) || d.at > now + 1000 || now - d.at > 180_000 || !d.tile || typeof d.tile !== 'object') return null;
    const tile = d.tile as Record<string, unknown>;
    if (!['x', 'z', 'level'].every(k => typeof tile[k] === 'number' && Number.isInteger(tile[k]) && tile[k] >= 0 && tile[k] < (k === 'level' ? 4 : 16384))) return null;
    const items = (value: unknown): value is RecoveryItem[] => Array.isArray(value) && value.length <= 56 && value.every(i => i && Number.isInteger(i.id) && i.id > 0 && i.id < 65536 && Number.isInteger(i.count) && i.count > 0 && i.count <= 2147483647);
    if (!items(d.items) || !items(d.ground)) return null;
    return { at: d.at, tile: { x: Number(tile.x), z: Number(tile.z), level: Number(tile.level) }, items: d.items.map(i => ({ ...i })), ground: d.ground.map(i => ({ ...i })) };
}

export function recoveryDrops<T extends RecoveryItem & { tile: Point }>(death: DeathReport, drops: T[]): T[] {
    const gear = new Set([...GEAR, BOW]);
    const pile = drops.filter(d => near(d.tile, death.tile, 0));
    return pile.filter(d => death.items.some(i => i.id === d.id)
        && pile.filter(i => i.id === d.id).reduce((n, i) => n + i.count, 0) > death.ground.filter(i => i.id === d.id).reduce((n, i) => n + i.count, 0))
        .sort((a, b) => Number(gear.has(b.id)) - Number(gear.has(a.id)) || a.id - b.id);
}
