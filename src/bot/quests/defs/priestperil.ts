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
import { Bank } from '../../api/hud/Bank.js';
import { driveDialog, gotoNpc, isUnderground, talkThrough, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { executeStep, openBankLeg } from '../exec/steps.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { QUESTS } from '../data/quests.js';

const GOLDEN_KEY_ID = 2944;
const IRON_KEY_ID = 2945;
const MURKY_ID = 2953;
const BLESSED_ID = 2954;
const MONK3_NPC_ID = 1046;

const ROALD: NpcStop = { npc: 'King Roald', anchor: new Tile(3222, 3476, 0), leash: 6, prefer: ['Sure.'] };
const DREZEL_CELL: NpcStop = { npc: 'Drezel', anchor: new Tile(3416, 3489, 2), leash: 3, prefer: [] };
const DREZEL_MAUS: NpcStop = { npc: 'Drezel', anchor: new Tile(3439, 9895, 0), leash: 4, prefer: [] };

const TEMPLE_DOOR_OUT = new Tile(3406, 3488, 0);
const TEMPLE_LOBBY = new Tile(3412, 3487, 0);
const DOG_TILE = new Tile(3405, 9902, 0);
const GATE1 = new Tile(3405, 9895, 0);
const GATE2 = new Tile(3431, 9897, 0);
const WELL_STAND = new Tile(3423, 9889, 0);
const CELL_DOOR = new Tile(3415, 3489, 2);
const CELL_DOOR_STAND = new Tile(3414, 3489, 2);
const COFFIN = new Tile(3413, 3486, 2);
const AUBURY_TILE = new Tile(3253, 3402, 0);
const VARROCK_EAST_BANK = new Tile(3253, 3420, 0);
const VARROCK_GENERAL = { npc: 'Shop keeper', anchor: new Tile(3218, 3414, 0) };

const MONUMENTS: Tile[] = [
    new Tile(3428, 9890, 0),
    new Tile(3416, 9890, 0),
    new Tile(3423, 9895, 0),
    new Tile(3423, 9884, 0),
    new Tile(3427, 9894, 0),
    new Tile(3427, 9885, 0),
    new Tile(3418, 9894, 0)
];

const HOPS: LadderHop[] = [
    { stand: new Tile(3405, 3506, 0), locName: 'Trapdoor', op: 'Climb-down', open: 'Open', arrive: new Tile(3405, 9907, 0) },
    { stand: new Tile(3405, 9907, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(3405, 3507, 0) }
];

const KNOCK_PREFER = ['Roald sent me to check on Drezel.', 'Sure.'];
const CELL_STORY_PREFER = ['Tell me anyway.', 'Yes.'];

const QUEST_NAME = 'Priest in Peril';
const ESSENCE_NEEDED = 50;

const has = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name) ?? 0) > 0;
const heldId = (id: number): boolean => Inventory.items().some(i => i.id === id);
const freeSlots = (): number => 28 - Inventory.items().length;
const journalComplete = (): boolean => Quests.status(QUEST_NAME) === 'complete';

async function walkTo(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    return walkWithHops(dest, radius, HOPS, log);
}

async function reachAndTalk(stop: NpcStop, log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(stop.anchor, 2, log))) {
        return false;
    }
    return talkThrough(stop.npc, stop.prefer, log);
}

async function tryOpen(name: string, near: Tile, log: (m: string) => void): Promise<boolean> {
    const closed = () => Locs.query().name(name).action('Open')
        .where(l => l.tile().distanceTo(near) <= 2).nearest();
    const here = Game.tile();
    if (here && here.level === near.level && near.distanceTo(here) <= 10 && closed() === null) {
        return true;
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
    return Execution.delayUntil(() => closed() === null, 4000);
}

function insideTemple(t: { x: number; z: number; level: number }): boolean {
    if (t.level >= 1) {
        return true;
    }
    return t.x >= 3409 && t.x <= 3418 && t.z >= 3483 && t.z <= 3493;
}

async function enterTemple(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && insideTemple(here)) {
        return true;
    }
    if (!(await walkTo(TEMPLE_DOOR_OUT, 1, log))) {
        return false;
    }
    const leaf = Locs.query().name('Large door').action('Open').within(4).nearest();
    if (!leaf) {
        return false;
    }
    if (!(await leaf.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const t = Game.tile();
        return t !== null && insideTemple(t);
    }, 6000);
}

