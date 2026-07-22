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

// LIVE-VERIFY: reachable stands beside the Grill (3025,3508,0) and the Hole
// (3031,3508,1), and the fortress Climb-up loc name; pinned from the live run.
const GRILL_STAND = new Tile(3025, 3509, 0);
const HOLE_STAND = new Tile(3031, 3509, 1);
// A PLAIN cabbage field — south of Falador's south wall. NOT the Draynor MANOR
// patch (which grows magic_cabbage, the wrong item the potion rejects).
// LIVE-VERIFY the exact field tile + that the picked obj is 'Cabbage'.
const CABBAGE_FIELD = new Tile(3053, 3306, 0);

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: SIR_AMIK }; }

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

/** Fortress infiltration (re-entrant): reach the Grill and Listen (advances %spy
 *  1->2; a no-op "I can't hear much" once listened), then climb to the Hole and
 *  use the Cabbage on it (advances 2->3, consuming the Cabbage). Both ops are
 *  safe off-stage and listening must precede the sabotage, so this runs them in
 *  sequence without reading %spy. The fixed Reach drives the Sturdy-door /
 *  secret-Wall / aggro nav. False until the Cabbage is gone. */
async function infiltrate(log: (m: string) => void): Promise<boolean> {
    if (!Inventory.contains('Cabbage')) { return true; } // sabotaged — decide routes to Sir Amik

    // 1) Listen at the Grill (level 0): Reach walks to the stand + opens any door
    //    on the server's "can't reach"; then drive the eavesdrop continues.
    const grill = await Reach.locOp({
        name: 'Grill', op: 'Listen-at', near: GRILL_STAND,
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        log
    });
    if (grill === 'done') {
        for (let i = 0; i < 30 && ChatDialog.isOpen(); i++) {
            if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
            await Execution.delayTicks(1);
        }
        return false; // re-enter: next pass does the sabotage
    }
    if (grill === 'unreachable') { log('bkf: Grill unreachable — re-planning'); return false; }

    // 2) Sabotage: climb to the Hole (level 1) and use the Cabbage on it.
    const level = Game.tile()?.level ?? 0;
    if (level !== 1) {
        await Reach.locOp({
            name: 'Ladder', op: 'Climb-up', near: HOLE_STAND,
            expect: () => (Game.tile()?.level ?? 0) >= 1, log
        });
        return false;
    }
    const hole = Locs.query().name('Hole').within(8).nearest();
    const cabbage = Inventory.first('Cabbage');
    if (hole && cabbage) {
        const before = Inventory.count('Cabbage');
        await cabbage.useOn(hole);
        await Execution.delayUntil(() => Inventory.count('Cabbage') < before, 6000);
    } else {
        await Traversal.walkResilient(HOLE_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log });
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
