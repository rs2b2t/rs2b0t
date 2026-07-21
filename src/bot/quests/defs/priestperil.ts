import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import Tile from '../../api/Tile.js';
import { inEssMine } from '../../scripts/EssMinerLogic.js';
import { driveDialog, gotoNpc, isUnderground, talkThrough, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

// Priest in Peril — content facts traced from ~/code/rs2b2t-content (cited
// inline as file:line): scripts/quests/quest_priestperil/*, scripts/areas/
// area_mausoleum/scripts/*, scripts/areas/area_varrock/scripts/king_roald.rs2.
// Coordinates are map-derived (maps/m53_54.jm2 + m53_154.jm2 NPC/LOC sections
// decoded to absolute tiles), ids from pack/{npc,obj}.pack.
//
// FLOW (varp `priestperil`, INVISIBLE to the snapshot — only journal colour +
// inventory + world probes reach decide()):
//   0  notStarted        -> talk King Roald, "Sure." starts it (king_roald.rs2:52-60)
//   1  started           -> Knock-at the temple door, agree to kill the dog
//                           (temple_doors.rs2:24-33 -> :92-97 sets 2)
//   2  agree_to_kill_dog -> kill the Temple guardian in the crypt — attackable
//                           ONLY at this stage (temple_guardian.rs2:16-24);
//                           the death hook sets 3 (:1-13)
//   3  killed_dog        -> talk Roald; his tirade SETS 4 (king_roald.rs2:76-88)
//   4  return_to_drezel  -> temple front door now opens (temple_doors.rs2:9-16);
//                           Talk-through the cell door, "Tell me anyway." + "Yes."
//                           sets 5 (trapped_drezel.rs2:76-142)
//   5  find_drezel_key   -> Gate 1 opens (gates.rs2:1-13); kill Monk of Zamorak
//                           id 1046 — the ONLY variant whose death drops the
//                           Golden key, and only while stage < 6 (evil_monks.rs2:44-49);
//                           swap it at a Monument for the Iron key (monuments.rs2:64-77)
//   6  unlocked_drezel   -> Iron key used on the cell door, key consumed
//                           (trapped_drezel.rs2:47-58); water chain: Bucket on the
//                           Well -> murky (well.rs2:9-16), murky on Drezel ->
//                           blessed (trapped_drezel.rs2:145-152)
//   7  poured            -> blessed on the Coffin (vampire_coffin.rs2:10-19);
//                           talk cell Drezel -> 8 (trapped_drezel.rs2:22-27)
//   8  meet_in_mausoleum -> Gate 2 opens (gates.rs2:4-13); talk mausoleum Drezel
//                           (a SECOND "Drezel" npc, id 1049) -> 10 (drezel.rs2:22-47)
//   10..59 bring_essence -> talking while holding UNNOTED Rune essence hands ALL
//                           of it, +1 varp each (drezel.rs2:96-118); noted rejected (:89-94)
//   60 complete          -> Wolfbane + 1406 Prayer xp (priestperil.rs2:8-11); one
//                           more talk with Wolfbane held sets 61 = holy-barrier
//                           access to Morytania (drezel.rs2:137-152)
//
// STAGE ORACLES (varps never reach the client): temple front door OPENS at >=4,
// Gate 1 at >=5, cell door at >=6, Gate 2 at >=8 — probed via tryOpen(). The
// murky/blessed name collision ("Bucket of water" for both, priestperil.obj)
// forces obj-id reads, the Demon Slayer key pattern.

// --- Obj/npc ids (pack/obj.pack, pack/npc.pack) --------------------------------
const GOLDEN_KEY_ID = 2944;  // pipkey_gold "Golden key"
const IRON_KEY_ID = 2945;    // pipkey_iron "Iron key"
const MURKY_ID = 2953;       // bucket_murkywater — displays "Bucket of water"
const BLESSED_ID = 2954;     // bucket_blessedwater — displays "Bucket of water"
const MONK3_NPC_ID = 1046;   // priestperilevilmonk3, the lvl-30 key-dropper

// --- NPC stops -----------------------------------------------------------------
// King Roald — Varrock palace ground floor, m50_54 "0 22 20: 648" -> (3222,3476,0).
// notStarted multi2's LAST option is "No, that sounds boring." (abandon), so the
// prefer MUST match "Sure." (king_roald.rs2:59); every other stage branch is
// option-free and just plays through.
const ROALD: NpcStop = { npc: 'King Roald', anchor: new Tile(3222, 3476, 0), leash: 6, prefer: ['Sure.'] };
// Cell Drezel (priestperiltrappedmonk) — temple LEVEL 2, m53_54 "2 25 33: 1048"
// -> (3417,3489,2), wanders the cell (range 5). Reached via the baked spiral
// stairs (3417,3484 L0->L1) + ladder (3410,3485 L1->L2); his talks are option-free.
const DREZEL_CELL: NpcStop = { npc: 'Drezel', anchor: new Tile(3416, 3489, 2), leash: 3, prefer: [] };
// Mausoleum Drezel (priestperiltrappedmonk2) — m53_154 "0 48 39: 1049" ->
// (3440,9895,0), behind Gate 2; wander range 1. Option-free dialogues.
const DREZEL_MAUS: NpcStop = { npc: 'Drezel', anchor: new Tile(3439, 9895, 0), leash: 4, prefer: [] };

// --- Tiles (map-derived) ---------------------------------------------------------
const TEMPLE_DOOR = new Tile(3408, 3488, 0);      // Large door leaves (3408,3488)+(3408,3489), west face
const TEMPLE_DOOR_OUT = new Tile(3406, 3488, 0);  // exterior stand west of the doors
const TEMPLE_LOBBY = new Tile(3412, 3487, 0);     // ground floor, monk-3 spawns (3411,3489)/(3415,3485)
const DOG_TILE = new Tile(3405, 9902, 0);         // Temple guardian spawn, m53_154 "0 13 46: 1047"
const GATE1 = new Tile(3405, 9895, 0);            // pip_underground_door1, opens at stage >= 5
const GATE2 = new Tile(3431, 9897, 0);            // pip_underground_door2, opens at stage >= 8
// The Well (priestperil_well, 3423,9890, no ops — use-item only) is a blocked
// CENTREPIECE ringed by priestperil_well_coloumn locs, so walking AT it aims at
// an unreachable tile. Stand on this free, pathable neighbour (directly south,
// baked cost 47 from the crypt) and use-item the Bucket across (found within 6).
const WELL_STAND = new Tile(3423, 9889, 0);
const CELL_DOOR = new Tile(3415, 3489, 2);        // pip_prisondoor, temple L2
const CELL_DOOR_STAND = new Tile(3414, 3489, 2);  // outside-the-cell stand beside the door
const COFFIN = new Tile(3413, 3486, 2);           // priestperil_coffin_noanim, L2
const AUBURY_TILE = new Tile(3253, 3402, 0);      // Aubury's rune shop (EssMiner.ts:45)
const VARROCK_EAST_BANK = new Tile(3253, 3420, 0); // essence-run bank (EssMiner's bank)
// Varrock general store (the Demon Slayer bucket shop, demonslayer.ts:147-149).
const VARROCK_GENERAL = { npc: 'Shop keeper', anchor: new Tile(3218, 3414, 0) };

// The 7 Monuments (m53_154 LOC section; probe-verified 2026-07-20). Try order
// starts at grave_base3 (3428,9890): with the layout NEVER Studied the seed bits
// are 0 and content_id(grave) = (grave*17 % 7)+1 puts the Iron key (content 3,
// monument_graves_models) at grave 3. The full loop is seed-proof anyway —
// exactly one grave swaps for ANY seed (17 ≡ 3 mod 7, coprime), wrong graves
// no-op (monuments.rs2:64-77 falls through to displaymessage).
const MONUMENTS: Tile[] = [
    new Tile(3428, 9890, 0), // grave_base3 — the un-Studied-layout key grave
    new Tile(3416, 9890, 0), // grave_base1
    new Tile(3423, 9895, 0), // grave_base2
    new Tile(3423, 9884, 0), // grave_base4
    new Tile(3427, 9894, 0), // grave_base5
    new Tile(3427, 9885, 0), // grave_base6
    new Tile(3418, 9894, 0)  // grave_base7
];

// Surface <-> crypt crossings. The north trapdoor (3405,3507) is Open ->
// Climb-down (+6400 telejump, trapdoors.rs2:2-12) and re-closes ~500 ticks
// after opening — hence `open`. The exit is a plain cellar ladder
// (ladders.rs2:87-94, -6400).
const HOPS: LadderHop[] = [
    { stand: new Tile(3405, 3506, 0), locName: 'Trapdoor', op: 'Climb-down', open: 'Open', arrive: new Tile(3405, 9907, 0) },
    { stand: new Tile(3405, 9907, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3405, 3507, 0) }
];

// Knock-at chain (temple_doors.rs2:24-33): multi4 -> "Roald sent me to check on
// Drezel." -> multi2 -> "Sure." sets stage 2 (:92-97). Fallbacks are safe
// declines, but only the prefers advance.
const KNOCK_PREFER = ['Roald sent me to check on Drezel.', 'Sure.'];
// Cell-door Talk-through story (trapped_drezel.rs2:76-142): "Tell me anyway."
// then "Yes." set stage 5 via drezel_yes_of_course (:120-133).
const CELL_STORY_PREFER = ['Tell me anyway.', 'Yes.'];

const QUEST_NAME = 'Priest in Peril';
const ESSENCE_NEEDED = 50; // ^priestperil_end_bring_essence(60) - begin(10)

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
/** Live pack check by OBJ ID — the only way to tell murky from blessed water
 *  (name-collided) or confirm a specific key. Pack-only; none are wearable. */
const heldId = (id: number): boolean => Inventory.items().some(i => i.id === id);
const freeSlots = (): number => 28 - Inventory.items().length;
const journalComplete = (): boolean => Quests.status(QUEST_NAME) === 'complete';

/** walkWithHops with this quest's hops baked in. */
async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    return walkWithHops(dest, radius, HOPS, log);
}

