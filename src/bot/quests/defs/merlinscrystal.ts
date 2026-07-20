import { EventSignal } from '../../api/EventSignal.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reach } from '../../api/Reach.js';
import { Sustain } from '../../api/Sustain.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, pickPreferred, talkThrough, type NpcStop } from '../exec/primitives.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Merlin's Crystal — the fleet's LONGEST def. Every coord/loc-name/op below was
// traced from ~/code/rs2b2t-content/scripts/quests/quest_arthur (cited inline as
// "arthur.rs2:N" / "arthur_journal.rs2" / "lady_of_the_lake.rs2" / "beggar.rs2" /
// "sir_mordred.rs2" / "candle_maker.rs2" / "bees.rs2" / "king_arthur.rs2" /
// "sir_gawain.rs2" / "sir_lancelot.rs2"). NPC/loc spawns are map-derived from the
// jm2 spawn sections (numeric ids resolved via pack/npc.pack + pack/loc.pack).
//
// THE HARD PART — this quest has a long run of VARP-ONLY stages (%arthur 1→2→3→4,
// then 4→5→6) with NO inventory signal, and quest varps are `scope=perm` (NOT
// transmitted — quest_arthur.varp), so a PURE decide() sees only journal (3-bucket)
// + inventory + noProgress, exactly like Romeo & Juliet. BUT unlike R&J this quest
// has FOUR consecutive no-inventory-change advances up front, far more than the
// watchdog's 8-step no-progress budget. The engine's escape hatch: a custom that
// returns FALSE does NOT tick the watchdog (QuestEngine only notes ok===true steps).
// So the entire varp-only OPENING (stages 1→4) lives in ONE re-entrant custom
// (`openingLeg`) that returns false throughout, sequencing off LIVE dialogue-option
// reads (never the unreadable varp). Phase B (the component gather + summon + break)
// dispatches on HELD ITEMS, waterfall-style.
//
// FLAGGED LIVE RISKS (see the report): (1) MULTI-LEVEL NAV — Lancelot is upstairs in
// Camelot (level 1), Mordred is level 2 in the sealed sea-stronghold, and Merlin's
// crystal is level 2 up the Camelot NW tower; the stronghold/tower stairs are almost
// certainly NOT in the baked nav graph, so the climbs are done EXPLICITLY here
// (climbAt) rather than trusting walkResilient across levels. (2) COMBAT — Sir
// Mordred is level 39 and the Giant bat is level 27; both fights are re-entrant so
// the host EatFood task heals between engine steps (needs food set + a real weapon +
// ~40 combat). (3) THE CHAOS ALTAR is in the low WILDERNESS (3239,3608) — PvP/aggro
// risk. (4) EXCALIBUR CANNOT be re-obtained mid-quest once lost to a death
// (lady_of_the_lake.rs2:20 gates the 500-coin re-buy on %arthur>excalibur_bound,
// i.e. only stage 6, after the crystal is already broken) — a death after obtaining
// it STRANDS the quest; carry food.

// --- Item display names -> LOWERCASED inv keys (obj configs). CRITICAL: the unlit
//     candle displays "Black candle" (unlit_black_candle id 38) and the lit one
//     "Lit black candle" (lit_black_candle id 32) — DISTINCT names, so decide() can
//     tell them apart by name (no id disambiguation needed). ---
const EXCALIBUR = 'Excalibur';
const UNLIT_CANDLE = 'Black candle';        // unlit_black_candle (from the candle maker)
const LIT_CANDLE = 'Lit black candle';      // lit_black_candle (tinderbox on the unlit one)
const BAT_BONES = 'Bat bones';              // Giant bat death drop
const WAX = 'Bucket of wax';                // bucket_empty + beehive
const BUCKET = 'Bucket';                    // bucket_empty (water_sources.obj: "Bucket")
const REPELLENT = 'Insect repellent';
const BREAD = 'Bread';
const TINDERBOX = 'Tinderbox';
// A CRUSH weapon for the two re-entrant fights. Sir Mordred is only 38 HP but his
// defence is stab 99 / slash 82 / CRUSH 45 (keep_le_faye.npc) — so bare fists OR a slash
// scimitar chip him for ~6 min, long enough that the bot's food runs out and it dies
// (live 2026-07-19: fists, fists+trout, and a slash scimitar all died/stalled). A crush
// weapon exploits his crush-def 45 and drops him in ~1 min. Provisioned as a plain combat
// tool (NOT a Phase-B signal), wielded before each fight. Kept in `tools` so a mid-quest
// restart re-carries it.
const WEAPON = 'Rune mace';

