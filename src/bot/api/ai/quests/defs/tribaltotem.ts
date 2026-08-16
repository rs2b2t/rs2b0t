// docs/QUESTS.md
import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import Tile from '../../../../geometry/Tile.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { Modals } from '../../../ui/widgets/Modals.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { QUESTS } from '../data/quests.js';
import { hasFlag, type QuestModule, type QuestProgress, type QuestSnapshot, type QuestStep } from '../engine/types.js';
import type { NpcStop } from '../exec/primitives.js';
import { driveUntil, heldId, promptLoc, settleScene, useOnLoc } from '../exec/prompts.js';

const QUEST = 'Tribal Totem';

/** `quest_totem.constant`. */
export const TOTEM_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    CRATE_MARKED: 2,
    CRATE_DELIVERED: 3,
    TELEPORTED: 4,
    COMPLETE: 5
} as const;

export const LABEL_OBJ = 1858;
export const TOTEM_OBJ = 1857;

// Why: the depot stacks five locs all called "Crate", and the mansion holds a sixth once the parcel lands, so every lookup here is by id.
const HORN_CRATE = 2707;
const TELEPORT_CRATE = 2708;
const COMBO_DOOR = 2705;
const TRAP_STAIRS = 2711;
const CHEST_SHUT = 2709;
const CHEST_OPEN = 2710;

const KANGAI: NpcStop = {
    npc: 'Kangai Mau',
    anchor: new Tile(2791, 3182, 0),
    leash: 6,
    prefer: ['Ok, I will get it back.', "I'm in search of adventure!"]
};

const CROMPERTY: NpcStop = {
    npc: 'Wizard Cromperty',
    anchor: new Tile(2681, 3325, 0),
    leash: 8,
    prefer: ['So what have you invented?', 'Can I be teleported please?', 'Yes, that sounds good. Teleport me!']
};

const RPDT: NpcStop = {
    npc: 'RPDT employee',
    anchor: new Tile(2644, 3272, 0),
    leash: 8,
    prefer: ['So, when are you going to deliver this crate?']
};

// Why: the crates are ordinary walking distance from the Ardougne bank, so only the mansion leg needs Cromperty's block — this is also where it lands before the parcel is delivered.
/** The R.P.D.T. depot's crate room. */
const DEPOT_STAND = new Tile(2649, 3271, 0);
const COMBO_STAND = new Tile(2635, 3323, 0);
/** `[oploc1,totemtrapstairs]` walks the player here itself, three tiles north of the loc. */
const STAIRS_STAND = new Tile(2631, 3325, 0);
const CHEST_STAND = new Tile(2638, 3323, 1);
const BANK = new Tile(2655, 3283, 0);

// Why: the mansion is a sealed component — the inner door opens only outward and the way in is Cromperty's block, so a resume outside it has to be teleported back rather than walked.
/** Boxes covering everything the inner door seals, excluding the porch and the two garden alcoves. */
const MANSION_BOXES: readonly { level: number; x0: number; x1: number; z0: number; z1: number }[] = [
    { level: 0, x0: 2627, x1: 2643, z0: 3322, z1: 3325 },
    { level: 0, x0: 2627, x1: 2628, z0: 3320, z1: 3321 },
    { level: 0, x0: 2631, x1: 2633, z0: 3320, z1: 3321 },
    { level: 0, x0: 2637, x1: 2639, z0: 3320, z1: 3321 },
    { level: 1, x0: 2630, x1: 2640, z0: 3318, z1: 3325 }
];

export function inMansion(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    return MANSION_BOXES.some(b => tile.level === b.level && tile.x >= b.x0 && tile.x <= b.x1 && tile.z >= b.z0 && tile.z <= b.z1);
}

// Why: the packer numbers a root's components from root + 1, so `tribal_door2:com_N` is `716 + 1 + N`.
const DOOR_UI = 716;
const com = (index: number): number => DOOR_UI + 1 + index;
const DIAL_TEXT = [com(43), com(44), com(45), com(46)];
const DIAL_DOWN = [com(47), com(49), com(51), com(53)];
const DIAL_UP = [com(48), com(50), com(52), com(54)];
const CONFIRM = com(57);

/** Lord Francis **Kurt** Handelmort, from the Tourist Guide to Ardougne. */
export const COMBINATION = 'KURT';

const LETTERS = 26;
const CORRECT = /combination seems correct/i;
const TRAP_FOUND = /trap in these stairs/i;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

