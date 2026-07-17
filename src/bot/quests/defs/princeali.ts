// COMBAT-SURVIVABILITY GATE (not modeled in QuestSnapshot): Prince Ali never
// fights, but the Draynor jail (Keli's imprint + the jailbreak) is ringed by
// level-26 Jail guards (draynor.npc:152, op2=Attack) that aggro any account
// under ~2x their level (aggressive to combat level <= 26*2 = 52). A bare or
// low-combat account dies at the jail and DROPS its coins AND the tradeable
// disguise items (blond wig / bronze key / pink skirt — only Paste is
// untradeable) on death; death recovery re-provisions from the BANK but can't
// restore dropped pack items, so the run strands. THE FIX IS COMBAT LEVEL > 52:
// at that point the guards do not aggro at all, so the imprint + the linger-
// heavy jailbreak (tie Keli, unlock, hand over) are safe. The smoke preps
// attack/strength/defence/hitpoints ~60 (combat ~65). Live-verified: combat 40
// still died mid-jailbreak (2026-07-17). TODO(robustness): bank the coin float +
// carry food eaten via a sustain hook, so a stray death can't strand the quest.
import { Execution } from '../../api/Execution.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { F2P } from '../data/f2p.js';
import { gatherBalls } from './sheepshearer.js';

// Prince Ali Rescue — the fleet's most mechanical def. Content facts from
// docs/superpowers/research/2026-07-16-prince-ali-content-facts.md (cited inline
// as "research doc §N"). Three disguise pipelines (wig+dye, skin paste, bronze
// key) converge, then a bespoke jailbreak (§5). decide()/gather fns are PURE;
// every live read is inside a custom thunk (jailbreak/imprintAtKeli/wigPipeline/
// burnForAshes) per the engine's snapshot discipline.

// --- NPC stops (research doc §2 map-derived anchors; prefer chains verbatim) ---
const HASSAN: NpcStop = { npc: 'Hassan', anchor: new Tile(3302, 3163, 0), leash: 6, prefer: ['Can I help you? You must need some help here in the desert.'] };
// ORDER MATTERS: talkThrough greedily picks the FIRST prefer entry present in a
// menu. 'Okay, I better go find some things.' MUST outrank 'What is the second
// thing you need?' — both appear in the osman_first_thing menu (osman.rs2:49),
// and picking "second thing" loops between the first/second-thing menus forever
// without ever setting stage 20 (osman_better_go). Live 2026-07-16: the old
// order looped Osman↔Keli ~65 min, stage 20 never set, Keli's imprint gate
// (stage-20) never opened. 'What is the first thing I must do?' first surfaces
// the menu that contains "Okay, I better go". (The opener line is auto-said, not
// an option, so it's dropped.)
const OSMAN: NpcStop = { npc: 'Osman', anchor: new Tile(3286, 3180, 0), leash: 6, prefer: ['Okay, I better go find some things.', 'What is the first thing I must do?', 'What is the second thing you need?'] };
// 'I hoped to get him drunk.' is Leela's stage-30 guard-plan option (leela.rs2:47)
// — she confirms the 3-beers approach. Informational (beers work at stage 30
// regardless), but preferring it keeps the dialogue on the quest rail instead of
// the fallback decline.
const LEELA: NpcStop = { npc: 'Leela', anchor: new Tile(3113, 3263, 0), leash: 6, prefer: ['I hoped to get him drunk.'] };
const NED_WIG: NpcStop = { npc: 'Ned', anchor: new Tile(3100, 3258, 0), leash: 6, prefer: ['Ned, could you make other things from wool?', 'How about some sort of wig?', 'I have that now. Please, make me a wig.'] };
const NED_ROPE: NpcStop = { npc: 'Ned', anchor: new Tile(3100, 3258, 0), leash: 6, prefer: ['Yes, I would like some rope.', 'Okay, please sell me some rope.'] };
const AGGIE_PASTE: NpcStop = { npc: 'Aggie', anchor: new Tile(3086, 3259, 0), leash: 6, prefer: ['Could you think of a way to make skin paste?', 'Yes please. Mix me some skin paste.'] };
const AGGIE_DYE: NpcStop = { npc: 'Aggie', anchor: new Tile(3086, 3259, 0), leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make yellow dye?', 'Okay, make me some yellow dye please.'] };
// prefer = the MENU OPTIONS along the flattery→plan→key path (lady_keli.rs2
// menus at :13,18,57,out,key_please), NOT the player's auto-said opening line.
// Live 2026-07-16: the old ['Are you the famous Lady Keli?', ...] matched no
// menu (that string is the opener, not an option), so talkThrough fell through
// to the last option (the decline) and the imprint never happened. The
// 'Yes, of course I have heard of you.' entry recovers the 'never heard of you'
// branch (:33). Imprint menu is stage-20+softclay gated (:88).
const KELI: NpcStop = { npc: 'Lady Keli', anchor: new Tile(3128, 3244, 0), leash: 6, prefer: ['Heard of you? You are famous in RuneScape!', 'Yes, of course I have heard of you.', 'What is your latest plan then?', 'Can you be sure they will not try to get him out?', 'Could I see the key please?', 'Could I touch the key for a moment?'] };
// Varrock Blue Moon (3226,3399, bluemoon_bartender). His beer option is
// "A glass of your finest ale please." (bartender.rs2:65-21), NOT the Jolly
// Boar's "I'll have a beer please." — live 2026-07-16: the old single string
// matched no Blue Moon menu, so talkThrough declined and never bought a beer.
// Both strings are listed so either bar works; each talk buys ONE beer (2gp).
const BARTENDER: NpcStop = { npc: 'Bartender', anchor: new Tile(3226, 3399, 0), leash: 8, prefer: ['A glass of your finest ale please.', "I'll have a beer please."] };

// --- Shops (research doc §6). Thessalia/Shantay given; the two "general store"
// sellers are derived the standard way (npc.pack id -> map jm2 NPC spawn): ---
const THESSALIA_SHOP = { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) };
const SHANTAY_SHOP = { npc: 'Shantay', anchor: new Tile(3304, 3123, 0) };
// Port Sarim "general store" (research doc §6 redberries+pot_of_flour): the only
// LIVE shop stocking both in Port Sarim is Wydin's Food Store — port_sarim.inv
// [wydinstore] (the [foodshop] block that also lists them is tagged //unused).
// Wydin = npc.pack id 557, owned_shop=wydinstore, op3=Trade (ungated — the apron
// gate in wydin.rs2 is only for the Pirate's Treasure job); spawn m47_50 (0 6 4)
// -> (3014,3204,0). LIVE-VERIFY the Trade reaches through the shopfront door.
const PORT_SARIM_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
// Lumbridge general store (research doc §6 tinderbox, stock 2gp): lumbridge.inv
// [generalshop1], owned by "Shop keeper" = npc.pack id 520, spawn m50_50 (0 9 47)
// -> (3209,3247,0). op3=Trade.
const LUMBY_SHOP = { npc: 'Shop keeper', anchor: new Tile(3209, 3247, 0) };

