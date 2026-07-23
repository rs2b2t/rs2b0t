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

const PEBBLE = "Glarial's pebble";
const AMULET = "Glarial's amulet";
const URN = "Glarial's urn";
const BOOK = 'Book on baxtorian';
const KEY = 'A key';
const ROPE = 'Rope';
const RUNES = ['Air rune', 'Earth rune', 'Water rune'];

function foodName(): string | null { return QuestFood.name; }

function runeWithdraw(): { name: string; qty: number }[] {
    const f = foodName();
    return [
        { name: 'Air rune', qty: 6 },
        { name: 'Earth rune', qty: 6 },
        { name: 'Water rune', qty: 6 },
        ...(f ? [{ name: f, qty: 10 }] : [])
    ];
}
function tombKeep(): string[] {
    const f = foodName();
    return ['glarial', 'rope', 'coins', 'book', ...(f ? [f.toLowerCase()] : [])];
}
const ARDOUGNE_BANK = new Tile(2616, 3332, 0);
const ARDOUGNE_GENERAL = { npc: 'Aemad', anchor: new Tile(2614, 3293, 0) };
const BETTY_SHOP = { npc: 'Betty', anchor: new Tile(3012, 3259, 0) };

const ALMERA: NpcStop = { npc: 'Almera', anchor: new Tile(2522, 3498, 0), leash: 6, prefer: ['How can I help?'] };
const GOLRIE_PREFER = ['Do you mind if I have a look?', 'No, of course not.', 'Could I take this old pebble?'];

const WATERFALL_HOPS: LadderHop[] = [
    { stand: new Tile(2533, 3156, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(2533, 9556, 0) },
    { stand: new Tile(2533, 9556, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(2533, 3156, 0) }
];

const RAFT_STAND = new Tile(2509, 3493, 0);
const MOUND_SWIM_STAND = new Tile(2512, 3476, 0);
const BOOKCASE_STAND = new Tile(2519, 3426, 1);
const GOLRIE_CRATE_STAND = new Tile(2548, 9565, 0);
const GOLRIE_GATE_STAND = new Tile(2515, 9574, 0);
const GOLRIE_STAND = new Tile(2515, 9581, 0);
const TOMBSTONE_STAND = new Tile(2558, 3444, 0);
const CHEST_STAND = new Tile(2530, 9845, 0);
const COFFIN_STAND = new Tile(2542, 9810, 0);
const TOMB_LADDER_STAND = new Tile(2554, 9844, 0);
const ROCK_STAND = new Tile(2512, 3477, 0);
const BAX_CRATE_STAND = new Tile(2589, 9888, 0);
const SOUTH_DOOR_STAND = new Tile(2568, 9892, 0);
const PUZZLE_DOOR_STAND = new Tile(2566, 9900, 0);
const PILLAR_STAND = new Tile(2563, 9911, 0);
const STATUE_STAND = new Tile(2565, 9915, 0);
const DOOR_LEAF_STAND = new Tile(2603, 9900, 0);

const held = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

function runesShortLive(): boolean {
    return RUNES.some(r => Inventory.count(r) < 6);
}

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

function amuletHeldLive(): boolean {
    return Inventory.count(AMULET) > 0 || Equipment.contains(AMULET);
}

function totalRunes(): number {
    return RUNES.reduce((n, r) => n + Inventory.count(r), 0);
}

async function readBook(_log: (m: string) => void): Promise<boolean> {
    const book = Inventory.first(BOOK);
    if (!book) {
        return false;
    }
    await book.interact('Read');
    await Execution.delayTicks(3);
    await Execution.delayTicks(1);
    return true;
}

async function bookLeg(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(BOOK)) {
        return readBook(log);
    }
    const here = Game.tile();
    if (here === null) {
        return false;
    }
    const onMound = here.x >= 2508 && here.x <= 2515 && here.z >= 3474 && here.z <= 3485;
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
        await Execution.delayUntil(() => ChatDialog.canContinue(), 8000);
        for (let i = 0; i < 14 && ChatDialog.canContinue(); i++) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
        }
        await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && t.x <= 2515 && t.z <= 3485; }, 10_000);
        return false;
    }
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
        await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && t.x >= 2520; }, 12_000);
        return false;
    }
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