/** Reach an NPC stop with walkTo(radius 2) + talkThrough, NOT gotoNpc. Both
 *  Drezels stand in tight pockets (the cell is a 1-tile cell; the mausoleum
 *  Drezel sits in a walled alcove) where an NPC standing ON the anchor makes
 *  gotoNpc's radius-1 approach loop forever ('deviated ... repathing', live
 *  2026-07-20). walkTo within 2 + talkThrough lets the server auto-walk the
 *  final step onto him — the same reach the murky-bless useOn already relies on.
 *  (gotoNpc stays for FAR stops like Roald, which need its staged approach.) */
async function reachAndTalk(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stop.anchor, 2, log))) {
        return false;
    }
    return talkThrough(stop.npc, stop.prefer, log);
}

/**
 * Probe-and-open a stage-gated leaf near `near` (level-aware): walk up, and if a
 * closed leaf (one still offering 'Open') is there, open it and wait for the
 * closed leaf to vanish. TRUE = no closed leaf remains (either already open or
 * we just opened it) — i.e. the stage gate is PASSED. FALSE = still closed
 * after the attempt (the server printed its locked mes) or the walk failed.
 * Side-effect-free when locked, so it doubles as the stage oracle. Also needed
 * because the baked pack records these quest doors as walkable (no door edges),
 * so walkResilient alone would wedge on the live closed leaf.
 */
