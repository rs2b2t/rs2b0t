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
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Bank } from '../../api/hud/Bank.js';
import { Equipment } from '../../api/hud/Equipment.js';
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
import { QUESTS } from '../data/quests.js';
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
// Aemad's Adventuring Supplies (Ardougne East market, adventurershop; keepers
// Aemad/Kortan, op3 Trade, stocks Rope 20/100 @ ~18gp) — Rope is bought HERE with
// a plain shop Trade rather than Ned's multi-line "sell me some rope" dialogue.
const ADVENTURE_SHOP = { npc: 'Aemad', anchor: new Tile(2614, 3293, 0) };
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
// (water is now bought as a Jug of water from the Shantay Pass shop — see jugWater)
// Logs ground spawn for burnForAshes: no static Logs OBJ exists in Draynor town,
// but m48_51 (0 17 1)/(0 17 2) -> (3089,3265,0)/(3089,3266,0) sit ~6t N of Aggie
// in a fenced Draynor yard (obj.pack Logs id 1511). Closest level-0 pair to the
// paste-crafting hub. LIVE-VERIFY the yard is open (walkResilient pathable).
const LOGS_SPAWN = new Tile(3089, 3265, 0);
// Bronze-pickaxe ground spawn (obj 1265 @ m46_50 -> (2963,3216,0)) in a Rimmington
// house — cost 37 / 0 doors from the clay rocks (2986,3240), the closest of the
// world's pickaxe spawns to the soft-clay mining. Grabbed when the account holds
// no pickaxe of any tier, so a pickaxe-less start still mines instead of parking.
const PICKAXE_SPAWN = new Tile(2963, 3216, 0);

// --- Jailbreak geometry (research doc §5: Joe z3245 > Keli z3244 > door z3243 >
// prince z3242; unlock the door standing NORTH, z>=3244) ---
const JAIL_DOOR_NORTH = new Tile(3123, 3244, 0);
const PRINCE_TILE = new Tile(3123, 3242, 0);
const JOE_TILE = new Tile(3123, 3245, 0);
// A fixed jail-yard tile between Keli (3128,3244) and the cell door. The
// jailbreak anchors here BEFORE checking Keli, so "Keli within range" is read
// from a known spot — a roaming Keli momentarily >12t from a walking bot used
// to false-negative into the unlock branch at stage 30 (door still locked ->
// walker looped on the sealed cell; live 2026-07-17).
const JAIL_ANCHOR = new Tile(3126, 3245, 0);

// Both wigs display "Wig" (research doc §4) — only the obj id tells plain from
// blond (quest_prince.obj: plainwig 2421, blondwig 2419). The snapshot is
// name-only, so blond-ness is checked LIVE inside wigPipeline / the jailbreak
// wig guard; decide() can only see "some wig".
const BLONDWIG_ID = 2419;

// The four disguise pieces the prince handover consumes at once (research §5.5).
const DISGUISE = ['bronze key', 'wig', 'pink skirt', 'paste'];

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const packCoins = (snap: QuestSnapshot): number => snap.inv.get('coins') ?? 0;
/** Any pickaxe tier in the pack OR EQUIPPED — the soft-clay chain MINES clay, so
 *  it needs one but must never fetch a second when one is already worn/held
 *  (matches Doric's gatherOre gate). Tutorial accounts carry a bronze pickaxe,
 *  kept across the between-quest deposit via `tools: ['pickaxe']`. */
const hasPickaxe = (snap: QuestSnapshot): boolean => {
    for (const name of snap.inv.keys()) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    for (const name of snap.worn) {
        if (name.endsWith('pickaxe')) { return true; }
    }
    return false;
};

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

/** Emit a buy, but if pack + bank together cannot cover it (gpShort > 0) park a
 *  WAIT the engine surfaces instead — the `buy` executor self-provisions coins from
 *  the bank, but a truly broke account makes it return false forever (a "re-enter"
 *  the watchdog ignores), so a bare buy loops silently. This restores the engine's
 *  "nothing loops silently" invariant for the coins-short case (review finding). */
function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

/** Water for the soft-clay (row 5) and paste (row 8) chains: buy Jug(s) of water
 *  from the Shantay Pass shop (Jug of water, 1gp) — simpler and more reliable
 *  than grabbing a Bucket and filling it at the Rimmington well. */
