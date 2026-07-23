import Tile from '#/bot/api/Tile.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import type { NpcStop } from '#/bot/quests/exec/primitives.js';

export const SPADE_NAME = 'Spade';
export const TRIO = ['Sextant', 'Watch', 'Chart'] as const;

export function trailKit(scrollId: number | null, spade: string = SPADE_NAME): string[] {
    if (scrollId === null) {
        return [];
    }
    return [spade, ...TRIO, ...(CLUE_DB[scrollId]?.items ?? [])];
}

export const SPADE_SPAWNS: Tile[] = [
    new Tile(2574, 3331, 0),
    new Tile(2981, 3369, 0)
];

export type CoordTool = 'sextant' | 'watch' | 'chart';

export interface HeldTrio {
    sextant: boolean;
    watch: boolean;
    chart: boolean;
}

export function nextCoordTool(held: HeldTrio): CoordTool | null {
    if (!held.sextant) {
        return 'sextant';
    }
    if (!held.watch) {
        return 'watch';
    }
    if (!held.chart) {
        return 'chart';
    }
    return null;
}

export const PROFESSOR: NpcStop = {
    npc: 'Observatory professor',
    anchor: new Tile(2438, 3186, 0),
    leash: 10,
    prefer: ['Treasure Trails', 'lost', 'navigation', 'sextant', 'watch']
};
export const MURPHY: NpcStop = {
    npc: 'Murphy',
    anchor: new Tile(2668, 3162, 0),
    leash: 10,
    prefer: ['sextant', 'lost']
};
export const KOJO: NpcStop = {
    npc: 'Brother Kojo',
    anchor: new Tile(2569, 3249, 0),
    leash: 10,
    prefer: ['watch', 'lost']
};
export const KOJO_EXIT = new Tile(2576, 3250, 0);
