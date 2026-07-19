import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reach } from '../../api/Reach.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, isUnderground, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Demon Slayer — content facts traced from ~/code/rs2b2t-content/scripts (cited
// inline as file:line). Coordinates are map-derived (maps/*.jm2 NPC/LOC sections
// decoded to absolute tiles) and pack ids from pack/{npc,loc,obj}.pack. Verified
// against those sources for every coord/name/op below; LIVE-VERIFY tags flag the
// spots static data couldn't fully pin (chiefly the sewer ascent).
//
// FLOW (demon.constant stages, all INVISIBLE to the snapshot — only journal
// colour + inventory reach decide()):
//   notStarted            -> talk Gypsy Aris (Varrock square), needs 1 coin.
//   talked_aris (1)       -> talk Sir Prysin (palace) to open the KEY HUNT (2).
//   key_hunt (2)          -> collect THREE keys (one of each, all named "Key"):
//                              Captain Rovin (palace NW tower, L2) -> key_2 (2400)
//                              Wizard Traiborn (Wizards' Tower, L1) -> key_1 (2399), needs 25 Bones
//                              the palace kitchen DRAIN -> key_3 (2401): pour a
//                                Bucket of water on it, then fetch it from the sewer.
//   (all 3 keys)          -> talk Sir Prysin -> he assembles Silverlight (stage 29).
//   silverlight (29)      -> equip Silverlight, attack Delrith at the stone circle;
//                              at 0 HP he weakens and the incantation fires — answer
//                              option 4 "Carlem Aber Camerinthum Purchai Gabindo".
//   complete (30)         -> done.
//
// THE THREE KEYS ALL DISPLAY "Key" (demon.obj: silverlight_key_1/2/3 all name=Key),
// so the name-only snapshot can only see a merged "key" count and CANNOT tell which
// key it holds — the same collision as Waterfall's "A key". decide() therefore
// routes the whole key phase to ONE re-entrant custom (keyHunt) that reads the obj
// IDs live (2399/2400/2401, like Prince Ali's blond-wig id read) to know which key
// is still missing. Every custom leg returns false on any missing precondition so
// decide() re-routes (re-entrant), and all live world reads live inside the customs.

// --- Obj ids (pack/obj.pack). The keys are name-collided ("Key"), so they are
//     ONLY distinguishable by these ids — read live inside the customs. ---
const TRAIBORN_KEY_ID = 2399; // silverlight_key_1 — Wizard Traiborn (25 bones)
const ROVIN_KEY_ID = 2400;    // silverlight_key_2 — Captain Rovin
const DRAIN_KEY_ID = 2401;    // silverlight_key_3 — washed down the palace drain

