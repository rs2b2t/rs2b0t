import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { SPECIAL_CROSSINGS } from '#/bot/event/webwalk/data/specialCrossings.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { handleSpecialCrossing, type PathStepTile } from '#/bot/event/webwalk/exec/specialCrossing.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { stubProps } from '../../lib/stubSingletons.js';

const FROM = { x: 3303, z: 9416, level: 0 } as const;
const TO = { x: 3319, z: 9431, level: 0 } as const;
const CAVE_FROM = { x: 3286, z: 9415, level: 0 } as const;
const CAVE_TO = { x: 3278, z: 9415, level: 0 } as const;
const WROUGHT_FROM = { x: 3322, z: 9448, level: 0 } as const;
const WROUGHT_TO = { x: 3322, z: 9449, level: 0 } as const;
const FAILURE = "You fail to fit yourself into the cart in time before it starts it's journey.";

let kind: 'cart' | 'cave' | 'wrought';
let tile: WorldTile;
let dialogue: 'closed' | 'choice' | 'pages';
let pages: number;
let failuresBeforeSuccess: number;
let ignoredInteractions: number;
let interactions: number;
let continues: number;
let upkeep: number;
let edgePassAfterChecks: number;
let edgePassChecks: number;
let sceneWalks: number;

const loc = {
    get id(): number {
        return kind === 'cart' ? 2684 : kind === 'cave' ? 2698 : 2687;
    },
    get name(): string {
        return kind === 'cart' ? 'Mine Cart' : kind === 'cave' ? 'Mine cave' : 'Gate';
    },
    tile: () => (
        kind === 'cart'
            ? { x: 3303, z: 9417, level: 0 }
            : kind === 'cave'
                ? { x: 3283, z: 9415, level: 0 }
                : { ...WROUGHT_FROM }
    ),
    distance: () => 1,
    actions: () => [kind === 'cart' ? 'Search' : kind === 'cave' ? 'Walk through' : 'Open'],
    interact: async (action: string): Promise<boolean> => {
        if (!loc.actions().includes(action)) throw new Error(`unexpected transport action '${action}'`);
        interactions++;
        if (interactions <= ignoredInteractions) {
            dialogue = 'closed';
        } else if (kind === 'cart') {
            dialogue = 'choice';
        } else if (kind === 'cave') {
            dialogue = 'pages';
            pages = 2;
        } else {
            dialogue = 'closed';
        }
        return true;
    }
};

function locQuery(): unknown {
    let matches = true;
    const query = {
        name: (...names: string[]) => {
            matches &&= names.includes(loc.name);
            return query;
        },
        action: (action: string) => {
            matches &&= loc.actions().includes(action);
            return query;
        },
        where: (predicate: (candidate: typeof loc) => boolean) => {
            matches &&= predicate(loc);
            return query;
        },
        nearest: () => (matches ? loc : null)
    };
    return query;
}

// These APIs are live singletons, so restore every mutation after this file.
const restoreReader = stubProps(reader, {
    worldTile: () => tile,
    modals: () => ({ main: -1, side: -1, chat: dialogue === 'closed' ? -1 : 5 })
});
const restoreExecution = stubProps(Execution, {
    delayTicks: async () => {},
    delayUntil: async (condition: () => boolean) => condition()
});
const restoreLocs = stubProps(Locs, { query: () => locQuery() as never });
const restoreChat = stubProps(ChatDialog, {
    isOpen: () => dialogue !== 'closed',
    canContinue: () => dialogue === 'pages' && pages > 0,
    options: () => (dialogue === 'choice' ? ['Yes, of course.'] : []),
    chooseOption: async (choice?: string): Promise<boolean> => {
        if (choice !== 'Yes, of course.') throw new Error(`unexpected cart choice '${choice ?? ''}'`);
        if (interactions <= failuresBeforeSuccess) {
            GameMessages.record(FAILURE);
            dialogue = 'pages';
            pages = 2;
        } else {
            tile = { ...TO };
            dialogue = 'pages';
            pages = 1;
        }
        return true;
    },
    continue: async (): Promise<boolean> => {
        if (dialogue !== 'pages' || pages <= 0) return false;
        continues++;
        pages--;
        if (pages === 0) {
            dialogue = 'closed';
            if (kind === 'cave') tile = { ...CAVE_TO };
        }
        return true;
    }
});
const restoreReachability = stubProps(Reachability, {
    canStep: () => {
        edgePassChecks++;
        return kind === 'wrought' && edgePassChecks > edgePassAfterChecks;
    }
});
const restoreDirectNavigator = stubProps(DirectNavigator, {
    walk: async (destination: WorldTile): Promise<boolean> => {
        if (kind !== 'wrought') throw new Error('scene walk invoked outside wrought-gate test');
        if (edgePassChecks <= edgePassAfterChecks) throw new Error('scene walk issued before collision acknowledged the open gate');
        sceneWalks++;
        tile = { ...destination };
        return true;
    }
});

