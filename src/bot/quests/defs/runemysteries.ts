import Tile from '../../api/Tile.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Tiles/dialogue verbatim from scripts/RuneMysteries.ts (probe-verified;
// dialogue from the quest .rs2 sources — see that file's header).
const DUKE: NpcStop = { npc: 'Duke Horacio', anchor: new Tile(3212, 3220, 1), leash: 6, prefer: ['Have you any quests for me?', 'Sure, no problem.'] };
const SEDRIDOR: NpcStop = { npc: 'Sedridor', anchor: new Tile(3103, 9572, 0), leash: 8, prefer: ["I'm looking for the head wizard.", 'Ok, here you are.', 'Yes, certainly.'], approach: [new Tile(3108, 9572, 0)] };
const AUBURY: NpcStop = { npc: 'Aubury', anchor: new Tile(3253, 3402, 0), leash: 8, prefer: ['I have been sent here with a package for you.'] };

export const WIZARD_HOPS: LadderHop[] = [
    { stand: new Tile(3105, 3162, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(3104, 9576, 0) },
    { stand: new Tile(3104, 9576, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3105, 3162, 0) }
];

const TALK = (stop: NpcStop): QuestStep => ({ kind: 'talk', stop });

// Empty-handed mid-quest probes, same fixed order as the old recoverOrder
// (RuneMysteries.ts:134-136): Aubury first is also the quest's REQUIRED second
// talk after handing him the package; each NPC's dialogue re-gives its own
// lost item.
const RECOVER_PROBES: NpcStop[] = [AUBURY, SEDRIDOR, DUKE];

/** Port of nextStep(journal, held) — held-item logic inlined over snap.inv
 *  (exact CI full-name equality, most-advanced wins; RuneMysteries.ts:26-38).
 *  The old bot's rotating recoverIdx becomes snap.noProgress % probes: the
 *  engine watchdog count IS the rotation, so decide stays pure. */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return TALK(DUKE);
    }
    if (snap.inv.has('notes') || snap.inv.has('air talisman')) {
        return TALK(SEDRIDOR);
    }
    if (snap.inv.has('research package')) {
        return TALK(AUBURY);
    }
    return TALK(RECOVER_PROBES[snap.noProgress % RECOVER_PROBES.length]);
}

export const runemysteries: QuestModule = {
    record: F2P.find(r => r.id === 'runemysteries')!,
    // quest-internal deliverables a restart may hold ('notes' is generic but a
    // conservative keep is harmless)
    tools: ['air talisman', 'research package', 'notes'],
    hops: WIZARD_HOPS,
    decide
};
