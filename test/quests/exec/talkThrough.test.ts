import { beforeEach, describe, expect, mock, test } from 'bun:test';

interface TileLike { x: number; z: number; level: number }

let sceneNpc: { name: string; tile: TileLike; ops: string[] } | null;
let sceneDoor: { name: string; ops: string[]; tile: TileLike; distance: number } | null;
let cantReach: boolean;
let npcReachable: boolean;
let dialogOpen: boolean;
let canContinue: boolean;
let continueCount: number;
let continueOnly: boolean;
let npcInteractOps: string[];
let doorInteractOps: string[];

const { isOpenableBarrier, isOpenBarrierLeaf } = await import('#/bot/nav/WalkExecutor.js');

const RealAdapter = await import('#/bot/adapter/ClientAdapter.js');
mock.module('#/bot/adapter/ClientAdapter.js', () => ({
    ...RealAdapter,
    reader: { ...RealAdapter.reader, worldTile: () => ({ x: 0, z: 0, level: 0 }) }
}));
const { GameMessages } = await import('#/bot/events/gameMessages.js');
mock.module('#/bot/api/Execution.js', () => ({
    Execution: {
        delayUntil: async (cond: () => boolean) => cond(),
        delayTicks: async () => {}
    }
}));
mock.module('#/bot/api/Game.js', () => ({ Game: { tile: () => ({ x: 0, z: 0, level: 0 }) } }));
mock.module('#/bot/api/Traversal.js', () => ({ Traversal: { walkResilient: async () => true } }));
mock.module('#/bot/api/Reachability.js', () => ({
    // The door tile stays reachable; only the NPC beyond it is walled off.
    Reachability: { canReach: (t: TileLike) => npcReachable || !(sceneNpc !== null && t.x === sceneNpc.tile.x && t.z === sceneNpc.tile.z) }
}));
mock.module('#/bot/nav/WalkExecutor.js', () => ({
    WalkExecutor: { get lastOutcome() { return 'arrived'; } },
    isOpenableBarrier,
    isOpenBarrierLeaf
}));

const npcHandle = () => (sceneNpc ? {
    name: sceneNpc.name,
    tile: () => sceneNpc!.tile,
    distance: () => 3,
    actions: () => sceneNpc!.ops,
    interact: async (op: string) => {
        npcInteractOps.push(op);
        if (cantReach) {
            GameMessages.record("I can't reach that!");
            return true;
        }
        dialogOpen = !continueOnly;
        canContinue = true;
        return true;
    }
} : null);
const doorHandle = () => (sceneDoor ? {
    name: sceneDoor.name,
    tile: () => sceneDoor!.tile,
    actions: () => sceneDoor!.ops,
    distance: () => sceneDoor!.distance,
    interact: async (op: string) => {
        doorInteractOps.push(op);
        cantReach = false;
        npcReachable = true;
        sceneDoor = null;
        return true;
    }
} : null);
function doorWhere(preds: ((l: unknown) => boolean)[]): unknown {
    return {
        where: (p: (l: unknown) => boolean) => doorWhere([...preds, p]),
        nearest: () => { const h = doorHandle(); return h && preds.every(p => p(h)) ? h : null; }
    };
}
mock.module('#/bot/api/queries/Locs.js', () => ({
    Locs: {
        query: () => ({
            name: () => ({ action: () => ({ within: () => ({ nearest: () => null }) }) }),
            where: (p: (l: unknown) => boolean) => doorWhere([p])
        })
    }
}));
mock.module('#/bot/api/queries/Npcs.js', () => ({
    Npcs: {
        query: () => ({
            name: () => ({
                nearest: npcHandle,
                action: () => ({ nearest: npcHandle }),
                where: (pred: (n: unknown) => boolean) => ({ nearest: () => { const h = npcHandle(); return h && pred(h) ? h : null; } })
            })
        })
    }
}));
mock.module('#/bot/api/hud/ChatDialog.js', () => ({
    ChatDialog: {
        isOpen: () => dialogOpen,
        canContinue: () => canContinue,
        options: () => [],
        continue: async () => { continueCount++; canContinue = false; dialogOpen = false; },
        chooseOption: async () => {}
    }
}));

