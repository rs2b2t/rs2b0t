import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Facts: romeo.rs2 / juliet.rs2 / father_lawrence.rs2 / apothecary.rs2. NPC
// anchors are map-derived (varrock.npc + m*.jm2 spawns): Romeo (3211,3425,0),
// Juliet (3158,3425, LEVEL 1 — her house's (3155,3435) 0<->1 staircase is
// already in stairEdges.json), Father Lawrence (3254,3475,0), Apothecary
// (3195,3404,0). Cadava berries are a free GROUND PICK: obj 753 map-spawns at
// SE Varrock (see BERRY_ANCHOR) — no combat, no skill gate. Imps also drop them
// (imp.rs2:67, ~3%/kill) but that grind is far slower and needs 40 att/str.
const ROMEO: NpcStop = { npc: 'Romeo', anchor: new Tile(3211, 3425, 0), leash: 8, prefer: ['Can I help find her for you?', 'Yes, I will tell her.', 'He sent me to the Apothecary.'] };
const JULIET: NpcStop = { npc: 'Juliet', anchor: new Tile(3158, 3425, 1), leash: 6, prefer: ['I guess I could find him.', 'Certainly, I will do so straight away!'] };
const LAWRENCE: NpcStop = { npc: 'Father Lawrence', anchor: new Tile(3254, 3475, 0), leash: 6, prefer: [] };
const APOTHECARY: NpcStop = { npc: 'Apothecary', anchor: new Tile(3195, 3404, 0), leash: 6, prefer: [] };

// SE-Varrock cadava ground-spawns: obj 753 (Cadava berries), count-1 map spawns
// at (3266,3361) / (3273,3375) / (3277,3370) — the m51_52.jm2 OBJ section, the
// classic cadava-bush corner south-east of Varrock. Each respawns on the engine
// default (~60s), and the quest needs only ONE berry (apothecary.rs2:65 deletes
// 1), so a single pick finishes the gather. Anchor at the cluster centroid so a
// within(12) sweep sees all three spawns from one stand.
const BERRY_ANCHOR = new Tile(3272, 3369, 0);

// Stage flow with berries pre-provisioned: 10->Juliet, 30->Lawrence,
// 40/50->Apothecary, 60->Romeo. None are inventory-visible, so rotate; any
// progress (Message appears, berries consumed, journal completes) resets
// noProgress and the held-item branches take over.
const PROBES: NpcStop[] = [JULIET, LAWRENCE, APOTHECARY, ROMEO];

/** Pick a Cadava berry off the SE-Varrock ground-spawns — no combat, no skill
 *  gate (unlike the imp drop, which needs 40 att/str and still averages ~3%/kill).
 *  Only one berry is required. Banking a Cadava berries also works (bank-first
 *  skips this gather entirely). */
async function pickBerries(log: (m: string) => void): Promise<boolean> {
    const berry = GroundItems.query().name('Cadava berries').within(12).nearest();
    if (berry) {
        if (!(await berry.interact('Take'))) { return false; }
        return Execution.delayUntil(() => Inventory.contains('Cadava berries'), 8000);
    }
    // Not at the cluster yet, or all three spawns are mid-respawn: park at the
    // anchor (a no-op once we're there) and wait out a respawn cycle (~60s) before
    // re-entering. One spawn coming back is enough — we only need a single berry.
    await Traversal.walkResilient(BERRY_ANCHOR, { radius: 3, attempts: 2, timeoutMs: 120_000, log });
    await Execution.delayUntil(
        () => GroundItems.query().name('Cadava berries').within(12).nearest() !== null,
        70_000
    );
    return false; // not done until the berries branch above succeeds
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: ROMEO }; }
    if (snap.inv.has('cadava potion')) { return { kind: 'talk', stop: JULIET }; }
    if (snap.inv.has('message')) { return { kind: 'talk', stop: ROMEO }; }
    // Mid-quest stages carry no inventory signal, so rotate the probe by the
    // engine watchdog count; any real progress resets it and lands us above.
    return { kind: 'talk', stop: PROBES[snap.noProgress % PROBES.length] };
}

export const romeojuliet: QuestModule = {
    record: QUESTS.find(r => r.id === 'romeojuliet')!,
    // 'cadava' keeps both the berries (record item) and the potion; 'message'
    // is Juliet's letter
    tools: ['cadava', 'message'],
    gather: {
        'cadava berries': () => ({ kind: 'custom', name: 'pick cadava berries', run: pickBerries })
    },
    decide
};
