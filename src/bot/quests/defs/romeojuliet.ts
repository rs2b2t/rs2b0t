import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import type { NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';

// Facts: romeo.rs2 / juliet.rs2 / father_lawrence.rs2 / apothecary.rs2. NPC
// anchors are map-derived (varrock.npc + m*.jm2 spawns): Romeo (3211,3425,0),
// Juliet (3158,3425, LEVEL 1 — her house's (3155,3435) 0<->1 staircase is
// already in stairEdges.json), Father Lawrence (3254,3475,0), Apothecary
// (3195,3404,0). BERRIES ARE AN IMP DROP in this content (imp.rs2:67, ~4/128
// ~= 3%/kill) — there is NO cadava bush, so berries come from a grind, not a pick.
const ROMEO: NpcStop = { npc: 'Romeo', anchor: new Tile(3211, 3425, 0), leash: 8, prefer: ['Can I help find her for you?', 'Yes, I will tell her.', 'He sent me to the Apothecary.'] };
const JULIET: NpcStop = { npc: 'Juliet', anchor: new Tile(3158, 3425, 1), leash: 6, prefer: ['I guess I could find him.', 'Certainly, I will do so straight away!'] };
const LAWRENCE: NpcStop = { npc: 'Father Lawrence', anchor: new Tile(3254, 3475, 0), leash: 6, prefer: [] };
const APOTHECARY: NpcStop = { npc: 'Apothecary', anchor: new Tile(3195, 3404, 0), leash: 6, prefer: [] };

// North-Varrock imp field: the densest imp cluster nearest the quest route
// (3 spawns within 40t — m50_54.jm2 imp id 708 @ 3213,3502 / 3234,3506 /
// 3261,3514), just south of the wilderness ditch (z<3520, non-members/safe).
// Walkable + pathable from Romeo (cost 98) against out/collision.lcnav.gz.
// Roamers from all three spawns feed the within(15) grind sweep in huntImps.
const IMP_ANCHOR = new Tile(3234, 3506, 0);

// Stage flow with berries pre-provisioned: 10->Juliet, 30->Lawrence,
// 40/50->Apothecary, 60->Romeo. None are inventory-visible, so rotate; any
// progress (Message appears, berries consumed, journal completes) resets
// noProgress and the held-item branches take over.
const PROBES: NpcStop[] = [JULIET, LAWRENCE, APOTHECARY, ROMEO];

/** SKILL GATE, not modeled in QuestSnapshot: imps flee-teleport when damaged,
 *  so a bare level-3 account cannot realistically kill one (a live 90-min run
 *  produced zero berries); the acceptance runs prepped attack/strength 40 via
 *  account cheat. Banking a Cadava berries also works (bank-first skips this).
 *
 *  Kill imps near the anchor until Cadava berries drop, then loot. ~3%/kill
 *  (imp.rs2:67): expect a grind; the smoke budget accounts for it. */
async function huntImps(log: (m: string) => void): Promise<boolean> {
    const berry = GroundItems.query().name('Cadava berries').within(12).nearest();
    if (berry) {
        if (!(await berry.interact('Take'))) { return false; }
        return Execution.delayUntil(() => Inventory.contains('Cadava berries'), 8000);
    }
    const imp = Npcs.query().name('Imp').action('Attack').within(15).nearest();
    if (!imp) {
        await Traversal.walkResilient(IMP_ANCHOR, { radius: 3, attempts: 2, timeoutMs: 120_000, log });
        return false;
    }
    if (!(await imp.interact('Attack'))) { return false; }
    // Wait out the fight; imps also teleport away — either way, re-enter next loop.
    await Execution.delayUntil(
        () => GroundItems.query().name('Cadava berries').within(12).nearest() !== null
            || Npcs.query().name('Imp').action('Attack').within(3).nearest() === null,
        30_000
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
    record: F2P.find(r => r.id === 'romeojuliet')!,
    grind: ['Imp'],
    gather: {
        'cadava berries': () => ({ kind: 'custom', name: 'hunt imps for cadava berries', run: huntImps })
    },
    decide
};