function jugWater(snap: QuestSnapshot, qty: number): QuestStep {
    return buyOrWait(snap, { kind: 'buy', item: 'Jug of water', qty, shop: SHANTAY_SHOP, estGp: 5 * qty });
}

/** Soft-clay chain (brief row 5): mine clay, fill a bucket, then water-on-clay
 *  (the item-on-item useOn variant this task adds). */
function softClayChain(snap: QuestSnapshot): QuestStep {
    if (!has(snap, 'clay')) {
        if (!hasPickaxe(snap)) {
            // No pickaxe worn or held — bank-FIRST (withdraw a banked one of any
            // tier), else grab the spawned Bronze pickaxe near the clay rocks.
            return { kind: 'custom', name: 'get a pickaxe', run: ensurePickaxe };
        }
        return { kind: 'mineRock', rock: 'Clay', item: 'Clay', qty: 1, anchor: CLAY_ROCKS };
    }
    if (!has(snap, 'jug of water')) {
        return jugWater(snap, 2); // one for the soft clay, one left for the paste
    }
    // Jug of water on Clay -> Soft clay (item-on-item; anchor unused). Leaves an
    // empty jug + a second jug of water the paste chain reuses.
    return { kind: 'useOn', item: 'Jug of water', targetKind: 'item', target: 'Clay', anchor: CLAY_ROCKS, product: 'Soft clay' };
}

/** Paste chain (brief row 8; research doc §3: redberries + pot_flour + ashes +
 *  one water, free at Aggie). */
function pasteChain(snap: QuestSnapshot): QuestStep {
    if (!has(snap, 'redberries')) {
        return buyOrWait(snap, { kind: 'buy', item: 'Redberries', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 });
    }
    if (!has(snap, 'pot of flour')) {
        return buyOrWait(snap, { kind: 'buy', item: 'Pot of flour', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 });
    }
    if (!has(snap, 'ashes')) {
        if (!has(snap, 'tinderbox')) {
            return buyOrWait(snap, { kind: 'buy', item: 'Tinderbox', qty: 1, shop: LUMBY_SHOP, estGp: 5 });
        }
        if (!has(snap, 'logs')) {
            return { kind: 'grabGround', item: 'Logs', anchor: LOGS_SPAWN };
        }
        return { kind: 'custom', name: 'burn logs for ashes', run: burnForAshes };
    }
    // Either water type satisfies Aggie (research doc §3: bucket_water OR jug_water).
    if (!has(snap, 'bucket of water') && !has(snap, 'jug of water')) {
        return jugWater(snap, 1);
    }
    return { kind: 'talk', stop: AGGIE_PASTE };
}

// --- Custom thunks (all live reads; re-entrant, false = re-decide) ------------

/** Get a pickaxe to mine the soft-clay chain's clay. Any tier worn/held short-
 *  circuits (belt to hasPickaxe). Otherwise scan the BANK first — withdraw a
 *  banked pickaxe of any tier rather than fetching a fresh one — and only grab
 *  the Rimmington Bronze pickaxe spawn when the bank has none. */
