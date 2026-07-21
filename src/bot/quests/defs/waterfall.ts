import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { isUnderground, talkThrough, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import { gpShort } from '../engine/provisioning.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';
import { QuestFood } from '../food.js';

// Waterfall Quest — content facts from
// docs/superpowers/research/2026-07-16-waterfall-content-facts.md and the nav
// audit docs/superpowers/research/2026-07-16-waterfall-nav-audit.md (cited inline
// as "content §…" / "audit §…"; line cites are into ~/code/content
// scripts/quests/quest_waterfall). Verified against those sources for every
// coord/loc-name/op below.
//
// FIVE-CUSTOM DEVIATION (Restless Ghost's sanctioned two-custom precedent, scaled
// up): the quest is five scripted-ride clusters — bookLeg, pebbleLeg, tombLeg,
// fallsLeg, dungeonLeg — each a chain of walk→interact→await-teleport legs the
// pure step vocabulary can't express (loc-on-loc telejumps, blind rune placement,
// a deposit+unequip gate). decide() stays PURE and dispatches on HELD ITEMS only;
// every live read happens inside a custom thunk, and each custom returns false on
// any missing precondition so decide() re-routes (re-entrant). fallsLeg/dungeonLeg
// share one dispatcher (fallsAndDungeon) because they are item-identical
// (amulet+urn) and separable only by the live surface/underground position that a
// pure snapshot can't see — the same reason the rune withdraw lives inside that
// dispatcher (position-guarded) rather than as a decide() step.

// --- Item display names (content §Items). "A key" is shared by the golrie and
//     baxtorian keys — tracked by LEG, never by name. Urn full/empty share the
//     display "Glarial's urn". ---
const PEBBLE = "Glarial's pebble";
const AMULET = "Glarial's amulet";
const URN = "Glarial's urn";
const BOOK = 'Book on baxtorian';
const KEY = 'A key';
const ROPE = 'Rope';
const RUNES = ['Air rune', 'Earth rune', 'Water rune'];

/** Configured food display name (AIOQuester `food` setting), or null if unset —
 *  read dynamically so it follows the parameter instead of a hardcoded 'Trout'
 *  (which tried to withdraw food that doesn't exist on accounts banking a
 *  different food). */
function foodName(): string | null { return QuestFood.name; }

// Runes/food are withdrawn only AFTER the tomb (they cannot pass the tomb gate —
// content §Gotchas), so they are def-managed, not in the quest record. Built
// dynamically: the food line is included only when a food is configured.
function runeWithdraw(): { name: string; qty: number }[] {
    const f = foodName();
    return [
        { name: 'Air rune', qty: 6 },
        { name: 'Earth rune', qty: 6 },
        { name: 'Water rune', qty: 6 },
        ...(f ? [{ name: f, qty: 10 }] : [])
    ];
}
// The tomb-gate deposit keep (content §tomb-gate): glarial items + rope + food +
// coins + book are all allowed through; everything else (weapons/armour/runes/
// logs/…) is forbidden, so a narrow keep guarantees entry.
function tombKeep(): string[] {
    const f = foodName();
    return ['glarial', 'rope', 'coins', 'book', ...(f ? [f.toLowerCase()] : [])];
}
// Waterfall's geometric-nearest bank is the Fishing Guild (2586,3420), gated behind
// level-68 Fishing — a quester can't enter it (the offline pathfinder can't see the
// skill gate, so nearestBank() picks it and the bot strands at the guild door, live
// 2026-07-17). Ardougne West (2616,3332) is accessible at ~the same distance; route
// every Waterfall deposit/withdraw there explicitly.
const ARDOUGNE_BANK = new Tile(2616, 3332, 0);
// Aemad's Adventuring Supplies (Ardougne East market general store — Aemad @
// 2613,3291 / Kortan @ 2615,3292, both Trade; stocks rope 20/100), the accessible
// place the def re-buys the player-supplied Rope. A death drops EVERYTHING on this
// server (even the untradeable quest items go — the pebble/amulet/urn ARE
// re-derivable in-quest), but Rope is a `record` item with no gather fn, so a death
// hard-BLOCKED the quest ("no gather for Rope", live 2026-07-17 deliberate-death
// test). gatherRope below is that gather fn. Live-verified Aemad's stand + Trade op;
// a full death->recovery->complete run was not (re-run is ~25 min).
const ARDOUGNE_GENERAL = { npc: 'Aemad', anchor: new Tile(2614, 3293, 0) };
// Betty's Magic Emporium (Port Sarim: air/earth/water runes @ ~4gp) — where
// the def BUYS the 6/6/6 runes when the Ardougne bank is short of them, rather
// than looping the withdraw forever. npc.pack betty=583, spawn m47_50 -> (3012,3259).
const BETTY_SHOP = { npc: 'Betty', anchor: new Tile(3012, 3259, 0) };

// --- NPC stops (content §NPCs; map-derived anchors). Almera starts the quest
//     (choice "How can I help?"); Golrie hands the pebble (scripted chatplayer/
//     chatnpc, no real options — prefer is advisory). ---
const ALMERA: NpcStop = { npc: 'Almera', anchor: new Tile(2522, 3498, 0), leash: 6, prefer: ['How can I help?'] };
const GOLRIE_PREFER = ['Do you mind if I have a look?', 'No, of course not.', 'Could I take this old pebble?'];

// --- TGV surface/underground telejump pair (audit §Data change). The transports.
//     json edge already crosses it, but walkWithHops climbs it deterministically.
//     Endpoints are the walkable tile immediately NORTH of each ladder loc square
//     (the loc squares read BLOCKED); the dungeon-side ladder is forceapproach=
//     NORTH, so (2533,9556) is the only tile the Climb-up fires from. ---
const WATERFALL_HOPS: LadderHop[] = [
    { stand: new Tile(2533, 3156, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(2533, 9556, 0) },
    { stand: new Tile(2533, 9556, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(2533, 3156, 0) }
];

// --- Scripted-ride anchors/arrivals (content §Scripted rides; loc names + ops
//     verified in waterfall.loc / all.loc). Loc squares read BLOCKED, so the
//     stands are the reachable tiles beside them (walkResilient snaps the goal). ---
const RAFT_STAND = new Tile(2509, 3493, 0);      // lograft "Log raft" op1 Board -> mound (2512,3481)
// Hudon's mound is a SEALED 8-tile river island (2511-2512, 3476-3481): the raft
// p_teleports you onto it (quest_waterfall.rs2:163), the forced Hudon dialogue sets
// stage 2, and NOTHING there walks back — the bookcase/tourist-centre landmass is
// nav-unreachable from the mound. The ONLY exit is the "Rock" (2512,3468) op1 "Swim
// to": it washes you downstream to waterfall_fail_coord (2527,3413) on the mainland
// with NO item loss (quest_waterfall.rs2:186-205), from which the bookcase IS
// reachable (cost 52). So the book leg is raft -> Hudon -> swim-return -> bookcase.
const MOUND_SWIM_STAND = new Tile(2512, 3476, 0); // southmost walkable mound tile, in the swim zone (2510-2514,3476-3481), ~8t N of the Rock
// The "Swim to" washes the bot downstream to (2527,3413) near the tourist centre —
// detected below by leaving the mound (x>=2520), so no constant is needed for it.
// The Bookcase (bookcase_waterfall_quest id 1989) is a 1x2 loc at (2520,3426,1) whose
// OWN tile is blocked; stand on the walkable tile immediately west and Search from
// there (the old stand was the blocked loc tile -> "no path unreachable" live).
const BOOKCASE_STAND = new Tile(2519, 3426, 1);  // "Bookcase" op1 Search, UPSTAIRS (level 1), via the spiral staircase
const GOLRIE_CRATE_STAND = new Tile(2548, 9565, 0); // golrie_crate "Crate" op1 Search -> "A key"
const GOLRIE_GATE_STAND = new Tile(2515, 9574, 0);  // south side of golrie_gate "Door" (useOn key)
const GOLRIE_STAND = new Tile(2515, 9581, 0);       // Golrie, past the gate
const TOMBSTONE_STAND = new Tile(2558, 3444, 0);    // "Tombstone of glarial" (oplocu pebble) -> tomb (2554,9844)
const CHEST_STAND = new Tile(2530, 9845, 0);        // "Closed chest"->Open->"Open chest" Search -> amulet (forceapproach N)
const COFFIN_STAND = new Tile(2542, 9810, 0);       // S of "Tomb of glarial" (2542-2543,9811, 2x1) — CARDINALLY adjacent so the op1 Search fires (the old 2542,9812 is the blocked loc tile; the bot snapped DIAGONAL and the Search never reached, live 2026-07-17)
const TOMB_LADDER_STAND = new Tile(2554, 9844, 0);  // tomb landing; a live Climb-up here exits to the surface
const ROCK_STAND = new Tile(2512, 3477, 0);         // walkable mound tile in the rope-zone (2510-2514,3476-3481), N of the "Rock" (2512,3468); useOn rope. The mound is raft-only (sealed), so fallsLeg boards the raft to reach here.
const BAX_CRATE_STAND = new Tile(2589, 9888, 0);    // baxtorian_crate "Crate" op1 Search -> "A key"
// The pillar/statue room is behind TWO locked baxtorian_door_2 doors (id 2002) that
// op1-Open reports "locked" both sides — the key-USE (oplocu) teleports you THROUGH
// (open_and_close_door). The walker can't cross them, so the def keys them in
// sequence by z-region (live-mapped 2026-07-17): the SOUTH door (2568,9893) from the
// south (2568,9892) -> teleport to z>=9894; then the PUZZLE door (2566,9901) from
// (2566,9900) -> stage 6 + teleport to z>=9902 (into the pillar room). Both stands
// are reachable live without crossing the locked door they key.
const SOUTH_DOOR_STAND = new Tile(2568, 9892, 0);   // S of the "south door" (2568,9893); useOn key -> teleport N
const PUZZLE_DOOR_STAND = new Tile(2566, 9900, 0);  // S of the puzzle door (2566,9901); useOn key -> stage 6 + teleport N
const PILLAR_STAND = new Tile(2563, 9911, 0);       // inside the pillar room
const STATUE_STAND = new Tile(2565, 9915, 0);       // beside "Statue of Glarial" @ (2565,9916)
const DOOR_LEAF_STAND = new Tile(2603, 9900, 0);    // baxtorian_door_2 x>2600 leaf @ (2604,9900); useOn key TELEPORTS to the raised room
// The six pillars are (2562,x)/(2569,x) for x in 9910/9912/9914; the chalice is at
// (2603,9910). Both the pillar sweep and the chalice reach their loc via useOn's
// NATIVE game-walk (placeRunes / the chalice branch) rather than pre-positioned
// stands — walkResilient repathed forever ("stuck 0 clicks") in these cramped rooms —
// so no PILLAR_TILES / CHALICE_STAND constants are needed.

const held = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

/** Live count-short check for the runes/food withdraw (position-guarded to the
 *  surface inside fallsAndDungeon, so it never re-fires mid-dungeon). */
function runesShortLive(): boolean {
    // RUNES only — food is best-effort (the eat hook), so it must NOT gate the
    // rune withdraw/buy, or a food-less bank would loop it forever.
    return RUNES.some(r => Inventory.count(r) < 6);
}

/** Get the 6/6/6 air/earth/water runes for the finale: withdraw what the Ardougne
 *  bank holds (+ food, best-effort), then BUY any shortfall from Betty's (Port
 *  Sarim) so a rune-short bank doesn't loop the withdraw. */
async function ensureRunes(log: (m: string) => void): Promise<boolean> {
    await executeStep({ kind: 'withdraw', items: runeWithdraw(), bank: ARDOUGNE_BANK }, WATERFALL_HOPS, log);
    for (const rune of RUNES) {
        const need = 6 - Inventory.count(rune);
        if (need > 0) {
            await executeStep({ kind: 'buy', item: rune, qty: need, shop: BETTY_SHOP, estGp: need * 10 }, WATERFALL_HOPS, log);
        }
    }
    return RUNES.every(r => Inventory.count(r) >= 6);
}

/** Live amulet check — held in the pack OR worn (it has an iop2 Wear). Used to
 *  split the urn-without-amulet signature: worn/held here = still have it. */
function amuletHeldLive(): boolean {
    return Inventory.count(AMULET) > 0 || Equipment.contains(AMULET);
}

/** Total runes in the pack (across all three types). The pillar sweep measures
 *  progress by the DROP in this count, never by "pack empty" — free no-op
 *  re-placements keep the rune, so a re-stocked death never empties it (Finding 3). */
function totalRunes(): number {
    return RUNES.reduce((n, r) => n + Inventory.count(r), 0);
}

// --- Custom legs (all live reads; each returns false to re-enter) --------------

/** Read the held book (idempotent — re-reading is a harmless status line; the
 *  book is kept). Reading needs stage 2 (spoken to Hudon), set by the raft ride. */
async function readBook(log: (m: string) => void): Promise<boolean> {
    const book = Inventory.first(BOOK);
    if (!book) {
        return false;
    }
    await book.interact('Read');
    await Execution.delayTicks(3);
    // The Read (opheld1) sets stage 3 immediately (baxtorian_book.rs2:6-7). It also
    // opens the book interface — a MAIN modal with NO close button, so closeModal()
    // (a CLOSE_BUTTON click) can't dismiss it; only a MOVEMENT packet does. The very
    // next leg (pebbleLeg's walk to the golrie crate) sends that movement, which
    // closes it — and the engine's per-loop dismiss now falls through on a
    // buttonless modal instead of livelocking on it (QuestEngine, 2026-07-17).
    await Execution.delayTicks(1);
    return true;
}

/**
 * Row 2 (content §Flow 0→3). Raft ride (Board -> forced Hudon dialogue, stage
 * 1→2) unless already across the river, then the upstairs bookcase Search + Read
 * (stage 2→3). The book is kept, so "book in pack" ends this leg; a defensive
 * re-read lives in pebbleLeg because Golrie only hands the pebble at stage 3.
 */
async function bookLeg(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(BOOK)) {
        return readBook(log);
    }
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    const onMound = here.x >= 2508 && here.x <= 2515 && here.z >= 3474 && here.z <= 3485;
    // Almera's (north) bank -> board the raft (fires Hudon, stage 2, lands on the
    // mound). z>3485 is Almera/raft; the mound (z~3481) and the mainland bookcase
    // area (z<=3426) both sit below it, so this never re-fires post-raft.
    if (here.z > 3485 && !onMound) {
        if (!(await Traversal.walkResilient(RAFT_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const raft = Locs.query().name('Log raft').action('Board').within(8).nearest();
        if (!raft) {
            log('bookLeg: no Log raft to Board');
            return false;
        }
        if (!(await raft.interact('Board'))) {
            return false;
        }
        // Board p_teleports onto the mound AND opens a forced ~7-page Hudon dialogue.
        // The stage-2 set (^waterfall_spoken_to_hudon) is PARTWAY through it
        // (quest_waterfall.rs2:178), and the script SUSPENDS on each chat page until
        // continued — so DRIVE it to completion inline. Walking away (to the swim)
        // abandons the suspended script and the stage stays 1, after which the tourist
        // bookcase yields nothing forever (live 2026-07-17: stuck Searching, book=0).
        // Same inline-drive as the Prince beer dialogue (canContinue, not isOpen).
        await Execution.delayUntil(() => ChatDialog.canContinue(), 8000);
        for (let i = 0; i < 14 && ChatDialog.canContinue(); i++) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
        }
        // Land on the mound (x<=2515) — NOT merely z<=3485, which the mainland also is.
        await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && t.x <= 2515 && t.z <= 3485; }, 10_000);
        return false; // re-enter -> the swim-return below
    }
    // Hudon's sealed mound -> "Swim to" the Rock to be washed downstream to the
    // mainland (FAIL_COORD). No item loss; the bookcase is unreachable from here.
    if (onMound) {
        if (!(await Traversal.walkResilient(MOUND_SWIM_STAND, { radius: 1, attempts: 3, timeoutMs: 30_000, log }))) {
            return false;
        }
        const rock = Locs.query().name('Rock').action('Swim to').within(10).nearest();
        if (!rock) {
            log('bookLeg: no "Rock" to Swim to from the mound — LIVE-VERIFY the swim-return');
            return false;
        }
        if (!(await rock.interact('Swim to'))) {
            return false;
        }
        // Washed downstream lands at FAIL_COORD (2527,3413); success = off the mound.
        await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && t.x >= 2520; }, 12_000);
        return false; // re-enter -> walk to the bookcase from the mainland
    }
    // Mainland (post-swim, near the tourist centre) -> search the upstairs bookcase.
    if (!(await Traversal.walkResilient(BOOKCASE_STAND, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const shelf = Locs.query().name('Bookcase').action('Search').within(8).nearest();
    if (!shelf) {
        log('bookLeg: no Bookcase to Search near Hadley\'s office');
        return false;
    }
    if (!(await shelf.interact('Search'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Inventory.contains(BOOK), 8000))) {
        return false;
    }
    return readBook(log);
}

/**
 * Row 3 (content §Golrie leg + golrie.rs2). Descend to the TGV dungeon, Search
 * the golrie crate for the key, USE the key on the locked gate (op1 alone won't
 * open it — quest_waterfall.rs2:331-356), then talk Golrie for the pebble. The
 * gate must be OPEN to reach him; the key is consumed by Golrie's dialogue but
 * that is fine — the pebble ends this leg.
 */
async function pebbleLeg(log: (m: string) => void): Promise<boolean> {
    // Defensive: guarantee stage 3 before Golrie (he yields the pebble only
    // post-read). Harmless re-read; the book is still held here.
    if (Inventory.contains(BOOK)) {
        await readBook(log);
    }
    if (!Inventory.contains(KEY)) {
        if (!(await walkWithHops(GOLRIE_CRATE_STAND, 2, WATERFALL_HOPS, log))) {
            return false;
        }
        const crate = Locs.query().name('Crate').action('Search').within(8).nearest();
        if (!crate) {
            log('pebbleLeg: no golrie Crate to Search');
            return false;
        }
        if (!(await crate.interact('Search'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(KEY), 8000);
    }
    // The golrie gate (a wall @ 2515,9575) opens only when the KEY is USED from the
    // OUTSIDE (south, z<9575): check_axis then forcewalks you THROUGH to the inside
    // (quest_waterfall.rs2:358-368). Once through, do NOT walk back to the south stand
    // — the gate auto-closes behind you and re-walking re-opens it forever (live
    // 2026-07-17: oscillated at the gate, pebble never obtained). Guard on position:
    // north of the gate (z>=9576) go straight to Golrie; else (re)open from the south.
    const gateHere = Game.tile();
    const insideGate = gateHere !== null && gateHere.z >= 9576;
    if (!insideGate) {
        if (!(await walkWithHops(GOLRIE_GATE_STAND, 1, WATERFALL_HOPS, log))) {
            return false;
        }
        const closedGate = Locs.query().name('Door').action('Open').within(6).nearest();
        if (closedGate) {
            const key = Inventory.first(KEY);
            if (key) {
                await key.useOn(closedGate);
                // The key-use forcewalks us north through the gate — wait for it so
                // we don't immediately re-loop and get pulled back south.
                await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && t.z >= 9576; }, 6000);
            }
        }
        return false; // re-enter -> inside branch (or retry the open)
    }
    // Inside the gate -> Golrie hands the pebble (scripted, no real options).
    if (!(await Traversal.walkResilient(GOLRIE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await talkThrough('Golrie', GOLRIE_PREFER, log);
    return Inventory.contains(PEBBLE);
}

/**
 * Row 4 (content §Tomb + quest_waterfall.rs2:44-151). Pre-entry: deposit the
 * pack down to the gate-safe keep, strip worn gear, then USE the pebble on the
 * tombstone (the gate check runs there — no item loss on a bounce). Inside: loot
 * the CHEST (amulet) BEFORE the coffin (urn) so decide()'s item signature stays
 * unambiguous (amulet-without-urn = mid-tomb; urn-without-amulet = post-statue),
 * then climb the (unpinned) exit ladder. Fights nothing — runs past the giants.
 */
async function tombLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const inTomb = here !== null && isUnderground(here) && here.z >= 9800 && here.z < 9850;
    if (!inTomb) {
        // Strip worn gear FIRST (it is gate-forbidden). Unequipping drops each piece
        // into the pack, so the deposit that follows sweeps it out in the SAME pass
        // (Finding 4 — the old deposit-then-unequip order left the just-removed gear
        // in the pack and guaranteed one tomb-gate bounce on geared accounts). The
        // smoke account wears nothing, so this is a no-op there. Glarial's amulet, if
        // ever worn, is gate-allowed and TOMB_KEEP-kept, so this never loses it.
        const hadGear = Equipment.items().length > 0;
        for (const it of Equipment.items()) {
            if (it.name) {
                await Equipment.unequip(it.name);
            }
        }
        // Only make the bank trip when there is a gate-forbidden item to shed: runes
        // (the def-managed forbidden item) or gear just unequipped into the pack. With
        // the runes already banked (their normal home — they can't pass the gate), the
        // pack is clean here and the tomb entry needs no detour. Routed to Ardougne
        // West, since the geometric-nearest bank is the gated Fishing Guild.
        const needsDeposit = hadGear || RUNES.some(r => Inventory.count(r) > 0);
        if (needsDeposit && !(await executeStep({ kind: 'deposit', keep: tombKeep(), bank: ARDOUGNE_BANK }, WATERFALL_HOPS, log))) {
            return false;
        }
        if (!(await walkWithHops(TOMBSTONE_STAND, 2, WATERFALL_HOPS, log))) {
            return false;
        }
        const stone = Locs.query().name('Tombstone of glarial').within(8).nearest();
        const pebble = Inventory.first(PEBBLE);
        if (!stone || !pebble) {
            log('tombLeg: no tombstone or pebble for the entry');
            return false;
        }
        if (!(await pebble.useOn(stone))) { // oplocu; op1 'Read' is a decoy
            return false;
        }
        return Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && isUnderground(t) && t.z >= 9800 && t.z < 9850;
        }, 12_000);
    }
    // Inside the tomb — chest (amulet) first.
    if (!Inventory.contains(AMULET)) {
        if (!(await Traversal.walkResilient(CHEST_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const closed = Locs.query().name('Closed chest').action('Open').within(8).nearest();
        if (closed) {
            await closed.interact('Open');
            await Execution.delayTicks(2);
            return false;
        }
        const open = Locs.query().name('Open chest').action('Search').within(8).nearest();
        if (!open) {
            log('tombLeg: no open chest to Search');
            return false;
        }
        if (!(await open.interact('Search'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(AMULET), 8000);
    }
    // Then the coffin (urn) — SKIPPED in the amulet re-obtain path (Finding 2), which
    // re-enters the tomb already holding the urn and only needs the chest amulet.
    if (!Inventory.contains(URN)) {
        if (!(await Traversal.walkResilient(COFFIN_STAND, { radius: 1, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const coffin = Locs.query().name('Tomb of glarial').action('Search').within(8).nearest();
        if (!coffin) {
            log('tombLeg: no coffin to Search');
            return false;
        }
        if (!(await coffin.interact('Search'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(URN), 8000);
    }
    // Both items held while still in the tomb: the EXIT is decide()'s job, not this
    // leg's (Finding 1). hasUrn && hasAmulet routes to fallsAndDungeon, whose tomb
    // branch (z < 9850) climbs out via tombExit(). The old in-leg Climb-up block was
    // DEAD — decide() had always re-routed away the instant the urn appeared — so it
    // moved to tombExit(). Return false to hand off to that routing.
    return false;
}

/**
 * Climb the tomb's exit ladder (region 153) back to the surface (Finding 1). The
 * pebble-tele lands at (2554,9844) beside a Climb-up; the exit was never curated as
 * a nav edge (audit exit-ladder risk), so walk to the landing and take the live
 * Climb-up. Used by BOTH the happy path (amulet+urn just looted) and the amulet
 * re-obtain path (Finding 2), which both re-surface through here.
 */
async function tombExit(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(TOMB_LADDER_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const ladder = Locs.query().action('Climb-up').within(8).nearest();
    if (!ladder) {
        log('tombExit: no Climb-up ladder near the tomb landing (2554,9844) — LIVE-VERIFY the exit');
        return false;
    }
    if (!(await ladder.interact('Climb-up'))) {
        return false;
    }
    return Execution.delayUntil(() => { const t = Game.tile(); return t !== null && !isUnderground(t); }, 12_000);
}

/**
 * Rows 6-8 dispatcher — the amulet+urn AND urn-only states share one item
 * signature and split only by LIVE position:
 *   underground, tomb region (z < 9850)    -> climb out to the surface (Finding 1)
 *   underground, finale region (z >= 9850) -> the dungeon finale (dungeonLeg)
 *   surface, amulet missing                -> re-obtain it via the tomb (Finding 2)
 *   surface, amulet held                   -> stock runes/food, then the falls crossing
 * The urn-without-amulet death respawns on the SURFACE and must re-obtain the amulet
 * (the ledge door floods without it); the SAME item signature in the raised room is
 * the happy-path chalice finish — so the split has to be live position, never a pure
 * decide() row. (Runes/food could not pass the tomb gate, so they are withdrawn only
 * on the surface here, never mid-dungeon.)
 */
async function fallsAndDungeon(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    if (isUnderground(t)) {
        // Tomb (region 153, lands z~9844) vs finale (region 154, ledge drop z~9861,
        // rooms z~9888-9916) by z. The tomb is a sealed island — never dungeonLeg it.
        if (t.z < 9850) {
            return tombExit(log);
        }
        return dungeonLeg(log);
    }
    // Surface. Re-obtain a consumed amulet before the falls crossing (Finding 2 — the
    // statue eats it at stage 8; a death respawns here holding only the urn, and the
    // ledge door floods without it). The tomb chest re-gives the amulet (pebble
    // persists), then the normal amulet+urn flow resumes.
    if (!amuletHeldLive()) {
        return tombLeg(log);
    }
    if (runesShortLive()) {
        return ensureRunes(log);
    }
    return fallsLeg(log);
}

/**
 * Row 6 (content §Scripted rides :218-285). Rope-on-rock (stand N of it) forcemoves
 * across; rope-on-dead-tree drops to the ledge; Open the Ledge door (amulet held)
 * into the dungeon. NEVER op1 'Swim to' the rock, 'Climb' the tree, or 'Get in'
 * the Barrel (all traps) — every crossing is a USE-rope or the ledge Open.
 */
async function fallsLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    const atFalls = t.x >= 2505 && t.x <= 2518;
    // On the ledge (arrive 2511,3463) -> Open the Ledge into the dungeon. THREE
    // 'Ledge' doors sit adjacent (2510/2511/2512,3464); only the CENTRE one (id
    // 2010, waterfall_ledge_door) has an oploc1 that teleports you in — the flanking
    // decoys (2011/2012) have NO handler, so opening them is a silent no-op and
    // .nearest() ties into a dead stall (live 2026-07-17). Target id 2010 explicitly.
    if (atFalls && t.z >= 3461 && t.z <= 3465) {
        const door = Locs.query().where(l => l.id === 2010).action('Open').within(6).nearest();
        if (!door) {
            log('fallsLeg: no Ledge door to Open');
            return false;
        }
        if (!(await door.interact('Open'))) {
            return false;
        }
        return Execution.delayUntil(() => { const g = Game.tile(); return g !== null && isUnderground(g); }, 12_000);
    }
    // Just past the rock (forcemove ~2513,3468) -> rope on the dead tree.
    if (atFalls && t.z >= 3466 && t.z <= 3472) {
        const tree = Locs.query().name('Dead tree').within(8).nearest();
        const rope = Inventory.first(ROPE);
        if (!tree || !rope) {
            log('fallsLeg: no dead tree or rope');
            return false;
        }
        if (!(await rope.useOn(tree))) {
            return false;
        }
        return Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.z <= 3465; }, 8000);
    }
    // The crossing "Rock" (2512,3468) is roped from the SEALED mound (rope-zone
    // 2510-2514,3476-3481), reachable ONLY via the Log raft — the same island Hudon
    // sits on. If we're not on the mound, board the raft (at stage>=5 it just
    // p_teleports us there; the forced Hudon dialogue only fires at stage 1). Then
    // rope the rock. Without this the leg walked to ROCK_STAND on the sealed mound
    // and dead-looped 'unreachable' (audit + book-leg mound finding, 2026-07-17).
    const onMound = t.x >= 2508 && t.x <= 2515 && t.z >= 3474 && t.z <= 3485;
    if (!onMound) {
        if (!(await Traversal.walkResilient(RAFT_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const raft = Locs.query().name('Log raft').action('Board').within(8).nearest();
        if (!raft) {
            log('fallsLeg: no Log raft to Board');
            return false;
        }
        if (!(await raft.interact('Board'))) {
            return false;
        }
        await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x <= 2515 && g.z <= 3485; }, 10_000);
        return false; // re-enter on the mound -> rope the rock
    }
    // On the mound -> rope the crossing rock (forcemoves us across the river).
    if (!(await Traversal.walkResilient(ROCK_STAND, { radius: 1, attempts: 3, timeoutMs: 45_000, log }))) {
        return false;
    }
    const rock = Locs.query().name('Rock').action('Swim to').within(10).nearest();
    const rope = Inventory.first(ROPE);
    if (!rock || !rope) {
        log('fallsLeg: no crossing rock or rope');
        return false;
    }
    if (!(await rope.useOn(rock))) {
        return false;
    }
    return Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.z >= 3466 && g.z <= 3472; }, 8000);
}

/**
 * ONE blind-place sweep: walk each pillar and use one of every rune type on it.
 * Repeats are FREE no-ops (the rune is KEPT when the bit is already set —
 * waterfall_pillars.rs2:12), so the caller measures progress by the DROP in the
 * total rune count, never by "pack empty" (Finding 3). From a fresh 6+6+6 pack a
 * single sweep sets all 18 bits; a silently dropped useOn is re-attempted on the
 * caller's next re-entry (the rune is still held).
 */
async function placeRunes(log: (m: string) => void): Promise<void> {
    // Iterate the six 'Pillar' locs and let useOn's NATIVE game-walk reach each — the
    // server walks the player adjacent before applying the rune (oplocu). walkResilient
    // pre-positioning was abandoned: in this cramped room it repaths endlessly ("stuck
    // 0 clicks") between the packed loc tiles and stranded the sweep at 16/18 bits
    // (live 2026-07-17, three attempts). Repeats over a set bit are free no-ops
    // (waterfall_pillars.rs2:12), so a re-sweep harmlessly finishes any rune whose
    // walk didn't land in time. Waypoint each pillar so its 3 runes place from adjacency.
    const pillars = Locs.query().name('Pillar').within(20).results();
    for (const pillar of pillars) {
        for (const rune of RUNES) {
            const r = Inventory.first(rune);
            if (!r) {
                continue;
            }
            const before = totalRunes();
            await r.useOn(pillar); // oplocu — native walk-to-loc then apply
            await Execution.delayUntil(() => totalRunes() < before, 6000);
        }
    }
}

/**
 * Row 7 (content §Dungeon finale + quest_waterfall.rs2:370-488). Search the
 * baxtorian crate for the key; USE the key on the leaf at (2566,9902) to set
 * stage 6 (entered_puzzle_room — the statue's gate); SWEEP-place all 18 runes;
 * USE the amulet on the Statue of Glarial (all bits set -> tele to the raised
 * room, amulet consumed); then USE the full urn on the Chalice. NEVER op1
 * 'Take treasure' the chalice (whirlpool) — only the urn USE completes it.
 *
 * TWO-ROUTE REDUNDANCY into the raised room (content §Dungeon finale :381-426):
 * the statue tele is the primary route, but the baxtorian_door_2 leaves at x>2600
 * ((2604,9900)/(2606,9892)) also TELEPORT original<->raised, opened with the
 * baxtorian key (re-obtainable from the crate, not consumed). The door leaf covers
 * the post-statue-death case where the statue is a permanent stage-8 no-op
 * (Finding 2). The raised room proper sits at z>=9906 (chalice 9910, statue tele
 * 9914); the x>2600 door leaf sits at z~9900, so z splits the two.
 */
async function dungeonLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    // Raised room (chalice 2603,9910; statue/door tele land z~9910-9914) -> urn on the
    // chalice = done. z>=9906 distinguishes it from the x>2600 door leaf (z~9900) in
    // the original room, which must NOT be mistaken for "already at the chalice".
    if (t.x >= 2600 && t.z >= 9906) {
        // useOn's native walk-to-loc reaches the Chalice — walkResilient repaths
        // endlessly here too ("stuck 0 clicks") the same way the pillar room did
        // (live 2026-07-17: statue teleport landed the bot in the raised room but it
        // then stalled 2-3t short of the chalice). The urn.useOn walks it in.
        const chalice = Locs.query().name('Chalice of eternity').within(12).nearest();
        const urn = Inventory.first(URN);
        if (!chalice || !urn) {
            log('dungeonLeg: no chalice or urn in the raised room');
            return false;
        }
        if (!(await urn.useOn(chalice))) { // oplocu; op1 'Take treasure' is the trap
            return false;
        }
        await Execution.delayTicks(3);
        return true; // the complete queue flips the journal; next decide() -> done
    }
    // At the x>2600 teleport-door leaf in the ORIGINAL room (z<9906) — the post-statue
    // recovery route (Finding 2). Open the leaf with the key and await the teleport to
    // the raised room; keeps all door-leaf open logic in one place across re-entries.
    if (t.x >= 2600 && t.z < 9906 && Inventory.contains(KEY)) {
        const leaf = Locs.query().name('Door').action('Open').within(6).nearest();
        const key = Inventory.first(KEY);
        if (leaf && key) {
            await key.useOn(leaf);
        } else {
            log('dungeonLeg: at the x>2600 leaf but no Door/key — LIVE-VERIFY the teleport door');
        }
        return Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x >= 2600 && g.z >= 9906; }, 12_000);
    }
    // Get the baxtorian key.
    if (!Inventory.contains(KEY)) {
        if (!(await Traversal.walkResilient(BAX_CRATE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        const crate = Locs.query().name('Crate').action('Search').within(8).nearest();
        if (!crate) {
            log('dungeonLeg: no baxtorian Crate to Search');
            return false;
        }
        if (!(await crate.interact('Search'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(KEY), 8000);
    }
    // Reach the pillar/statue room by key-crossing the two locked baxtorian_door_2
    // doors in sequence (each key-USE teleports us N; the puzzle door also sets
    // stage 6). Guard by z-region so a re-entry advances instead of re-keying.
    const inPuzzle = t.x >= 2558 && t.x <= 2572 && t.z >= 9908 && t.z <= 9918;
    if (!inPuzzle) {
        const key = Inventory.first(KEY);
        // (a) South of the SOUTH door -> key it from (2568,9892), teleport to z>=9894.
        if (t.z < 9894) {
            if (!(await Traversal.walkResilient(SOUTH_DOOR_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
                return false;
            }
            const door = Locs.query().where(l => l.id === 2002).action('Open').within(3).nearest();
            if (door && key) {
                await key.useOn(door);
                await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.z >= 9894; }, 6000);
            }
            return false;
        }
        // (b) Between the doors -> key the PUZZLE door from (2566,9900): stage 6 +
        //     teleport to z>=9902. (c) North of it -> walk into the pillar room.
        if (t.z < 9902) {
            if (!(await Traversal.walkResilient(PUZZLE_DOOR_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
                return false;
            }
            const door = Locs.query().where(l => l.id === 2002).action('Open').within(3).nearest();
            if (door && key) {
                await key.useOn(door);
                await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.z >= 9902; }, 6000);
            }
            return false;
        }
        // North of the puzzle door -> step up into the pillar room.
        await Traversal.walkResilient(PILLAR_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log });
        return false;
    }
    // SWEEP-THEN-STATUE (Finding 3): a re-stocked death leaves runes over already-set
    // bits, and free no-op re-placements KEEP those runes, so a "pack rune-empty" gate
    // would deadlock forever. Instead run one full placement sweep, then ALWAYS attempt
    // the statue. Real progress = the DROP in the total rune count.
    const runesBefore = totalRunes();
    await placeRunes(log);
    const placed = runesBefore - totalRunes();

    // USE the amulet on the statue (all 18 bits set -> tele to the raised room x>2600,
    // amulet consumed). Skip the useOn if the amulet is gone (a stage-8 recovery routes
    // here with it re-obtained; the door-leaf fallback below is amulet-free anyway).
    if (!(await Traversal.walkResilient(STATUE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const statue = Locs.query().name('Statue of Glarial').within(6).nearest();
    const amulet = Inventory.first(AMULET);
    if (statue && amulet) {
        await amulet.useOn(statue); // oplocu; the statue is a no-op past stage 8
    }
    // Success = the teleport arrival at the raised room (2603,9914). Bounded.
    if (await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x >= 2600 && g.z >= 9906; }, 12_000)) {
        return false; // re-enter -> raised-room chalice branch
    }
    // No teleport. If THIS sweep still placed runes, the bits were merely completing (a
    // dropped useOn, or a re-stock over partial bits) -> re-enter and re-sweep to finish.
    if (placed > 0) {
        return false;
    }
    // placed === 0 and no teleport. The TRUE stage-8 signal is the amulet being GONE
    // (consumed by an earlier statue placement, e.g. a post-statue death) — then the
    // statue is a permanent no-op and the raised room must be reached via the x>2600
    // teleport-door leaf. But placed === 0 ALSO happens when a pillar useOn simply isn't
    // landing (puzzle NOT yet solved); in that case the amulet is still held, so
    // re-sweep to retry rather than abandoning to the door leaf with the puzzle
    // incomplete (review finding: don't conflate "solved" with "placement failing").
    if (!amuletHeldLive() && Inventory.contains(KEY)) {
        await Traversal.walkResilient(DOOR_LEAF_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log });
    }
    return false;
}

// --- Pure quest brain (dispatches on HELD ITEMS only) -------------------------

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: ALMERA }; }

    const hasPebble = held(snap, PEBBLE);
    const hasAmulet = held(snap, AMULET) || worn(snap, AMULET);
    const hasUrn = held(snap, URN);
    const hasBook = held(snap, BOOK);

    // Row 8: the statue consumed the amulet (urn-without-amulet is UNIQUELY post-statue
    // — tombLeg loots the chest amulet before the coffin urn). This item signature has
    // TWO live sub-states that fallsAndDungeon splits by position: in the raised room it
    // is the happy-path chalice finish; on the SURFACE it is a post-statue-death respawn
    // that must RE-OBTAIN the amulet before the ledge door (which floods without it —
    // Finding 2), via tombLeg's chest re-give (the pebble persists;
    // quest_waterfall.rs2:102 never deletes it). Pure decide() can't see position, so it
    // routes to the dispatcher and lets it choose.
    if (hasUrn && !hasAmulet) { return { kind: 'custom', name: 'amulet re-obtain', run: fallsAndDungeon }; }
    // Rows 5-7: tomb fully looted (amulet+urn) -> runes, falls crossing, dungeon.
    if (hasUrn && hasAmulet) { return { kind: 'custom', name: 'falls + dungeon', run: fallsAndDungeon }; }
    // Row 4: pebble in hand, tomb not fully looted (no urn yet).
    if (hasPebble) { return { kind: 'custom', name: 'tomb', run: tombLeg }; }
    // Row 3: past the book, no pebble -> Golrie pebble leg.
    if (hasBook) { return { kind: 'custom', name: 'pebble', run: pebbleLeg }; }
    // Row 2: empty-handed -> raft + Hudon + read the book.
    return { kind: 'custom', name: 'book', run: bookLeg };
}

/** Re-buy the player-supplied Rope after a death drops it (record item, `acquirable`).
 *  Buy at the Ardougne West general store if the bank/pack can cover it, else park a
 *  WAIT — never let a missing gather fn hard-block the quest (deliberate-death test). */
function gatherRope(snap: QuestSnapshot, need: number): QuestStep {
    const estGp = 20 * Math.max(1, need);
    if (gpShort(snap, estGp) > 0) {
        return { kind: 'wait', reason: `need ~${estGp} gp to re-buy Rope after a death` };
    }
    return { kind: 'buy', item: 'Rope', qty: Math.max(1, need), shop: ARDOUGNE_GENERAL, estGp };
}

export const waterfall: QuestModule = {
    record: QUESTS.find(r => r.id === 'waterfall')!,
    // Carry food for the dungeon/combat legs — the engine withdraws this many of
    // the AIOQuester's configured food item at provisioning time and the eat hook
    // consumes it when HP dips (the tomb/Golrie legs run past aggressive spawns).
    food: 8,
    // Rope is the only player-supplied record item; a death drops it, so it needs a
    // gather fn or the engine hard-blocks re-provisioning (deliberate-death finding).
    gather: { rope: gatherRope },
    // Every quest item a mid-quest restart may hold in the pack (the between-quest
    // deposit keeps these). 'glarial' covers pebble/amulet/urn; 'a key' covers both
    // keys; runes/food are def-withdrawn post-tomb but kept if already held.
    tools: ['glarial', 'a key', 'rope', 'book on baxtorian', 'trout', 'air rune', 'earth rune', 'water rune', 'coins'],
    hops: WATERFALL_HOPS,
    decide
};
