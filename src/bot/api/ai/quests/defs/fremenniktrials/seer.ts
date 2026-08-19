import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Reach } from '../../../../walking/Reach.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { pickPreferred } from '../../exec/primitives.js';
import { promptLoc, settleScene, useOnLoc } from '../../exec/prompts.js';
import { FT_ID, FT_LOC, FT_TILE, PEER, inPuzzleRoom, inSeerEast, inSeerWest } from './areas.js';
import { combine, walkTo } from './supplies.js';

/** `combolockdoor` from pack/interface.pack: root 10051, then the four dials with their buttons, then Enter. */
const COMBO = {
    ROOT: 10051,
    LETTER: [10095, 10096, 10097, 10098],
    DOWN: [10099, 10101, 10103, 10105],
    UP: [10100, 10102, 10104, 10106],
    ENTER: 10109
} as const;

const ALPHABET = 26;

/** One of six riddles is rolled when the trial starts; these phrases name the answer. */
const RIDDLES: readonly [RegExp, string][] = [
    [/my first is in mage, but not in wizard|powerful\s*\|?\s*tool you will possess/i, 'MIND'],
    [/my first is in tar, but not in a swamp|wears more rings the older/i, 'TREE'],
    [/my first is in the well, but not at sea|when stolen from you causes you death/i, 'LIFE'],
    [/my first is in fish, but not in the sea|cannot die as long as it has food/i, 'FIRE'],
    [/my first is in water, and also in tea|crushes mountains, drains rivers/i, 'TIME'],
    [/my first is in wizard, but not in a mage|helps to make bread, let birds fly/i, 'WIND']
];

// Why: once Thorvald's trial is open Peer leads with the deposit offer, and taking it never starts his own.
const PEER_START = ['Ask about becoming a Fremennik', 'Yes'];
export const PEER_BANK = ['Ask about depositing your equipment', 'Bank your equipment', 'Yes'];

const holding = (id: number): boolean => Inventory.countById(id) > 0;
const carried = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;

const BUCKETS = [FT_ID.BUCKET_EMPTY, FT_ID.BUCKET_1, FT_ID.BUCKET_2, FT_ID.BUCKET_3, FT_ID.BUCKET_4, FT_ID.BUCKET_5];
const JUGS = [FT_ID.JUG_EMPTY, FT_ID.JUG_1, FT_ID.JUG_2, FT_ID.JUG_3];

/** How full the carried vessel is, or -1 when it is not carried. */
function level(ids: readonly number[], snap: QuestSnapshot): number {
    return ids.findIndex(id => carried(snap, id) > 0);
}

/**
 * Peer's trial: enter his house with nothing, answer the riddle on the lock,
 * then work the puzzle floor out through the far door.
 */
export function seerStep(snap: QuestSnapshot): QuestStep | null {
    if (hasFlag(snap.progress, 'seer-done')) {
        return null;
    }
    if (!hasFlag(snap.progress, 'seer-started')) {
        return { kind: 'talk', stop: PEER(PEER_START) };
    }
    if (inPuzzleRoom(snap.tile)) {
        return puzzleFloor(snap);
    }
    if (inSeerEast(snap.tile)) {
        return eastRoom(snap);
    }
    if (inSeerWest(snap.tile)) {
        return { kind: 'custom', name: 'climb to the puzzle floor', run: climbWest };
    }
    // Why: the trial refuses anyone carrying or wearing anything, and Peer's own spell is the only bank within reach.
    if (snap.inv.size > 0 || snap.worn.size > 0) {
        return { kind: 'talk', stop: PEER(PEER_BANK) };
    }
    return { kind: 'custom', name: "solve the lock on Peer's door", run: solveRiddleAndEnter };
}

// The puzzle floor