// --- NPC stops (jm2 NPC-section spawns; display names from the npc configs). ---
// King Arthur (2764,3515,0) — start at notStarted; at stage freed_merlin his
// opnpc1 auto-runs @king_arthur_merlin_free (no options) -> queues complete.
const KING_ARTHUR: NpcStop = { npc: 'King Arthur', anchor: new Tile(2764, 3515, 0), leash: 6, prefer: ['I want to become a Knight of the Round Table!'] };
// Sir Gawain (npc 240) — at %arthur=started his menu offers "Do you know how Merlin got
// trapped?" (sir_gawain.rs2:36-40 -> stage spoken_gawain); the sub-menu then has "Thank
// you for the information." to close cleanly. LIVE GEOMETRY (probed 2026-07-19): Gawain
// patrols the Round Table, live at ~(2761,3508,0) — WEST-central of the main hall, which
// is entered from the south Large door (2757,3503). The old anchor (2766,3508) sat
// directly north of a side Door (2766,3504), so gotoNpc routed the bot THROUGH that door
// and stalled ("giving up after 5 repaths"). Anchor now in his patrol area on the main-
// entrance side; talkKnight then walks to his LIVE tile. prefer opt4 sets
// arthur_spoken_gawain (sir_gawain.rs2:40) before the follow-up menu, so "Thank you..."
// safely closes.
const GAWAIN: NpcStop = { npc: 'Sir Gawain', anchor: new Tile(2761, 3508, 0), leash: 4, prefer: ['Do you know how Merlin got trapped?', 'Thank you for the information.'] };
// Sir Lancelot (npc 239, LEVEL 1 — Camelot upstairs). Only at %arthur=spoken_gawain
// does his menu offer "Any ideas on how to get into Morgan Le Faye's stronghold?"
// (sir_lancelot.rs2:15,30-36 -> stage spoken_lancelot). LIVE GEOMETRY (probed
// 2026-07-19): the ONLY staircase up to his floor lands at (2750,3511,1) on the WEST
// side, but a brick wall (bluepaintedbrickwall at world x=2757, z 3508-3515) fences
// off the throne room where Lancelot patrols (live tile ~2761,3512,1) to the EAST —
// reachable only by the client walker routing around+through the south Large doors
// (2761/2762,3505,1). The old anchor (2757,3511,1) sat ON that wall ("blocked live"),
// stranding the bot one strip west, and the server Talk-to can't open closed doors, so
// its 15s wait always timed out and the stage stuck at spoken_gawain, looping the
// stairs. Anchor now on the reachable WEST landing; talkKnight then walks to his LIVE
// tile (the door-opening client walker crosses the wall) before Talk-to. prefer opt4
// sets arthur_spoken_lancelot — the gate the smuggling crate needs to enter the keep.
const LANCELOT: NpcStop = { npc: 'Sir Lancelot', anchor: new Tile(2755, 3511, 1), leash: 4, prefer: ['Any ideas on how to get into Morgan Le Faye', "You're a little full of yourself"] };
// The Lady of the Lake at Taverley (2924,3405,0). Her "I seek the sword Excalibur."
// option appears ONLY at %arthur>=spoken_morgan_lefaye with no Excalibur held
// (lady_of_the_lake.rs2:4); picking it sends us to the Port Sarim jeweller and sets
// %excalibur_started (:42-43).
const LADY_LAKE: NpcStop = { npc: 'The Lady of the Lake', anchor: new Tile(2924, 3405, 0), leash: 6, prefer: ['I seek the sword Excalibur.'] };
// Candle maker in Catherby (2800,3439,0). At %arthur=spoken_morgan_lefaye his menu
// offers "Have you got any black candles?" (candle_maker.rs2:17-18) -> sets the
// blackcandle bit and asks for a bucket of wax; once the bit is set + wax held he
// auto-exchanges for an unlit Black candle (:2-13). prefer keeps him on the request
// path when the bit isn't set yet; when it is + wax held there are no options and
// the exchange is automatic.
const CANDLE_MAKER: NpcStop = { npc: 'Candle maker', anchor: new Tile(2800, 3439, 0), leash: 6, prefer: ['Have you got any black candles?'] };