afterEach(() => Sustain.set(null));
afterAll(() => {
    restoreReader();
    restoreExecution();
    restoreLocs();
    restoreChat();
    restoreReachability();
    restoreDirectNavigator();
});

beforeEach(() => {
    kind = 'cart';
    tile = { ...FROM };
    dialogue = 'closed';
    pages = 0;
    failuresBeforeSuccess = 0;
    ignoredInteractions = 0;
    interactions = 0;
    continues = 0;
    upkeep = 0;
    edgePassAfterChecks = Number.POSITIVE_INFINITY;
    edgePassChecks = 0;
    sceneWalks = 0;
    GameMessages.reset();
    Sustain.set(async () => {
        upkeep++;
    });
});

function crossing(): { approach: PathStepTile; step: PathStepTile; recipe: (typeof SPECIAL_CROSSINGS)[number] } {
    const recipe = SPECIAL_CROSSINGS.find(candidate => candidate.label === 'Desert Mining Camp mine cart in');
    if (!recipe) throw new Error('missing inbound Desert Mining Camp cart recipe');
    return {
        approach: { ...FROM },
        step: {
            ...TO,
            transport: {
                locName: 'Mine Cart',
                action: 'Search',
                locX: 3303,
                locZ: 9417,
                locId: 2684,
                toTile: { x: TO.x, z: TO.z }
            }
        },
        recipe
    };
}

async function run(logs: string[]): Promise<boolean> {
    const { approach, step, recipe } = crossing();
    return handleSpecialCrossing(
        approach,
        step,
        recipe,
        message => logs.push(message),
        async () => {
            throw new Error('cart retry unexpectedly invoked pathfinding');
        }
    );
}

async function runCave(logs: string[]): Promise<boolean> {
    kind = 'cave';
    tile = { ...CAVE_FROM };
    const recipe = SPECIAL_CROSSINGS.find(candidate => candidate.label === 'Desert Mining Camp guarded cave out');
    if (!recipe) throw new Error('missing outbound Desert Mining Camp guarded-cave recipe');
    const step: PathStepTile = {
        ...CAVE_TO,
        transport: {
            locName: 'Mine cave',
            action: 'Walk through',
            locX: 3283,
            locZ: 9415,
            locId: 2698,
            toTile: { x: CAVE_TO.x, z: CAVE_TO.z }
        }
    };
    return handleSpecialCrossing(
        { ...CAVE_FROM },
        step,
        recipe,
        message => logs.push(message),
        async () => {
            throw new Error('guarded-cave retry unexpectedly invoked pathfinding');
        }
    );
}