async function killTarget(npc: { index: number; interact(op: string): boolean | Promise<boolean> }, name: RegExp): Promise<boolean> {
    const idx = npc.index;
    if (!(await npc.interact('Attack'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Game.inCombat(), 5000))) {
        return false;
    }
    return Execution.delayUntil(() => !Npcs.all().some(n => n.index === idx && name.test(n.name ?? '')), 90_000);
}

async function earlyLeg(log: (m: string) => void): Promise<boolean> {
    log('priestperil: early phase — knock, dog, Roald');
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
    if (!(await walkTo(DOG_TILE, 8, log))) {
        return false;
    }
    const dog = Npcs.query().name('Temple guardian').action('Attack').within(12).nearest();
    if (dog) {
        log('priestperil: attacking Temple guardian');
        await killTarget(dog, /temple guardian/i);
    }
    if (!(await gotoNpc(ROALD, HOPS, log))) {
        return false;
    }
    log('priestperil: reporting to King Roald');
    await talkThrough('King Roald', ROALD.prefer, log);
    return false;
}

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

async function monkHuntLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(TEMPLE_LOBBY, 3, log))) {
        return false;
    }
    const drop = GroundItems.query().name('Golden key').within(16).nearest();
    if (drop) {
        if (!(await drop.interact('Take'))) {
            return false;
        }
        await Execution.delayUntil(() => heldId(GOLDEN_KEY_ID), 6000);
        return false;
    }
    const monk = Npcs.query().where(n => n.id === MONK3_NPC_ID).action('Attack').within(14).nearest();
    if (!monk) {
        log('priestperil: no key-dropping Monk of Zamorak (id 1046) in the temple — waiting on respawn');
        await Execution.delayTicks(4);
        return false;
    }
    log('priestperil: attacking Monk of Zamorak (id 1046) for the golden key');
    await killTarget(monk, /monk of zamorak/i);
    return false;
}

async function spineLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }

    if (isUnderground(here)) {
        const dog = Npcs.query().name('Temple guardian').action('Attack').within(20).nearest();
        if (dog) {
            if (!(await walkTo(DOG_TILE, 6, log))) {
                return false;
            }
            const d = Npcs.query().name('Temple guardian').action('Attack').within(12).nearest();
            if (d && (await killTarget(d, /temple guardian/i))) {
                if (!(await gotoNpc(ROALD, HOPS, log))) {
                    return false;
                }
                await talkThrough('King Roald', ROALD.prefer, log);
                return false;
            }
        }
        if (await tryOpen('Gate', GATE1, log)) {
            if (await tryOpen('Gate', GATE2, log)) {
                return essenceLeg(log);
            }
        }
        await walkTo(TEMPLE_DOOR_OUT, 3, log);
        return false;
    }

    if (!(await enterTemple(log))) {
        log('priestperil: temple door locked (stage < 4) — early phase');
        return earlyLeg(log);
    }
    log('priestperil: inside the temple (stage >= 4)');
    if (await tryOpen('Cell door', CELL_DOOR, log)) {
        return waterLeg(log);
    }
    return monkHuntLeg(log);
}

async function monumentLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await tryOpen('Gate', GATE1, log))) {
        if (!(await enterTemple(log))) {
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
            return false;
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
        if (!(await key.useOn(monument))) {
            continue;
        }
        await Execution.delayTicks(3);
    }
    if (heldId(IRON_KEY_ID)) {
        log('priestperil: iron key obtained');
    } else {
        log('priestperil: golden key fit NO monument — iron key already claimed and lost?');
    }
    return false;
}

async function unlockLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await enterTemple(log))) {
        return false;
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
    return false;
}