// --- Loc stands / interaction tiles (jm2 LOC-section spawns) ---
// Catherby smuggling crate (merlincrate_empty @ 2801,3442,0; op2 "Hide-in"). Boarding
// it at %arthur>=spoken_lancelot runs the ship voyage and drops us in the stronghold
// (arthur.rs2:1-35); below that stage it's a "no reason" no-op (:36).
const CATHERBY_CRATE_STAND = new Tile(2801, 3443, 0);
// The sealed sea-stronghold footprint (keep_crate landing 2778,3401,0; Mordred
// 2769,3403,2; return crate 2779,3401,1; stairs 2769,3398-3405 L0-2). Used to tell
// "inside the keep" from Catherby/Camelot so openingLeg skips the Catherby candle
// probe while we're mid-fortress (it's unreachable from inside — the keep is
// boat/crate-only, sir_lancelot.rs2:32-36).
function insideKeep(t: { x: number; z: number }): boolean {
    return t.x >= 2762 && t.x <= 2782 && t.z >= 3396 && t.z <= 3410;
}
const MORDRED_TILE = new Tile(2769, 3403, 2);        // Sir Mordred, level 2
const KEEP_STAIR_L0 = new Tile(2769, 3404, 0);       // "stairs" up 0->1 (id 1722)
const KEEP_STAIR_L1_UP = new Tile(2769, 3398, 1);    // "stairs" up 1->2 (id 1722)
const KEEP_STAIR_L2_DOWN = new Tile(2769, 3399, 2);  // "stairstop" down 2->1 (id 1723)
const RETURN_CRATE_STAND = new Tile(2779, 3402, 1);  // beside merlincrate_empty2 (2779,3401,1)
// Camelot magic symbol (^camelot_magic_symbol = 2780,3515,0; loc 776). The summon
// zone is the 3x3 around it (arthur.rs2:151); stand on it and Drop the bat bones.
const MAGIC_SYMBOL = new Tile(2780, 3515, 0);
// The Chaos altar bearing the binding words "Snarthon Candtrick Termanto"
// (thrantaxaltar @ 3239,3608,0; name "Chaos altar", op2 "Check"; arthur.rs2:142-148).
// LOW WILDERNESS — see the flagged risk. op2 "Check" sets the chaosaltar bit ONLY at
// %arthur=spoken_morgan_lefaye.
const CHAOS_ALTAR_STAND = new Tile(3239, 3607, 0);
// Merlin's crystal up the Camelot NW tower: ground ladder (2769,3493,0) -> L1, ladder
// (2767,3491,1) -> L2, crystal "Giant crystal" (2767,3493,2). Stands are the ladder
// tiles / a tile beside the 2x2 crystal (LIVE-VERIFY the exact stands).
const TOWER_LADDER_0 = new Tile(2769, 3493, 0);
const TOWER_LADDER_1 = new Tile(2767, 3491, 1);
const CRYSTAL_STAND = new Tile(2767, 3494, 2);
// Port Sarim jeweller door (jewellersdoor @ 3016,3246,0; name "Door", op1 "Open").
// Opening it at %excalibur_started spawns the Beggar and runs the give-bread dialogue
// inline (arthur.rs2:210-222 -> beggar.rs2:18-46 -> Excalibur). No upstairs ladder is
// needed (that Lady is members-gated flavour, arthur.rs2:225-237).
const JEWELLER_DOOR_STAND = new Tile(3016, 3247, 0);
// Beehive cluster W of Catherby (merlin_beehive @ ~2755-2762,3440-3447; name
// "Beehive", op1 "Take-from"). Pour Insect repellent to free the bees, then take wax
// with an empty bucket (bees.rs2). Insect repellent ground-spawns at (2807,3450,0)
// in Catherby (jm2 OBJ id 28) — grabbed inline.
const BEEHIVE_STAND = new Tile(2758, 3444, 0);
const REPELLENT_SPAWN = new Tile(2807, 3450, 0);
// Giant bat (npc 78, level 27, param death_drop=bat_bones). The closest ACCESSIBLE
// surface cluster is W of Seers near the coal trucks (~2585,3478); a cluster at
// (2752-2759,3401) sits nearer Catherby but may be on the sealed stronghold rock —
// LIVE-VERIFY and switch the anchor if the coal-truck bats are unreachable.
const BAT_ANCHOR = new Tile(2589, 3478, 0);
// Wydin's food store, Port Sarim (3014,3204,0) — sells Bread (port_sarim.inv). On the
// Excalibur route (same town as the jeweller).
const WYDIN_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
// Rimmington general store "Shop keeper" (generalshopkeeper6 @ 2947,3216,0) — stocks
// Tinderbox + Bucket (rimmington.inv).
const RIMMINGTON_SHOP = { npc: 'Shop keeper', anchor: new Tile(2947, 3216, 0) };

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;

// --- Shared helpers ----------------------------------------------------------

/** Wield the provisioned weapon before a re-entrant fight — bare fists can't down Sir
 *  Mordred (lvl 39) before the bot's food runs out. No-op once it's worn or absent (a
 *  bankless restart may lack it; the fight then falls back to fists). */
async function wieldWeapon(log: (m: string) => void): Promise<void> {
    if (Equipment.contains(WEAPON) || !Inventory.contains(WEAPON)) {
        return;
    }
    if (await Equipment.equip(WEAPON)) {
        log(`wielded ${WEAPON}`);
    }
}

/** Emit a buy, or a parked WAIT when pack+bank can't cover it (the princeali
 *  idiom — a bare buy on a broke account re-enters forever and loops silently). */
function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

/** Drive an ALREADY-OPEN dialogue to close: continue through pages, pick the first
 *  matching `prefer` option (fallback = last = the safe decline). Used for dialogues
 *  opened by a non-talk action (dropping bones -> Thrantax; a killing blow ->
 *  Morgan; opening the jeweller door -> the Beggar), which the sibling ContinueDialog
 *  task can't drive mid-custom (no turn while we await). canContinue() also sees the
 *  MAIN-modal mesboxes of the crate voyage (princeali's joe_beer lesson). */