// --- NPC stops (map-derived spawns: maps/*.jm2 NPC section decoded). aris DISPLAYS
//     as "Gypsy" (varrock.npc [aris] name=Gypsy), NOT "Gypsy Aris". ---
// Gypsy Aris — Varrock square tent, m50_53 "0 3 32: 882" -> (3203,3424,0). The start
// needs 1 coin (gypsy.rs2:162-165, deducted at demon_slayer_aris_quest_start). prefer
// MUST include "Ok, here you go." — the not_started menu's last option is "No, I
// don't believe in that stuff." (gypsy.rs2:79), so a fallback there declines and
// never starts. The reward-branch options after it all advance to demon_talked_aris
// (:238); "Okay, thanks..." ends the trailing info loop cleanly (:266).
const GYPSY: NpcStop = { npc: 'Gypsy', anchor: new Tile(3203, 3424, 0), leash: 6, prefer: [
    'Ok, here you go.',                                    // pay the coin -> quest_start (gypsy.rs2:79,159)
    'Very interesting. What does that Aaargh bit mean?',   // the vision menu — any option advances (:171)
    "Who's Delrith?",                                      // :181
    "Okay, where is he? I'll kill him for you!",           // who_is_delrith -> destroy_delrith sets talked_aris (:200,238)
    'Where can I find Silverlight?',                       // more_info -> points at Sir Prysin (:243,270)
    "Okay, thanks. I'll do my best to stop the demon."     // close (:258,274). Incantation is FLAVOUR, not a gate.
] };
// Sir Prysin — Varrock palace ground floor, m50_54 "0 4 17: 883" -> (3204,3473,0).
// Two jobs: (a) at talked_aris his pre_silverlight dialogue sets key_hunt (stage 2)
// — the gate Rovin/Traiborn's key options need (sir_prysin.rs2:119-123); pick
// "Gypsy Aris said I should come and talk to you." (proc opt3, :270) then
// "I need to find Silverlight." / "So give me the keys!". (b) with ALL THREE keys
// held, a plain Talk-to auto-assembles Silverlight (prysin_got_them, :64-76) — no
// menu. "I'm still looking." exits the <3-keys key_search_progress branch (:54-61).
const PRYSIN: NpcStop = { npc: 'Sir Prysin', anchor: new Tile(3205, 3473, 0), leash: 6, prefer: [
    'Gypsy Aris said I should come and talk to you.',          // pre_silverlight opt3 (sir_prysin.rs2:270)
    'I need to find Silverlight.',                             // aris branch opt1 (:80)
    "He's back and unfortunately I've got to deal with him.",  // silverlight branch — either advances (:96)
    'So give me the keys!',                                    // -> keys label, which SETS demon_key_hunt (:108,123)
    'Where does the wizard live?',                             // post-key_hunt info menu (:124)
    "Well I'd better go key hunting.",                         // close (:152,166 — note the apostrophe)
    "I'm still looking."                                       // key_search_progress revisit close (:54)
] };
// Captain Rovin — TOP of the palace NW tower, LEVEL 2, m50_54 "2 4 40: 884" ->
// (3204,3496,2). Reached via the baked palace staircases (transports/stairEdges:
// (3201,3497,0)->1->2 confirmed present). His key_2 comes from the "important"
// path: opt3 "Yes I know, but this is important." (only offered at stage>=key_hunt,
// captain_rovin.rs2:60-61) -> "There's a demon who wants to invade this city."
// (:30-45) -> inv_add(silverlight_key_2). LIVE-VERIFY the L0->L2 climb.
const ROVIN: NpcStop = { npc: 'Captain Rovin', anchor: new Tile(3204, 3496, 2), leash: 6, prefer: ['Yes I know, but this is important.', "There's a demon who wants to invade this city."] };
// Wizard Traiborn — Wizards' Tower FIRST FLOOR, LEVEL 1, m48_49 "1 40 26: 881" ->
// (3112,3162,1). Reached via the baked tower staircases (stairEdges (3102,3159,0)->
// (3105,3160,1) confirmed). Two-talk key_1 flow (traiborn.rs2): the FIRST talk at
// stage key_hunt takes opt3 "I need to get a key given to you by Sir Prysin."
// (:38,52) -> "...have you got any keys knocking around?" (:54) -> "I'll get the
// bones for you." (:138) which sets find_bones (stage 3). The SECOND talk, while
// holding bones and at stage>=find_bones, routes straight to the bones handover
// (:4-8 -> :10-32), consuming ALL held bones (one stage per bone) — 25 bones takes
// stage 3->28 -> the incantation gives key_1 (:191-209). LIVE-VERIFY the L0->L1 climb.
// Traiborn stands at (3113,3162,1), just EAST of an L1 door at (3110,3162,1); the
// stair landing is WEST of it (probe 2026-07-19). leash MUST be small: at 6, gotoNpc's
// npcNear fires while the bot is still west of the door (it "sees" Traiborn d4 across
// it), so it stops there and talkThrough can't reach him — and the wedged door-cross
// then lets the resilient walker escalate into a counterproductive climb-DOWN. leash 2
// only satisfies at d<=2 of Traiborn (x>=3111 = EAST of the door), forcing the crossing.
const TRAIBORN: NpcStop = { npc: 'Traiborn', anchor: new Tile(3112, 3162, 1), leash: 2, prefer: ['I need to get a key given to you by Sir Prysin.', 'have you got any keys knocking around', "I'll get the bones for you"] };
// Wizards' Tower L0->L1 climb. The baked stair edge for this tower has a
// WALL-BLIND snapped start tile — derive-stairs snapped the staircase (3103,3159)
// operate tile to (3102,3159,0), which is walkable but sits OUTSIDE the tower's
// west wall, so the live server rejects Climb-up from there ("can't reach
// Staircase", live 2026-07-19). Worse, that exterior tile is a CHEAP shortcut the
// A* prefers, so a plain walk-to-L1 loops forever at (3102,3159). Fix: baked-walk
// to the INTERIOR stand (3105,3160,0) — a pure-L0 target, which forces the real
// door route (offline trace: (3109,3166)[Open] -> ... -> (3106,3162)[Open] ->
// inside) instead of the bogus edge — then OPLOC the staircase from INSIDE, where
// the server can reach it. (Global follow-up: a curated transports.json edge with
// the interior from-tile would fix this for every tower-climbing bot.)
const WIZ_INSIDE_STAND = new Tile(3105, 3160, 0);