export function parseTribalTotemJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.includes('quest complete!')) {
        return { stage: TOTEM_STAGE.COMPLETE, flags: new Set(['combo']) };
    }
    // Why: every stage from here down repeats the ones above it, so the newest sentence has to be tested first.
    if (text.includes('teleported myself inside')) {
        const flags = new Set<string>();
        if (text.includes('i worked out the combination for the door')) {
            flags.add('combo');
        }
        return { stage: TOTEM_STAGE.TELEPORTED, flags };
    }
    if (text.includes('get wizard cromperty to teleport me inside')) {
        return { stage: TOTEM_STAGE.CRATE_DELIVERED, flags: new Set() };
    }
    if (text.includes('deliver the crate now')) {
        return { stage: TOTEM_STAGE.CRATE_MARKED, flags: new Set() };
    }
    if (text.includes('lord handelmorts mansion')) {
        return { stage: TOTEM_STAGE.STARTED, flags: new Set() };
    }
    if (text.includes('i can start this quest by speaking to')) {
        return { stage: TOTEM_STAGE.NOT_STARTED, flags: new Set() };
    }
    return undefined;
}

async function readTribalTotemProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return { stage: TOTEM_STAGE.COMPLETE, flags: new Set(['combo']) };
    }
    if (status === 'notStarted') {
        return { stage: TOTEM_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseTribalTotemJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}

function locById(id: number, within = 6): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

async function takeLabel(log: (m: string) => void): Promise<boolean> {
    if (heldId(LABEL_OBJ) > 0) {
        return true;
    }
    log('tribaltotem: peeling the address label off the mansion crate');
    return promptLoc({
        name: 'Crate',
        op: 'Investigate',
        id: HORN_CRATE,
        near: DEPOT_STAND,
        within: 8,
        expect: () => heldId(LABEL_OBJ) > 0
    }, log);
}

async function markCrate(log: (m: string) => void): Promise<boolean> {
    log("tribaltotem: covering the Wizards' Tower label with the mansion one");
    return useOnLoc(
        LABEL_OBJ,
        { name: 'Crate', near: DEPOT_STAND, id: TELEPORT_CRATE, within: 8 },
        [],
        () => heldId(LABEL_OBJ) === 0,
        log
    );
}

function dialLetter(index: number): string | null {
    const text = reader.ifText(DIAL_TEXT[index]);
    if (text === null) {
        return null;
    }
    const letter = text.trim().toUpperCase().charAt(0);
    return letter >= 'A' && letter <= 'Z' ? letter : null;
}

// Why: the arrows step one letter per click and the interface echoes the server's own value back, so reading the dial after every click is what keeps a dropped click from shifting every letter after it.
async function setDial(index: number, target: string, log: (m: string) => void): Promise<boolean> {
    for (let clicks = 0; clicks <= LETTERS; clicks++) {
        const current = dialLetter(index);
        if (current === null) {
            log(`tribaltotem: dial ${index + 1} is not readable — the lock interface closed`);
            return false;
        }
        if (current === target) {
            return true;
        }
        const forward = (target.charCodeAt(0) - current.charCodeAt(0) + LETTERS) % LETTERS;
        const button = forward * 2 <= LETTERS ? DIAL_UP[index] : DIAL_DOWN[index];
        if (!actions.ifButton(button)) {
            return false;
        }
        if (!(await Execution.delayUntil(() => dialLetter(index) !== current, 3000))) {
            log(`tribaltotem: dial ${index + 1} did not move off ${current}`);
            return false;
        }
    }
    return dialLetter(index) === target;
}

async function solveCombination(log: (m: string) => void): Promise<boolean> {
    const opened = await promptLoc({
        name: 'Door',
        op: 'Open',
        id: COMBO_DOOR,
        near: COMBO_STAND,
        within: 6,
        expect: () => Modals.main() === DOOR_UI,
        expectMs: 8000
    }, log);
    if (!opened) {
        log('tribaltotem: the security door never raised its lock');
        return false;
    }
    for (let dial = 0; dial < COMBINATION.length; dial++) {
        if (!(await setDial(dial, COMBINATION.charAt(dial), log))) {
            await Modals.closeIfOpen();
            return false;
        }
    }
    log(`tribaltotem: entering ${COMBINATION} on the security door`);
    const mark = GameMessages.mark();
    if (!actions.ifButton(CONFIRM)) {
        await Modals.closeIfOpen();
        return false;
    }
    // Why: `com_57` runs `if_close` before it tests the word, so the modal goes either way and only the message says which.
    const accepted = await driveUntil(() => GameMessages.sawSince(mark, CORRECT), [], log, 8000);
    if (!accepted) {
        log('tribaltotem: the security door refused the combination');
        await Modals.closeIfOpen();
    }
    return accepted;
}

// Why: `[oploc2,totemtrapstairs]` re-shows its box whether or not the trap is already noted, so this is safe to repeat and there is no client-visible bit to skip it on.
async function disarmTrap(log: (m: string) => void): Promise<boolean> {
    let found = false;
    const noted = (): boolean => {
        if (!found && [...reader.chatModalTexts(), ...reader.mainModalTexts()].some(t => TRAP_FOUND.test(t))) {
            found = true;
        }
        return found;
    };
    log('tribaltotem: searching the stairs for the trap');
    return promptLoc({
        name: 'Stairs',
        op: 'Investigate',
        id: TRAP_STAIRS,
        near: STAIRS_STAND,
        within: 8,
        expect: noted,
        expectMs: 15_000
    }, log);
}

async function climbStairs(log: (m: string) => void): Promise<boolean> {
    const upstairs = (): boolean => {
        const t = Game.tile();
        return t !== null && t.level === 1;
    };
    log('tribaltotem: climbing the disarmed stairs');
    const climbed = await promptLoc({
        name: 'Stairs',
        op: 'Climb-up',
        id: TRAP_STAIRS,
        near: STAIRS_STAND,
        within: 8,
        expect: upstairs,
        expectMs: 15_000
    }, log);
    if (climbed) {
        await settleScene();
    }
    return climbed;
}

async function emptyChest(log: (m: string) => void): Promise<boolean> {
    if (locById(CHEST_OPEN, 8) === null) {
        // Why: the shut chest and the open chest are two locs, and the shut one lingers for a tick after the Open lands.
        const opened = await promptLoc({
            name: 'Chest',
            op: 'Open',
            id: CHEST_SHUT,
            near: CHEST_STAND,
            within: 8,
            expect: () => locById(CHEST_OPEN, 8) !== null,
            expectMs: 8000
        }, log);
        if (!opened) {
            return false;
        }
    }
    log('tribaltotem: searching the chest for the totem');
    return promptLoc({
        name: 'Chest',
        op: 'Search',
        id: CHEST_OPEN,
        near: CHEST_STAND,
        within: 8,
        expect: () => heldId(TOTEM_OBJ) > 0,
        expectMs: 12_000
    }, log);
}

async function takeTotem(log: (m: string) => void): Promise<boolean> {
    if (heldId(TOTEM_OBJ) > 0) {
        return true;
    }
    const here = Game.tile();
    if (!here) {
        return false;
    }
    // Why: the climb is driven rather than walked because the undisarmed stairs drop the player into the Ardougne sewers for a fifth of their hitpoints.
    if (here.level === 0) {
        if (!(await disarmTrap(log))) {
            return false;
        }
        if (!(await climbStairs(log))) {
            return false;
        }
    }
    return emptyChest(log);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') { return { kind: 'done' }; }
    if (snap.journal === 'unknown') { return { kind: 'wait', reason: 'quest journal not loaded' }; }
    if (snap.journal === 'notStarted') { return { kind: 'talk', stop: KANGAI }; }

    const progress = snap.progress;
    if (progress === undefined) { return { kind: 'wait', reason: 'Tribal Totem journal stage unavailable' }; }

    // Why: the chest refuses a second totem while one sits in the pack or the bank, so carrying it is the same thing as the quest being over bar the walk.
    if ((snap.invIds?.get(TOTEM_OBJ) ?? 0) > 0) { return { kind: 'talk', stop: KANGAI }; }

    switch (progress.stage) {
        case TOTEM_STAGE.STARTED:
            return (snap.invIds?.get(LABEL_OBJ) ?? 0) > 0
                ? { kind: 'custom', name: 'relabel the crate bound for the Wizards\' Tower', run: markCrate }
                : { kind: 'custom', name: 'take the address label off the mansion crate', run: takeLabel };
        case TOTEM_STAGE.CRATE_MARKED:
            return { kind: 'talk', stop: RPDT };
        case TOTEM_STAGE.CRATE_DELIVERED:
            return { kind: 'talk', stop: CROMPERTY };
        case TOTEM_STAGE.TELEPORTED:
            if (!inMansion(snap.tile)) { return { kind: 'talk', stop: CROMPERTY }; }
            return hasFlag(progress, 'combo')
                ? { kind: 'custom', name: 'take the totem from the mansion chest', run: takeTotem }
                : { kind: 'custom', name: 'work out the security door combination', run: solveCombination };
        default:
            return { kind: 'wait', reason: `Tribal Totem stage ${progress.stage} is not implemented` };
    }
}

export const tribaltotem: QuestModule = {
    record: QUESTS.find(record => record.id === 'totem')!,
    bank: BANK,
    food: 6,
    // Why: the mansion crate is the only source of the label, and both it and the totem have to survive the spillover deposit that opens every provisioning pass.
    tools: ['address label', 'totem', 'coins'],
    readProgress: readTribalTotemProgress,
    warnReadiness: () =>
        'Tribal Totem was proven at 70 across the board; the mansion guard dogs are level 44 and hunt cowardly, so they leave a grown account alone and nothing here is fought',
    decide
};