async function driveDialogue(prefer: string[], log: (m: string) => void, maxPages = 60): Promise<void> {
    for (let i = 0; i < maxPages && (ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
        if (EventSignal.pending()) {
            return; // yield to the random-event handler
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickPreferred(opts, prefer);
            if (!pick) {
                log(`  driveDialogue: no preferred option in [${opts.join(' | ')}] — taking the last`);
            }
            await ChatDialog.chooseOption(pick ?? opts[opts.length - 1]);
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
}

/** Walk to `stand` then climb the ladder/stair offering `op` there, awaiting the
 *  LEVEL change. The stronghold/tower crossings are almost certainly absent from the
 *  baked nav graph, so we cross them explicitly instead of trusting walkResilient
 *  across levels. Returns false on any failure (re-enter). */
async function climbAt(stand: Tile, op: string, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const stair = Locs.query().action(op).within(4).nearest();
    if (!stair) {
        log(`climbAt: no '${op}' near (${stand.x},${stand.z}) — LIVE-VERIFY the stair`);
        return false;
    }
    const before = Game.tile()?.level ?? stand.level;
    if (!(await stair.interact(op))) {
        return false;
    }
    return Execution.delayUntil(() => (Game.tile()?.level ?? before) !== before, 6000);
}

/** Climb DOWN the Camelot NW tower (L2->L1->L0) after visiting the crystal. Its ladders
 *  aren't in the baked nav graph (the ascent uses climbAt for the same reason), so a
 *  plain walkResilient can't leave the upper floors — it would burn its whole budget
 *  failing to path off L2. Descend the laddertops (name "Ladder", op Climb-down)
 *  explicitly, one flight per pass. Best-effort; a failure re-enters and retries. */
async function descendTower(log: (m: string) => void): Promise<boolean> {
    for (let guard = 0; guard < 4 && (Game.tile()?.level ?? 0) > 0; guard++) {
        const down = Locs.query().name('Ladder').action('Climb-down').within(6).nearest();
        if (!down) {
            log('descendTower: no Climb-down ladder in range — LIVE-VERIFY the tower descent');
            return false;
        }
        const before = Game.tile()?.level ?? 0;
        if (!(await down.interact('Climb-down'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => (Game.tile()?.level ?? before) < before, 6000))) {
            return false;
        }
    }
    return (Game.tile()?.level ?? 0) === 0;
}

// --- Phase A: the varp-only opening (stages 1→4), one re-entrant custom ---------

/** Talk Gawain then Lancelot to advance stage 1→3. Reach opens each dialogue —
 *  tracking the patrol via the live NPC query and climbing to Lancelot's floor /
 *  opening the throne-room leaf when the way is shut — and the shared talkThrough
 *  (transient-close tolerant) drives it through the mid-branch varp-sets.
 *
 *  Reach.npcDialog is RE-ENTRANT: a single call from off-scene or the wrong level
 *  only walks/climbs CLOSER and returns 'retry' — so Lancelot (upstairs, wall-
 *  fenced) never opened on the one call the bot made before openingLeg dragged it
 *  back to the crate, and the stage stuck below spoken_lancelot (live 2026-07-19).
 *  Loop the re-entrant Reach until the dialogue is actually open, then drive it.
 *  And because Reach short-circuits 'done' on ANY open box, confirm the knight is
 *  the NPC we're facing before talkThrough, so a stale/foreign dialogue (the candle
 *  maker's sticky sell menu on a later pass) is never driven with a knight's prefer. */
async function talkKnights(log: (m: string) => void): Promise<void> {
    for (const knight of [GAWAIN, LANCELOT]) {
        for (let attempt = 0; attempt < 4; attempt++) {
            const status = await Reach.npcDialog({ name: knight.npc, near: knight.anchor, log });
            if (status === 'unreachable') {
                log(`talkKnights: '${knight.npc}' unreachable this pass`);
                break;
            }
            if (status !== 'done') {
                continue; // 'retry' — re-enter Reach (it stepped us closer / up the stairs)
            }
            const npc = Npcs.query().name(knight.npc).action('Talk-to').nearest();
            const here = Game.tile();
            if (!npc || !here || npc.tile().distanceTo(here) > 3) {
                log(`talkKnights: open dialogue is not '${knight.npc}' (not adjacent) — skipping`);
                break;
            }
            log(`talkKnights: '${knight.npc}' dialogue open — driving`);
            await talkThrough(knight.npc, knight.prefer, log);
            break;
        }
    }
}

/**
 * Live stage-4 gate at the Catherby candle maker (the phase-A hub NPC). Returns true
 * iff %arthur>=spoken_morgan_lefaye, read purely from his LIVE dialogue options:
 *   - option "black candles" present  -> stage 4, bit not yet set: PICK it (sets the
 *     blackcandle bit for the later wax exchange) -> true.
 *   - only the plain sell menu ("Yes Please."/"No thank you.") -> stage <4 -> decline.
 *   - NO options at all (continue-only "Have you got any wax yet?" flow) -> stage 4,
 *     bit already set -> true (a stage <4 talk ALWAYS shows the sell menu, so
 *     option-less can only be the bit-set wax flow).
 * Driven inline (ContinueDialog can't help mid-custom).
 */
async function candleMakerStageFour(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(CANDLE_MAKER, [], log))) {
        return false;
    }
    const npc = Npcs.query().name('Candle maker').action('Talk-to').nearest();
    if (!npc || !(await npc.interact('Talk-to'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        return false;
    }
    let stage4 = false;
    let sawOptions = false;
    for (let i = 0; i < 40 && (ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            sawOptions = true;
            if (opts.some(o => /black candles/i.test(o))) {
                stage4 = true;
                await ChatDialog.chooseOption('black candles'); // sets the blackcandle bit
            } else {
                await ChatDialog.chooseOption('No thank you');   // plain sell menu -> decline
            }
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    // Option-less whole dialogue == the bit-set wax flow == stage 4 (a stage <4 talk
    // always presents the sell menu).
    return stage4 || !sawOptions;
}

/**
 * Board the Catherby crate into the sealed stronghold, climb to Sir Mordred (level 2),
 * beat him to the spare-son dialogue (server ai_queue3 at HP 0), pick the untrap
 * option (-> stage spoken_morgan_lefaye), then LEAVE via the return crate so the next
 * loop's candle-maker probe (Catherby) is reachable. Re-entrant: one leg per call so
 * the host EatFood task heals between the (re-entrant) attacks. Only ever entered
 * pre-stage-4 (openingLeg gates it behind the candle probe), so a fight is always
 * still owed on the first level-2 entry.
 */
async function fortress(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (!t) {
        return false;
    }
    if (!insideKeep(t)) {
        // Board the smuggling crate. Teleports in only at %arthur>=spoken_lancelot;
        // otherwise a harmless "no reason" mesbox (no teleport).
        if (!(await Traversal.walkResilient(CATHERBY_CRATE_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const crate = Locs.query().name('Crate').action('Hide-in').within(6).nearest();
        if (!crate) {
            log('fortress: no Catherby Crate to Hide-in');
            return false;
        }
        if (!(await crate.interact('Hide-in'))) {
            return false;
        }
        // Hide-in opens a mesbox then the "hide inside?" Yes/No, but interact() returns
        // before it renders and driveDialogue no-ops on a not-yet-open dialogue — wait
        // for it first (the Excalibur-door race, same class).
        await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 6000);
        await driveDialogue(['Yes.'], log, 40); // ~20 voyage mesboxes + the climb-out choice
        const boarded = await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && insideKeep(g); }, 12_000);
        log(`fortress: crate Hide-in -> insideKeep=${boarded} (needs stage>=spoken_lancelot to teleport)`);
        return false; // re-enter inside the keep (or still at Catherby if stage <3)
    }
    // A spare-son / Morgan dialogue open (killing blow) -> drive it, THEN leave in the
    // SAME call (there is no post-spar inventory signal, so returning to decide()
    // between the spar and the leave would re-fight Mordred forever).
    if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
        // sir_mordred.rs2:28-42: "Tell me how to untrap Merlin and I might." sets
        // spoken_morgan_lefaye + explains the summon; then @multi "OK I will go do all
        // that." closes.
        await driveDialogue(['Tell me how to untrap Merlin and I might.', 'OK I will go do all that.'], log);
        await leaveKeep(log);
        return false;
    }
    const lvl = Game.tile()?.level ?? 0;
    if (lvl < 2) {
        // Climb up to Mordred (one flight per call).
        if (lvl < 1) {
            await climbAt(KEEP_STAIR_L0, 'Climb-up', log);
        } else {
            await climbAt(KEEP_STAIR_L1_UP, 'Climb-up', log);
        }
        return false;
    }
    // Level 2 — engage Mordred (op2 Attack; sir_mordred.rs2:1-5) until the spare
    // dialogue opens. Re-entrant: one engagement per call.
    if (!(await Traversal.walkResilient(MORDRED_TILE, { radius: 5, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await wieldWeapon(log);
    // Force the AGGRESSIVE style (com_mode 1). On a mace that's Pummel = CRUSH, hitting
    // Mordred's crush-def 45; the default Controlled style is Spike = STAB, which slams
    // into his stab-def 99 and misses almost everything (live 2026-07-19: adjacent + fed
    // but still couldn't drop him). Re-asserted each pass (com_mode isn't persisted).
    Game.setCombatStyle(1);
    // Re-issue Attack each pass (Mordred is aggressive, so inCombat() reads true off his
    // hits even when we're idle — gating on it would stop us attacking back).
    const mordred = Npcs.query().name('Sir Mordred').action('Attack').within(8).nearest();
    if (mordred) {
        // Close to MELEE range first. The keep platform stalled the OPNPC Attack auto-walk
        // ~2 tiles short (bot idled at z=3401 while Mordred stood at z=3403), so every swing
        // was out of range — Mordred (38 HP) never fell and the bot tanked him to death
        // (live 2026-07-19). Walk ADJACENT to his live tile, then attack.
        const here = Game.tile();
        if (here && mordred.tile().distanceTo(here) > 1) {
            await Traversal.walkResilient(mordred.tile(), { radius: 1, attempts: 2, timeoutMs: 20_000, log });
        }
        await mordred.interact('Attack');
        // HOLD the engagement — do NOT re-click Attack (that resets the swing timer and
        // was crippling DPS). Let the sustained auto-attack run, eating between checks
        // (the host EatFood/Sustain hook only fires during walks, never inside a
        // delayUntil — a standing fight would never trigger it, so drive it here), until
        // the spare dialogue opens or ~14s pass (then re-enter to re-approach if the
        // knockback pushed us out of melee).
        for (let i = 0; i < 8 && !ChatDialog.isOpen() && !ChatDialog.canContinue() && Game.inCombat(); i++) {
            await Execution.delayTicks(3);
            await Sustain.run();
        }
    }
    return false;
}

/** Leave the sealed keep: climb down to level 1 and board the return crate
 *  (merlincrate_empty2) back to Catherby (arthur.rs2:38-66). Best-effort in one call;
 *  a failure re-enters fortress, which retries. */
async function leaveKeep(log: (m: string) => void): Promise<boolean> {
    if ((Game.tile()?.level ?? 0) >= 2) {
        // Climb DOWN. climbAt's strict walkResilient(stand, radius 1) reads the down-
        // stair stand (2769,3399) as "unreachable" from the post-fight spot (live
        // 2026-07-19), so OPLOC the Staircase directly when it's in range and let the
        // SERVER walk the last tiles + descend; only walk closer if it's not visible.
        const down = Locs.query().name('Staircase').action('Climb-down').within(6).nearest();
        if (down) {
            await down.interact('Climb-down');
            await Execution.delayUntil(() => (Game.tile()?.level ?? 2) < 2, 8000);
            return false;
        }
        await Traversal.walkResilient(KEEP_STAIR_L2_DOWN, { radius: 2, attempts: 3, timeoutMs: 60_000, log });
        return false;
    }
    if (!(await Traversal.walkResilient(RETURN_CRATE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const crate = Locs.query().name('Crate').action('Hide-in').within(6).nearest();
    if (crate) {
        await crate.interact('Hide-in');
        await driveDialogue(['Yes.'], log, 40);
        await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && !insideKeep(g); }, 12_000);
    }
    return true;
}

/**
 * The whole varp-only opening (stages 1→4) plus the phase-B seed, one re-entrant leg.
 * Returns false throughout so it never trips the no-progress watchdog (which would
 * park then block on the 4 no-inventory-change advances). Dispatch order is
 * POSITION-gated so we never re-probe the (unreachable) candle maker mid-fortress or
 * mid-bat-hunt:
 *   - inside the keep            -> continue the fortress (fight/leave)
 *   - already at the bats        -> keep hunting (killGiantBat)
 *   - else advance the knights, then the candle-maker stage-4 gate splits:
 *        stage 4  -> seed phase B by killing a Giant bat for bones
 *        stage <4 -> run the fortress (crate -> Mordred -> Morgan)
 */
async function openingLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t && insideKeep(t)) {
        return fortress(log);
    }
    if (t && BAT_ANCHOR.distanceTo(t) <= 25) {
        return killGiantBat(log); // committed to the bat hunt — don't bounce back to Catherby
    }
    await talkKnights(log); // Gawain + Lancelot: advance 1→3 (harmless no-ops once done)
    if (await candleMakerStageFour(log)) {
        return killGiantBat(log); // stage 4 reached -> seed bones (walkResilient makes the trip in one call)
    }
    return fortress(log);
}

// --- Phase B: component gather + summon + break (dispatched on held items) ------

/** Kill a Giant bat for its death-drop Bat bones. Re-entrant (one engagement per
 *  call so EatFood heals between). Grabs the dropped bones off the ground. */
async function killGiantBat(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(BAT_BONES)) {
        return true;
    }
    const drop = GroundItems.query().name(BAT_BONES).within(6).nearest();
    if (drop) {
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(BAT_BONES), 6000);
    }
    if (!(await Traversal.walkResilient(BAT_ANCHOR, { radius: 6, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await wieldWeapon(log);
    Game.setCombatStyle(1); // aggressive/crush + max strength (see fortress)
    const bat = Npcs.query().name('Giant bat').action('Attack').within(10).nearest();
    if (!bat) {
        log('killGiantBat: no Giant bat near the anchor — LIVE-VERIFY the spawn is reachable');
        return false;
    }
    await bat.interact('Attack');
    await Execution.delayUntil(
        () => GroundItems.query().name(BAT_BONES).within(6).nearest() !== null || Npcs.query().name('Giant bat').within(2).nearest() === null,
        5000
    );
    await Sustain.run(); // eat mid-fight — the host hook only fires during walks (see fortress)
    return false; // re-enter -> grab the bones or attack again
}

/** Get a Bucket of wax: grab the Catherby insect-repellent spawn if missing, pour it
 *  on a beehive to drive the bees off (bees.rs2:16-22), then take wax with an empty
 *  bucket (:24-36). Repellent is NOT consumed; the bucket becomes the wax. */
async function getWax(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(WAX)) {
        return true;
    }
    if (!Inventory.contains(REPELLENT)) {
        const rep = GroundItems.query().name(REPELLENT).within(8).nearest();
        if (rep) {
            if (!(await rep.interact('Take'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.contains(REPELLENT), 6000);
        }
        await Traversal.walkResilient(REPELLENT_SPAWN, { radius: 2, attempts: 3, timeoutMs: 90_000, log });
        return false;
    }
    if (!Inventory.contains(BUCKET)) {
        log('getWax: no empty Bucket (should be provisioned) — parking to re-provision');
        return false;
    }
    if (!(await Traversal.walkResilient(BEEHIVE_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    // bees.loc defines TWO 'Beehive' locs: the interactive merlin_beehive (op1=
    // Take-from, the quest one) and a decorative beehive with no op. Filter on the
    // Take-from op so useOn never targets a dead decorative hive.
    const hive = Locs.query().name('Beehive').action('Take-from').within(8).nearest();
    if (!hive) {
        log('getWax: no Beehive near the anchor');
        return false;
    }
    // Pour repellent (oplocu case insect_repellent) to free the bees, then take wax
    // with the bucket (oplocu case bucket_empty -> @take_beehive). %beehive_free is a
    // shared varp, so a race just re-enters (repeated pours are harmless).
    const rep = Inventory.first(REPELLENT);
    if (rep) {
        await rep.useOn(hive);
        await Execution.delayTicks(2);
    }
    const bucket = Inventory.first(BUCKET);
    if (bucket) {
        await bucket.useOn(hive);
    }
    return Execution.delayUntil(() => Inventory.contains(WAX), 8000);
}

/** Light the unlit Black candle with the Tinderbox (ignite_light_source). */
async function lightCandle(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(LIT_CANDLE)) {
        return true;
    }
    const tinder = Inventory.first(TINDERBOX);
    const candle = Inventory.first(UNLIT_CANDLE);
    if (!tinder || !candle) {
        log('lightCandle: missing Tinderbox or Black candle');
        return false;
    }
    if (!(await tinder.useOn(candle))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains(LIT_CANDLE), 6000);
}

/**
 * Obtain Excalibur (only possible at stage>=spoken_morgan_lefaye). Ask the Taverley
 * Lady of the Lake (sets %excalibur_started + sends us to Port Sarim), then open the
 * jeweller's door holding Bread — that inline-spawns the Beggar and runs the
 * give-bread dialogue (arthur.rs2:210-222 -> beggar.rs2), turning him into the Lady
 * who hands over Excalibur. If the Beggar is already spawned (door opened earlier
 * without bread -> spoken_beggar), Talk-to him with bread instead.
 */
async function getExcalibur(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(EXCALIBUR)) {
        return true;
    }
    // 1. Taverley Lady -> set %excalibur_started (idempotent; her option only shows at
    //    stage>=4 with no Excalibur held).
    if (await gotoNpc(LADY_LAKE, [], log)) {
        await talkThrough('The Lady of the Lake', LADY_LAKE.prefer, log);
    }
    if (!Inventory.contains(BREAD)) {
        log('getExcalibur: no Bread for the Beggar (should be provisioned)');
        return false;
    }
    // 2. Port Sarim jeweller door -> Beggar -> bread -> Excalibur.
    if (!(await Traversal.walkResilient(JEWELLER_DOOR_STAND, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const beggar = Npcs.query().name('Beggar').action('Talk-to').within(6).nearest();
    if (beggar) {
        await talkThrough('Beggar', ['Yes, here you go.', 'Yes certainly.'], log);
    } else {
        const door = Locs.query().name('Door').action('Open').within(6).nearest();
        if (!door) {
            log('getExcalibur: no jeweller Door to Open');
            return false;
        }
        if (!(await door.interact('Open'))) {
            return false;
        }
        // The open inline-runs @lake_beggar_dialogue, but interact() returns BEFORE the
        // dialogue renders (like every talk here), and driveDialogue does zero passes if
        // nothing is open yet — which silently wasted the whole Taverley<->Port Sarim
        // round trip and re-entered forever. Wait for the beggar's box first.
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
            log('getExcalibur: jeweller door opened but the Beggar dialogue never appeared — retry');
            return false;
        }
        // The open inline-runs @lake_beggar_dialogue — drive the give-bread choices.
        await driveDialogue(['Yes certainly.', 'Yes, here you go.'], log);
    }
    return Inventory.contains(EXCALIBUR);
}

/**
 * Terminal leg (entered holding Excalibur + a candle + Bat bones). Break-FIRST is the
 * clean stage guard: using Excalibur on the crystal works ONLY at
 * %arthur>=excalibur_bound (stage 5); at stage 4 it's a harmless "dark force" no-op
 * (arthur.rs2:239-271). So:
 *   - crystal shatters  -> Merlin freed (stage 6) -> report to King Arthur -> complete.
 *   - still intact      -> stage 4: summon Thrantax first (summonThrantax), re-enter.
 * Doing the summon FIRST would re-drop (and LOSE) the bones at stage 5, so the break
 * test must gate it. Costs one extra tower climb at stage 4 (flagged).
 */
async function summonAndBreak(log: (m: string) => void): Promise<boolean> {
    const outcome = await tryBreakCrystal(log);
    if (outcome === 'fail') {
        return false;
    }
    // tryBreakCrystal leaves us atop the L2 tower; its ladders aren't baked into the
    // nav graph, so descend explicitly (same call) before walking off — else the next
    // walkResilient/gotoNpc burns its whole budget failing to path off L2.
    await descendTower(log);
    if (outcome === 'broke') {
        // king_arthur.rs2:42/48-51: at freed_merlin his opnpc1 auto-runs the reward +
        // queues arthur_quest_complete (no options).
        if (!(await gotoNpc(KING_ARTHUR, [], log))) {
            return false;
        }
        await talkThrough('King Arthur', KING_ARTHUR.prefer, log);
        return true;
    }
    // need-summon: learn the words + summon Thrantax (stage 4 -> excalibur_bound), then
    // re-enter to climb the tower again and break the crystal for real at stage 5.
    await summonThrantax(log);
    return false;
}

/** Climb the Camelot tower to Merlin's crystal (level 2) and use Excalibur on it.
 *  'broke' = crystal gone / Merlin spawned; 'need-summon' = still intact (stage <5);
 *  'fail' = a climb/walk failure (re-enter). */
async function tryBreakCrystal(log: (m: string) => void): Promise<'broke' | 'need-summon' | 'fail'> {
    if ((Game.tile()?.level ?? 0) < 1 && !(await climbAt(TOWER_LADDER_0, 'Climb-up', log))) {
        return 'fail';
    }
    if ((Game.tile()?.level ?? 0) < 2 && !(await climbAt(TOWER_LADDER_1, 'Climb-up', log))) {
        return 'fail';
    }
    if (!(await Traversal.walkResilient(CRYSTAL_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return 'fail';
    }
    // We're at the crystal stand: no crystal here means it's already shattered (Merlin
    // freed on an earlier pass whose walk to King Arthur was interrupted) — report in,
    // don't loop re-breaking nothing.
    const crystal = Locs.query().name('Giant crystal').within(8).nearest();
    if (!crystal) {
        return 'broke';
    }
    const excal = Inventory.first(EXCALIBUR);
    if (!excal) {
        log('tryBreakCrystal: no Excalibur to break the crystal');
        return 'fail';
    }
    await excal.useOn(crystal); // oplocu,merlins_crystal
    await Execution.delayTicks(3);
    const gone = Locs.query().name('Giant crystal').within(8).nearest() === null
        || Npcs.query().name('Merlin').within(8).nearest() !== null;
    return gone ? 'broke' : 'need-summon';
}

/**
 * Summon and bind Thrantax (stage 4 -> excalibur_bound). Learn the words at the Chaos
 * altar (Wilderness; the varp bit is unreadable so we always Check before summoning —
 * only reached at stage 4), walk to the Camelot magic symbol, ensure a LIT candle,
 * then Drop the bat bones (opheld5 -> Thrantax; the bones are RETAINED, not consumed,
 * arthur.rs2:150-206) and recite "Snarthon Candtrick Termanto". A WRONG recital
 * deletes the candle and Thrantax attacks, so the exact string is preferred.
 */
async function summonThrantax(log: (m: string) => void): Promise<boolean> {
    // Chaos altar 'Check' -> learn the binding words (arthur.rs2:142-148). WILDERNESS.
    if (!(await Traversal.walkResilient(CHAOS_ALTAR_STAND, { radius: 2, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    const altar = Locs.query().name('Chaos altar').action('Check').within(8).nearest();
    if (altar) {
        await altar.interact('Check');
        await Execution.delayTicks(2);
    }
    // Magic symbol -> ensure a lit candle -> drop the bones to summon.
    if (!(await Traversal.walkResilient(MAGIC_SYMBOL, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!Inventory.contains(LIT_CANDLE) && !(await lightCandle(log))) {
        return false;
    }
    const bones = Inventory.first(BAT_BONES);
    if (!bones) {
        log('summonThrantax: no Bat bones');
        return false;
    }
    if (!(await bones.interact('Drop'))) { // opheld5,bat_bones on the magic symbol
        return false;
    }
    if (!(await Execution.delayUntil(
        () => ChatDialog.isOpen() || ChatDialog.canContinue() || Npcs.query().name('Thrantax').within(6).nearest() !== null,
        6000
    ))) {
        log('summonThrantax: Thrantax did not appear (words not learned, or off the symbol?)');
        return false;
    }
    await driveDialogue(['Snarthon Candtrick Termanto'], log); // the ONLY correct recital
    return true;
}

// --- Pure quest brain --------------------------------------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: KING_ARTHUR }; }

    const hasExcalibur = has(snap, EXCALIBUR);
    const hasUnlit = has(snap, UNLIT_CANDLE);
    const hasLit = has(snap, LIT_CANDLE);
    const hasBones = has(snap, BAT_BONES);
    const hasWax = has(snap, WAX);
    const anyProduct = hasExcalibur || hasUnlit || hasLit || hasBones || hasWax;

    // No phase-B product yet -> we're somewhere in the varp-only opening (stage 1-4).
    // The single re-entrant custom advances 1→4 and seeds the first Bat bones; it
    // returns false throughout, so the watchdog never parks on the signal-less run.
    if (!anyProduct) {
        return { kind: 'custom', name: 'opening (knights + fortress)', run: openingLeg };
    }

    // Phase B (holding a product PROVES stage>=4). Gather the summon prerequisites in
    // a danger-minimising order — the risky bat + Wilderness altar come BEFORE
    // Excalibur, which a death would strip permanently — then summon and break.
    if (!hasBones) {
        return { kind: 'custom', name: 'kill a Giant bat for bones', run: killGiantBat };
    }
    if (!hasUnlit && !hasLit && !hasWax) {
        return { kind: 'custom', name: 'gather wax for the black candle', run: getWax };
    }
    if (hasWax && !hasUnlit && !hasLit) {
        return { kind: 'talk', stop: CANDLE_MAKER }; // exchange wax -> Black candle
    }
    if (hasUnlit && !hasLit) {
        return { kind: 'custom', name: 'light the black candle', run: lightCandle };
    }
    if (!hasExcalibur) {
        return { kind: 'custom', name: 'get Excalibur (Lady of the Lake + Beggar)', run: getExcalibur };
    }
    // Excalibur + lit candle + bones -> summon Thrantax, break the crystal, report in.
    return { kind: 'custom', name: 'summon Thrantax + break the crystal', run: summonAndBreak };
}

export const merlinscrystal: QuestModule = {
    record: QUESTS.find(r => r.id === 'arthur')!,
    // Mordred (lvl 39) + the Giant bat (lvl 27) are fought re-entrantly; the host
    // EatFood task heals between engine steps when HP dips (needs `food` set on the
    // AIOQuester + a real weapon; Excalibur is only obtained AFTER Mordred).
    food: 15,
    // Player-supplied consumables, provisioned bank-first (the user's bank-first
    // model); gather fns keep a bankless start from hard-parking.
    gather: {
        'insect repellent': () => ({ kind: 'grabGround', item: 'Insect repellent', anchor: REPELLENT_SPAWN }),
        'bread': s => buyOrWait(s, { kind: 'buy', item: 'Bread', qty: 1, shop: WYDIN_SHOP, estGp: 20 }),
        'tinderbox': s => buyOrWait(s, { kind: 'buy', item: 'Tinderbox', qty: 1, shop: RIMMINGTON_SHOP, estGp: 15 }),
        'bucket': s => buyOrWait(s, { kind: 'buy', item: 'Bucket', qty: 1, shop: RIMMINGTON_SHOP, estGp: 15 })
    },
    // Keep across the between-quest deposit: every quest-internal item a mid-quest
    // restart may hold, plus the supplies. 'black candle' covers unlit; 'lit black
    // candle' the lit one; 'bucket' covers both empty and 'bucket of wax'.
    tools: ['excalibur', 'black candle', 'lit black candle', 'bat bones', 'bucket of wax', 'bucket', 'insect repellent', 'bread', 'tinderbox', 'coins', 'rune mace'],
    decide
};
