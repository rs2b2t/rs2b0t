// docs/superpowers/specs/2026-07-29-shilo-village-design.md
import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { Traversal } from '../../api/Traversal.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestProgress, QuestSnapshot, QuestStep } from '../engine/types.js';
import { talkStrict } from '../exec/primitives.js';
import { heldId, promptLoc, settleScene } from '../exec/prompts.js';

export const JUNGLE_POTION_QUEST = 'Jungle Potion';

export const TRUFITUS = new Tile(2809, 3086, 0);

const ARDOUGNE_BANK = new Tile(2616, 3332, 0);

/** Trufitus wants each herb picked fresh and cleaned, so both ids matter. */
export interface JungleHerb {
    key: string;
    /** Display name after Identify — what Trufitus accepts. */
    name: string;
    id: number;
    /** Every unid renders as "Unidentified herb", so pick these out by id. */
    unidId: number;
    loc: string;
    op: string;
    at: Tile;
    /** Walkable tile the loc can be clicked from. */
    stand: Tile;
    underground?: boolean;
}

export const JUNGLE_HERBS: readonly JungleHerb[] = [
    {
        key: 'snake weed', name: 'Snake weed', id: 1526, unidId: 1525,
        loc: 'Marshy jungle vine', op: 'Search',
        at: new Tile(2760, 3014, 0), stand: new Tile(2761, 3015, 0)
    },
    {
        key: 'ardrigal', name: 'Ardrigal', id: 1528, unidId: 1527,
        loc: 'Palm tree', op: 'Search',
        // The palm is 2x2 over (2870-2871, 3115-3116); only its west side is open.
        at: new Tile(2870, 3115, 0), stand: new Tile(2869, 3115, 0)
    },
    {
        key: 'sito foil', name: 'Sito foil', id: 1530, unidId: 1529,
        loc: 'Scorched earth', op: 'Search',
        at: new Tile(2784, 3067, 0), stand: new Tile(2785, 3068, 0)
    },
    {
        key: 'volencia moss', name: 'Volencia moss', id: 1532, unidId: 1531,
        loc: 'Rock', op: 'Search',
        at: new Tile(2850, 3035, 0), stand: new Tile(2851, 3034, 0)
    },
    {
        key: 'rogues purse', name: 'Rogues purse', id: 1534, unidId: 1533,
        loc: 'Fungus covered Cavern wall', op: 'Search',
        at: new Tile(2850, 9476, 0), stand: new Tile(2850, 9477, 0),
        underground: true
    }
];

// The cave mouth is 2x2 over (2824-2825, 3118-3119), so the stand is its west neighbour.
const POTHOLE_ENTRANCE = { loc: 'Rocks', op: 'Search', stand: new Tile(2823, 3119, 0) };
const POTHOLE_EXIT = { loc: 'Hand holds', op: 'Climb', stand: new Tile(2830, 9521, 0) };

const START_DIALOGUE = [
    "It's a nice village, where is everyone?",
    'Me? How can I help?',
    'It sounds like just the challenge for me.'
];

const HAND_IN_DIALOGUE = ['Of course!'];

function inCaves(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined && tile.z >= 9400;
}

/**
 * Journal stages, in the order the engine walks them. `get_*` means Trufitus has
 * named the herb; `found_*` means it has been picked, which is the only state in
 * which he will accept it.
 */
export const JP_STAGE = {
    NOT_STARTED: 0,
    GET_SNAKE_WEED: 1,
    FOUND_SNAKE_WEED: 2,
    GET_ARDRIGAL: 3,
    FOUND_ARDRIGAL: 4,
    GET_SITO_FOIL: 5,
    FOUND_SITO_FOIL: 6,
    GET_VOLENCIA_MOSS: 7,
    FOUND_VOLENCIA_MOSS: 8,
    GET_ROGUES_PURSE: 9,
    FOUND_ROGUES_PURSE: 10,
    FOUND_ALL_HERBS: 11,
    COMPLETE: 12
} as const;

/** Herb index by stage: both the `get_` and `found_` stage point at the same herb. */
export function herbForStage(stage: number): JungleHerb | null {
    if (stage < JP_STAGE.GET_SNAKE_WEED || stage > JP_STAGE.FOUND_ROGUES_PURSE) {
        return null;
    }
    return JUNGLE_HERBS[Math.floor((stage - 1) / 2)] ?? null;
}

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * The journal names the herb it wants and, once picked, says so in the past tense.
 * That pair is enough to separate every `get_`/`found_` stage without a varp.
 */