// --- Ground/loc gather tiles (brief data block; research doc §6) ---
const ONION_PATCH = new Tile(3188, 3267, 0);      // loc 3366 'Onion' op2=Pick, beside Fred's farm
const CLAY_ROCKS = new Tile(2986, 3240, 0);       // reuse Doric's Rimmington clay anchor
const BUCKET_SPAWN = new Tile(3225, 3294, 0);     // proven farmhouse tile (cook def)
// Rimmington Well (loc 884 'Well', category=well) at (2956,3212) — 30 tiles from
// the Rimmington clay rocks the soft-clay/paste chains mine at, so bucket-fill
// and soft-clay-making happen in one place. Live 2026-07-16: the earlier
// Lumbridge (3208,3221) tile has NO 'Well' loc (a Fountain + Sink), so the
// fill useOn found no target and spun.
const WELL = new Tile(2956, 3212, 0);
// Logs ground spawn for burnForAshes: no static Logs OBJ exists in Draynor town,
// but m48_51 (0 17 1)/(0 17 2) -> (3089,3265,0)/(3089,3266,0) sit ~6t N of Aggie
// in a fenced Draynor yard (obj.pack Logs id 1511). Closest level-0 pair to the
// paste-crafting hub. LIVE-VERIFY the yard is open (walkResilient pathable).
const LOGS_SPAWN = new Tile(3089, 3265, 0);

// --- Jailbreak geometry (research doc §5: Joe z3245 > Keli z3244 > door z3243 >
// prince z3242; unlock the door standing NORTH, z>=3244) ---
const JAIL_DOOR_NORTH = new Tile(3123, 3244, 0);
const PRINCE_TILE = new Tile(3123, 3242, 0);
const JOE_TILE = new Tile(3123, 3245, 0);

