import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { gotoNpc, talkThrough, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Goblin Diplomacy — settle the Goblin Village generals' armour-colour feud by
// bringing them three dyed suits of goblin mail (orange, then blue, then their
// original brown). All content facts cited inline from
// ~/code/rs2b2t-content/scripts/quests/quest_gobdip/scripts/ (quest_gobdip.rs2,
// goblin_mail.rs2, gobdip_journal.rs2), the Aggie/Wyson dye sources
// (areas/area_draynor/scripts/aggie.rs2, areas/area_falador/scripts/
// wyson_the_gardener.rs2, skill_crafting/scripts/dye_cape/dye_cape.rs2), and the
// goblin drop table (drop tables/scripts/goblin.rs2). decide()/gather fns are
// PURE (snapshot-only); every live read is inside a custom thunk, matching the
// Prince Ali def's snapshot discipline.

// --- NPC stops (map-derived anchors; prefer chains verbatim from the .rs2) ---
// Start NPC: the Rusty Anchor Inn bartender in Port Sarim. Talking option
// "Not very busy in here today, is it?" runs goblin_diplomacy_start
// (bartender.rs2:18 -> quest_gobdip.rs2:13-19, sets %goblinquest = gobdip_started).
// Anchor from clues/data/talkAnchors.ts (npc 734 rustyanchor_bartender, name
// "Bartender", @ 3045,3257).
const BARTENDER: NpcStop = { npc: 'Bartender', anchor: new Tile(3045, 3257, 0), leash: 8, prefer: ['Not very busy in here today, is it?'] };

// The two generals (goblin_village.npc: general_wartface / general_bentnoze,
// both op1 Talk-to) stand together in Goblin Village, N of Falador (map label
// "Goblin Village" @ 2963,3502; the walled compound is entered via the Large
// door @ 2957,3509 already in nav/data/doors.json). Talking EITHER runs the same
// goblin_diplomacy_greet flow (general_wartface.rs2:4 / general_bentnoze.rs2:37
// -> quest_gobdip.rs2:71 greet_player_reply). Only the STAGE-1 dialogue shows a
// menu (quest_gobdip.rs2:82 p_choice3): pick "Do you want me to pick an armour
// colour for you?" (option 3) to reach gobdip_will_bring_armour. Every later
// stage auto-accepts the matching armour on a plain Talk-to (no menu), so this
// one prefer entry is harmless there (talkThrough just continues the pages).
// Anchor is (2957,3510) — a REACHABLE tile inside the compound, 1 tile S of
// General Wartface. His own tile (2957,3511) and Bentnoze's (2959,3508) are
// occupied/unwalkable, so anchoring on the general tile wedged the walker 2
// tiles short (live 2026-07-18); stand beside them and talk within leash instead.
const GENERAL: NpcStop = { npc: 'General Wartface', anchor: new Tile(2957, 3510, 0), leash: 6, prefer: ['Do you want me to pick an armour colour for you?'] };

// Aggie the Draynor witch (aggie.rs2; anchor @ 3086,3259 from the Prince Ali
// def). She mixes red/yellow/blue dyes via the [opnpc1] menu path
// (aggie.rs2:71-88): "Can you make dyes for me please?" -> "What do you need to
// make <colour> dye?" -> "Okay, make me some <colour> dye please." Each recipe
// costs 5 coins + its raw (aggie.rs2:90-130).
const AGGIE_ANCHOR = new Tile(3086, 3259, 0);
const AGGIE_RED: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make red dye?', 'Okay, make me some red dye please.'] };
const AGGIE_YELLOW: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make yellow dye?', 'Okay, make me some yellow dye please.'] };
const AGGIE_BLUE: NpcStop = { npc: 'Aggie', anchor: AGGIE_ANCHOR, leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make blue dye?', 'Okay, make me some blue dye please.'] };

// Wyson the gardener, Falador Park (wyson_the_gardener.rs2; the ONLY woad-leaf
// source in the content). "I'm looking for woad leaves." then "How about 20
// coins?" hands over 2 woad leaves for 20 coins in one go (wyson.rs2:25-36) —
// exactly what one blue dye needs. Anchor is the Park map label (3005,3379);
// LIVE-VERIFY Wyson stands within the leash of it (his exact spawn tile is not
// in the content, only the .jm2).
const WYSON: NpcStop = { npc: 'Wyson the gardener', anchor: new Tile(3013, 3377, 0), leash: 10, prefer: ["I'm looking for woad leaves.", 'How about 20 coins?'] };

// --- Gather anchors / shops --------------------------------------------------
// Goblin Village goblins (goblin_village.npc: goblin_greenarmour / _redarmour,
// both name "Goblin", op2 Attack, level 5, 12 HP). Their drop table
// (goblin.rs2:64-126 goblin_village_drop_table) yields Goblin mail at dropint
// 96-105 = 10/128 ≈ 7.8% per kill — so ~13 kills per mail, ~40 for the three.
// Farmed right here since the generals are steps away.
const GOBLIN_FARM = new Tile(2958, 3507, 0);
// Onion patch beside Fred's farm N of Lumbridge (loc 'Onion' op2 Pick,
// pickables.rs2:26; anchor from the Prince Ali def).
const ONION_PATCH = new Tile(3188, 3267, 0);
// Port Sarim general store = Wydin's Food Store (stocks Redberries; anchor from
// the Prince Ali def, npc Wydin @ 3014,3204, op3 Trade).
const PORT_SARIM_SHOP = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const qty = (snap: QuestSnapshot, name: string): number => snap.inv.get(name) ?? 0;

// --- Gather custom thunks (all live reads; re-entrant, false = re-decide) -----

/** Farm one Goblin mail off the Goblin Village goblins. Grab a dropped mail if
 *  one is on the ground (returns true = one unit collected, so provisioning
 *  re-diffs the need); otherwise land/continue a fight and return false to
 *  re-enter. No park pressure accrues on the false legs (the engine watchdog
 *  only counts ok=true steps), matching Romeo & Juliet's berry picker — the
 *  ~7.8% drop means many kills per mail. */
async function farmGoblinMail(log: (m: string) => void): Promise<boolean> {
    // 1. Grab a Goblin mail already on the ground (goblin.rs2:119 obj_add).
    const drop = GroundItems.query().name('Goblin mail').within(15).nearest();
    if (drop) {
        const before = Inventory.count('Goblin mail');
        if (!(await drop.interact('Take'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.count('Goblin mail') > before, 6000);
    }
    // 2. Mid-fight: let auto-retaliate finish the goblin, then re-decide.
    if (Game.inCombat()) {
        await Execution.delayTicks(2);
        return false;
    }
    // 3. Attack the nearest FREE goblin (skip ones already fighting someone else
    //    — crab-ownership etiquette; targetsAnotherPlayer()). Name 'Goblin' never
    //    matches the generals (General Wartface/Bentnoze), so they are safe.
    const goblin = Npcs.query().name('Goblin').action('Attack').within(15)
        .where(n => !n.inCombat && !n.targetsAnotherPlayer()).nearest();
    if (goblin) {
        if (!(await goblin.interact('Attack'))) {
            return false;
        }
        await Execution.delayUntil(() => Game.inCombat() || !goblin.valid(), 4000);
        return false;
    }
    // 4. None in range (all mid-respawn / we walked off) — home to the village.
    await Traversal.walkResilient(GOBLIN_FARM, { radius: 4, attempts: 2, timeoutMs: 90_000, log });
    return false;
}

/** Make one Blue dye: buy 2 woad leaves from Wyson (20 coins), then have Aggie
 *  mix them for 5 coins (aggie.rs2:118-130). Re-entrant; one leg per call. */
async function makeBlueDye(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Blue dye')) {
        return true;
    }
    if (Inventory.count('Woad leaf') < 2) {
        if (Inventory.count('Coins') < 20) {
            log('need ~20 coins for woad leaves');
            return false;
        }
        if (!(await gotoNpc(WYSON, [], log))) {
            return false;
        }
        await talkThrough(WYSON.npc, WYSON.prefer, log);
        return false; // re-enter once the leaves land
    }
    if (Inventory.count('Coins') < 5) {
        log('need ~5 coins for blue dye');
        return false;
    }
    if (!(await gotoNpc(AGGIE_BLUE, [], log))) {
        return false;
    }
    await talkThrough(AGGIE_BLUE.npc, AGGIE_BLUE.prefer, log);
    return Execution.delayUntil(() => Inventory.contains('Blue dye'), 8000);
}

/** Make one Orange dye: Aggie has no orange recipe, so build red dye (3
 *  redberries + 5 coins) AND yellow dye (2 onions + 5 coins), then mix them —
 *  Red dye on Yellow dye -> Orange dye (dye_cape.rs2:2-29 opheldu, craft_dyes at
 *  :127). Re-entrant; one leg per call. */
async function makeOrangeDye(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Orange dye')) {
        return true;
    }
    // Red dye leg (aggie.rs2:104-116: 3 redberries + 5 coins).
    if (!Inventory.contains('Red dye')) {
        if (Inventory.count('Redberries') < 3) {
            return executeStep({ kind: 'buy', item: 'Redberries', qty: 3, shop: PORT_SARIM_SHOP, estGp: 60 }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for red dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_RED, [], log))) {
            return false;
        }
        await talkThrough(AGGIE_RED.npc, AGGIE_RED.prefer, log);
        return false;
    }
    // Yellow dye leg (aggie.rs2:90-102: 2 onions + 5 coins).
    if (!Inventory.contains('Yellow dye')) {
        if (Inventory.count('Onion') < 2) {
            return executeStep({ kind: 'pickLoc', loc: 'Onion', op: 'Pick', item: 'Onion', anchor: ONION_PATCH }, [], log);
        }
        if (Inventory.count('Coins') < 5) {
            log('need ~5 coins for yellow dye');
            return false;
        }
        if (!(await gotoNpc(AGGIE_YELLOW, [], log))) {
            return false;
        }
        await talkThrough(AGGIE_YELLOW.npc, AGGIE_YELLOW.prefer, log);
        return false;
    }
    // Mix: Red dye on Yellow dye -> Orange dye (item-on-item; anchor unused).
    return executeStep({ kind: 'useOn', item: 'Red dye', targetKind: 'item', target: 'Yellow dye', anchor: AGGIE_ANCHOR, product: 'Orange dye' }, [], log);
}

// --- Pure quest brain --------------------------------------------------------

/**
 * Total decide(): journal (notStarted|inProgress|complete|unknown) + inventory
 * only — the five in-progress sub-stages (%goblinquest gobdip_started ->
 * will_bring_armour -> gave_orange -> gave_blue -> gave_brown) are NOT visible.
 * They don't need to be: provisioning delivers 3 Goblin mail + 1 Orange dye + 1
 * Blue dye, then this dyes two of the mail and hands armour to the generals.
 * Each hand-in is STAGE-GATED and SAFE (quest_gobdip.rs2:89-115): the general
 * accepts ONLY the colour the current stage wants and no-ops ("Come back when
 * you have some") otherwise, advancing exactly one stage per hand-in — so
 * repeatedly talking, holding all the armour, walks orange->blue->brown->done.
 */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: BARTENDER }; }

    // inProgress. Display names (quest_gobdip.obj): goblin_armour = "Goblin mail",
    // goblin_armour_orange = "Orange goblin mail", goblin_armour_darkblue =
    // "Blue goblin mail". Inventory keys are EXACT-lowercased, so plain mail
    // never collides with the dyed variants.
    const plainMail = qty(snap, 'goblin mail');
    const orangeMail = has(snap, 'orange goblin mail');
    const blueMail = has(snap, 'blue goblin mail');

    // Phase A: dye plain Goblin mail while the dye + a spare plain mail are held
    // (goblin_mail.rs2:1-12: orangedye/bluedye on goblin_armour). Order-
    // independent and re-entrant. Keep ONE plain mail for the final BROWN
    // hand-in — hence the blue leg guards on plainMail >= 2 (after orange has
    // consumed one, two remain: one for blue, one for brown).
    if (has(snap, 'orange dye') && !orangeMail && plainMail >= 1) {
        return { kind: 'useOn', item: 'Orange dye', targetKind: 'item', target: 'Goblin mail', anchor: GENERAL.anchor, product: 'Orange goblin mail' };
    }
    if (has(snap, 'blue dye') && !blueMail && plainMail >= 2) {
        return { kind: 'useOn', item: 'Blue dye', targetKind: 'item', target: 'Goblin mail', anchor: GENERAL.anchor, product: 'Blue goblin mail' };
    }

    // Phase B: hand the armour to the generals. Talking is stage-gated and safe
    // (see the doc comment) — one stage advances per successful hand-in, and the
    // stage-1 menu option is in GENERAL.prefer. Nothing else can progress the
    // quest, so this is also the total fallback for any leftover in-progress
    // state (a bare re-entry just gets a harmless "come back when you have some").
    return { kind: 'talk', stop: GENERAL };
}