function puzzleFloor(snap: QuestSnapshot): QuestStep {
    if (carried(snap, FT_ID.SEERS_KEY) > 0) {
        return { kind: 'custom', name: 'take the trapdoor down to the locked door', run: goDownEast };
    }
    if (carried(snap, FT_ID.FROZEN_KEY) > 0) {
        return useOnLocStep(FT_ID.FROZEN_KEY, 'Cooking range', FT_LOC.RANGE, FT_TILE.PUZZLE_RANGE,
            () => holding(FT_ID.SEERS_KEY), 'melt the ice off the key');
    }
    if (carried(snap, FT_ID.SEALED_VASE_WATER) > 0) {
        return useOnLocStep(FT_ID.SEALED_VASE_WATER, 'Frozen table', FT_LOC.FROZEN_TABLE, FT_TILE.PUZZLE_FROZEN_TABLE,
            () => holding(FT_ID.FROZEN_KEY), 'freeze the sealed vase until it shatters');
    }
    if (carried(snap, FT_ID.VASE_WATER) > 0 && carried(snap, FT_ID.VASE_LID) > 0) {
        return combine(FT_ID.VASE_LID, FT_ID.VASE_WATER, FT_ID.SEALED_VASE_WATER, 'screw the lid onto the full vase');
    }
    if (carried(snap, FT_ID.VASE) > 0 && carried(snap, FT_ID.VASE_LID) > 0) {
        return useOnLocStep(FT_ID.VASE, 'Tap', FT_LOC.TAP, FT_TILE.PUZZLE_TAP,
            () => holding(FT_ID.VASE_WATER), 'fill the vase from the tap');
    }
    if (carried(snap, FT_ID.VASE) > 0) {
        return { kind: 'custom', name: 'take the trapdoor down to the mural', run: goDownEast };
    }
    if (carried(snap, FT_ID.RED_DISK) < 2) {
        return collectDisks(snap);
    }
    return measureWater(snap);
}

// Why: the bookcase and both mounted heads stop giving once their disk is in the mural, so the order here is also the recovery order.
function collectDisks(snap: QuestSnapshot): QuestStep {
    const goop = carried(snap, FT_ID.RED_GOOP) > 0;
    const wooden = carried(snap, FT_ID.WOODEN_DISK) > 0;
    if (carried(snap, FT_ID.RED_DISK) === 0 && !goop && !wooden) {
        return locStep("Unicorn's head", 'Study', FT_LOC.UNICORN_HEAD, FT_TILE.PUZZLE_UNICORN,
            () => holding(FT_ID.RED_DISK), 'take the red disk from the unicorn head');
    }
    if (!wooden && !goop) {
        return locStep("Bull's head", 'Study', FT_LOC.BULL_HEAD, FT_TILE.PUZZLE_BULL,
            () => holding(FT_ID.WOODEN_DISK), 'take the wooden disk from the bull head');
    }
    if (goop) {
        return combine(FT_ID.RED_GOOP, FT_ID.WOODEN_DISK, FT_ID.RED_DISK, 'paint the wooden disk red');
    }
    if (carried(snap, FT_ID.RED_HERRING) === 0) {
        return locStep('Bookcase', 'Search', FT_LOC.BOOKCASE, FT_TILE.PUZZLE_BOOKCASE,
            () => holding(FT_ID.RED_HERRING), 'find the red herring behind the books');
    }
    return useOnLocStep(FT_ID.RED_HERRING, 'Cooking range', FT_LOC.RANGE, FT_TILE.PUZZLE_RANGE,
        () => holding(FT_ID.RED_GOOP), 'cook the red herring for its dye');
}

// Why: the chest's balance opens on four fifths, and the only vessels in the room hold three and five.

/** Fill the five-bucket to four using the three-jug, then trade it for the vase. */
function measureWater(snap: QuestSnapshot): QuestStep {
    const jug = level(JUGS, snap);
    const bucket = level(BUCKETS, snap);
    if (jug < 0) {
        return searchChest();
    }
    if (bucket < 0) {
        return openCupboard();
    }
    if (bucket === 4) {
        return useOnLocStep(FT_ID.BUCKET_4, 'Chest', FT_LOC.SCALES_CHEST, FT_TILE.PUZZLE_SCALES,
            () => holding(FT_ID.VASE), 'balance the scales with a four-fifths bucket');
    }
    if (bucket === 5) {
        return useOnLocStep(FT_ID.BUCKET_5, 'Drain', FT_LOC.DRAIN, FT_TILE.PUZZLE_DRAIN,
            () => holding(FT_ID.BUCKET_EMPTY), 'empty the bucket down the drain');
    }
    if (jug > 0 && (bucket === 0 || jug === 3)) {
        const poured = Math.min(5, bucket + jug);
        return combine(JUGS[jug]!, BUCKETS[bucket]!, BUCKETS[poured]!, 'pour the jug into the bucket');
    }
    return useOnLocStep(JUGS[jug]!, 'Tap', FT_LOC.TAP, FT_TILE.PUZZLE_TAP,
        () => holding(FT_ID.JUG_3), 'fill the jug from the tap');
}

function searchChest(): QuestStep {
    return {
        kind: 'custom',
        name: 'open the chest and take the jug',
        run: async log => {
            await openContainer(FT_LOC.SEER_CHEST_SHUT, FT_LOC.SEER_CHEST_OPEN, FT_TILE.PUZZLE_CHEST, log);
            const status = await Reach.locOp({
                name: 'Chest',
                op: 'Search',
                near: FT_TILE.PUZZLE_CHEST,
                within: 4,
                expect: () => holding(FT_ID.JUG_EMPTY),
                expectMs: 15_000,
                log
            });
            return status === 'done';
        }
    };
}