// Both wigs display "Wig" (research doc §4) — only the obj id tells plain from
// blond (quest_prince.obj: plainwig 2421, blondwig 2419). The snapshot is
// name-only, so blond-ness is checked LIVE inside wigPipeline / the jailbreak
// wig guard; decide() can only see "some wig".
const BLONDWIG_ID = 2419;

// The four disguise pieces the prince handover consumes at once (research §5.5).
const DISGUISE = ['bronze key', 'wig', 'pink skirt', 'paste'];

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const count = (snap: QuestSnapshot, name: string): number => snap.inv.get(name) ?? 0;
const packCoins = (snap: QuestSnapshot): number => snap.inv.get('coins') ?? 0;

// Probe rotation for stage-invisible gaps (Romeo & Juliet idiom): quest varps
// never reach the snapshot, so rotate harmless talks by the watchdog count.
const PROBES: NpcStop[] = [LEELA, OSMAN, HASSAN];

/** A live name->count snapshot for reusing pure gather fns (gatherBalls) inside
 *  a custom thunk. Only inv matters to those fns. */
function liveInvSnap(): QuestSnapshot {
    const inv = new Map<string, number>();
    for (const it of Inventory.items()) {
        if (it.name) {
            const key = it.name.toLowerCase();
            inv.set(key, (inv.get(key) ?? 0) + it.count);
        }
    }
    return { journal: 'inProgress', inv, worn: new Set(), noProgress: 0, bankCoins: 0 };
}

/** True once a BLOND wig (obj id) is in the pack — the only disguise-complete
 *  wig. A plain wig shares the display name, so this must be a live id read. */
function hasBlondWig(): boolean {
    const wig = Inventory.first('Wig');
    return wig !== null && wig.id === BLONDWIG_ID;
}

// --- Pure step chains --------------------------------------------------------

/** Pack short of coins for a dialogue purchase: withdraw when the bank covers it
 *  (gpShort 0), else park a wait the engine surfaces. Fixed 60gp withdraw is
 *  enough for the whole mid-quest shopping list (research doc §6: ~30-35gp). */
function coinsStep(snap: QuestSnapshot, need: number, thing: string): QuestStep {
    if (gpShort(snap, need) === 0) {
        return { kind: 'withdraw', items: [{ name: 'Coins', qty: 60 }] };
    }
    return { kind: 'wait', reason: `need ~${need} gp for ${thing}` };
}

/** Water sub-chain over a PURE snapshot: get an empty Bucket then fill it at the
 *  Well. Shared by the soft-clay (row 5) and paste (row 8) chains. */
function bucketWaterChain(snap: QuestSnapshot): QuestStep {
    if (!has(snap, 'bucket')) {
        return { kind: 'grabGround', item: 'Bucket', anchor: BUCKET_SPAWN };
    }
    return { kind: 'useOn', item: 'Bucket', targetKind: 'loc', target: 'Well', anchor: WELL, product: 'Bucket of water' };
}

/** Soft-clay chain (brief row 5): mine clay, fill a bucket, then water-on-clay
 *  (the item-on-item useOn variant this task adds). */
function softClayChain(snap: QuestSnapshot): QuestStep {
    if (!has(snap, 'clay')) {
        return { kind: 'mineRock', rock: 'Clay', item: 'Clay', qty: 1, anchor: CLAY_ROCKS };
    }
    if (!has(snap, 'bucket of water')) {
        return bucketWaterChain(snap);
    }
    // Bucket of water on Clay -> Soft clay (item-on-item; anchor unused).
    return { kind: 'useOn', item: 'Bucket of water', targetKind: 'item', target: 'Clay', anchor: WELL, product: 'Soft clay' };
}

/** Paste chain (brief row 8; research doc §3: redberries + pot_flour + ashes +
 *  one water, free at Aggie). */
function pasteChain(snap: QuestSnapshot): QuestStep {
    if (!has(snap, 'redberries')) {
        return { kind: 'buy', item: 'Redberries', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 };
    }
    if (!has(snap, 'pot of flour')) {
        return { kind: 'buy', item: 'Pot of flour', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 };
    }
    if (!has(snap, 'ashes')) {
        if (!has(snap, 'tinderbox')) {
            return { kind: 'buy', item: 'Tinderbox', qty: 1, shop: LUMBY_SHOP, estGp: 5 };
        }
        if (!has(snap, 'logs')) {
            return { kind: 'grabGround', item: 'Logs', anchor: LOGS_SPAWN };
        }
        return { kind: 'custom', name: 'burn logs for ashes', run: burnForAshes };
    }
    // Either water type satisfies Aggie (research doc §3: bucket_water OR jug_water).
    if (!has(snap, 'bucket of water') && !has(snap, 'jug of water')) {
        return bucketWaterChain(snap);
    }
    return { kind: 'talk', stop: AGGIE_PASTE };
}

