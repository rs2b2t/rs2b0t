import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Reach } from '../../api/Reach.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Black Knight's Fortress — content facts from quest_blackknight.rs2 /
// sir_amik_varze.rs2 / all.loc. State is the server varp %spy (0 start -> 1
// investigate -> 2 sabotage -> 3 report -> 4 complete), which is NEVER
// transmitted to the client, so decide() reads OBSERVABLES only: journal colour,
// the worn disguise, and whether the plain Cabbage is still held (the sabotage
// inv_dels it — its only consumer). Listening must precede the sabotage and both
// ops are safe no-ops off-stage, so ONE re-entrant infiltrate leg sequences them.

const SIR_AMIK: NpcStop = { npc: 'Sir Amik Varze', anchor: new Tile(2962, 3338, 2), leash: 6, prefer: ['I seek a quest!', 'I laugh in the face of danger!'] };
const IRON_CHAINBODY = 'Iron chainbody';
const BRONZE_MED_HELM = 'Bronze med helm';

// Fortress-interior nav: the grill pocket and the hole room are each sealed off,
// reachable only through a secret push-wall (bksecretdoor, op 'Push') — and those
// two Push-walls were MISSING from the baked door graph (the door-baker only
// emits Open/Close leaves, never Push-type walls), which left the whole interior
// unpathable. They are now curated into transports.json (as 'Wall'/'Push' door
// edges), so the PATHFINDER routes entrance -> grill -> hole under budget and the
// live walker crosses the entrance Sturdy door + both push-walls + the ladders.
// Tiles below are ground truth from probe-locs (verified: Listen-at fires from
// the Grill tile, the pocket ladder round-trips, each door crosses in isolation).
//
// KNOWN LIMITATION (blocks completion): the live walker's crossMultiTileDoor
// crosses each fortress door only from its DIRECT approach; the door-dense tight
// rooms leave it wedged ("stuck, 0 clicks") on the oblique approaches the chained
// walk produces (esp. the (3019,3515) double-door off the (3015,3518) ladder).
// Staging waypoints in the def does NOT help — the intermediate tiles are not
// cleanly reachable either. Completing the fortress needs walker hardening
// (robust door-crossing from any approach + tight-interior nav), not a def change.
const GRILL = new Tile(3025, 3507, 0); // witchgrill wall-decor; Listen-at from here
const HOLE = new Tile(3031, 3507, 1);  // blackknighthole; use the Cabbage on it (oplocu)
// A PLAIN cabbage field — south of Falador's south wall. NOT the Draynor MANOR
// patch (which grows magic_cabbage, the wrong item the potion rejects).
// LIVE-VERIFY the exact field tile + that the picked obj is 'Cabbage'.
const CABBAGE_FIELD = new Tile(3053, 3306, 0);

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
const nearTile = (t: Tile, r: number): boolean => {
    const me = Game.tile();
    return me !== null && me.level === t.level && Math.max(Math.abs(me.x - t.x), Math.abs(me.z - t.z)) <= r;
};

// %spy is never sent to the client, and re-Listening after the eavesdrop is a
// silent no-op, so a run must Listen (advancing %spy 1->2) BEFORE the sabotage
// (the hole's cabbage script gates on %spy=2). This in-process latch orders the
// two; decide() clears it when the quest is fresh so a reused process is correct.
let listened = false;

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { listened = false; return { kind: 'talk', stop: SIR_AMIK }; }

    // inProgress. The entrance guard needs BOTH disguise pieces worn — equip the
    // missing one (provisioning withdrew them to the pack). One per pass.
    if (!worn(snap, IRON_CHAINBODY) && has(snap, IRON_CHAINBODY)) { return { kind: 'equip', item: IRON_CHAINBODY }; }
    if (!worn(snap, BRONZE_MED_HELM) && has(snap, BRONZE_MED_HELM)) { return { kind: 'equip', item: BRONZE_MED_HELM }; }

    // Cabbage still held -> still infiltrating (grill Listen, then sabotage).
    // Cabbage gone -> the sabotage consumed it (provisioning guaranteed it was
    // held before the fortress phase), so the deed is done: report to Sir Amik
    // (his %spy=3 branch completes the quest).
    if (has(snap, 'Cabbage')) { return { kind: 'custom', name: 'infiltrate', run: infiltrate }; }
    return { kind: 'talk', stop: SIR_AMIK };
}

