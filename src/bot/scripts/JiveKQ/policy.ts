import { parseRangeStyle } from '../../api/combat/CombatStyle.js';

export interface Point { x: number; z: number; level: number }
export type Phase = 'melee' | 'ranged';

export const BANK = { x: 3308, z: 3120, level: 0 };
export const SURFACE = { x: 3226, z: 3108, level: 0 };
export const UPPER = { x: 3508, z: 9497, level: 2 };
export const ARRIVAL = { x: 3508, z: 9493, level: 0 };
export const lureTile = (queen: Point): Point => queen.x <= 3487 ? { x: 3508, z: 9493, level: 0 } : { x: 3466, z: 9494, level: 0 };
export const WAIT_CORNER = { x: 3470, z: 9503, level: 0 };

export function near(a: Point | null, b: Point, radius: number): boolean {
    return a !== null && a.level === b.level && Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= radius;
}

export function inNest(p: Point | null): boolean {
    return p !== null && p.x >= 3456 && p.x < 3520 && p.z >= 9472 && p.z < 9536;
}

export function inLair(p: Point | null): boolean {
    return inNest(p) && p?.level === 0;
}

export function queenPhase(id: number): Phase | null {
    return id === 1158 ? 'melee' : id === 1160 ? 'ranged' : null;
}

export function knownDead(health: number, totalHealth: number): boolean {
    return totalHealth > 0 && health === 0;
}

export class QueenTracker {
    killedAt = 0;
    startedAt = 0;
    lastKillMs = 0;
    private flyingAlive = false;
    private flyingDead = false;

    observe(npc: { id: number; health: number; totalHealth: number } | null, now = Date.now()): { dead: boolean; killed: boolean } {
        if (!npc) {
            const killed = this.flyingDead;
            this.flyingDead = false;
            if (killed) { this.killedAt = now; this.lastKillMs = now - this.startedAt; }
            return { dead: false, killed };
        }
        if (!this.startedAt || (npc.id === 1158 && this.killedAt)) { this.startedAt = now; this.killedAt = 0; }
        if (npc.id === 1158) this.flyingAlive = false;
        if (npc.id === 1160 && npc.health > 0) this.flyingAlive = true;
        const dead = knownDead(npc.health, npc.totalHealth) && (npc.id === 1158 || this.flyingAlive);
        if (npc.id === 1160 && dead) this.flyingDead = true;
        return { dead, killed: false };
    }
}

export const SIDES = ['West', 'East', 'North', 'South'] as const;

export function combatTile(centre: Point, size: number, slot: number, phase: Phase = 'melee'): Point {
    const radius = phase === 'ranged' ? 6 : Math.floor(size / 2) + 1;
    return { ...centre, x: centre.x + [-1, 1, 0, 0][slot] * radius, z: centre.z + [0, 0, 1, -1][slot] * radius };
}

export function combatFormation(centre: Point, size: number, phase: Phase, usable: (p: Point) => boolean): Point[] | null {
    const radii = phase === 'melee' ? [Math.floor(size / 2) + 1] : [6, 5, 7, 4, 8, 3, 9];
    const choices = SIDES.map((_, slot) => radii.map(r => ({ ...centre, x: centre.x + [-1, 1, 0, 0][slot] * r, z: centre.z + [0, 0, 1, -1][slot] * r })).filter(usable));
    const choose = (tiles: Point[]): Point[] | null => {
        if (tiles.length === 4) return tiles;
        for (const tile of choices[tiles.length]) {
            if (phase === 'ranged' && tiles.some(p => near(p, tile, 5))) continue;
            const result = choose([...tiles, tile]);
            if (result) return result;
        }
        return null;
    };
    return choose([]);
}

export function combatMode(phase: Phase, styles: readonly { mode: number; label: string }[] | null): number | null {
    return phase === 'ranged' ? parseRangeStyle('rapid') : styles?.find(s => s.label.toLowerCase().includes('aggressive'))?.mode ?? null;
}

export interface Supplies { hp: number; food: number; prayer: number; prayerDoses: number; escape: boolean; arrows: number }

export function retreatReason(s: Supplies): string | null {
    if (s.hp <= 31) return 'hitpoints at or below the queen max hit';
    if (s.food <= 1) return 'food reserve reached';
    if (s.prayer <= 10 && s.prayerDoses === 0) return 'prayer reserve exhausted';
    if (!s.escape) return 'escape supplies missing';
    if (s.arrows === 0) return 'out of arrows';
    return null;
}