async function tryOpen(name: string, near: Tile, log: (m: string) => void): Promise<boolean> {
    // Match the closed leaf by name + Open + 2D proximity ONLY. Do NOT filter on
    // l.tile().level: Tile.distanceTo is x/z-only, and the temple/Salve locs can
    // report a BRIDGED level ≠ the stand's — a strict level filter then dropped
    // the still-closed front door, tryOpen wrongly reported "open", and the spine
    // walked into the server-locked door forever (live 2026-07-20, aqpip2). The
    // x/z window is unique per door here (no same-tile door on another floor).
    const closed = () => Locs.query().name(name).action('Open')
        .where(l => l.tile().distanceTo(near) <= 2).nearest();
    const here = Game.tile();
    if (here && here.level === near.level && near.distanceTo(here) <= 10 && closed() === null) {
        return true; // in view and no closed leaf — already open
    }
    if (!(await walkTo(near, 3, log))) {
        return false;
    }
    const leaf = closed();
    if (!leaf) {
        return true;
    }
    if (!(await leaf.interact('Open'))) {
        return false;
    }
    // Locked leaves (temple door / gates before their stage) keep offering Open
    // and never change — the delayUntil times out and we honestly report FALSE.
    return Execution.delayUntil(() => closed() === null, 4000);
}

/** Attack a target npc and wait for its death (scene-slot despawn), the
 *  grindBones/Witch's House kill idiom. FALSE also covers "the server refused
 *  the attack" (stage-gated dog) — combat never started within 5s. */