// --- Custom thunks (all live reads; re-entrant, false = re-decide) ------------

/** Yellow-dye a plain wig to blond (research doc §3). Multi-leg: pick 2 onions,
 *  buy dye from Aggie (2 onions + 5 coins), then use dye on the wig. Each leg
 *  returns false to re-enter; success = a blond wig by id. */
async function dyeWigToBlond(log: (m: string) => void): Promise<boolean> {
    if (hasBlondWig()) {
        return true;
    }
    if (!Inventory.contains('Yellow dye')) {
        if (Inventory.count('Onion') < 2) {
            return executeStep({ kind: 'pickLoc', loc: 'Onion', op: 'Pick', item: 'Onion', anchor: ONION_PATCH }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for yellow dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_DYE, [], log))) {
            return false;
        }
        await talkThrough('Aggie', AGGIE_DYE.prefer, log);
        return false; // re-enter to apply the dye once it lands
    }
    const dye = Inventory.first('Yellow dye');
    const wig = Inventory.first('Wig');
    if (!dye || !wig) {
        return false;
    }
    if (!(await dye.useOn(wig))) {
        return false;
    }
    return Execution.delayUntil(() => hasBlondWig(), 8000);
}

/** Full wig pipeline (brief row 7): no wig -> 3 balls of wool (reuse sheepshearer
 *  gatherBalls) -> Ned makes a plain wig -> dye it blond. Blond wig = done.
 *  Re-entrant: one leg per call. Sustained across the plain-wig -> blond
 *  transition so a name-only decide() need only route here while a wig is
 *  absent or mid-dye (has onion/dye). */
async function wigPipeline(log: (m: string) => void): Promise<boolean> {
    if (hasBlondWig()) {
        return true;
    }
    if (!Inventory.contains('Wig')) {
        if (Inventory.count('Ball of wool') < 3) {
            // One wool-gathering leg (shear/spin/grab shears) via the shared def.
            return executeStep(gatherBalls(liveInvSnap(), 3), [], log);
        }
        if (!(await gotoNpc(NED_WIG, [], log))) {
            return false;
        }
        await talkThrough('Ned', NED_WIG.prefer, log);
        // Fall through: if the plain wig landed, start dyeing this same call so
        // the plain-wig window between decide() loops stays as small as possible.
    }
    return dyeWigToBlond(log);
}

/** Osman briefing THEN imprint the cell key at Lady Keli (research doc §2).
 *  Keli's imprint is HARD-GATED on %princequest >= ^prince_spoken_osman (stage 20,
 *  lady_keli.rs2:90); stage 20 is set ONLY by Osman's instruction dialogue
 *  (osman.rs2:48-50). From stage 10 empty-handed, imprinting first deadlocks:
 *  Keli refuses forever. So brief Osman FIRST (idempotent — a harmless status line
 *  at stage >=20), then imprint. Both legs re-entrant; any failure -> false. */
async function osmanBriefingThenImprint(log: (m: string) => void): Promise<boolean> {
    // Osman leg: advance stage 10 -> 20 so Keli's imprint gate opens. The OSMAN
    //  NpcStop prefer chain is the instruction dialogue itself.
    if (!(await gotoNpc(OSMAN, [], log))) {
        return false;
    }
    // Best-effort, NOT fatal: at stage < 20 this opens the instruction dialogue
    // and sets stage 20; at stage >= 20 (already briefed) Osman offers NO Talk-to
    // dialogue while we hold soft clay but no key print, so talkThrough returns
    // false — that must NOT bail the custom before Keli, or the bot wedges at
    // Osman forever (live 2026-07-16: stuck 3+ min at (3286,3181) after the
    // briefing already succeeded). Keli's imprint is the real success signal.
    if (!(await talkThrough('Osman', OSMAN.prefer, log))) {
        log('  Osman offered no dialogue (already briefed) — proceeding to Keli');
    }
    // Keli leg: talk the prefer chain while holding soft clay; success = a
    //  'Key print' appears.
    if (!(await gotoNpc(KELI, [], log))) {
        return false;
    }
    await talkThrough('Lady Keli', KELI.prefer, log);
    return Inventory.contains('Key print');
}

/** Burn held logs and collect the ashes (research doc §6: tinderbox on logs,
 *  fire burns 100-200 ticks then drops ashes). Assumes tinderbox + logs held
 *  (the paste chain gates on that). */
