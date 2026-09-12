import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';

export type ClueType = 'search' | 'dig' | 'talk';

export interface ClueRow {
    obj: string;
    id: number;
    type: ClueType;
    coord?: NavPoint;
    casketObj?: string;
    casketId?: number;
    npc?: string;
    needsSextant?: boolean;
    keyFrom?: { npc: string; keyObj: string; keyId: number };
    items?: string[];
    // Hard tier: the first dig spawns this NPC instead of the casket, which only appears once it's dead.
    guardian?: string;
// Hard tier: the NPC gives a sliding puzzle before the next clue.
    puzzle?: { obj: string; id: number };
}

export type ClueStep = ClueRow | { type: 'open-casket'; casketObj: string; casketId: number };