async function killTarget(npc: { index: number; interact(op: string): boolean | Promise<boolean> }, name: RegExp): Promise<boolean> {
    const idx = npc.index;
    if (!(await npc.interact('Attack'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Game.inCombat(), 5000))) {
        return false; // refused (stage gate) or click lost — caller re-decides
    }
    return Execution.delayUntil(() => !Npcs.all().some(n => n.index === idx && name.test(n.name ?? '')), 90_000);
}

// --- Legs (re-entrant customs; false = re-enter; all live reads inside) --------

/**
 * Stages 1-3, entered when the temple front door refuses to open. One pass
 * covers the whole early chain on a fresh start: knock+agree (1->2), kill the
 * dog (2->3), report to Roald (3->4). Every piece is idempotent at the other
 * stages (temple_doors.rs2 re-knock branches are flavour; Roald at 2 just
 * encourages), so a restart anywhere in 1..3 self-heals.
 */
async function earlyLeg(log: (m: string) => void): Promise<boolean> {
    log('priestperil: early phase — knock, dog, Roald');
    // 1. Knock-at + drive the agree chain (loc-initiated dialog -> driveDialog).
    if (!(await walkTo(TEMPLE_DOOR_OUT, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Large door').action('Knock-at').within(6).nearest();
    if (door && (await door.interact('Knock-at'))) {
        if (await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 5000)) {
            log('priestperil: knock dialogue open — driving agree chain');
            await driveDialog(KNOCK_PREFER, log);
        }
    }
    // 2. The dog — attackable ONLY at stage 2 (temple_guardian.rs2:16-24); a
    //    refusal (no combat within 5s) just falls through to Roald.
    if (!(await walkTo(DOG_TILE, 8, log))) {
        return false;
    }
    const dog = Npcs.query().name('Temple guardian').action('Attack').within(12).nearest();
    if (dog) {
        log('priestperil: attacking Temple guardian');
        await killTarget(dog, /temple guardian/i);
    }
    // 3. Roald: at stage 3 his tirade SETS 4 (king_roald.rs2:76-88); harmless at 2.
    if (!(await gotoNpc(ROALD, HOPS, log))) {
        return false;
    }
    log('priestperil: reporting to King Roald');
    await talkThrough('King Roald', ROALD.prefer, log);
    return false; // re-probe the temple door next pass
}

/**
 * Stage 4->5: Talk-through the cell door and drive Drezel's story (the "Tell me
 * anyway." + "Yes." chain sets find_drezel_key, trapped_drezel.rs2:76-142). At
 * stage 5 the same op is a short idempotent hint (:60-74).
 */
async function cellStoryLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(CELL_DOOR_STAND, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Cell door').action('Talk-through').within(5).nearest();
    if (!door) {
        log('priestperil: no Cell door offering Talk-through at the cell');
        return false;
    }
    if (!(await door.interact('Talk-through'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 5000))) {
        return false;
    }
    return driveDialog(CELL_STORY_PREFER, log);
}

/**
 * Stage 5 monk hunt: only npc id 1046 drops the Golden key (evil_monks.rs2:44-49
 * — the other two "Monk of Zamorak" variants share the name but never drop it),
 * and only while stage < 6. Loot-first so a ~3-min floor despawn can't eat a
 * key we already earned.
 */
async function monkHuntLeg(log: (m: string) => void): Promise<boolean> {
    // Descend to the L0 lobby FIRST: the monks (ids at L0/L1) and the dropped key
    // all live on L0, and both the ground-item and NPC queries are level-aware,
    // so a check from the L2 cell (where the spine's cell-door probe leaves us)
    // finds nothing. walkTo is now level-aware (walkWithHops fix, 2026-07-20).
    if (!(await walkTo(TEMPLE_LOBBY, 3, log))) {
        return false;
    }
    // Loot a dropped Golden key before re-engaging (it lasts ~3 min on the floor).
    const drop = GroundItems.query().name('Golden key').within(16).nearest();
    if (drop) {
        if (!(await drop.interact('Take'))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(GOLDEN_KEY_ID), 6000);
        return false; // decide() re-routes to the monument swap
    }
    const monk = Npcs.query().where(n => n.id === MONK3_NPC_ID).action('Attack').within(14).nearest();
    if (!monk) {
        log('priestperil: no key-dropping Monk of Zamorak (id 1046) in the temple — waiting on respawn');
        await Execution.delayTicks(4);
        return false;
    }
    log('priestperil: attacking Monk of Zamorak (id 1046) for the golden key');
    await killTarget(monk, /monk of zamorak/i);
    return false; // next pass loots the drop
}

/**
 * The stage-locating spine (decide()'s default): probes the stage oracles from
 * wherever the bot is and drives the phase they reveal. Probe order is
 * position-aware so restarts don't ping-pong across the map.
 */
async function spineLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }

    if (isUnderground(here)) {
        // Dog first — it lives right at the crypt landing.
        const dog = Npcs.query().name('Temple guardian').action('Attack').within(20).nearest();
        if (dog) {
            if (!(await walkTo(DOG_TILE, 6, log))) {
                return false;
            }
            const d = Npcs.query().name('Temple guardian').action('Attack').within(12).nearest();
            if (d && (await killTarget(d, /temple guardian/i))) {
                // Dead -> stage 3; report to Roald in the same pass (3->4).
                if (!(await gotoNpc(ROALD, HOPS, log))) {
                    return false;
                }
                await talkThrough('King Roald', ROALD.prefer, log);
                return false;
            }
            // refusal: not stage 2 — fall through to the gate probes
        }
        // Gate 1 (>=5) then Gate 2 (>=8) — Gate 1 MUST be probed first: the
        // baked pack walks straight through its wall, so a Gate-2 walk from
        // here would wedge on the live closed Gate 1.
        if (await tryOpen('Gate', GATE1, log)) {
            if (await tryOpen('Gate', GATE2, log)) {
                return essenceLeg(log);
            }
        }
        // Underground with no underground work left -> surface phases pending.
        await walkTo(TEMPLE_DOOR_OUT, 3, log);
        return false;
    }

    // Surface. Temple front door opening = stage >= 4 (temple_doors.rs2:9-16).
    if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
        log('priestperil: temple door locked (stage < 4) — early phase');
        return earlyLeg(log);
    }
    log('priestperil: temple door open (stage >= 4)');
    // Stage >= 4. Cell door opening = stage >= 6 -> water chain / essence.
    if (await tryOpen('Cell door', CELL_DOOR, log)) {
        return waterLeg(log);
    }
    // Stage 4..5: hunt the key monk at L0 (the golden key drops at stage < 6,
    // evil_monks.rs2:45). We do NOT drive the cell story here: holding the golden
    // key routes decide() -> monumentLeg, which opens Gate 1 and, when it's still
    // locked (stage 4 -> needs 5), drives the cell story itself. That keeps this
    // pass on L0 (no wasteful L2 climb just to re-tell the story every loop).
    return monkHuntLeg(log);
}