async function ensurePickaxe(log: (m: string) => void): Promise<boolean> {
    const isPick = (n: string | null | undefined): boolean => (n ?? '').toLowerCase().endsWith('pickaxe');
    if (Equipment.items().some(i => isPick(i.name)) || Inventory.items().some(i => isPick(i.name))) {
        return true;
    }
    if (await Bank.openNearest('Bank booth', 'Use-quickly', log)) {
        const banked = Bank.items().find(i => isPick(i.name));
        if (banked?.name) {
            log(`withdrawing ${banked.name} from the bank`);
            if (await Bank.withdrawX(banked.name, 1)) {
                return Execution.delayUntil(() => Inventory.items().some(i => isPick(i.name)), 3000);
            }
        }
    }
    return executeStep({ kind: 'grabGround', item: 'Bronze pickaxe', anchor: PICKAXE_SPAWN }, [], log);
}

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

    // KELI PHASE — everything up to and including the tie, gated on Keli being
    // present. Once she's tied she is npc_del'd (gone), so this whole block is
    // skipped and we fall through to the unlock/handover below. decide() enters
    // the jailbreak on all-4-held ALONE (it cannot see Keli or the drunk varp),
    // so the beers + rope are (re)acquired HERE, only when the live world proves
    // they're needed — otherwise the bot bounced off to re-buy beers it had
    // already drunk (live 2026-07-17: guard drunk + Keli tied, then walked to
    // Varrock to buy 3 more beers).
    // Anchor at the jail yard FIRST so the Keli check is from a fixed spot
    // (a roaming Keli false-negatived a walking bot into the unlock branch).
    if (!(await Traversal.walkResilient(JAIL_ANCHOR, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const keli = Npcs.query().name('Lady Keli').within(8).nearest();
    // `tied` gates the fall-through: a SUCCESSFUL tie must flow straight into the
    // unlock+handover WITHIN THIS SAME PASS. Returning to decide() between the tie
    // and the door lets Keli RESPAWN (her spawn is ~5t from the door, inside the
    // unlock's "no Keli within 10" check, quest_prince.rs2:38) before we reach it,
    // so the unlock bails "get rid of Keli" forever (live 2026-07-17: tied at t=72s,
    // detoured to re-buy beers, unlock never took). Race the respawn contiguously.
    let tied = false;
    if (keli) {
        // 1. Try the tie FIRST — it works iff the guard is already drunk, and is
        //    a harmless no-op mesbox otherwise (quest_prince.rs2:23-25, rope kept).
        //    This avoids buying/drinking beers when the guard is already drunk.
        const rope = Inventory.first('Rope');
        if (rope) {
            await rope.useOn(keli);
            // The tie either npc_del's Keli (success) or opens a "You cannot tie
            // Keli up..." mesbox (guard not drunk, quest_prince.rs2:24). DRIVE
            // that mesbox closed — a leftover open dialog would block the beer
            // useOn below (live 2026-07-17: stuck at Keli, beers never drunk).
            await Execution.delayUntil(() => ChatDialog.canContinue() || !Npcs.query().name('Lady Keli').within(12).nearest(), 4000);
            for (let i = 0; i < 8 && ChatDialog.canContinue(); i++) {
                await ChatDialog.continue();
                await Execution.delayTicks(1);
            }
            tied = !Npcs.query().name('Lady Keli').within(12).nearest();
        }
        if (!tied) {
            // 2. Tie didn't take (guard not drunk). Rope is provisioned up front;
            //    this only fires if it was consumed/lost — re-buy from Aemad's
            //    (Ardougne, plain shop Trade), not Ned's dialogue.
            if (Inventory.count('Rope') < 1) {
                await executeStep({ kind: 'buy', item: 'Rope', qty: 1, shop: ADVENTURE_SHOP, estGp: 40 }, [], log);
                return false;
            }
            // 3. Accumulate 3 beers (bartender, 1/pass) then drink them on Joe.
            //    joe_beer is a ~10-page conversation mixing ~chatnpc (chat modal)
            //    and ~mesbox "You hand a beer..." (MAIN modal), so it MUST be driven
            //    on canContinue() — isOpen() only sees the chat modal and stalls on
            //    the mesbox pages (live 2026-07-17). ContinueDialog can't help: this
            //    custom runs inside the QuestEngine task, so no sibling task gets a
            //    turn mid-await.
            if (Inventory.count('Beer') < 3) {
                if (!(await gotoNpc(BARTENDER, [], log))) {
                    return false;
                }
                await talkThrough('Bartender', BARTENDER.prefer, log);
                return false;
            }
            if (!(await Traversal.walkResilient(JOE_TILE, { radius: 3, attempts: 2, timeoutMs: 60_000, log }))) {
                return false;
            }
            const joe = Npcs.query().name('Joe').within(6).nearest();
            // Feed ALL held beers in this ONE visit (each is a full joe_beer dialogue).
            // Feeding one-per-pass cost a Blue Moon round-trip between each (review
            // finding) — drunkenness accrues server-side, so 3 in a row gets him drunk.
            for (let fed = 0; joe && fed < 3 && Inventory.count('Beer') > 0; fed++) {
                const beer = Inventory.first('Beer');
                if (!beer || !(await beer.useOn(joe))) {
                    break;
                }
                await Execution.delayUntil(() => ChatDialog.canContinue(), 5000);
                for (let i = 0; i < 40 && (ChatDialog.canContinue() || ChatDialog.options().length > 0); i++) {
                    if (ChatDialog.canContinue()) {
                        await ChatDialog.continue();
                    } else {
                        const opts = ChatDialog.options();
                        await ChatDialog.chooseOption(opts[opts.length - 1]);
                    }
                    await Execution.delayTicks(1);
                }
            }
            return false; // next pass: guard drunk, the tie above takes
        }
        // tied === true: fall through to the unlock immediately (same pass).
    }

    // 4. Keli tied/gone -> unlock the Prison Door standing NORTH (z>=3244) with the
    //    Bronze key. Success ("You unlock the door") p_teleports us onto the door
    //    tile (open_and_close_metal_gate2), one tile north of the prince — the key
    //    is NOT consumed here (quest_prince.rs2:34-44).
    if (!(await Traversal.walkResilient(JAIL_DOOR_NORTH, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const key = Inventory.first('Bronze key');
    const door = Locs.query().name('Prison Door').within(6).nearest();
    if (key && door) {
        await key.useOn(door);
        await Execution.delayUntil(() => Game.tile()?.z !== undefined && (Game.tile()?.z ?? 9999) <= 3243, 4000);
    }

    // 5. Walk to the prince and hand over the disguise + key (prince_ali.rs2:11-18,
    //    stage -> prince_saved). The handover consumes all 4; success = the Bronze
    //    key leaves the pack. If it's still held the unlock was blocked (Keli
    //    respawned) — re-decide and re-run the whole jailbreak.
    if (!(await Traversal.walkResilient(PRINCE_TILE, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await talkThrough('Prince Ali', [], log);
    // Drive the trailing handover mesbox pages ("The prince has escaped, well
    // done!") so no leftover main modal blocks the walk to Hassan below.
    for (let i = 0; i < 6 && ChatDialog.canContinue(); i++) {
        await ChatDialog.continue();
        await Execution.delayTicks(1);
    }
    if (Inventory.contains('Bronze key')) {
        return false;
    }

    // 6. Prince freed (stage prince_saved) — the quest is NOT complete until we
    //    RETURN TO HASSAN in Al-Kharid Palace to claim the reward: talking to him
    //    at prince_saved queues prince_complete (hassan.rs2:24-26 -> +coins, quest
    //    done). Without this leg decide() sees the disguise consumed, reads journal
    //    still 'inProgress', and restarts the key pipeline (live 2026-07-17: freed
    //    the prince then walked off to Rimmington to re-make a Bronze key).
    if (!(await gotoNpc(HASSAN, [], log))) {
        return false;
    }
    await talkThrough('Hassan', [], log);
    return true;
}

// --- Pure quest brain --------------------------------------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: HASSAN }; }

    const all4 = DISGUISE.every(item => has(snap, item));

    // Row 1: disguise complete -> COMMIT to the jailbreak. The custom self-
    //        provisions beers/rope and sequences drink->tie->unlock->handover
    //        off the LIVE world (Keli's presence, the drunk varp) — none of which
    //        the pure snapshot can see. A beer/rope gate here bounced the bot off
    //        to re-buy beers after it had already drunk them and tied Keli (live
    //        2026-07-17). The jailbreak needs coins in the pack for the beer/rope
    //        buys, so top up from the bank first while short.
    if (all4) {
        if (packCoins(snap) < 30 && gpShort(snap, 30) === 0) {
            return { kind: 'withdraw', items: [{ name: 'Coins', qty: 40 }] };
        }
        return { kind: 'custom', name: 'jailbreak', run: jailbreak };
    }

    // Row 3: hold the key imprint -> Osman forges the key (needs a Bronze bar;
    //        buy at Shantay if missing — research doc §3/§6).
    if (has(snap, 'key print')) {
        if (!has(snap, 'bronze bar')) {
            return buyOrWait(snap, { kind: 'buy', item: 'Bronze bar', qty: 1, shop: SHANTAY_SHOP, estGp: 60 });
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
        // Mid clay-build (any intermediate held) -> stay in the chain. Each chain
        // step changes inventory and RESETS noProgress to 0, so gating the Leela
        // probe on noProgress alone re-probed Leela — a full Draynor round-trip —
        // between every clay step (review finding). Only probe Leela on a genuinely
        // empty pack.
        const midClayBuild = has(snap, 'clay') || has(snap, 'jug of water');
        // POST-forge probe ONLY (Bronze bar consumed by Osman's forge): the finished
        // key waits at LEELA — collect it rather than rebuilding clay and forging a
        // second print. PRE-forge (still holding the Bronze bar) we do NOT pre-brief
        // Osman here: the 'osman briefing + keli imprint' custom briefs him inline
        // once soft clay is held (osman.rs2:48-50 is the stage-10->20 advance Keli's
        // imprint gate needs), so a separate noProgress-gated Osman probe is redundant
        // AND self-defeating. Talking an already-briefed Osman is a no-op that bumps
        // noProgress; the long Rimmington mining walk then resets noProgress to 0,
        // re-firing the probe — the bot oscillates Al Kharid <-> Rimmington forever,
        // never reaching the clay (live 2026-07-18 diag: 13 min in, 0 clay mined). So
        // pre-forge falls straight through to the clay build; probe Leela only, and
        // only post-forge.
        if (!midClayBuild && !has(snap, 'bronze bar') && snap.noProgress === 0) {
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
        return buyOrWait(snap, { kind: 'buy', item: 'Pink skirt', qty: 1, shop: THESSALIA_SHOP, estGp: 10 });
    }

    // Row 10: defensive dead branch. Any state reaching here holds a bronze key
    // (row 4 needs it absent) plus wig+paste+pink-skirt (rows 7-9 all satisfied),
    // i.e. all4 — which rows 1-2 already catch. Kept only so decide() is total
    // (every path returns a QuestStep) and as a belt-and-braces probe rotation.
    return { kind: 'talk', stop: PROBES[snap.noProgress % PROBES.length] };
}

export const princeali: QuestModule = {
    record: QUESTS.find(r => r.id === 'prince')!,
    // Every pipeline intermediate the deposit must keep (broad on purpose;
    // deposit only bites on spillover from OTHER quests). 'wig' covers both wigs.
    // 'pickaxe' is load-bearing: the soft-clay chain MINES clay, so the
    // between-quest spillover deposit must not bank the tutorial pickaxe (live
    // 2026-07-16: without it, the bot stood at the Rimmington clay rock forever
    // with no pickaxe, mineRock failing silently — same class as Doric's keep).
    tools: ['pickaxe', 'bronze key', 'key print', 'wig', 'paste', 'pink skirt', 'rope', 'beer', 'soft clay', 'clay', 'yellow dye', 'onion', 'ball of wool', 'shears', 'redberries', 'pot of flour', 'ashes', 'bucket', 'jug', 'tinderbox', 'logs', 'bronze bar', 'coins'],
    // Gather fns for the DECLARED raws (record.items above) — cheap one-shop-trip
    // buyables, provisioned BANK-FIRST at quest start. The tightly-consumed / slow
    // raws (clay, onion, logs, ball of wool, jug of water) are NOT declared — the
    // decide() sub-chains gather them just-in-time, so provisioning doesn't
    // criss-cross the map before the quest starts.
    gather: {
        'redberries': s => buyOrWait(s, { kind: 'buy', item: 'Redberries', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 }),
        'pot of flour': s => buyOrWait(s, { kind: 'buy', item: 'Pot of flour', qty: 1, shop: PORT_SARIM_SHOP, estGp: 20 }),
        'tinderbox': s => buyOrWait(s, { kind: 'buy', item: 'Tinderbox', qty: 1, shop: LUMBY_SHOP, estGp: 5 }),
        'bronze bar': s => buyOrWait(s, { kind: 'buy', item: 'Bronze bar', qty: 1, shop: SHANTAY_SHOP, estGp: 60 }),
        'pink skirt': s => buyOrWait(s, { kind: 'buy', item: 'Pink skirt', qty: 1, shop: THESSALIA_SHOP, estGp: 10 }),
        'rope': s => buyOrWait(s, { kind: 'buy', item: 'Rope', qty: 1, shop: ADVENTURE_SHOP, estGp: 40 })
    },
    decide
};