async function waterLeg(log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here === null) {
        return false;
    }

    if (heldId(BLESSED_ID)) {
        if (!(await enterTemple(log))) {
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
        await reachAndTalk(DREZEL_CELL, log);
        return false;
    }

    if (heldId(MURKY_ID)) {
        if (!(await enterTemple(log))) {
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

    if (!(await enterTemple(log))) {
        return false;
    }
    if (!(await tryOpen('Cell door', CELL_DOOR, log))) {
        return false;
    }
    log('priestperil: water — talking Drezel (hint at 6, advances 7 -> 8)');
    await reachAndTalk(DREZEL_CELL, log);
    if ((await tryOpen('Gate', GATE1, log)) && (await tryOpen('Gate', GATE2, log))) {
        log('priestperil: water done — both gates open, handing to essence');
        return essenceLeg(log);
    }
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
    if (!(await executeStep({ kind: 'withdraw', items: [{ name: 'Bucket', qty: 1 }] }, HOPS, log)) || !Inventory.contains('Bucket')) {
        await executeStep({ kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 }, HOPS, log);
    }
    return false;
}

async function bankEarlyEssence(log: (m: string) => void): Promise<boolean> {
    log('priestperil: essence held but a gate is stage-locked — banking it until the essence phase');
    if (!(await walkTo(TEMPLE_DOOR_OUT, 3, log))) {
        return false;
    }
    if (!(await openBankLeg('priestperil: essence-bank — no known bank', VARROCK_EAST_BANK, log))) {
        return false;
    }
    await Bank.depositAllMatching(name => name.toLowerCase() === 'rune essence', log);
    await Execution.delayUntil(() => Inventory.count('Rune essence') === 0, 6000);
    return false;
}

async function essenceLeg(log: (m: string) => void): Promise<boolean> {
    if (journalComplete()) {
        if (Inventory.contains('Wolfbane')) {
            await reachAndTalk(DREZEL_MAUS, log);
        }
        return true;
    }

    if (Inventory.count('Rune essence') > 0) {
        if (!(await tryOpen('Gate', GATE1, log))) {
            log('priestperil: Gate 1 refused during essence phase — mis-signalled essence in pack');
            return bankEarlyEssence(log);
        }
        if (!(await tryOpen('Gate', GATE2, log))) {
            log('priestperil: Gate 2 refused during essence phase — mis-signalled essence in pack');
            return bankEarlyEssence(log);
        }
        if (!(await walkTo(DREZEL_MAUS.anchor, 2, log))) {
            return false;
        }
        const before = Inventory.count('Rune essence');
        log(`priestperil: essence — handing ${before} to Drezel`);
        await talkThrough('Drezel', DREZEL_MAUS.prefer, log);
        await Execution.delayUntil(() => Inventory.count('Rune essence') < before || journalComplete(), 10_000);
        if (journalComplete()) {
            await Execution.delayTicks(2);
            if (Inventory.contains('Wolfbane')) {
                await reachAndTalk(DREZEL_MAUS, log);
            }
            return true;
        }
        return false;
    }

    if (!(await walkTo(TEMPLE_DOOR_OUT, 3, log))) {
        return false;
    }
    const want = Math.min(Math.max(freeSlots() - 1, 1), ESSENCE_NEEDED);
    log(`priestperil: essence — pack empty, withdrawing ${want} from Varrock East bank`);
    if (await executeStep({ kind: 'withdraw', items: [{ name: 'Rune essence', qty: want }], bank: VARROCK_EAST_BANK }, HOPS, log)) {
        if (Inventory.count('Rune essence') > 0) {
            return false;
        }
    }
    log('priestperil: essence — bank dry, mining the shortfall via Aubury');
    return mineEssence(log);
}

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
    for (let i = 0; i < 40 && freeSlots() > 0; i++) {
        const at = Game.tile();
        if (at === null || !inEssMine(at.x, at.z)) {
            log('priestperil: essence — left the mine mid-dig (random event?); yielding');
            return false;
        }
        const rock = Locs.query().name('Rune Essence').action('Mine').nearest();
        if (!rock) {
            await Execution.delayTicks(3);
            continue;
        }
        if (!(await rock.interact('Mine'))) {
            await Execution.delayTicks(2);
            continue;
        }
        await Execution.delayUntil(() => {
            if (freeSlots() === 0) { return true; }
            const t = Game.tile();
            return t === null || !inEssMine(t.x, t.z);
        }, 30_000);
    }
    const portal = Locs.query().name('Portal').action('Use').nearest();
    if (portal) {
        await portal.interact('Use');
        await Execution.delayUntil(() => {
            const t = Game.tile();
            return t !== null && !inEssMine(t.x, t.z);
        }, 12_000);
    } else {
        log('priestperil: essence — no Portal to leave the mine; retrying');
    }
    return false;
}

function gatherBucket(): QuestStep {
    return { kind: 'buy', item: 'Bucket', qty: 1, shop: VARROCK_GENERAL, estGp: 15 };
}

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
    bank: new Tile(3253, 3420, 0),
    food: 8,
    grind: ['temple guardian', 'monk of zamorak'],
    tools: ['golden key', 'iron key', 'bucket', 'wolfbane', 'rune essence', 'pickaxe', 'coins'],
    gather: {
        'bucket': gatherBucket
    },
    hops: HOPS,
    decide
};
