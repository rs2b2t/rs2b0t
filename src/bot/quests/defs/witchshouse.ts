import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import { DirectNavigator } from '../../nav/DirectNavigator.js';
import Tile from '../../api/Tile.js';
import { isUnderground, type NpcStop } from '../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Witch's House (record id 'ball') — content facts traced from
// ~/code/rs2b2t-content/scripts/quests/quest_ball/ (cited inline as file:line).
// Coordinates are map-derived: the witch house is mapsquare 45_54 (surface
// abs = 2880+localX, 3456+localZ) and its CELLAR is the underground region
// 45_154 (abs = 2880+localX, 9856+localZ). Every loc name/op below was read
// from all.loc / the quest .obj / .npc configs; every abs coord from the
// m45_54 / m45_154 .jm2 LOC|NPC|OBJ sections and the baked stairEdges/doors.
//
// FLOW (verified against quest_ball.rs2 + ball_journal.rs2):
//   0. Talk the Boy (N of Taverley) -> quest starts (boy.rs2:12, %ballquest=1).
//   1. Look-under the Potted plant outside -> Door key (quest_ball.rs2:1-8).
//   2. Enter the house (front Door opens while the key is held, :10-14), climb
//      the cellar Ladder DOWN, cross the iron Gate (needs LEATHER GLOVES worn,
//      else a shock and the gate won't open — :33-38), Search the Cupboard ->
//      Magnet (:65-75, sets stage 2).
//   3. Back on the surface: use Cheese on the Mouse hole to lure the Mouse
//      (:80-93), use the Magnet on the Mouse -> unlocks the back Door (:102-116,
//      stage 3, magnet consumed). Go into the garden, Check the Fountain ->
//      shed Key (:162-169; NO stage gate — only reachable once the back door is
//      open).
//   4. Use the shed Key on the shed Door -> opens it AND spawns the Witches
//      experiment (:134-160). Fight the 4 escalating forms (lvl 19/30/42/53,
//      witches_house.npc; each auto-spawns the next on death,
//      witches_experiement.rs2), then Take the Ball off the shed floor
//      (:171-196, opobj3 = the ground "Take"; pre-defeat it re-spawns the
//      monster, post-defeat it hands over the ball).
//   5. Return the Ball to the Boy -> complete (boy.rs2:28-33 -> ball_quest_
//      complete, :198-204).
//
// decide() is PURE and dispatches on HELD ITEMS only (journal gives just the
// colour, quest varps never reach the snapshot). The scripted-ride / combat /
// level-crossing legs live in custom thunks that read the LIVE world and return
// false on any missing precondition so decide() re-routes (re-entrant), the
// Waterfall idiom.
//
// ── FLAGGED UNCERTAINTIES (no live smoke was run — verify these first) ──
//  * BASEMENT GEOMETRY. The cellar Ladder (ladder_cellar id 1754 @ 2907,3476,0
//    -> ladders.rs2:83 climb_ladder(+6400z) -> 2907,9876,0) and the iron Gate
//    (shockgatel/r 2865/6 @ 2902,9873-9874,0) are NOT in the baked nav graph
//    (no stairEdge/transport spans region 45_154), so both ladders AND both
//    gate crossings are driven explicitly here off live position. The exact
//    stand tiles and the gate-teleport landing are best-effort guesses — the
//    gate does a p_teleport across (quest_ball.rs2:55), not a normal swing, so
//    walking "through" it won't work; it must be Open'd from the correct side.
//  * LEATHER GLOVES are MANDATORY (the iron gate) but are NOT on the 'ball'
//    record, so the engine won't provision them. decide() withdraws+equips them
//    from the bank; the account MUST bank a pair (see the report's recommended
//    record change — add {name:'Leather gloves', qty:1, kind:'acquirable'}).
//  * THE WITCH (Nora T. Hagg, witch.rs2) patrols the garden (2904-2930,3463)
//    and, on line-of-sight, curses you: teleports you out, DELETES the shed Key
//    AND the Ball, and re-locks the mouse door (resets stage 3 -> 1). The def
//    self-heals (Door-key-only routes back through the cellar for a fresh
//    magnet) but each catch is a big setback; there is no timing/stealth model
//    here. This is the single biggest live-reliability risk.
//  * COMBAT. The experiment tops out at level 53 (~144 HP across forms); this
//    needs a combat-capable account + food. The fight is modelled as a
//    re-entrant attack loop; the AIOQuester EatFood task/sustain hook eats the
//    carried food between passes. Combat-stat sizing is unverified.

