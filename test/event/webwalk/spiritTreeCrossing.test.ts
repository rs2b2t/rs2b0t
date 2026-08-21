import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { SPECIAL_CROSSINGS } from '#/bot/event/webwalk/data/specialCrossings.js';
import { handleSpecialCrossing, type PathStepTile } from '#/bot/event/webwalk/exec/specialCrossing.js';
import { DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV } from '#/bot/event/webwalk/pathFollowPolicy.js';
import { stubProps } from '../../lib/stubSingletons.js';

// Why: live, a walk from Varrock bank refused the young tree twice on every pass, fell through to
// the gnome glider and timed out; the hop fires from four tiles out and the tree was searched for
// within three of the player.

/** Village landing (spirit_tree.constant ^village_tree) and the loc's own scene tile. */
const VILLAGE_STAND: WorldTile = { x: 2542, z: 3169, level: 0 };
const VILLAGE_TREE: WorldTile = { x: 2543, z: 3168, level: 0 };
const KHAZARD_STAND: WorldTile = { x: 2555, z: 3259, level: 0 };

let tile: WorldTile;
let dialogue: 'closed' | 'choice';
let choices: string[];
/** Polls of the scene that return nothing before the tree appears. */
let blankScenePolls: number;
let interactions: number;

const tree = {
    id: 1294,
    name: 'Spirit tree',
    tile: () => ({ ...VILLAGE_TREE }),
    distance: () => Math.max(Math.abs(tile.x - VILLAGE_TREE.x), Math.abs(tile.z - VILLAGE_TREE.z)),
    actions: () => ['Talk-to'],
    interact: async (action: string): Promise<boolean> => {
        expect(action).toBe('Talk-to');
        interactions++;
        dialogue = 'choice';
        choices = ['Battlefield of Khazard.', 'Forest north of Varrock.', 'Gnome stronghold.'];
        return true;
    }
};

/** A scene holding one tree, filtered the way the executor asks for it. */
function locQuery(): unknown {
    let matches = true;
    const query = {
        name: (...names: string[]) => {
            matches &&= names.some(n => n.trim().toLowerCase() === tree.name.toLowerCase());
            return query;
        },
        action: (action: string) => {
            matches &&= tree.actions().some(a => a.toLowerCase() === action.toLowerCase());
            return query;
        },
        within: (dist: number) => {
            matches &&= tree.distance() <= dist;
            return query;
        },
        withinOf: (origin: WorldTile, dist: number) => {
            const t = tree.tile();
            matches &&= Math.max(Math.abs(t.x - origin.x), Math.abs(t.z - origin.z)) <= dist;
            return query;
        },
        nearest: () => {
            if (blankScenePolls > 0) {
                blankScenePolls--;
                return null;
            }
            return matches ? tree : null;
        }
    };
    return query;
}

const restoreReader = stubProps(reader, {
    worldTile: () => tile,
    modals: () => ({ main: -1, side: -1, chat: dialogue === 'closed' ? -1 : 5 })
});
const restoreExecution = stubProps(Execution, {
    delayTicks: async () => {},
    delayUntil: async (condition: () => boolean, _ms?: number) => {
        for (let i = 0; i < 8; i++) {
            if (condition()) {
                return true;
            }
        }
        return false;
    }
});
const restoreLocs = stubProps(Locs, { query: () => locQuery() as never });
const restoreChat = stubProps(ChatDialog, {
    isOpen: () => dialogue !== 'closed',
    canContinue: () => false,
    options: () => (dialogue === 'choice' ? choices : []),
    chooseOption: async (choice?: string): Promise<boolean> => {
        expect(choice).toBe('Battlefield of Khazard.');
        dialogue = 'closed';
        tile = { ...KHAZARD_STAND };
        return true;
    }
});

afterAll(() => {
    restoreReader();
    restoreExecution();
    restoreLocs();
    restoreChat();
});

beforeEach(() => {
    tile = { ...VILLAGE_STAND };
    dialogue = 'closed';
    choices = [];
    blankScenePolls = 0;
    interactions = 0;
});

function crossing(): { approach: PathStepTile; step: PathStepTile; recipe: (typeof SPECIAL_CROSSINGS)[number] } {
    const recipe = SPECIAL_CROSSINGS.find(candidate => candidate.label === 'Village spirit → Khazard');
    if (!recipe) {
        throw new Error('missing Village spirit → Khazard crossing');
    }
    return {
        approach: { ...VILLAGE_STAND },
        step: {
            ...KHAZARD_STAND,
            transport: {
                locName: 'Spirit Tree',
                action: 'Talk-to',
                locX: VILLAGE_STAND.x,
                locZ: VILLAGE_STAND.z,
                toTile: { x: KHAZARD_STAND.x, z: KHAZARD_STAND.z }
            }
        },
        recipe
    };
}

async function hop(logs: string[]): Promise<boolean> {
    const { approach, step, recipe } = crossing();
    return handleSpecialCrossing(approach, step, recipe, m => logs.push(m), async () => {
        throw new Error('the spirit hop must not walk');
    });
}

describe('spirit tree crossing', () => {
    test('standing on the landing, it talks to the tree and lands at the destination', async () => {
        const logs: string[] = [];
        expect(await hop(logs)).toBe(true);
        expect(interactions).toBe(1);
        expect(tile).toEqual(KHAZARD_STAND);
    });

    test('it reaches the tree from as far out as the hop can fire', async () => {
        // The walker engages a planned hop from this far off the approach tile, and the tree's
        // scene handle is the far corner of a 4x4, so a player-relative radius misses it.
        const out = DEFAULT_TRANSPORT_APPROACH_CHEBYSHEV;
        tile = { x: VILLAGE_STAND.x - out, z: VILLAGE_STAND.z - out, level: 0 };
        expect(tree.distance()).toBeGreaterThan(3);
        const logs: string[] = [];
        expect(await hop(logs)).toBe(true);
        expect(logs.join(' ')).not.toContain('not interactable');
    });

    test('a scene still rebuilding after a landing is waited out, not believed', async () => {
        blankScenePolls = 3;
        const logs: string[] = [];
        expect(await hop(logs)).toBe(true);
        expect(interactions).toBe(1);
    });

    test('a tree that never appears is reported once, so the walker can route around it', async () => {
        blankScenePolls = Number.POSITIVE_INFINITY;
        const logs: string[] = [];
        expect(await hop(logs)).toBe(false);
        expect(interactions).toBe(0);
        expect(logs.join(' ')).toContain("'Spirit Tree' not interactable near (2542,3169)");
    });
});