/**
 * Golden key held: swap it for the Iron key at the one monument that takes it.
 * Guard: the key can drop at stage 4 (the drop gate is merely < 6,
 * evil_monks.rs2:45), but Gate 1 needs stage >= 5 — if it refuses, drive the
 * cell-door story first (4->5) and re-enter.
 */
async function monumentLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await tryOpen('Gate', GATE1, log))) {
        if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
            return false;
        }
        await cellStoryLeg(log);
        return false;
    }
    for (const t of MONUMENTS) {
        if (heldId(IRON_KEY_ID)) {
            break;
        }
        const key = Inventory.items().find(i => i.id === GOLDEN_KEY_ID);
        if (!key) {
            return false; // lost mid-loop (shouldn't happen) — re-decide
        }
        if (!(await walkTo(t, 2, log))) {
            return false;
        }
        const monument = Locs.query().name('Monument')
            .where(l => l.tile().distanceTo(t) <= 2).nearest();
        if (!monument) {
            log(`priestperil: no Monument at (${t.x},${t.z})`);
            continue;
        }
        // NEVER 'Study' (op1) — it randomizes the layout (monuments.rs2:9-17).
        // Wrong graves no-op; the right one swaps gold -> iron (:64-77).
        if (!(await key.useOn(monument))) {
            continue;
        }
        await Execution.delayTicks(3);
    }
    if (heldId(IRON_KEY_ID)) {
        log('priestperil: iron key obtained');
    } else {
        // Iron-key grave already swapped with the key since lost — the one
        // non-self-healing server edge (monuments.rs2:65-68). Loud, not silent:
        // the watchdog parks the quest on repeated no-progress.
        log('priestperil: golden key fit NO monument — iron key already claimed and lost?');
    }
    return false;
}