// --- Item display names (quest_ball.obj). NOTE: the shed key's display is the
//     bare "Key" (obj witches_shedkey) and the door key's is "Door key" — kept
//     as distinct inventory entries, so has('key') never matches 'door key'. ---
const DOOR_KEY = 'Door key';
const MAGNET = 'Magnet';
const SHED_KEY = 'Key';
const BALL = 'Ball';
const CHEESE = 'Cheese';
const GLOVES = 'Leather gloves';

// The four experiment forms (witches_house.npc:36-155). Distinct display names,
// all op2=Attack, all category witches_experiment; each ai_queue3 spawns the
// next on death (witches_experiement.rs2). Surfaced through `grind` so the
// random-event guard never mistakes the quarry for a hostile event.
const EXPERIMENT_FORMS = [
    'Witches experiment',
    'Witches experiment second form',
    'Witches experiment third form',
    'Witches experiment fourth form'
];

// --- NPC stops (map-derived anchors) ---
// The Boy (taverly.npc [ballboy] "Boy", op1 Talk-to) spawns at m45_54 NPC
// (48,0) -> (2928,3456,0). prefer = the start + hand-back menu options
// (boy.rs2:6,10). The hand-back at 'default' stage is auto (no option), so only
// the start choices are listed.
// Start is a TWO-menu chain (boy.rs2:6,10): "What's the matter?" opens his plea,
// then "Ok, I'll see what I can do." sets ball_started. Both must be in prefer or the
// first menu falls to the "...I'll go." fallback and the quest never starts. The
// mid-quest "Not yet" reply and the ball hand-back are auto (no options).
const BOY: NpcStop = { npc: 'Boy', anchor: new Tile(2928, 3456, 0), leash: 6, prefer: ["What's the matter?", "Ok, I'll see what I can do."] };

// --- Surface stands/locs (m45_54 LOC section; op names from all.loc) ---
const POT_STAND = new Tile(2900, 3474, 0);        // witchpot "Potted plant" op1 Look-under -> Door key (:1-8)
// Cellar Ladder loc @ (2907,3476). Its adjacent tiles are canReach-BLOCKED from the
// front-door approach, so the client walker "0-clicks" wedges at (2908,3478) AND the
// loc query excludes the (unreachable) ladder so an OPLOC can't even fire (live
// 2026-07-19). LADDER_DOWN_STAND is the reachable approach we walk to first; then
// DirectNavigator (NOT canReach-gated) steps the last tiles onto LADDER_TILE, after
// which the ladder is reachable and Climb-down works.
const LADDER_DOWN_STAND = new Tile(2908, 3478, 0);
const LADDER_TILE = new Tile(2907, 3476, 0);
const MOUSEHOLE_STAND = new Tile(2903, 3467, 0);  // witchmousehole "Mouse hole" @ (2903,3466); useOn Cheese to lure the Mouse
const FOUNTAIN_STAND = new Tile(2909, 3471, 0);   // witchfountain "Fountain" @ (2909,3470); op2 Check -> shed Key (:162-169)
const SHED_STAND = new Tile(2933, 3463, 0);       // W of witchsheddoor "Door" @ (2934,3463); useOn Key -> opens + spawns experiment (:134-160)