function openCupboard(): QuestStep {
    return {
        kind: 'custom',
        name: 'open the cupboard and take the bucket',
        run: async log => {
            await openContainer(FT_LOC.CUPBOARD_SHUT, FT_LOC.CUPBOARD_OPEN, FT_TILE.PUZZLE_CUPBOARD, log);
            const status = await Reach.locOp({
                name: 'Cupboard',
                op: 'Search',
                near: FT_TILE.PUZZLE_CUPBOARD,
                within: 4,
                expect: () => holding(FT_ID.BUCKET_EMPTY),
                expectMs: 15_000,
                log
            });
            return status === 'done';
        }
    };
}

// Why: a loc that transforms keeps its old id for a tick, so the Search that follows has to wait for the open id rather than a fixed delay.
async function openContainer(shutId: number, openId: number, near: Tile, log: (m: string) => void): Promise<void> {
    const opened = (): boolean => Locs.query().where(l => l.id === openId).within(5).nearest() !== null;
    if (opened()) {
        return;
    }
    const find = () => Locs.query().where(l => l.id === shutId).action('Open').within(5).nearest();
    if (!find()) {
        await walkTo(near, 1, log);
        await settleScene();
    }
    const shut = find();
    if (shut && (await shut.interact('Open'))) {
        await Execution.delayUntil(opened, 6000);
    }
}

// The mural room, one floor below the second door

function eastRoom(snap: QuestSnapshot): QuestStep {
    if (carried(snap, FT_ID.SEERS_KEY) > 0) {
        return { kind: 'custom', name: 'unlock the far door', run: unlockExit };
    }
    if (carried(snap, FT_ID.RED_DISK) > 0) {
        return { kind: 'custom', name: 'press a red disk into the mural', run: pressDisk };
    }
    // Why: the mural hands the lid back to anyone whose two disks are already in it, so this must be gated on still needing one.
    if (carried(snap, FT_ID.VASE) > 0 && carried(snap, FT_ID.VASE_LID) === 0) {
        return locStep('Abstract mural', 'Study', FT_LOC.MURAL, FT_TILE.MURAL_STAND,
            () => holding(FT_ID.VASE_LID), 'take the vase lid out of the mural');
    }
    return { kind: 'custom', name: 'climb back to the puzzle floor', run: climbEast };
}

async function pressDisk(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.countById(FT_ID.RED_DISK);
    return useOnLoc(
        FT_ID.RED_DISK,
        { name: 'Abstract mural', near: FT_TILE.MURAL_STAND, id: FT_LOC.MURAL, within: 4 },
        [],
        () => Inventory.countById(FT_ID.RED_DISK) < before,
        log
    );
}

// Step builders

// Why: both mounted heads answer with `~mesbox`, which suspends the script until the box is continued — the disk lands after the click, not on it.
function locStep(name: string, op: string, id: number, near: Tile, expect: () => boolean, label: string): QuestStep {
    return {
        kind: 'custom',
        name: label,
        run: log => promptLoc({ name, op, near, id, within: 4, expect, expectMs: 20_000 }, log)
    };
}

function useOnLocStep(itemId: number, name: string, id: number, near: Tile, expect: () => boolean, label: string): QuestStep {
    return {
        kind: 'custom',
        name: label,
        run: log => useOnLoc(itemId, { name, near, id, within: 4 }, [], expect, log)
    };
}

async function climb(near: Tile, id: number, log: (m: string) => void): Promise<boolean> {
    const status = await Reach.locOp({
        name: 'Ladder',
        op: 'Climb-up',
        near,
        id,
        expect: () => inPuzzleRoom(Game.tile()),
        log
    });
    return status === 'done';
}

const climbWest = (log: (m: string) => void): Promise<boolean> => climb(FT_TILE.SEER_UP_LADDER, FT_LOC.SEER_UP_LADDER, log);
const climbEast = (log: (m: string) => void): Promise<boolean> => climb(FT_TILE.SEER_DOWN_LADDER, FT_LOC.SEER_DOWN_LADDER, log);