async function burnForAshes(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Ashes')) {
        return true;
    }
    const tinder = Inventory.first('Tinderbox');
    const logsItem = Inventory.first('Logs');
    if (!tinder || !logsItem) {
        log('burnForAshes: missing tinderbox or logs');
        return false;
    }
    // Light the fire (tinderbox on logs). CRITICAL: firemaking.rs2:132 spawns
    // the ashes as a GROUND OBJ on the fire tile after the burnout (100-200
    // ticks = ~60-120s), NOT into the pack — so we must Take them off the
    // ground, not wait on Inventory.contains (live 2026-07-16: the old
    // inventory-wait never fired, the log was already consumed, and each pass
    // re-lit a fresh fire forever -> park). The fire lights on our tile and we
    // step back one, so the ashes land within a couple tiles.
    if (!(await tinder.useOn(logsItem))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => GroundItems.query().name('Ashes').within(3).nearest() !== null, 150_000))) {
        log('burnForAshes: no ashes appeared after the burn');
        return false;
    }
    const ash = GroundItems.query().name('Ashes').within(3).nearest();
    if (!ash || !(await ash.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.contains('Ashes'), 5000);
}

/**
 * Jailbreak (research doc §5; brief's bespoke mechanic). Every leg re-checks
 * live state and returns false on any missing precondition so decide() re-routes.
 * Order: Leela stage-gate -> beers on Joe -> rope on Keli -> unlock the door
 * standing north -> hand the disguise to the prince.
 */