/** Iron key held: unlock the cell (stage -> 6, key consumed,
 *  trapped_drezel.rs2:47-58). The golden key does NOT fit (:59-62). */
async function unlockLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here !== null && !isUnderground(here)) {
        // Entering the temple crosses the front door — open the leaf first
        // (baked-walkable, live-locked).
        if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
            return false;
        }
    }
    if (!(await walkTo(CELL_DOOR_STAND, 2, log))) {
        return false;
    }
    const door = Locs.query().name('Cell door')
        .where(l => l.tile().level === 2 && l.tile().distanceTo(CELL_DOOR) <= 2).nearest();
    const key = Inventory.items().find(i => i.id === IRON_KEY_ID);
    if (!door || !key) {
        return false;
    }
    if (!(await key.useOn(door))) {
        return false;
    }
    await Execution.delayUntil(() => !heldId(IRON_KEY_ID), 8000);
    return false; // cell now openable — the spine hands off to waterLeg
}

/**
 * The stage 6->8 water chain, obj-id-driven (murky 2953 / blessed 2954 both
 * display "Bucket of water"). Order matters: pour, bless, fill, then the
 * probe-talk — so a restart holding any water state resumes mid-chain, and the
 * stage-7 "empty Bucket back in the pack" state goes through the TALK (7->8)
 * before any re-fill can loop the chain.
 */
async function waterLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    const enterTemple = async (): Promise<boolean> => {
        if (!isUnderground(here)) {
            if (!(await tryOpen('Large door', TEMPLE_DOOR, log))) {
                return false;
            }
        }
        return true;
    };

    // 1. Blessed -> pour on the Coffin (stage -> 7, vampire_coffin.rs2:10-19),
    //    then talk Drezel in the same pass (7 -> 8, trapped_drezel.rs2:22-27).
    if (heldId(BLESSED_ID)) {
        if (!(await enterTemple())) {
            return false;
        }
        if (!(await walkTo(COFFIN, 3, log))) {
            return false;
        }
        const coffin = Locs.query().name('Coffin')
            .where(l => l.tile().level === 2).within(8).nearest();
        const water = Inventory.items().find(i => i.id === BLESSED_ID);
        if (!coffin || !water) {
            return false;
        }
        log('priestperil: water — pouring blessed water on the coffin (stage -> 7)');
        if (!(await water.useOn(coffin))) {
            return false;
        }
        await Execution.delayUntil(() => !heldId(BLESSED_ID), 8000);
        if (!(await tryOpen('Cell door', CELL_DOOR, log))) {
            return false;
        }
        log('priestperil: water — telling Drezel the coffin is done (stage -> 8)');
        await reachAndTalk(DREZEL_CELL, log); // 7 -> 8
        return false;
    }

    // 2. Murky -> blessed: use it on the cell Drezel (opnpcu,
    //    trapped_drezel.rs2:56-58 -> drezel_bless_water :145-152).
    if (heldId(MURKY_ID)) {
        if (!(await enterTemple())) {
            return false;
        }
        if (!(await tryOpen('Cell door', CELL_DOOR, log))) {
            return false;
        }
        if (!(await walkTo(DREZEL_CELL.anchor, 2, log))) {
            return false;
        }
        const drezel = Npcs.query().name('Drezel').within(8).nearest();
        const water = Inventory.items().find(i => i.id === MURKY_ID);
        if (!drezel || !water) {
            return false;
        }
        log('priestperil: water — using murky water on Drezel to bless it');
        if (!(await water.useOn(drezel))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(BLESSED_ID), 10_000);
        return false;
    }

    // 3. No water held. Talk the cell Drezel FIRST: at 6 it's a hint, at 7 it
    //    SETS 8, at >=8 it's harmless — this is what disambiguates "empty
    //    Bucket because not filled yet" from "empty Bucket because poured".
    if (!(await enterTemple())) {
        return false;
    }
    if (!(await tryOpen('Cell door', CELL_DOOR, log))) {
        return false;
    }
    log('priestperil: water — talking Drezel (hint at 6, advances 7 -> 8)');
    await reachAndTalk(DREZEL_CELL, log);
    // Stage >= 8? Both gates open -> essence phase (Gate 1 first — see spine).
    if ((await tryOpen('Gate', GATE1, log)) && (await tryOpen('Gate', GATE2, log))) {
        log('priestperil: water done — both gates open, handing to essence');
        return essenceLeg(log);
    }
    // Still stage 6 -> we need murky water: fill the Bucket at the Well.
    if (Inventory.contains('Bucket')) {
        if (!(await tryOpen('Gate', GATE1, log))) {
            return false;
        }
        log('priestperil: water — filling the Bucket at the Well');
        if (!(await walkTo(WELL_STAND, 1, log))) {
            return false;
        }
        const well = Locs.query().name('Well').within(6).nearest();
        const bucket = Inventory.first('Bucket');
        if (!well || !bucket) {
            log('priestperil: water — no Well/Bucket in reach at the stand');
            return false;
        }
        if (!(await bucket.useOn(well))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(MURKY_ID), 8000);
        return false;
    }
    // Bucket lost mid-quest: bank first, shop fallback (the Demon Slayer
    // buyOrWait idiom — Varrock general store sells them for ~15 gp).
    if (!(await executeStep({ kind: 'withdraw', items: [{ name: 'Bucket', qty: 1 }] }, HOPS, log)) || !Inventory.contains('Bucket')) {
        await executeStep({ kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 }, HOPS, log);
    }
    return false;
}