async function runWrought(logs: string[]): Promise<boolean> {
    kind = 'wrought';
    tile = { ...WROUGHT_FROM };
    const recipe = SPECIAL_CROSSINGS.find(candidate => candidate.label === 'Desert Mining Camp wrought gate in');
    if (!recipe) throw new Error('missing inbound Desert Mining Camp wrought-gate recipe');
    const step: PathStepTile = {
        ...WROUGHT_TO,
        transport: {
            locName: 'Gate',
            action: 'Open',
            locX: WROUGHT_FROM.x,
            locZ: WROUGHT_FROM.z,
            locId: 2687,
            toTile: { x: WROUGHT_TO.x, z: WROUGHT_TO.z }
        }
    };
    return handleSpecialCrossing(
        { ...WROUGHT_FROM },
        step,
        recipe,
        message => logs.push(message),
        async () => {
            throw new Error('wrought-gate scene step unexpectedly invoked pathfinding');
        }
    );
}

describe('source-authored cart failure retry', () => {
    test('drains the failure dialogue, runs upkeep, and retries in place', async () => {
        failuresBeforeSuccess = 1;
        const logs: string[] = [];
        expect(await run(logs)).toBe(true);
        expect(interactions).toBe(2);
        expect(continues).toBe(3);
        expect(upkeep).toBe(1);
        expect(logs).toContainEqual(expect.stringContaining('Agility roll failed; attempt 1/6'));
        expect(logs).toContainEqual(expect.stringContaining('mine cart in: crossed'));
    });

    test('stops after six failed rolls with an explicit exhaustion log', async () => {
        failuresBeforeSuccess = Number.POSITIVE_INFINITY;
        const logs: string[] = [];
        expect(await run(logs)).toBe(false);
        expect(interactions).toBe(6);
        expect(continues).toBe(12);
        expect(upkeep).toBe(6);
        expect(logs.filter(message => message.includes('Agility roll failed; attempt'))).toHaveLength(6);
        expect(logs.at(-1)).toContain('attempt 6/6');
        expect(logs.at(-1)).toContain('bounded retries exhausted; repathing');
    });
});

describe('unacknowledged guarded-cave interaction', () => {
    test('retries an interrupted action in place and records the observed state', async () => {
        ignoredInteractions = 1;
        const logs: string[] = [];
        expect(await runCave(logs)).toBe(true);
        expect(interactions).toBe(2);
        expect(continues).toBe(2);
        expect(upkeep).toBe(1);
        expect(logs).toContainEqual(expect.stringContaining('interaction interrupted; attempt 1/3'));
        expect(logs).toContainEqual(expect.stringContaining('chat=-1; sawDialogue=false'));
        expect(logs).toContainEqual(expect.stringContaining('guarded cave out: crossed'));
    });

    test('stops after three unacknowledged actions with an explicit exhaustion log', async () => {
        ignoredInteractions = Number.POSITIVE_INFINITY;
        const logs: string[] = [];
        expect(await runCave(logs)).toBe(false);
        expect(interactions).toBe(3);
        expect(continues).toBe(0);
        expect(upkeep).toBe(3);
        expect(logs.filter(message => message.includes('interaction interrupted; attempt'))).toHaveLength(3);
        expect(logs.at(-1)).toContain('attempt 3/3');
        expect(logs.at(-1)).toContain('bounded retries exhausted; repathing');
    });
});

describe('wrought-gate collision acknowledgement', () => {
    test('waits for the opened collision edge before scene-stepping once', async () => {
        edgePassAfterChecks = 2;
        const logs: string[] = [];
        expect(await runWrought(logs)).toBe(true);
        expect(edgePassChecks).toBeGreaterThan(2);
        expect(sceneWalks).toBe(1);
        expect(logs).toContainEqual(expect.stringContaining('wrought gate in: scene-step'));
        expect(logs).toContainEqual(expect.stringContaining('wrought gate in: crossed'));
    });

    test('never walks a gate whose collision edge stays closed', async () => {
        const logs: string[] = [];
        expect(await runWrought(logs)).toBe(false);
        expect(edgePassChecks).toBeGreaterThan(0);
        expect(sceneWalks).toBe(0);
        expect(logs.at(-1)).toContain('dialogue did not resolve — repathing');
    });
});