// --- Drain / sewer geometry (the bespoke key_3 mechanic) ---
// The Drain (questdrain, loc 2843) — palace kitchen, m50_54 "0 25 39: 2843" ->
// (3225,3495,0). name=Drain (all.loc). Pouring bucket_water on it (oplocu,
// demon_slayer.rs2:23-40) spawns silverlight_key_3 as a GROUND obj in the sewer at
// obj coord 0_50_154_25_41 = (3225,9897,0), lasting ~300 ticks (~3 min).
const DRAIN_TILE = new Tile(3225, 3495, 0);
// The palace kitchen Sink (sink2, loc 874) — m50_54 "0 24 38: 874" -> (3224,3494,0),
// ONE tile from the drain; name=Sink, category=watersource (water_sources.loc), so
// an empty Bucket USED on it fills to Bucket of water (water_sources.rs2:63-82).
const SINK_TILE = new Tile(3224, 3494, 0);
// Varrock Sewers Manhole — m50_54 "0 37 2: 881" (manholeclosed) -> (3237,3458,0).
// name=Manhole. op1 "Open" (manholeclosed) flips it to manholeopen; op1 "Climb down"
// (manholeopen) p_telejumps +6400 z -> the sewer landing (manholes.rs2:1-11).
const MANHOLE_TILE = new Tile(3237, 3458, 0);
const SEWER_LAND = new Tile(3237, 9858, 0); // manhole "Climb down" lands here (3237,3458 + 6400 z)
const SEWER_KEY = new Tile(3225, 9897, 0);  // where the washed-down key spawns
// Stone circle south of Varrock — Delrith spawns at m50_52 "0 29 41: 879" ->
// (3229,3369,0), ringed by Dark wizards (ids 172/174). demon.npc: Delrith 7 HP,
// death_drop=ashes; delrith_weakened has no Attack op.
const DELRITH_TILE = new Tile(3229, 3369, 0);
// Lumbridge chicken farm for the Bones grind — m50_51 chicken (id 41) cluster
// local (25-35, 33-36) -> ~(3225-3235, 3297-3300, 0). Level-1, 3 HP, always drops
// Bones (bones.obj, npc death). Anchor the cluster centroid.
const CHICKEN_ANCHOR = new Tile(3230, 3298, 0);
// Varrock general store (generalshop2, varrock.inv:32 stock4=bucket_empty) — keeper
// generalshopkeeper2 (npc 522) at ~(3218,3414,0); op3 Trade. Display "Shop keeper"
// (the fleet's general-store convention, cf. Prince Ali's Lumbridge LUMBY_SHOP).
const VARROCK_GENERAL = { npc: 'Shop keeper', anchor: new Tile(3218, 3414, 0) };