async function jailbreak(log: (m: string) => void): Promise<boolean> {
    // 0. Leela sets stage 30 (prince_prep_finished) when all 4 are held — the
    //    gate the beer step needs (joe_guard.rs2: beer only works at stage 30;
    //    research doc §5.1). Harmless/idempotent at later stages.
    if (!(await gotoNpc(LEELA, [], log))) {
        return false;
    }
    await talkThrough('Leela', LEELA.prefer, log);

    // 0b. Blond-wig backstop: a random-event interrupt can leave a plain wig
    //     that name-only decide() cannot tell from blond. The handover needs a
    //     BLOND wig, so finish the dye here before proceeding (re-enter jailbreak).
    if (!hasBlondWig()) {
        log('wig is not blond yet — completing the dye before the handover');
        return dyeWigToBlond(log);
    }

    // 1. Beers on Joe -> guard drunk (stage 40). One opnpcu with 3 beers held
    //    consumes all 3, but loop defensively (research doc §5.2: 1 then 2 more).
    if (Inventory.count('Beer') > 0) {
        if (!(await Traversal.walkResilient(JOE_TILE, { radius: 3, attempts: 2, timeoutMs: 60_000, log }))) {
            return false;
        }
        for (let i = 0; i < 3 && Inventory.count('Beer') > 0; i++) {
            const joe = Npcs.query().name('Joe').within(6).nearest();
            const beer = Inventory.first('Beer');
            if (!joe || !beer) {
                break;
            }
            await beer.useOn(joe);
            await Execution.delayTicks(3);
        }
        // Not done yet — fall through to try the rope this pass if beers are gone.
    }

    // 2. Rope on Keli -> tied (stage 50), Keli npc_del'd. Only works once the
    //    guard is drunk; a failure keeps the rope and we retry next pass.
    const keli = Npcs.query().name('Lady Keli').within(10).nearest();
    if (keli) {
        const rope = Inventory.first('Rope');
        if (rope) {
            await rope.useOn(keli);
            await Execution.delayTicks(3);
        }
        return false; // re-decide; next pass sees Keli gone if the tie took
    }

    // 3. Keli gone -> unlock the Prison Door standing NORTH (z>=3244), using the
    //    Bronze key. No item change on success ("You unlock the door").
    if (!(await Traversal.walkResilient(JAIL_DOOR_NORTH, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const key = Inventory.first('Bronze key');
    const door = Locs.query().name('Prison Door').within(6).nearest();
    if (key && door) {
        await key.useOn(door);
        await Execution.delayTicks(3);
    }

    // 4. Walk to the prince and hand over the disguise + key (stage 100). The
    //    handover consumes all 4; success = the Bronze key leaves the pack.
    if (!(await Traversal.walkResilient(PRINCE_TILE, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await talkThrough('Prince Ali', [], log);
    return !Inventory.contains('Bronze key');
}

// --- Pure quest brain --------------------------------------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: HASSAN }; }

    const all4 = DISGUISE.every(item => has(snap, item));

    // Row 1: fully equipped -> jailbreak.
    if (all4 && count(snap, 'beer') >= 3 && count(snap, 'rope') >= 2) {
        return { kind: 'custom', name: 'jailbreak', run: jailbreak };
    }

    // Row 2: equipped but short on consumables (beers x3, ropes x2 for Keli
    //        respawns — research doc §7). Buy via dialogue; self-fund from bank.
    if (all4) {
        if (count(snap, 'beer') < 3) {
            return packCoins(snap) >= 10 ? { kind: 'talk', stop: BARTENDER } : coinsStep(snap, 10, 'beer');
        }
        return packCoins(snap) >= 15 ? { kind: 'talk', stop: NED_ROPE } : coinsStep(snap, 15, 'rope');
    }

    // Row 3: hold the key imprint -> Osman forges the key (needs a Bronze bar;
    //        buy at Shantay if missing — research doc §3/§6).
    if (has(snap, 'key print')) {
        if (!has(snap, 'bronze bar')) {
            return { kind: 'buy', item: 'Bronze bar', qty: 1, shop: SHANTAY_SHOP, estGp: 60 };
        }
        return { kind: 'talk', stop: OSMAN };
    }

    // Rows 4-6: build/collect the Bronze key while lacking key + print.
    if (!has(snap, 'bronze key') && !has(snap, 'key print')) {
        if (has(snap, 'soft clay')) {
            // Keli's imprint is gated on %princequest >= stage 20 (lady_keli.rs2:90),
            // and osman.rs2:48-50 is the ONLY 10->20 advance — so the custom briefs
            // Osman BEFORE imprinting (hassan.rs2:22: "cannot proceed without
            // reporting to him"). Imprinting first would deadlock forever.
            return { kind: 'custom', name: 'osman briefing + keli imprint', run: osmanBriefingThenImprint };
        }
        // Empty-handed: the key may be made-but-uncollected (keystatus varp is
        // invisible). Probe Leela first (harmless, hands a made key); only build
        // fresh clay once Leela has stalled — this also avoids forging a SECOND
        // key print after Osman (Keli re-imprints at stage 20, which would wedge
        // row 3 forever). noProgress==0 = just progressed or fresh, so try Leela.
        if (snap.noProgress === 0) {
            return { kind: 'talk', stop: LEELA };
        }
        return softClayChain(snap);
    }

    // Row 7: no blond wig. Route here while a wig is absent, or mid-dye (onion/
    //        yellow-dye held) — the custom does the live plain-vs-blond id check.
    if (!has(snap, 'wig') || has(snap, 'yellow dye') || has(snap, 'onion')) {
        return { kind: 'custom', name: 'wig pipeline', run: wigPipeline };
    }

    // Row 8: skin paste.
    if (!has(snap, 'paste')) {
        return pasteChain(snap);
    }

    // Row 9: pink skirt (bought — research doc §6).
    if (!has(snap, 'pink skirt')) {
        return { kind: 'buy', item: 'Pink skirt', qty: 1, shop: THESSALIA_SHOP, estGp: 10 };
    }

    // Row 10: defensive dead branch. Any state reaching here holds a bronze key
    // (row 4 needs it absent) plus wig+paste+pink-skirt (rows 7-9 all satisfied),
    // i.e. all4 — which rows 1-2 already catch. Kept only so decide() is total
    // (every path returns a QuestStep) and as a belt-and-braces probe rotation.
    return { kind: 'talk', stop: PROBES[snap.noProgress % PROBES.length] };
}

export const princeali: QuestModule = {
    record: F2P.find(r => r.id === 'prince')!,
    // Every pipeline intermediate the deposit must keep (broad on purpose;
    // deposit only bites on spillover from OTHER quests). 'wig' covers both wigs.
    // 'pickaxe' is load-bearing: the soft-clay chain MINES clay, so the
    // between-quest spillover deposit must not bank the tutorial pickaxe (live
    // 2026-07-16: without it, the bot stood at the Rimmington clay rock forever
    // with no pickaxe, mineRock failing silently — same class as Doric's keep).
    tools: ['pickaxe', 'bronze key', 'key print', 'wig', 'paste', 'pink skirt', 'rope', 'beer', 'soft clay', 'clay', 'yellow dye', 'onion', 'ball of wool', 'shears', 'redberries', 'pot of flour', 'ashes', 'bucket', 'jug', 'tinderbox', 'logs', 'bronze bar', 'coins'],
    decide
};