/** Fortress infiltration (re-entrant). walkResilient routes the whole interior
 *  (entrance -> grill -> hole) via the curated push-walls + baked Sturdy
 *  doors/ladders, so this only sequences the two quest ops: Listen at the Grill
 *  (advances %spy 1->2, opening the witch/knight eavesdrop dialogue), then use
 *  the Cabbage on the Hole (advances 2->3, consuming it). The `listened` latch
 *  guarantees the Listen precedes the sabotage. False until the Cabbage is gone
 *  (decide() then reports to Sir Amik). */
async function infiltrate(log: (m: string) => void): Promise<boolean> {
    if (!Inventory.contains('Cabbage')) { return true; } // sabotaged — decide routes to Sir Amik

    if (!listened) {
        // Reach the Grill and Listen. Reach walks the fortress to the grill tile
        // (Sturdy doors + the L0 secret Wall + the pocket ladder) and lets the
        // server op-walk the final tiles; 'done' once we stand at the grill,
        // whether or not the (once-only) eavesdrop dialogue opens.
        const grill = await Reach.locOp({
            name: 'Grill', op: 'Listen-at', near: GRILL,
            expect: () => ChatDialog.isOpen() || ChatDialog.canContinue() || nearTile(GRILL, 1),
            log
        });
        if (grill === 'unreachable') { log('bkf: Grill unreachable — re-planning'); return false; }
        if (grill !== 'done') { return false; } // still en route — re-enter
        // Drive the eavesdrop dialogue if this was the %spy=1 Listen (silent after).
        await Execution.delayUntil(() => ChatDialog.isOpen(), 2500);
        for (let i = 0; i < 40 && ChatDialog.isOpen(); i++) {
            if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
            await Execution.delayTicks(1);
        }
        listened = true;
        return false; // re-enter for the sabotage
    }

    // Sabotage: walkResilient routes the grill pocket -> L1 -> the L1 secret Wall
    // -> the Hole; then use the Cabbage on it (the %spy=2 branch consumes it).
    await Traversal.walkResilient(HOLE, { radius: 1, attempts: 6, timeoutMs: 120_000, log });
    const hole = Locs.query().name('Hole').within(8).nearest();
    const cabbage = Inventory.first('Cabbage');
    if (hole && cabbage) {
        const before = Inventory.count('Cabbage');
        await cabbage.useOn(hole);
        await Execution.delayUntil(() => Inventory.count('Cabbage') < before, 6000);
    }
    return false;
}

/** Pick one PLAIN Cabbage from an ordinary field (re-entrant; true once held).
 *  The pickable plant is a loc named 'Cabbage' with a 'Pick' op (all.loc
 *  [cabbage]); walk to the field if none is in range. */
async function pickCabbage(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Cabbage')) { return true; }
    const plant = Locs.query().name('Cabbage').action('Pick').within(10).nearest();
    if (!plant) {
        await Traversal.walkResilient(CABBAGE_FIELD, { radius: 4, attempts: 4, timeoutMs: 120_000, log });
        return false;
    }
    const before = Inventory.count('Cabbage');
    if (!(await plant.interact('Pick'))) { return false; }
    await Execution.delayUntil(() => Inventory.count('Cabbage') > before, 6000);
    return false;
}

export const blackknight: QuestModule = {
    record: QUESTS.find(r => r.id === 'blackknight')!,
    bank: new Tile(2946, 3369, 0), // Falador West — nearest the White Knights' Castle
    food: 4, // carried for the black-knight run; eaten by the AIOQuester hook, never to fight
    // The fortress Black Knights aggro as we pass — whitelist them so the random-
    // event guard never flags them.
    grind: ['black knight', 'aggressive black knight'],
    // Plain Cabbage from an ordinary field; NEVER the Draynor Manor magic patch.
    gather: {
        'cabbage': () => ({ kind: 'custom', name: 'pick cabbage', run: pickCabbage })
    },
    decide
};