/**
 * Stages 8-60 (+61): deliver 50 unnoted Rune essence to the mausoleum Drezel.
 * Unstackable — two ~25-slot trips; "how many are left" is server-side only,
 * so the loop just repeats withdraw -> deliver until the journal flips. Bank
 * dry -> mine the shortfall via Aubury's teleport (user decision: the AIO
 * stays fresh-account self-sufficient).
 */
async function essenceLeg(log: (m: string) => void): Promise<boolean> {
    if (journalComplete()) {
        // Final flourish: one more talk with Wolfbane held sets stage 61 —
        // holy-barrier access (drezel.rs2:137-152). decide() returns done on
        // the next loop, so this MUST happen before we report success.
        if (Inventory.contains('Wolfbane')) {
            await reachAndTalk(DREZEL_MAUS, log);
        }
        return true;
    }

    if (Inventory.count('Rune essence') > 0) {
        // Deliver: Gate 1 then Gate 2 (both baked-walkable/live-locked), then
        // talk. At stage 8 the first talk is the damage-assessment chain (-> 10,
        // drezel.rs2:22-47); with essence held at >=10 the talk hands ALL of it
        // (:60-77 -> :96-118). Two talks on a stage-8 entry — the re-entry loop
        // covers it.
        if (!(await tryOpen('Gate', GATE1, log))) {
            log('priestperil: Gate 1 refused during essence phase — mis-signalled essence in pack?');
            return false;
        }
        if (!(await tryOpen('Gate', GATE2, log))) {
            return false;
        }
        if (!(await walkTo(DREZEL_MAUS.anchor, 2, log))) {
            return false;
        }
        const before = Inventory.count('Rune essence');
        log(`priestperil: essence — handing ${before} to Drezel`);
        await talkThrough('Drezel', DREZEL_MAUS.prefer, log);
        await Execution.delayUntil(() => Inventory.count('Rune essence') < before || journalComplete(), 10_000);
        if (journalComplete()) {
            await Execution.delayTicks(2); // let the Wolfbane inv_add land
            if (Inventory.contains('Wolfbane')) {
                await reachAndTalk(DREZEL_MAUS, log); // stage 61
            }
            return true;
        }
        return false;
    }

    // Restock. Surface first — the withdraw executor's walk has no hops.
    if (!(await walkTo(TEMPLE_DOOR_OUT, 3, log))) {
        return false;
    }
    const want = Math.min(Math.max(freeSlots() - 1, 1), ESSENCE_NEEDED); // keep a slot free for the Wolfbane hand-in
    log(`priestperil: essence — pack empty, withdrawing ${want} from Varrock East bank`);
    if (await executeStep({ kind: 'withdraw', items: [{ name: 'Rune essence', qty: want }], bank: VARROCK_EAST_BANK }, HOPS, log)) {
        if (Inventory.count('Rune essence') > 0) {
            return false; // loaded — next pass delivers
        }
    }
    log('priestperil: essence — bank dry, mining the shortfall via Aubury');
    return mineEssence(log);
}

/**
 * Bank had no essence: mine it. Aubury op 'Teleport' (quest-gated on Rune
 * Mysteries, which the AIO run order guarantees) -> one Mine click auto-repeats
 * until the pack fills (EssMiner.ts:216-242) -> Portal out (lands at Aubury's).
 * Needs a pickaxe: pack/worn first, then a small bank cascade.
 */
