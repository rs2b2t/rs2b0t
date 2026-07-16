import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Traversal } from '../../api/Traversal.js';
import Tile from '../../api/Tile.js';
import { isUnderground, talkThrough, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { MEMBERS_C } from '../data/members-c.js';

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
const FOOD = 'Trout'; // cheap, bankable, prepped by the smoke — the def's only food
const RUNES = ['Air rune', 'Earth rune', 'Water rune'];

// Runes/food are withdrawn only AFTER the tomb (they cannot pass the tomb gate —
// content §Gotchas), so they are def-managed, not in the members-c record.
const RUNE_WITHDRAW = [
    { name: 'Air rune', qty: 6 },
    { name: 'Earth rune', qty: 6 },
    { name: 'Water rune', qty: 6 },
    { name: FOOD, qty: 10 }
];
// The tomb-gate deposit keep (content §tomb-gate): glarial items + rope + food +
// coins + book are all allowed through; everything else (weapons/armour/runes/
// logs/…) is forbidden, so a narrow keep guarantees entry.
const TOMB_KEEP = ['glarial', 'rope', FOOD.toLowerCase(), 'coins', 'book'];

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
const RAFT_STAND = new Tile(2509, 3493, 0);      // lograft "Log raft" op1 Board -> (2512,3481)
const BOOKCASE_STAND = new Tile(2520, 3426, 1);  // "Bookcase" op1 Search, UPSTAIRS (level 1)
const GOLRIE_CRATE_STAND = new Tile(2548, 9565, 0); // golrie_crate "Crate" op1 Search -> "A key"
const GOLRIE_GATE_STAND = new Tile(2515, 9574, 0);  // south side of golrie_gate "Door" (useOn key)
const GOLRIE_STAND = new Tile(2515, 9581, 0);       // Golrie, past the gate
const TOMBSTONE_STAND = new Tile(2558, 3444, 0);    // "Tombstone of glarial" (oplocu pebble) -> tomb (2554,9844)
const CHEST_STAND = new Tile(2530, 9845, 0);        // "Closed chest"->Open->"Open chest" Search -> amulet (forceapproach N)
const COFFIN_STAND = new Tile(2542, 9812, 0);       // "Tomb of glarial" op1 Search -> urn
const ROCK_STAND = new Tile(2512, 3478, 0);         // N-of-rock zone (2510-2514,3476-3481); useOn rope -> "Rock"
const BAX_CRATE_STAND = new Tile(2589, 9888, 0);    // baxtorian_crate "Crate" op1 Search -> "A key"
const PUZZLE_DOOR_STAND = new Tile(2566, 9900, 0);  // baxtorian_door_2 leaf "Door" @ (2566,9902); useOn key -> stage 6
const PILLAR_STAND = new Tile(2563, 9911, 0);       // inside the pillar room
const STATUE_STAND = new Tile(2565, 9915, 0);       // beside "Statue of Glarial" @ (2565,9916)
const CHALICE_STAND = new Tile(2603, 9911, 0);      // beside "Chalice of eternity" @ (2603,9910)
// Six pillars (content §Dungeon finale): one air + one earth + one water on each.
const PILLAR_TILES = [
    new Tile(2562, 9910, 0), new Tile(2562, 9912, 0), new Tile(2562, 9914, 0),
    new Tile(2569, 9910, 0), new Tile(2569, 9912, 0), new Tile(2569, 9914, 0)
];

const held = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

/** Live count-short check for the runes/food withdraw (position-guarded to the
 *  surface inside fallsAndDungeon, so it never re-fires mid-dungeon). */
function runesShortLive(): boolean {
    return RUNES.some(r => Inventory.count(r) < 6) || Inventory.count(FOOD) < 1;
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
    // Still on Almera's (north) bank -> ride the raft south (fires Hudon). The
    // arrival (2512,3481) and the bookcase area sit below z 3485, so a re-entry
    // after the raft skips it (no re-ride oscillation).
    if (here !== null && here.z > 3485) {
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
        await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && t.z <= 3485; }, 10_000);
        return false; // re-enter now that we are across
    }
    // Across: search the upstairs bookcase for the book, then read it.
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
    // Open the gate with the key if it is still closed (offers 'Open'); re-enter
    // so the next pass approaches Golrie through the opened gate.
    if (!(await walkWithHops(GOLRIE_GATE_STAND, 2, WATERFALL_HOPS, log))) {
        return false;
    }
    const closedGate = Locs.query().name('Door').action('Open').within(6).nearest();
    if (closedGate) {
        const key = Inventory.first(KEY);
        if (key) {
            await key.useOn(closedGate);
            await Execution.delayTicks(3);
        }
        return false;
    }
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
        // Clear forbidden items from the pack (narrow keep = guaranteed entry).
        if (!(await executeStep({ kind: 'deposit', keep: TOMB_KEEP }, WATERFALL_HOPS, log))) {
            return false;
        }
        // Strip worn gear (also gate-forbidden). Unequipping drops it into the
        // pack; the smoke account wears nothing so this is a no-op, and a worn-
        // gear edge self-heals: the gate bounces (no loss, teleport to the fail
        // coord) and the next re-entry deposits the now-in-pack gear.
        for (const it of Equipment.items()) {
            if (it.name) {
                await Equipment.unequip(it.name);
            }
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
    // Then the coffin (urn).
    if (!Inventory.contains(URN)) {
        if (!(await Traversal.walkResilient(COFFIN_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
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
    // Both looted — climb out. The exit ladder is UNPINNED (audit risk #1): find a
    // live Climb-up near the landing (2554,9844); log + return false if absent so
    // the smoke exposes it (no walk-out edge was curated).
    const ladder = Locs.query().action('Climb-up').within(15).nearest();
    if (!ladder) {
        log('tombLeg: no Climb-up ladder near the tomb landing (2554,9844) — LIVE-VERIFY the exit');
        return false;
    }
    if (!(await ladder.interact('Climb-up'))) {
        return false;
    }
    return Execution.delayUntil(() => { const t = Game.tile(); return t !== null && !isUnderground(t); }, 12_000);
}

/**
 * Rows 6-7 dispatcher. Item-identical (amulet+urn) so the split is by LIVE
 * position: underground -> the dungeon finale; surface -> stock the runes/food
 * (they could not pass the tomb gate, so they are withdrawn only now) then the
 * rope-and-ledge falls crossing.
 */
async function fallsAndDungeon(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    if (isUnderground(t)) {
        return dungeonLeg(log);
    }
    if (runesShortLive()) {
        return executeStep({ kind: 'withdraw', items: RUNE_WITHDRAW }, WATERFALL_HOPS, log);
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
    // On the ledge (arrive 2511,3463) -> Open the Ledge into the dungeon.
    if (atFalls && t.z >= 3461 && t.z <= 3465) {
        const door = Locs.query().name('Ledge').action('Open').within(6).nearest();
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
    // Anywhere else on the surface -> walk N of the crossing rock and rope it.
    if (!(await Traversal.walkResilient(ROCK_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    const rock = Locs.query().name('Rock').within(8).nearest();
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
 * Blind-place every remaining rune on every pillar (repeats are FREE no-ops —
 * the rune is kept when the bit is already set, waterfall_pillars.rs2:12). One
 * sweep per call; re-entrant until the pack is rune-empty (all 18 bits set), so
 * a silently dropped useOn self-corrects on the next sweep.
 */
async function placeRunes(log: (m: string) => void): Promise<boolean> {
    for (const pillarTile of PILLAR_TILES) {
        if (!(await Traversal.walkResilient(pillarTile, { radius: 1, attempts: 2, timeoutMs: 45_000, log }))) {
            continue;
        }
        for (const rune of RUNES) {
            const r = Inventory.first(rune);
            if (!r) {
                continue;
            }
            const pillar = Locs.query().name('Pillar').within(3).nearest();
            if (!pillar) {
                continue;
            }
            await r.useOn(pillar);
            await Execution.delayTicks(2);
        }
    }
    return false; // re-enter until rune-empty, then dungeonLeg routes to the statue
}

/**
 * Row 7 (content §Dungeon finale + quest_waterfall.rs2:370-488). Search the
 * baxtorian crate for the key; USE the key on the leaf at (2566,9902) to set
 * stage 6 (entered_puzzle_room — the statue's gate); blind-place all 18 runes;
 * USE the amulet on the Statue of Glarial (all bits set -> tele to the raised
 * room x>2600, amulet consumed); then USE the full urn on the Chalice. NEVER op1
 * 'Take treasure' the chalice (whirlpool) — only the urn USE completes it.
 */
async function dungeonLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    // Raised room (statue tele lands at 2603,9914) -> urn on the chalice = done.
    if (t.x >= 2600) {
        if (!(await Traversal.walkResilient(CHALICE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        const chalice = Locs.query().name('Chalice of eternity').within(6).nearest();
        const urn = Inventory.first(URN);
        if (!chalice || !urn) {
            log('dungeonLeg: no chalice or urn');
            return false;
        }
        if (!(await urn.useOn(chalice))) { // oplocu; op1 'Take treasure' is the trap
            return false;
        }
        await Execution.delayTicks(3);
        return true; // the complete queue flips the journal; next decide() -> done
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
    // Unlock the puzzle-room door leaf (stage 6) then step into the pillar room
    // (walkably open on the original side — audit §Region 154).
    const inPuzzle = t.x >= 2558 && t.x <= 2572 && t.z >= 9908 && t.z <= 9918;
    if (!inPuzzle) {
        if (!(await Traversal.walkResilient(PUZZLE_DOOR_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        const door = Locs.query().name('Door').action('Open').within(6).nearest();
        const key = Inventory.first(KEY);
        if (door && key) {
            await key.useOn(door);
            await Execution.delayTicks(3);
        }
        await Traversal.walkResilient(PILLAR_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log });
        return false;
    }
    // Blind-place all 18 runes.
    if (Inventory.contains('Air rune') || Inventory.contains('Earth rune') || Inventory.contains('Water rune')) {
        return placeRunes(log);
    }
    // All placed -> amulet on the statue (only reached rune-empty, so all bits are
    // set and the 20-hp boulder bounce is avoided).
    if (!(await Traversal.walkResilient(STATUE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const statue = Locs.query().name('Statue of Glarial').within(6).nearest();
    const amulet = Inventory.first(AMULET);
    if (!statue || !amulet) {
        log('dungeonLeg: no statue or amulet');
        return false;
    }
    if (!(await amulet.useOn(statue))) {
        return false;
    }
    return Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x >= 2600; }, 12_000);
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

    // Row 8: the statue consumed the amulet -> only urn-on-chalice remains. Because
    // tombLeg loots the chest (amulet) before the coffin (urn), urn-without-amulet
    // is UNIQUELY the post-statue state. The pebble persists all quest
    // (quest_waterfall.rs2:102 never deletes it), so routing keys on amulet/urn.
    if (hasUrn && !hasAmulet) { return { kind: 'custom', name: 'chalice finale', run: fallsAndDungeon }; }
    // Rows 5-7: tomb fully looted (amulet+urn) -> runes, falls crossing, dungeon.
    if (hasUrn && hasAmulet) { return { kind: 'custom', name: 'falls + dungeon', run: fallsAndDungeon }; }
    // Row 4: pebble in hand, tomb not fully looted (no urn yet).
    if (hasPebble) { return { kind: 'custom', name: 'tomb', run: tombLeg }; }
    // Row 3: past the book, no pebble -> Golrie pebble leg.
    if (hasBook) { return { kind: 'custom', name: 'pebble', run: pebbleLeg }; }
    // Row 2: empty-handed -> raft + Hudon + read the book.
    return { kind: 'custom', name: 'book', run: bookLeg };
}

export const waterfall: QuestModule = {
    record: MEMBERS_C.find(r => r.id === 'waterfall')!,
    // Every quest item a mid-quest restart may hold in the pack (the between-quest
    // deposit keeps these). 'glarial' covers pebble/amulet/urn; 'a key' covers both
    // keys; runes/food are def-withdrawn post-tomb but kept if already held.
    tools: ['glarial', 'a key', 'rope', 'book on baxtorian', 'trout', 'air rune', 'earth rune', 'water rune', 'coins'],
    hops: WATERFALL_HOPS,
    decide
};