const { talkThrough } = await import('#/bot/quests/exec/primitives.js');

beforeEach(() => {
    sceneNpc = { name: 'Fred the Farmer', tile: { x: 3, z: 1, level: 0 }, ops: ['Talk-to'] };
    sceneDoor = null;
    cantReach = false;
    npcReachable = true;
    dialogOpen = false;
    canContinue = false;
    continueCount = 0;
    continueOnly = false;
    npcInteractOps = [];
    doorInteractOps = [];
    GameMessages.reset();
});

describe('talkThrough door handling', () => {
    test('an NPC walled off with no server verdict is still reached by opening the door', async () => {
        // The live case: Fred wanders into his bedroom, the interior door re-shuts,
        // and the server stays silent — only the scene knows he is unreachable.
        npcReachable = false;
        sceneDoor = { name: 'Door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1 };

        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(doorInteractOps).toEqual(['Open']);
        expect(npcInteractOps).toEqual(['Talk-to']);
        expect(ok).toBe(true);
    });

    test('a distant target is never probed — out of BFS range reads as walled off', async () => {
        // 400 expansions run out at ~11 tiles of open ground, so a patrolling NPC
        // would otherwise have us opening doors it is simply too far to need.
        npcReachable = false;
        sceneNpc = { name: 'Fred the Farmer', tile: { x: 40, z: 40, level: 0 }, ops: ['Talk-to'] };
        sceneDoor = { name: 'Door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1 };

        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(doorInteractOps).toEqual([]);
        expect(npcInteractOps).toEqual(['Talk-to']);
        expect(ok).toBe(true);
    });

    test('a target on another level is never probed', async () => {
        npcReachable = false;
        sceneNpc = { name: 'Fred the Farmer', tile: { x: 3, z: 1, level: 1 }, ops: ['Talk-to'] };
        sceneDoor = { name: 'Door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1 };

        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(doorInteractOps).toEqual([]);
        expect(ok).toBe(true);
    });

    test('walled off with no door to open falls through to the plain click', async () => {
        npcReachable = false;

        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(doorInteractOps).toEqual([]);
        expect(npcInteractOps).toEqual(['Talk-to']);
        expect(ok).toBe(true);
    });

    test('an NPC shut behind a door is reached by opening it, not abandoned', async () => {
        // The server does report "I can't reach that!" when its own path dead-ends.
        cantReach = true;
        sceneDoor = { name: 'Door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1 };

        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(doorInteractOps).toEqual(['Open']);
        expect(npcInteractOps).toEqual(['Talk-to', 'Talk-to']);
        expect(ok).toBe(true);
    });

    test('a reachable NPC still opens on the first click and touches no door', async () => {
        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(npcInteractOps).toEqual(['Talk-to']);
        expect(doorInteractOps).toEqual([]);
        expect(ok).toBe(true);
    });

    test("Fred's continue-only final response counts as an opened dialogue", async () => {
        continueOnly = true;

        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(npcInteractOps).toEqual(['Talk-to']);
        expect(continueCount).toBe(1);
        expect(ok).toBe(true);
    });

    test("can't-reach with no openable door gives up rather than spinning", async () => {
        cantReach = true;

        const ok = await talkThrough('Fred the Farmer', [], () => {});

        expect(npcInteractOps).toEqual(['Talk-to']);
        expect(ok).toBe(false);
    });

    test('an NPC that is not in the scene is reported, not clicked', async () => {
        sceneNpc = null;
        const lines: string[] = [];

        const ok = await talkThrough('Fred the Farmer', [], m => lines.push(m));

        expect(ok).toBe(false);
        expect(lines).toEqual(["no 'Fred the Farmer' nearby to talk to"]);
    });
});