// The exact incantation option (delrith.rs2:21 p_choice4 option 4). Two options
// start "Carlem..."; "Aber Camerinthum" is unique to the correct one, so a
// substring match on it can never pick option 1 ("Carlem Gabindo...").
const INCANTATION = 'Aber Camerinthum Purchai Gabindo';

const BONES_NEEDED = 25; // traiborn.rs2: got_traiborn_key(28) - find_bones(3) = 25

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
/** Live check for one of the three name-collided keys BY OBJ ID (the snapshot
 *  can't — all three are "Key"). Pack-only; the keys are never worn. */
const heldId = (id: number): boolean => Inventory.items().some(i => i.id === id);

/** Emit a buy, but park a WAIT the engine surfaces if pack+bank can't cover it —
 *  a bare buy that can't self-provision coins re-enters silently forever
 *  (Prince Ali's buyOrWait invariant). */
function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

// --- Provisioning gather fns (called bank-first before the quest starts) --------

/** Bucket of water (record item): fill an empty Bucket at the palace kitchen Sink
 *  (adjacent to the drain), buying the empty Bucket from the Varrock general store
 *  first if none is held. Re-plans each loop (decide-shaped), so buy -> fill -> done. */
function fillBucket(snap: QuestSnapshot): QuestStep {
    if (has(snap, 'bucket')) { // an EMPTY Bucket ('bucket' != 'bucket of water')
        return { kind: 'useOn', item: 'Bucket', targetKind: 'loc', target: 'Sink', anchor: SINK_TILE, product: 'Bucket of water' };
    }
    return buyOrWait(snap, { kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 });
}

// --- Custom legs (all live reads; each returns false to re-enter) ---------------

/** Grind Lumbridge chickens for Bones (one kill/loot cycle per call; false until
 *  BONES_NEEDED held). Chickens are level 1 / 3 HP and never meaningfully hurt back,
 *  so this is safe unattended; the AIOQuester eat hook covers any stray damage.
 *  Shared by the `bones` gather (bank-first fallback) AND keyHunt's Traiborn branch
 *  (just-in-time, so the quest still works even if Bones isn't a provisioned record
 *  item — Prince Ali's "gather slow raws in the sub-chain" lesson). */
async function grindBones(log: (m: string) => void): Promise<boolean> {
    if (Inventory.count('Bones') >= BONES_NEEDED) {
        return true;
    }
    // Loot any bones already on the ground first.
    const drop = GroundItems.query().name('Bones').within(14).nearest();
    if (drop) {
        const before = Inventory.count('Bones');
        if (!(await drop.interact('Take'))) { return false; }
        await Execution.delayUntil(() => Inventory.count('Bones') > before, 6000);
        return false;
    }
    // Attack the nearest idle chicken at the coop; walk there if none is in range.
    const chicken = Npcs.query().name('Chicken').action('Attack').where(n => !n.inCombat).within(12).nearest();
    if (!chicken) {
        await Traversal.walkResilient(CHICKEN_ANCHOR, { radius: 3, attempts: 3, timeoutMs: 90_000, log });
        return false;
    }
    const idx = chicken.index;
    if (!(await chicken.interact('Attack'))) { return false; }
    await Execution.delayUntil(() => Game.inCombat(), 5000);
    // Kill = the target NPC leaving the scene (death despawn), tracked by scene slot.
    await Execution.delayUntil(() => !Npcs.all().some(n => n.index === idx && /chicken/i.test(n.name ?? '')), 30_000);
    return false;
}