// --- Cellar stands/locs (m45_154; abs z = 9856 + localZ) ---
// The Ladder lands at (2907,9876,0) EAST of the iron Gate (2902,9873); the
// Cupboard (2898,9873) is WEST of it. So both a WEST crossing (to the cupboard)
// and an EAST crossing (back to the up-ladder) are needed, gloves worn for both.
const CELLAR_UP_STAND = new Tile(2907, 9876, 0);  // ladder_from_cellar "Ladder" op1 Climb-up -> surface (2907,3476,0)
const GATE_EAST_STAND = new Tile(2904, 9873, 0);  // E of the Gate; Open it here to teleport WEST (x<=2901)
const GATE_WEST_STAND = new Tile(2900, 9873, 0);  // W of the Gate; Open it here to teleport EAST (x>=2903)
const CUPBOARD_STAND = new Tile(2898, 9873, 0);   // magnetcbshut/open "Cupboard" op1 Open / op1 Search -> Magnet
const GATE_X = 2902;                               // the gate leaves sit on x=2902 (2865/6 @ 9873/9874)

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const wornGloves = (snap: QuestSnapshot): boolean => snap.worn.has(GLOVES.toLowerCase());

/** Any experiment form currently near the shed (within ~14t of us). */
function nearestExperiment() {
    return Npcs.query().name(...EXPERIMENT_FORMS).within(14).nearest();
}

// --- Custom legs (all live reads; each returns false to re-enter) --------------

/**
 * Row: hold the Door key, still need the Magnet (also the redundant path a
 * mid-quest restart at stage 3 takes — it fetches a fresh magnet, harmless: the
 * cupboard re-gives one whenever obj_gettotal(magnet)=0, and gardenLeg's attach
 * then reports "already unlocked" and carries on to the shed key). Leather
 * gloves are guaranteed WORN by decide() before we route here (the iron gate).
 *
 * Staged by live position so a re-entry advances instead of re-doing a leg:
 *   surface                 -> walk to the cellar Ladder, Climb-down
 *   cellar, E of the Gate   -> Open the Gate (teleport WEST)
 *   cellar, W of the Gate   -> Open + Search the Cupboard -> Magnet
 * The ASCENT is gardenLeg's job (decide routes to it the instant the magnet
 * appears, while we are still underground).
 */