async function pebbleLeg(log: (m: string) => void): Promise<boolean> {
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
                await Execution.delayUntil(() => { const t = Game.tile(); return t !== null && t.z >= 9576; }, 6000);
            }
        }
        return false;
    }
    if (!(await Traversal.walkResilient(GOLRIE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    await talkThrough('Golrie', GOLRIE_PREFER, log);
    return Inventory.contains(PEBBLE);
}

async function tombLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const inTomb = here !== null && isUnderground(here) && here.z >= 9800 && here.z < 9850;
    if (!inTomb) {
        const hadGear = Equipment.items().length > 0;
        for (const it of Equipment.items()) {
            if (it.name) {
                await Equipment.unequip(it.name);
            }
        }
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
        if (!(await pebble.useOn(stone))) {
            return false;
        }
        return Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && isUnderground(t) && t.z >= 9800 && t.z < 9850;
        }, 12_000);
    }
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
    return false;
}

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

async function fallsAndDungeon(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    if (isUnderground(t)) {
        if (t.z < 9850) {
            return tombExit(log);
        }
        return dungeonLeg(log);
    }
    if (!amuletHeldLive()) {
        return tombLeg(log);
    }
    if (runesShortLive()) {
        return ensureRunes(log);
    }
    return fallsLeg(log);
}

async function fallsLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    const atFalls = t.x >= 2505 && t.x <= 2518;
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
        return false;
    }
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

async function placeRunes(_log: (m: string) => void): Promise<void> {
    const pillars = Locs.query().name('Pillar').within(20).results();
    for (const pillar of pillars) {
        for (const rune of RUNES) {
            const r = Inventory.first(rune);
            if (!r) {
                continue;
            }
            const before = totalRunes();
            await r.useOn(pillar);
            await Execution.delayUntil(() => totalRunes() < before, 6000);
        }
    }
}

async function dungeonLeg(log: (m: string) => void): Promise<boolean> {
    const t = Game.tile();
    if (t === null) {
        return false;
    }
    if (t.x >= 2600 && t.z >= 9906) {
        const chalice = Locs.query().name('Chalice of eternity').within(12).nearest();
        const urn = Inventory.first(URN);
        if (!chalice || !urn) {
            log('dungeonLeg: no chalice or urn in the raised room');
            return false;
        }
        if (!(await urn.useOn(chalice))) {
            return false;
        }
        await Execution.delayTicks(3);
        return true;
    }
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
    const inPuzzle = t.x >= 2558 && t.x <= 2572 && t.z >= 9908 && t.z <= 9918;
    if (!inPuzzle) {
        const key = Inventory.first(KEY);
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
        await Traversal.walkResilient(PILLAR_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log });
        return false;
    }
    const runesBefore = totalRunes();
    await placeRunes(log);
    const placed = runesBefore - totalRunes();

    if (!(await Traversal.walkResilient(STATUE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const statue = Locs.query().name('Statue of Glarial').within(6).nearest();
    const amulet = Inventory.first(AMULET);
    if (statue && amulet) {
        await amulet.useOn(statue);
    }
    if (await Execution.delayUntil(() => { const g = Game.tile(); return g !== null && g.x >= 2600 && g.z >= 9906; }, 12_000)) {
        return false;
    }
    if (placed > 0) {
        return false;
    }
    if (!amuletHeldLive() && Inventory.contains(KEY)) {
        await Traversal.walkResilient(DOOR_LEAF_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log });
    }
    return false;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: ALMERA }; }

    const hasPebble = held(snap, PEBBLE);
    const hasAmulet = held(snap, AMULET) || worn(snap, AMULET);
    const hasUrn = held(snap, URN);
    const hasBook = held(snap, BOOK);

    if (hasUrn && !hasAmulet) { return { kind: 'custom', name: 'amulet re-obtain', run: fallsAndDungeon }; }
    if (hasUrn && hasAmulet) { return { kind: 'custom', name: 'falls + dungeon', run: fallsAndDungeon }; }
    if (hasPebble) { return { kind: 'custom', name: 'tomb', run: tombLeg }; }
    if (hasBook) { return { kind: 'custom', name: 'pebble', run: pebbleLeg }; }
    return { kind: 'custom', name: 'book', run: bookLeg };
}

function gatherRope(snap: QuestSnapshot, need: number): QuestStep {
    const estGp = 20 * Math.max(1, need);
    if (gpShort(snap, estGp) > 0) {
        return { kind: 'wait', reason: `need ~${estGp} gp to re-buy Rope after a death` };
    }
    return { kind: 'buy', item: 'Rope', qty: Math.max(1, need), shop: ARDOUGNE_GENERAL, estGp };
}

export const waterfall: QuestModule = {
    record: QUESTS.find(r => r.id === 'waterfall')!,
    bank: ARDOUGNE_BANK,
    food: 8,
    gather: { rope: gatherRope },
    tools: ['glarial', 'a key', 'rope', 'book on baxtorian', 'trout', 'air rune', 'earth rune', 'water rune', 'coins'],
    hops: WATERFALL_HOPS,
    decide
};