// Why: the east trapdoor starts shut and `loc_change` gives it the same id as the western one, so the search radius, not the id, is what keeps them apart.
async function goDownEast(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(FT_TILE.PUZZLE_EAST_TRAPDOOR, 0, log))) {
        return false;
    }
    await settleScene();
    const findOpen = () => Locs.query().where(l => l.id === FT_LOC.TRAPDOOR_OPEN).action('Climb-down').within(3).nearest();
    const shut = Locs.query().where(l => l.id === FT_LOC.TRAPDOOR_SHUT).action('Open').within(3).nearest();
    if (shut) {
        if (!(await shut.interact('Open'))) {
            return false;
        }
        await Execution.delayUntil(() => findOpen() !== null, 6000);
    }
    const open = findOpen();
    if (!open) {
        log('the east trapdoor never opened');
        return false;
    }
    if (!(await open.interact('Climb-down'))) {
        return false;
    }
    return Execution.delayUntil(() => inSeerEast(Game.tile()), 8000);
}

async function unlockExit(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(FT_TILE.SEER_DOOR2_INNER, 0, log))) {
        return false;
    }
    await settleScene();
    const door = Locs.query().where(l => l.id === FT_LOC.SEER_DOOR2).within(4).nearest();
    const key = Inventory.items().find(i => i.id === FT_ID.SEERS_KEY);
    if (!door || !key) {
        log('no locked door or no key in range');
        return false;
    }
    if (!(await key.useOn(door))) {
        return false;
    }
    return Execution.delayUntil(() => !holding(FT_ID.SEERS_KEY), 8000);
}

// The riddle lock

export function riddleAnswer(text: string): string | null {
    return RIDDLES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

async function setDial(index: number, letter: string, log: (m: string) => void): Promise<boolean> {
    const target = letter.charCodeAt(0) - 65;
    for (let press = 0; press <= ALPHABET; press++) {
        const shown = (reader.ifText(COMBO.LETTER[index]!) ?? 'A').trim().toUpperCase();
        if (shown.charCodeAt(0) - 65 === target) {
            return true;
        }
        const current = shown.charCodeAt(0) - 65;
        const up = (target - current + ALPHABET) % ALPHABET;
        const down = (current - target + ALPHABET) % ALPHABET;
        if (!actions.ifButton(up <= down ? COMBO.UP[index]! : COMBO.DOWN[index]!)) {
            log(`could not press dial ${index + 1}`);
            return false;
        }
        await Execution.delayUntil(() => (reader.ifText(COMBO.LETTER[index]!) ?? '').trim().toUpperCase() !== shown, 3000);
    }
    return false;
}

/** Read the plaque, dial the answer, then walk through the door the lock guarded. */
async function solveRiddleAndEnter(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(FT_TILE.SEER_DOOR1, 0, log))) {
        return false;
    }
    await settleScene();
    const find = () => Locs.query().where(l => l.id === FT_LOC.SEER_DOOR1).action('Open').within(4).nearest();
    const door = find();
    if (!door) {
        log('no combination-lock door in range');
        return false;
    }
    const mark = GameMessages.mark();
    if (!(await door.interact('Open'))) {
        return false;
    }
    if (await Execution.delayUntil(() => inSeerWest(Game.tile()), 5000)) {
        return true;
    }

    const spoken = await readRiddle(log);
    if (spoken === null) {
        return false;
    }
    const answer = riddleAnswer(spoken);
    if (!answer) {
        log(`the plaque did not match any known riddle: "${spoken.trim()}"`);
        return false;
    }
    log(`the lock's riddle answers ${answer}`);
    for (let i = 0; i < 4; i++) {
        if (!(await setDial(i, answer[i]!, log))) {
            return false;
        }
    }
    if (!actions.ifButton(COMBO.ENTER)) {
        return false;
    }
    if (!(await Execution.delayUntil(() => GameMessages.sawSince(mark, /solved the riddle/i), 8000))) {
        log('the lock rejected the answer');
        return false;
    }
    await Modals.closeIfOpen();
    const again = find();
    if (!again || !(await again.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => inSeerWest(Game.tile()), 8000);
}

// Why: `driveChoice` would continue past the two plaque boxes before anything read them, and the plaque is the only place the answer is written.
async function readRiddle(log: (m: string) => void): Promise<string | null> {
    let spoken = '';
    const deadline = performance.now() + 40_000;
    while (performance.now() < deadline && reader.modals().main !== COMBO.ROOT) {
        if (ChatDialog.isOpen()) {
            spoken += ' ' + ChatDialog.texts().join(' ');
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const pick = pickPreferred(options, ['Read the riddle']);
            if (!pick) {
                log(`the lock offered [${options.join(' | ')}] with no way to read the riddle`);
                return null;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        }
        await Execution.delayTicks(1);
    }
    if (reader.modals().main !== COMBO.ROOT) {
        log('the combination lock never opened');
        return null;
    }
    return spoken;
}