async function mineEssence(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    if (!inEssMine(here.x, here.z)) {
        if (!Inventory.items().some(i => /pickaxe/i.test(i.name ?? ''))) {
            for (const pick of ['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe']) {
                await executeStep({ kind: 'withdraw', items: [{ name: pick, qty: 1 }], bank: VARROCK_EAST_BANK }, HOPS, log);
                if (Inventory.items().some(i => /pickaxe/i.test(i.name ?? ''))) {
                    break;
                }
            }
            if (!Inventory.items().some(i => /pickaxe/i.test(i.name ?? ''))) {
                log('priestperil: no pickaxe held or banked — cannot mine essence (park)');
                return false;
            }
        }
        if (!(await walkTo(AUBURY_TILE, 4, log))) {
            return false;
        }
        const aubury = Npcs.query().name('Aubury').action('Teleport').within(10).nearest();
        if (!aubury) {
            log('priestperil: no Aubury offering Teleport near his shop');
            return false;
        }
        if (!(await aubury.interact('Teleport'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && inEssMine(t.x, t.z);
        }, 12_000))) {
            return false;
        }
    }
    if (freeSlots() > 0) {
        const rock = Locs.query().name('Rune Essence').action('Mine').nearest();
        if (!rock) {
            log('priestperil: no Rune Essence crystal visible in the mine');
            return false;
        }
        if (!(await rock.interact('Mine'))) {
            return false;
        }
        // One click auto-repeats server-side; wait for a full pack, tolerating
        // a stall (re-enter re-clicks — EssMiner's STALL_MS idiom).
        await Execution.delayUntil(() => freeSlots() === 0, 180_000);
        return false;
    }
    const portal = Locs.query().name('Portal').action('Use').nearest();
    if (!portal) {
        return false;
    }
    await portal.interact('Use');
    await Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && !inEssMine(t.x, t.z);
    }, 12_000);
    return false; // pack full of essence — next pass delivers
}

// --- Provisioning gather (bank-first; called when the bank lacks the Bucket) ---

/** Buy the Bucket at the Varrock general store. Deliberately NO gp wait-guard:
 *  at provisioning time lastBankCounts can be pre-deposit STALE (live
 *  2026-07-20: the smoke's 1000 given coins were deposited moments earlier,
 *  snap.bankCoins still read 0, and a 'need ~15 gp' wait parked the quest 3x
 *  before it started). The buy executor self-provisions coins with a REAL bank
 *  trip — which finds the banked coins regardless of the stale snapshot — and
 *  a genuinely broke account surfaces as the buy step's own honest failure. */
function gatherBucket(): QuestStep {
    return { kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 };
}

// --- Pure quest brain ----------------------------------------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'notStarted') {
        return { kind: 'talk', stop: ROALD };
    }
    // Held-item routing (exact lowercased full-name keys). Keys outrank water
    // outrank essence: each earlier item is consumed producing the later state.
    if (has(snap, 'golden key')) {
        return { kind: 'custom', name: 'monument key swap', run: monumentLeg };
    }
    if (has(snap, 'iron key')) {
        return { kind: 'custom', name: 'unlock the cell', run: unlockLeg };
    }
    if (has(snap, 'bucket of water')) {
        return { kind: 'custom', name: 'water chain', run: waterLeg };
    }
    if (has(snap, 'rune essence')) {
        return { kind: 'custom', name: 'essence delivery', run: essenceLeg };
    }
    return { kind: 'custom', name: 'locate phase', run: spineLeg };
}

export const priestperil: QuestModule = {
    record: QUESTS.find(r => r.id === 'priestperil')!,
    // Two lvl-30 fights (dog 45 HP, monk 25 HP) + aggressive lvl-17/22/30 monks
    // in the temple lobby — carried food + the AIOQuester eat hook cover it.
    food: 12,
    grind: ['temple guardian', 'monk of zamorak'],
    // Between-quest deposit KEEP list: quest-internal items a mid-quest restart
    // may hold. 'bucket' substring-covers empty/murky/blessed; 'pickaxe' keeps
    // the essence-mining tool; keys and Wolfbane are quest-critical.
    tools: ['golden key', 'iron key', 'bucket', 'wolfbane', 'rune essence', 'pickaxe', 'coins'],
    gather: {
        'bucket': gatherBucket
    },
    hops: HOPS,
    decide
};
