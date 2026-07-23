import type Tile from '../../api/Tile.js';
import type { QuestStatus } from '#/bot/api/hud/Quests.js';
import type { QuestRecord } from '../types.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';

export interface QuestSnapshot {
    journal: QuestStatus;
    inv: Map<string, number>;
    worn: Set<string>;
    noProgress: number;
    bankCoins: number;
}

export type QuestStep =
    | { kind: 'talk'; stop: NpcStop }
    | { kind: 'grabGround'; item: string; anchor: Tile }
    | { kind: 'pickLoc'; loc: string; op: string; item: string; anchor: Tile }
    | { kind: 'interactLoc'; loc: string; op: string; anchor: Tile; expectItem?: string }
    | { kind: 'useOn'; item: string; targetKind: 'npc' | 'loc' | 'item'; target: string; anchor: Tile; product?: string }
    | { kind: 'equip'; item: string }
    | { kind: 'withdraw'; items: { name: string; qty: number }[]; bank?: Tile }
    | { kind: 'deposit'; keep: string[]; bank?: Tile }
    | { kind: 'mineRock'; rock: string; item: string; qty: number; anchor: Tile }
    | { kind: 'buy'; item: string; qty: number; shop: { npc: string; anchor: Tile }; estGp: number }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export interface QuestModule {
    record: QuestRecord;
    hops?: LadderHop[];
    bank?: Tile;
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    tools?: string[];
    decide(snap: QuestSnapshot): QuestStep;
}