export const goblindiplomacy: QuestModule = {
    record: QUESTS.find(r => r.id === 'gobdip')!,
    // Keep every quest-internal item the between-quest deposit must not bank.
    // 'goblin mail' (substring) covers plain + "Orange goblin mail" + "Blue
    // goblin mail"; 'dye' covers orange/blue/red/yellow dyes; the rest are the
    // dye-chain intermediates. record.items (Goblin mail, Orange/Blue dye) are
    // kept implicitly, but listing 'goblin mail'/'dye' keeps the CREATED
    // variants too (never record items).
    tools: ['goblin mail', 'dye', 'woad', 'redberries', 'onion', 'coins'],
    // Goblins are the quarry — surface them to the random-event guard so a
    // village goblin is never mistaken for a hostile event (the ArdyFighter
    // mechanism).
    grind: ['Goblin'],
    // Gather fns for the DECLARED raws (record.items). Bank-first provisioning
    // withdraws any banked ones first; only a true shortfall runs these.
    gather: {
        'goblin mail': () => ({ kind: 'custom', name: 'farm goblin mail', run: farmGoblinMail }),
        'orange dye': () => ({ kind: 'custom', name: 'make orange dye', run: makeOrangeDye }),
        'blue dye': () => ({ kind: 'custom', name: 'make blue dye', run: makeBlueDye })
    },
    decide
};