async function magnetLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    if (!isUnderground(t)) {
        // Descend the cellar Ladder (see LADDER_TILE note). Its approach is canReach-
        // BLOCKED from inside, so the loc query even EXCLUDES the ladder until we're
        // adjacent. Stage by live position:
        //   (1) ladder reachable now (query finds it)  -> Climb-down;
        //   (2) not yet at the approach                -> walk there (crosses the
        //       front Door, which auto-opens while the Door key is held, :10-14);
        //   (3) at the approach                        -> DirectNavigator (NOT
        //       canReach-gated) steps onto the ladder tile; next pass sees it reachable.
        const here = Tile.from(t);
        // (2) Not yet at the reachable approach -> walk there.
        if (here.distanceTo(LADDER_DOWN_STAND) > 1 && here.distanceTo(LADDER_TILE) > 1) {
            await Traversal.walkResilient(LADDER_DOWN_STAND, { radius: 1, attempts: 3, timeoutMs: 90_000, log });
            return false;
        }
        // (1) ON the ladder tile -> Climb-down (a diagonal-adjacent OPLOC silently
        //     no-ops on the canReach block, so we must actually stand on it first).
        if (here.distanceTo(LADDER_TILE) === 0) {
            const ladder = Locs.query().name('Ladder').action('Climb-down').within(2).nearest();
            if (ladder) {
                await ladder.interact('Climb-down');
                return Execution.delayUntil(() => { const g = Game.tile(); return g !== null && isUnderground(g); }, 10_000);
            }
        }
        // (3) Not yet on the ladder -> DirectNavigator (NOT canReach-gated) steps
        //     across the blocked gap toward it, one tile per pass, until we're on it.
        log(`magnetLeg: DirectNav ${here.x},${here.z} -> ladder ${LADDER_TILE.x},${LADDER_TILE.z} (canReach gap)`);
        await DirectNavigator.walkTo(LADDER_TILE, 0, 8000);
        return false;
    }
    // Underground. Cross the iron Gate WEST to the cupboard if we are still on
    // its east side (the Ladder lands there).
    if (t.x >= GATE_X) {
        if (!(await Traversal.walkResilient(GATE_EAST_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
        if (!gate) {
            log('magnetLeg: no Gate to Open (LIVE-VERIFY the iron gate @ 2902,9873)');
            return false;
        }
        await gate.interact('Open'); // oploc1 _ball_irongate: gloves worn -> p_teleport across (:33-58)
        await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x <= GATE_X - 1; }, 6000);
        return false;
    }
    // West of the Gate -> the Cupboard hands the Magnet (Open then Search).
    if (!(await Traversal.walkResilient(CUPBOARD_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const shut = Locs.query().name('Cupboard').action('Open').within(6).nearest();
    if (shut) {
        await shut.interact('Open'); // magnetcbshut -> magnetcbopen (:61-63)
        await Execution.delayTicks(2);
        return false;
    }
    const open = Locs.query().name('Cupboard').action('Search').within(6).nearest();
    if (!open) {
        log('magnetLeg: no open Cupboard to Search near 2898,9873');
        return false;
    }
    if (!(await open.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(MAGNET), 8000);
}

/**
 * Row: hold the Magnet -> unlock the mouse door, then get the shed Key. Handles
 * the ascent out of the cellar first (decide routes here the moment the magnet
 * appears, while we are still underground). Drives attach -> fountain
 * contiguously so a fresh run never returns to decide() in the bare
 * "Door key only" state (which would re-descend for another magnet).
 */
async function gardenLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    // ASCENT: still underground with the magnet -> cross the Gate EAST if needed,
    // then Climb-up the cellar Ladder. Gloves are still worn from magnetLeg.
    if (isUnderground(t)) {
        if (t.x <= GATE_X - 1) {
            if (!(await Traversal.walkResilient(GATE_WEST_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
                return false;
            }
            const gate = Locs.query().name('Gate').action('Open').within(4).nearest();
            if (gate) {
                await gate.interact('Open');
                await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x >= GATE_X + 1; }, 6000);
            }
            return false;
        }
        // Same pattern as the descent: OPLOC the up-ladder when in range, else walk in.
        const ladder = Locs.query().name('Ladder').action('Climb-up').within(6).nearest();
        if (ladder) {
            await ladder.interact('Climb-up');
            await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && !isUnderground(g); }, 10_000);
            return false;
        }
        await Traversal.walkResilient(CELLAR_UP_STAND, { radius: 3, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    // Surface. Lure the Mouse (Cheese on the Mouse hole) and attach the Magnet.
    if (Inventory.contains(MAGNET)) {
        if (!(await Traversal.walkResilient(MOUSEHOLE_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        let mouse = Npcs.query().name('Mouse').within(8).nearest();
        if (!mouse) {
            const cheese = Inventory.first(CHEESE);
            const hole = Locs.query().name('Mouse hole').within(8).nearest();
            if (cheese && hole) {
                await cheese.useOn(hole); // oplocu witchmousehole -> spawns the Mouse (:89-93)
                await Execution.delayUntil(() => Npcs.query().name('Mouse').within(8).nearest() !== null, 6000);
            } else {
                log('gardenLeg: no Cheese or Mouse hole to lure the mouse');
                return false;
            }
            mouse = Npcs.query().name('Mouse').within(8).nearest();
        }
        if (mouse) {
            const magnet = Inventory.first(MAGNET);
            if (magnet) {
                await magnet.useOn(mouse); // opnpcu: stage 2 -> attach (magnet consumed, door unlocks);
                // stage 3 -> "already unlocked" (magnet KEPT). Either way the door is
                // now open, so we fall THROUGH to the fountain rather than re-decide
                // on a retained magnet (which would loop at a stage-3 restart, :102-116).
                await Execution.delayTicks(3);
            }
        }
        // fall through to the fountain in this same invocation
    }
    // Back door is open now -> Check the Fountain for the shed Key.
    if (!(await Traversal.walkResilient(FOUNTAIN_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const fountain = Locs.query().name('Fountain').action('Check').within(6).nearest();
    if (!fountain) {
        log('gardenLeg: no Fountain to Check (back door may still be locked — LIVE-VERIFY the mouse/magnet unlock)');
        return false;
    }
    if (!(await fountain.interact('Check'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(SHED_KEY), 8000);
}

/**
 * Row: hold the shed Key -> open the shed (spawns the experiment), fight the
 * four forms, then Take the Ball. Re-entrant: one unit of work per pass so the
 * EatFood task interleaves between attacks.
 */
async function shedLeg(log: (m: string) => void): Promise<boolean> {
    // 1. A form is up -> fight it. Re-Attack whenever we drop out of combat (the
    //    next form spawns via ai_queue3 and opplayer2's us; witches_experiement.rs2).
    const exp = nearestExperiment();
    if (exp) {
        if (!Game.inCombat()) {
            await exp.interact('Attack');
            await Execution.delayUntil(() => Game.inCombat() || !exp.valid(), 4000);
        } else {
            await Execution.delayTicks(2); // let the EatFood task eat between passes
        }
        return false;
    }
    // 2. No form up. If the Ball is exposed, Take it: opobj3 hands it over once
    //    the experiment is defeated, or RE-spawns the monster before then (we
    //    re-enter to fight). quest_ball.rs2:171-196.
    const ball = GroundItems.query().name(BALL).within(14).nearest();
    if (ball) {
        await ball.interact('Take');
        await Execution.delayUntil(
            () => Inventory.contains(BALL) || nearestExperiment() !== null,
            6000
        );
        return false;
    }
    // 3. Shed still shut (no form, no visible ball) -> open it with the Key,
    //    which spawns the first form (witchsheddoor oplocu, :134-160).
    if (!(await Traversal.walkResilient(SHED_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const door = Locs.query().name('Door').action('Open').within(4).nearest(); // the shed door (nearest to the shed stand)
    const key = Inventory.first(SHED_KEY);
    if (door && key) {
        await key.useOn(door);
        await Execution.delayUntil(() => nearestExperiment() !== null, 6000);
    } else {
        log('shedLeg: no shed Door or shed Key to open the shed');
    }
    return false;
}

// --- Pure quest brain (dispatches on HELD ITEMS only) -------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: BOY }; }

    // Row 5: hold the Ball -> hand it back to the Boy (completes the quest).
    if (has(snap, BALL)) { return { kind: 'talk', stop: BOY }; }

    // Row 4: hold the shed Key -> open the shed, fight the experiment, take the ball.
    if (has(snap, SHED_KEY)) { return { kind: 'custom', name: 'shed + experiment fight', run: shedLeg }; }

    // Row 3: hold the Magnet -> unlock the mouse door, then get the shed key.
    if (has(snap, MAGNET)) { return { kind: 'custom', name: 'mouse/magnet + shed key', run: gardenLeg }; }

    // Row 2: hold the Door key, no magnet yet -> the cellar magnet run. It needs
    //   LEATHER GLOVES worn for the iron gate (quest_ball.rs2:33-38), so equip
    //   them first — withdrawing from the bank if the pack lacks them. (Gloves
    //   are not a 'ball' record item, so the engine does not provision them; the
    //   account must bank a pair — see the recommended record change.)
    if (has(snap, DOOR_KEY)) {
        if (!wornGloves(snap)) {
            if (!has(snap, GLOVES)) { return { kind: 'withdraw', items: [{ name: GLOVES, qty: 1 }] }; }
            return { kind: 'equip', item: GLOVES };
        }
        return { kind: 'custom', name: 'cellar magnet', run: magnetLeg };
    }

    // Row 1: started, empty-handed -> Look under the Potted plant for the Door key.
    return { kind: 'interactLoc', loc: 'Potted plant', op: 'Look-under', anchor: POT_STAND, expectItem: DOOR_KEY };
}

export const witchshouse: QuestModule = {
    record: QUESTS.find(r => r.id === 'ball')!,
    // Carry food for the experiment fight (lvl 19->30->42->53); the AIOQuester
    // sustain hook / EatFood task eats it when HP dips.
    food: 20,
    // The legit combat quarry — surfaced so the random-event guard never treats
    // the experiment forms as a hostile event.
    grind: EXPERIMENT_FORMS,
    // Keep every quest-internal item a mid-quest restart may hold (the between-
    // quest deposit keeps these). 'leather gloves' is load-bearing: without it
    // the deposit could bank the gloves the iron-gate crossing needs.
    tools: ['door key', 'key', 'magnet', 'cheese', 'ball', 'leather gloves'],
    decide
};
