import { describe, expect, mock, test, beforeEach } from 'bun:test';

// --- capture state the mocks read/write ---
let sceneLoc: { name: string; ops: string[]; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let sceneNpc: { name: string; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let walkCalls: { x: number; z: number; level: number }[];
let walkResult: boolean;
let walkLastOutcome: string;
let canReachResult: boolean;
let doorOpened: boolean;
let dialogOpen: boolean;
let expectFlips: boolean; // locOp's expect() reads this

mock.module('../adapter/ClientAdapter.js', () => ({
    reader: { worldTile: () => ({ x: 0, z: 0, level: 0 }) }
}));
mock.module('./Execution.js', () => ({
    Execution: {
        delayUntil: async (cond: () => boolean) => cond(),
        delayTicks: async () => {}
    }
}));
mock.module('./queries/Locs.js', () => ({
    Locs: {
        query: () => ({
            name: () => ({ action: () => ({ within: () => ({ nearest: () => (sceneLoc ? { name: sceneLoc.name, tile: () => sceneLoc!.tile, actions: () => sceneLoc!.ops, interact: async () => sceneLoc!.interactResult } : null) }) }) })
        })
    }
}));
mock.module('./queries/Npcs.js', () => ({
    Npcs: {
        query: () => ({
            name: () => ({ action: () => ({ nearest: () => (sceneNpc ? { name: sceneNpc.name, tile: () => sceneNpc!.tile, interact: async () => sceneNpc!.interactResult } : null) }) })
        })
    }
}));
mock.module('./hud/ChatDialog.js', () => ({
    ChatDialog: { isOpen: () => dialogOpen, canContinue: () => false }
}));
mock.module('./Reachability.js', () => ({
    Reachability: { canReach: () => canReachResult }
}));
mock.module('./Traversal.js', () => ({
    Traversal: {
        walkResilient: async (dest: { x: number; z: number; level: number }) => {
            walkCalls.push(dest);
            return walkResult;
        }
    }
}));
mock.module('../nav/WalkExecutor.js', () => ({
    WalkExecutor: {
        get lastOutcome() { return walkLastOutcome; },
        tryNearbyDoor: async () => { doorOpened = true; return true; }
    }
}));

const { Reach } = await import('./Reach.js');

beforeEach(() => {
    sceneLoc = null;
    sceneNpc = null;
    walkCalls = [];
    walkResult = true;
    walkLastOutcome = 'failed';
    canReachResult = true;
    doorOpened = false;
    dialogOpen = false;
    expectFlips = true;
});

describe('Reach.locOp', () => {
    test('loc not in scene → walks the hint, returns retry', async () => {
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
    });
    test('hint walk proven unreachable → unreachable', async () => {
        walkResult = false;
        walkLastOutcome = 'unreachable';
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
    });
    test('loc present + expect satisfied → done (no walking)', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('done');
        expect(walkCalls.length).toBe(0);
    });
    test('loc present but canReach false → opens a door first, still fires the op', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(doorOpened).toBe(true);
        expect(r).toBe('done');
    });
    test('op fired but expect never satisfied → retry', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        expectFlips = false;
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
    });
});

describe('Reach.npcDialog', () => {
    test('dialog already open → done immediately', async () => {
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('done');
    });
    test('npc absent → walks the hint, retry', async () => {
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
    });
    test('npc present, blocked way → door opened, talk fired, done when dialog opens', async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        // delayUntil evaluates its condition once — make the dialog "open" as a
        // side effect of interact for this scenario:
        sceneNpc.interactResult = true;
        dialogOpen = false;
        const promise = Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        dialogOpen = true; // opens before the wait's condition is polled
        const r = await promise;
        expect(doorOpened).toBe(true);
        expect(r).toBe('done');
    });
});
