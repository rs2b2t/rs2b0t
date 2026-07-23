import type { NavPoint } from '#/bot/nav/PathFinder.js';

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
}

export type ClueStep = ClueRow | { type: 'open-casket'; casketObj: string; casketId: number };