export function parseJungleJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.includes('quest complete!')) {
        return { stage: JP_STAGE.COMPLETE, flags: new Set() };
    }
    if (text.includes('i can start this quest')) {
        return { stage: JP_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (text.includes('trufitus needs to commune with the gods')) {
        return { stage: JP_STAGE.FOUND_ALL_HERBS, flags: new Set() };
    }
    // Newest first: the "picked" line only ever appears alongside its own "need to give".
    const asked: [string, number, number][] = [
        ['rogues purse', JP_STAGE.GET_ROGUES_PURSE, JP_STAGE.FOUND_ROGUES_PURSE],
        ['volencia moss', JP_STAGE.GET_VOLENCIA_MOSS, JP_STAGE.FOUND_VOLENCIA_MOSS],
        ['sito foil', JP_STAGE.GET_SITO_FOIL, JP_STAGE.FOUND_SITO_FOIL],
        ['ardrigal', JP_STAGE.GET_ARDRIGAL, JP_STAGE.FOUND_ARDRIGAL],
        ['snakeweed', JP_STAGE.GET_SNAKE_WEED, JP_STAGE.FOUND_SNAKE_WEED]
    ];
    for (const [herb, getStage, foundStage] of asked) {
        if (text.includes(`i need to give the ${herb}`) || text.includes(`i picked some fresh ${herb}`)) {
            return { stage: foundStage, flags: new Set() };
        }
        if (text.includes(`i need to pick some fresh ${herb}`)) {
            return { stage: getStage, flags: new Set() };
        }
    }
    // Rogues purse renders singular in the "give" line only.
    if (text.includes('i need to give the rogue purse')) {
        return { stage: JP_STAGE.FOUND_ROGUES_PURSE, flags: new Set() };
    }
    return undefined;
}

export async function readJungleProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(JUNGLE_POTION_QUEST);
    if (status === 'complete') return { stage: JP_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: JP_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;
    const progress = parseJungleJournal(await Quests.journal(JUNGLE_POTION_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}

/** The cave mouth raises a message box first, then the yes/no prompt. */
async function enterPothole(log: (m: string) => void): Promise<boolean> {
    if (inCaves(Game.tile())) {
        return true;
    }
    const ok = await promptLoc(
        {
            name: POTHOLE_ENTRANCE.loc,
            op: POTHOLE_ENTRANCE.op,
            near: POTHOLE_ENTRANCE.stand,
            prefer: ["Yes, I'll enter the cave."],
            expect: () => inCaves(Game.tile())
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

export async function leavePothole(log: (m: string) => void): Promise<boolean> {
    if (!inCaves(Game.tile())) {
        return true;
    }
    const ok = await promptLoc(
        {
            name: POTHOLE_EXIT.loc,
            op: POTHOLE_EXIT.op,
            near: POTHOLE_EXIT.stand,
            expect: () => !inCaves(Game.tile())
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

export function pickHerb(herb: JungleHerb): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        // Only the unid is evidence of a fresh pick. A clean herb carried over from
        // an earlier run does not advance the stage, and Trufitus refuses it.
        if (heldId(herb.unidId) > 0) {
            return true;
        }
        if (herb.underground && !(await enterPothole(log))) {
            return false;
        }
        if (!herb.underground && inCaves(Game.tile()) && !(await leavePothole(log))) {
            return false;
        }
        return promptLoc(
            {
                name: herb.loc,
                op: herb.op,
                near: herb.stand,
                expect: () => heldId(herb.unidId) > 0
            },
            log
        );
    };
}

export function identifyHerb(herb: JungleHerb): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        if (heldId(herb.id) > 0) {
            return true;
        }
        const unid = Inventory.items().find(item => item.id === herb.unidId);
        if (!unid) {
            log(`no unidentified ${herb.name} in the pack`);
            return false;
        }
        if (!(await unid.interact('Identify'))) {
            return false;
        }
        return Execution.delayUntil(() => heldId(herb.id) > 0, 6000);
    };
}

async function talkToTrufitus(prefer: string[], log: (m: string) => void): Promise<boolean> {
    if (inCaves(Game.tile()) && !(await leavePothole(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(TRUFITUS, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    return talkStrict('Trufitus', prefer, log);
}

function startQuest(log: (m: string) => void): Promise<boolean> {
    return talkToTrufitus(START_DIALOGUE, log);
}

function handInHerb(log: (m: string) => void): Promise<boolean> {
    return talkToTrufitus(HAND_IN_DIALOGUE, log);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    // A carried unid outranks the journal. It exists only because we just picked
    // it, which is exactly the state the journal cannot render: at `found_snake_weed`
    // holding the unid it writes no line at all, and every other `found_` stage
    // writes the *previous* stage's "go and pick it" line.
    const carried = JUNGLE_HERBS.find(h => (snap.invIds?.get(h.unidId) ?? 0) > 0);
    if (carried) {
        return { kind: 'custom', name: `identify the ${carried.name}`, run: identifyHerb(carried) };
    }

    const stage = snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Jungle Potion journal stage unavailable' };
    }
    if (stage === JP_STAGE.NOT_STARTED) {
        return { kind: 'custom', name: 'ask Trufitus for the herb-gathering job', run: startQuest };
    }
    if (stage >= JP_STAGE.FOUND_ALL_HERBS) {
        return { kind: 'custom', name: 'let Trufitus commune with the gods', run: handInHerb };
    }

    const herb = herbForStage(stage);
    if (!herb) {
        return { kind: 'wait', reason: `Jungle Potion stage ${stage} is not implemented` };
    }
    // Picking is what advances `get_` to `found_`, and only `found_` accepts a
    // hand-in — so a clean herb carried into a `get_` stage still has to be re-picked.
    const held = snap.invIds?.get(herb.id) ?? 0;
    if (stage % 2 === 1 || held === 0) {
        return { kind: 'custom', name: `pick ${herb.name}`, run: pickHerb(herb) };
    }
    return { kind: 'custom', name: `give the ${herb.name} to Trufitus`, run: handInHerb };
}

export const junglepotion: QuestModule = {
    record: QUESTS.find(record => record.id === 'junglepotion')!,
    // Karamja has no bank and nothing here needs one; Ardougne West is simply the
    // nearest one to the crossing, for the engine's own bookkeeping.
    bank: ARDOUGNE_BANK,
    ownsInventory: true,
    readProgress: readJungleProgress,
    decide
};
