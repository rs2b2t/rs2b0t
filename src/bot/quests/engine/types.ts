// AIO quest engine — shared types. Type-only imports so the pure evaluators
// that consume these snapshots stay free of any client/DOM dependency (their
// tests run under bun:test with no game client). Live reads happen only in
// QuestEngine.ts, which converts game state into the plain snapshots here —
// the same "pure snapshots, no client at runtime" discipline as quests/types.ts.

import type Tile from '../../api/Tile.js';
import type { QuestStatus } from '#/bot/api/hud/Quests.js'; // type-only import, no client at runtime
import type { QuestRecord } from '../types.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';

/** Plain-data view of the world for ONE quest's decide(). Engine-assembled. */
export interface QuestSnapshot {
    journal: QuestStatus;              // this quest's journal colour
    inv: Map<string, number>;          // LOWERCASED display name -> inventory count
    worn: Set<string>;                 // LOWERCASED equipped item names
    /** Current no-progress count from the engine watchdog (0 = last step
     *  moved the world). Lets a PURE decide() rotate empty-handed probes
     *  (probeOrder[noProgress % probeOrder.length]) without module state —
     *  quest varps are never transmitted, so mid-quest stages with no
     *  inventory signal (Romeo & Juliet 30/40/60) are only reachable this way. */
    noProgress: number;
}

export type QuestStep =
    | { kind: 'talk'; stop: NpcStop }
    | { kind: 'grabGround'; item: string; anchor: Tile }
    | { kind: 'pickLoc'; loc: string; op: string; item: string; anchor: Tile }
    | { kind: 'interactLoc'; loc: string; op: string; anchor: Tile; expectItem?: string }
    | { kind: 'useOn'; item: string; targetKind: 'npc' | 'loc'; target: string; anchor: Tile; product?: string }
    | { kind: 'equip'; item: string }
    | { kind: 'withdraw'; items: { name: string; qty: number }[] }
    | { kind: 'mineRock'; rock: string; item: string; qty: number; anchor: Tile }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export interface QuestModule {
    record: QuestRecord;               // the existing quests/data record (one source of truth)
    hops?: LadderHop[];                // scripted level crossings the nav graph lacks
    /** NPC names this quest legitimately fights, surfaced through
     *  AIOQuester.grindTargets() so the random-event guard never mistakes the
     *  quarry for a hostile event (the ArdyFighter mechanism). */
    grind?: string[];
    /** Per acquirable item (LOWERCASED name): next step toward obtaining it.
     *  Called by provisioning when the bank lacks the item; `need` is how many
     *  more are required. decide-shaped so multi-leg gathers (windmill flour)
     *  re-plan from the snapshot each loop. */
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    /** PURE quest brain: (journal, inv, worn) -> next step. */
    decide(snap: QuestSnapshot): QuestStep;
}