/**
 * The DRAIN key_3 leg (bespoke mechanic). Position-aware like Waterfall's legs,
 * since the sewer excursion has NO baked nav edge in or out (verified: transports/
 * stairEdges have nothing in the Varrock-sewer z-band), so the surface<->sewer
 * crossing must be driven explicitly here.
 *
 * UNDERGROUND: grab the "Key" ground item, then ALWAYS climb back out (so a missed
 *   grab or a first-try ascent miss self-heals on re-entry — keyHunt routes here for
 *   ANY underground position, not just while the key is missing).
 * SURFACE (no key): pour a Bucket of water on the Drain (spawns the key in the
 *   sewer) THEN descend the manhole in the SAME pass — an empty Bucket alone can't
 *   tell "just poured, go down" from "key despawned, re-pour", so pouring and
 *   descending are kept contiguous; a lone empty Bucket means re-fill at the Sink.
 *
 * ⚠ TOP LIVE-VERIFY: the sewer ASCENT. Static map data shows no ladder/Climb-up loc
 *   at the landing and no baked exit edge — the real exit loc/op/coords must be
 *   confirmed live. Until then the bot can grab the key but may not climb out.
 */
async function drainLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }

    if (isUnderground(here)) {
        // In the sewer: grab the washed-down key if we don't have it yet.
        if (!heldId(DRAIN_KEY_ID)) {
            if (!(await Traversal.walkResilient(SEWER_KEY, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
                return false;
            }
            const key = GroundItems.query().name('Key').where(g => g.id === DRAIN_KEY_ID).within(10).nearest()
                ?? GroundItems.query().name('Key').within(10).nearest();
            if (key) {
                await key.interact('Take');
                await Execution.delayUntil(() => heldId(DRAIN_KEY_ID), 6000);
            } else {
                log('drainLeg: no "Key" on the sewer floor — despawned? climbing out to re-pour');
            }
        }
        // Climb OUT regardless (self-healing). LIVE-VERIFY the exit loc/op.
        if (!(await Traversal.walkResilient(SEWER_LAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const up = Locs.query().action('Climb-up').within(8).nearest()
            ?? Locs.query().action('Climb up').within(8).nearest()
            ?? Locs.query().name('Manhole').within(8).nearest();
        if (!up) {
            log('drainLeg: LIVE-VERIFY — no Climb-up/Manhole at the sewer landing (3237,9858); confirm the Varrock-sewer exit');
            return false;
        }
        const op = up.actions().find(a => /climb.?up/i.test(a)) ?? up.actions()[0];
        if (op) { await up.interact(op); }
        await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && !isUnderground(t); }, 12_000);
        return false;
    }

    // Surface, key not yet held.
    if (heldId(DRAIN_KEY_ID)) {
        return true;
    }
    if (Inventory.contains('Bucket of water')) {
        // Pour on the drain (oplocu, last_useitem==bucket_water) to spawn the key...
        if (!(await Traversal.walkResilient(DRAIN_TILE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const drain = Locs.query().name('Drain').within(8).nearest();
        const bucket = Inventory.first('Bucket of water');
        if (drain && bucket) {
            await bucket.useOn(drain);
            // Confirm the pour landed (bucket_water -> bucket_empty) before leaving,
            // so we don't walk off mid-oplocu and skip the key spawn.
            await Execution.delayUntil(() => !Inventory.contains('Bucket of water'), 6000);
        }
        // ...then descend the manhole in the SAME pass (Open if closed, then Climb down).
        if (!(await Traversal.walkResilient(MANHOLE_TILE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const closed = Locs.query().name('Manhole').action('Open').within(6).nearest();
        if (closed) {
            await closed.interact('Open');
            await Execution.delayTicks(2);
        }
        const open = Locs.query().name('Manhole').action('Climb down').within(6).nearest();
        if (open) {
            await open.interact('Climb down');
            await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && isUnderground(t); }, 12_000);
        } else {
            log('drainLeg: no open Manhole to Climb down — retrying the Open next pass');
        }
        return false;
    }
    if (Inventory.contains('Bucket')) {
        // Poured earlier (or key despawned) and back on the surface with an empty
        // Bucket -> re-fill at the Sink; next pass takes the pour+descend branch.
        if (!(await Traversal.walkResilient(SINK_TILE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const sink = Locs.query().name('Sink').within(8).nearest();
        const bucket = Inventory.first('Bucket');
        if (sink && bucket) {
            await bucket.useOn(sink);
            await Execution.delayUntil(() => Inventory.contains('Bucket of water'), 6000);
        }
        return false;
    }
    // No bucket at all (never provisioned / lost mid-quest) — buy an empty one from
    // the Varrock general store; next pass fills it at the Sink.
    await executeStep({ kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 }, [], log);
    return false;
}

/**
 * The KEY HUNT + Silverlight assembly (the quest's spine while it lacks the sword).
 * Fully obj-id-aware, so the name-collided "Key" count never confuses it:
 *   underground            -> drainLeg (grab + climb out)
 *   all 3 keys held        -> talk Sir Prysin -> he assembles Silverlight (stage 29)
 *   no key yet             -> talk Sir Prysin first to OPEN the hunt (stage->key_hunt),
 *                             then fall through to collect (getting any key proves the
 *                             stage is set, so this Prysin talk only fires pre-first-key)
 *   missing Rovin key      -> talk Captain Rovin (palace L2)
 *   missing Traiborn key   -> grind 25 Bones (just-in-time) then talk Traiborn (L1)
 *   missing Drain key      -> drainLeg (pour + sewer)
 * Each leg returns false to re-enter; success bubbles up as "Silverlight held".
 */
async function keyHunt(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    // Underground = mid drain-leg (grab/ascend) regardless of which keys we hold.
    if (isUnderground(here)) {
        return drainLeg(log);
    }

    const hasRovin = heldId(ROVIN_KEY_ID);
    const hasTraiborn = heldId(TRAIBORN_KEY_ID);
    const hasDrain = heldId(DRAIN_KEY_ID);

    // All three distinct keys -> Sir Prysin assembles Silverlight (no menu; the
    // got_them branch fires on a plain Talk-to, sir_prysin.rs2:35-76).
    if (hasRovin && hasTraiborn && hasDrain) {
        if (!(await gotoNpc(PRYSIN, [], log))) { return false; }
        await talkThrough('Sir Prysin', PRYSIN.prefer, log);
        // The sword inv_add trails the if_close() by ~2 ticks — wait for it so decide()
        // routes to `equip`, not back into a keyless keyHunt pass.
        return Execution.delayUntil(() => Inventory.contains('Silverlight'), 6000);
    }

    // Before the first key, guarantee stage key_hunt via Sir Prysin (idempotent — a
    // harmless key_search_progress at stage>=key_hunt). Fall THROUGH to Rovin in the
    // same pass so "no key yet" can't loop on Prysin (his talk yields no key).
    if (!hasRovin && !hasTraiborn && !hasDrain) {
        if (!(await gotoNpc(PRYSIN, [], log))) { return false; }
        await talkThrough('Sir Prysin', PRYSIN.prefer, log);
    }

    // Captain Rovin's key (palace NW tower, L2). "important" option is stage-gated.
    // WAIT for the key to land: Rovin's inv_add trails if_close() by ~2 ticks and his
    // dialogue has NO already-have guard, so an immediate re-talk hands a DUPLICATE
    // key_2 (captain_rovin.rs2:42-45).
    if (!hasRovin) {
        if (!(await gotoNpc(ROVIN, [], log))) { return false; }
        await talkThrough('Captain Rovin', ROVIN.prefer, log);
        return Execution.delayUntil(() => heldId(ROVIN_KEY_ID), 6000);
    }

    // Wizard Traiborn's key (Wizards' Tower, L1) — needs 25 Bones handed over.
    if (!hasTraiborn) {
        if (Inventory.count('Bones') < BONES_NEEDED) {
            return grindBones(log);
        }
        // Climb to the tower's first floor. Post nav-fix this is ONE primitive:
        // walkResilient routes the whole baked path (the regenerated stair edge
        // now stands INSIDE the tower and the door-crossings are driven), and
        // the Climb-up OPLOC server-walks the last tiles.
        const t0 = Game.tile();
        if (t0 && t0.level !== 1) {
            const climbed = await Reach.locOp({
                name: 'Staircase',
                op: 'Climb-up',
                near: WIZ_INSIDE_STAND,
                expect: () => (Game.tile()?.level ?? 0) >= 1,
                log
            });
            if (climbed === 'unreachable') {
                log('demon: tower staircase unreachable — re-entering to re-plan');
            }
            return false; // re-enter: next pass talks Traiborn from L1
        }
        // On L1 — get Traiborn's dialogue open (tracks his patrol; opens the
        // interior door leaf when the way is shut), then drive it.
        if ((await Reach.npcDialog({ name: 'Traiborn', near: TRAIBORN.anchor, log })) !== 'done') {
            return false;
        }
        // First talk sets find_bones; second (still holding bones) hands all 25 and
        // yields key_1. talkThrough drives both. The handover is a ~25-TICK SERVER
        // chain (traiborn.rs2:22-32: if_close + inv_del(bones,1) + p_delay(1), looped
        // 25×), which OUTLASTS a short key-wait: a 6s timeout re-entered mid-chain with
        // bones momentarily < 25 and mis-routed to grindBones — walking the bot off to
        // the Lumbridge coop and climbing back DOWN the tower (live 2026-07-19). So once
        // the handover has actually STARTED eating bones (only the 2nd talk does), sit
        // tight and wait GENEROUSLY (30s) for key_1 so the chain finishes undisturbed.
        // The 1st talk just sets find_bones (no bones eaten) -> re-enter fast to the 2nd.
        await talkThrough('Traiborn', TRAIBORN.prefer, log);
        await Execution.delayTicks(2); // let a started handover consume its first bone(s)
        if (Inventory.count('Bones') < BONES_NEEDED) {
            // Handover started (only the 2nd talk eats bones). It's a ~25-tick SERVER
            // chain (if_close + inv_del(bones,1) + p_delay(1), looped 25×) that runs
            // with the dialogue CLOSED, THEN reopens a Hurrah!/incantation dialogue
            // (chatnpc + mesbox×3, traiborn.rs2:191-212) whose continue-prompts MUST be
            // clicked to receive key_1. talkThrough returned at the first if_close, so a
            // bare wait here leaves the incantation un-clicked and the key never comes
            // (bot then re-enters with bones<25 and grinds chickens forever). Drive the
            // continues to the end: loop while a box is open OR the key hasn't landed.
            for (let i = 0; i < 60 && (ChatDialog.isOpen() || !heldId(TRAIBORN_KEY_ID)); i++) {
                if (ChatDialog.canContinue()) { await ChatDialog.continue(); }
                await Execution.delayTicks(1);
            }
        }
        return false;
    }

    // The drain/sewer key (key_3).
    if (!hasDrain) {
        return drainLeg(log);
    }
    return false;
}

/**
 * The Delrith fight (delrith.rs2 + npc_combat.rs2:174-185). Silverlight MUST be worn
 * in the weapon slot to damage him (npc_combat.rs2:177 checks worn slot 3; otherwise
 * "Maybe I'd better wield silverlight first."). At 0 HP the death queue is intercepted
 * (ai_queue3) -> he becomes Weakened Delrith and the incantation p_choice4 fires;
 * answer option 4 ("...Aber Camerinthum...") to banish him (correct -> npc_death +
 * demon_slayer_complete). A wrong answer restores him to full HP, so we just re-attack.
 * The dialog is driven INLINE (like Prince Ali's beer / Waterfall's Hudon chains) —
 * the incantation appears mid-fight, inside this custom's own await window.
 */
async function fightDelrith(log: (m: string) => void): Promise<boolean> {
    // 1. Silverlight in the weapon slot, or no damage lands.
    if (!Equipment.contains('Silverlight')) {
        if (Inventory.contains('Silverlight')) { await Equipment.equip('Silverlight'); }
        return false;
    }
    // 2. Only walk/attack when no dialog is already up — a re-entry mid-incantation
    //    must answer it FIRST (an open p_choice4 blocks the walk). Otherwise get to
    //    the stone circle and open the fight; driveIncantation re-attacks as needed.
    if (!ChatDialog.canContinue() && ChatDialog.options().length === 0) {
        if (!(await Traversal.walkResilient(DELRITH_TILE, { radius: 4, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const delrith = Npcs.query().name('Delrith').action('Attack').within(12).nearest();
        if (delrith) {
            await delrith.interact('Attack');
        } else if (Npcs.query().name('Weakened Delrith').within(12).nearest() === null) {
            log('fightDelrith: no Delrith at the stone circle (3229,3369) — LIVE-VERIFY the spawn');
            return false;
        }
    }
    // 3. Drive the fight/incantation inline. Success = the journal flipping to
    //    complete after the correct answer (option 4).
    return driveIncantation(log);
}

/** Poll the dialog for ~a fight's worth of time: answer the incantation p_choice4
 *  with option 4, continue any pages, re-attack Delrith if he restored (wrong answer
 *  or still alive). Returns true once the journal is complete; false to re-enter. */
async function driveIncantation(log: (m: string) => void): Promise<boolean> {
    const deadline = performance.now() + 60_000;
    while (performance.now() < deadline) {
        if (Quests.status('Demon Slayer') === 'complete') {
            return true;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const inc = opts.find(o => o.toLowerCase().includes(INCANTATION.toLowerCase()));
            await ChatDialog.chooseOption(inc ?? opts[opts.length - 1]);
            await Execution.delayTicks(1);
            continue;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        // No dialog: if Delrith is up and we're not fighting, (re)attack — a wrong
        // incantation restores him to full HP (delrith.rs2:37-45).
        if (!Game.inCombat()) {
            const d = Npcs.query().name('Delrith').action('Attack').within(12).nearest();
            if (d) {
                await d.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue() || ChatDialog.options().length > 0, 5000);
                continue;
            }
        }
        await Execution.delayTicks(2);
    }
    return Quests.status('Demon Slayer') === 'complete';
}

// --- Pure quest brain ----------------------------------------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: GYPSY }; }

    // Silverlight in hand -> equip it; worn -> the Delrith fight. (Both checks come
    // before the key phase so a re-equip after a stray unequip is handled.)
    if (worn(snap, 'Silverlight')) { return { kind: 'custom', name: 'fight Delrith', run: fightDelrith }; }
    if (has(snap, 'Silverlight')) { return { kind: 'equip', item: 'Silverlight' }; }

    // Everything else (open the hunt, collect the 3 keys, assemble Silverlight) is
    // obj-id-driven inside keyHunt — the snapshot can't tell the three "Key"s apart.
    return { kind: 'custom', name: 'key hunt', run: keyHunt };
}

export const demonslayer: QuestModule = {
    record: QUESTS.find(r => r.id === 'demon')!,
    // Carry food for the Delrith fight — the stone circle is ringed by Dark wizards
    // that cast earth/water strike (dark_wizard.rs2). Best-effort via the eat hook.
    food: 10,
    // NPCs the quest legitimately fights, so the random-event guard never flags them:
    // Delrith (+ its weakened form) and the Dark wizards at the circle, plus the
    // Chickens the Bones grind kills.
    grind: ['delrith', 'weakened delrith', 'dark wizard', 'chicken'],
    // Bank-first gathers for the DECLARED record raws. Bucket of water fills at the
    // palace Sink (buying the empty Bucket if needed); Bones grinds Lumbridge chickens.
    // Both are also re-derivable mid-quest (keyHunt grinds Bones just-in-time;
    // drainLeg re-fills the Bucket), so a mid-run loss can't hard-block.
    gather: {
        'bucket of water': fillBucket,
        'bones': () => ({ kind: 'custom', name: 'grind bones', run: grindBones })
    },
    // Between-quest deposit KEEP list: the quest-internal items a mid-quest restart
    // may hold. 'key' covers all three silverlight keys (name-collided); 'bucket'
    // covers empty + water; 'silverlight'/'bones'/'coins' are self-explanatory.
    tools: ['key', 'silverlight', 'bucket', 'bones', 'coins'],
    decide
};
