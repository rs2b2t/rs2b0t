import { describe, expect, mock, test, beforeEach } from 'bun:test';

// --- capture state the mocks read/write ---
let sceneLoc: { name: string; ops: string[]; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let sceneNpc: { name: string; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let walkCalls: { x: number; z: number; level: number }[];
let walkResult: boolean;
let walkLastOutcome: string;
let canReachResult: boolean;
let locInteractCount: number;
let npcInteractCount: number;
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
            name: () => ({ action: () => ({ within: () => ({ nearest: () => (sceneLoc ? { name: sceneLoc.name, tile: () => sceneLoc!.tile, actions: () => sceneLoc!.ops, interact: async () => { locInteractCount++; return sceneLoc!.interactResult; } } : null) }) }) })
        })
    }
}));
mock.module('./queries/Npcs.js', () => {
    const npcHandle = (): unknown => (sceneNpc ? { name: sceneNpc.name, tile: () => sceneNpc!.tile, interact: async () => { npcInteractCount++; return sceneNpc!.interactResult; } } : null);
    // name() now offers BOTH .nearest() (the adjacency probe) and .action().nearest() (the Talk-to lookup)
    return {
        Npcs: {
            query: () => ({
                name: () => ({ nearest: npcHandle, action: () => ({ nearest: npcHandle }) })
            })
        }
    };
});
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
        get lastOutcome() { return walkLastOutcome; }
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
    locInteractCount = 0;
    npcInteractCount = 0;
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
    test('loc present but canReach false → walks to the loc tile, then fires the op, done', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        // walked to the LOC tile (6,5) — not merely the hint (5,5) — then fired the op
        expect(walkCalls.length).toBe(1);
        expect(walkCalls[0]).toEqual({ x: 6, z: 5, level: 0 });
        expect(locInteractCount).toBe(1);
        expect(r).toBe('done');
    });
    test('loc present + canReach false + walk proves unreachable → unreachable, op never fires', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        walkResult = false;
        walkLastOutcome = 'unreachable';
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
        expect(walkCalls[0]).toEqual({ x: 6, z: 5, level: 0 });
        expect(locInteractCount).toBe(0);
    });
    test('op fired but expect never satisfied → retry', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        expectFlips = false;
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
    });
});

describe('Reach.npcDialog', () => {
    test('dialog already open + target adjacent → done (re-entrant, no walk/interact)', async () => {
        // bot at (0,0,0); target npc at (0,1,0) — Chebyshev 1, so the open box IS this npc's
        sceneNpc = { name: 'Traiborn', tile: { x: 0, z: 1, level: 0 }, interactResult: true };
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('done');
        expect(walkCalls.length).toBe(0);
        expect(npcInteractCount).toBe(0);
    });
    test('dialog open but target NOT adjacent → retry (foreign box, op never fires)', async () => {
        // an open box that is NOT this npc's — a random event, or another NPC's sticky menu (bot at (0,0,0), npc far)
        sceneNpc = { name: 'Traiborn', tile: { x: 10, z: 10, level: 0 }, interactResult: true };
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(0);
        expect(npcInteractCount).toBe(0);
    });
    test('dialog open but target absent from scene → retry (foreign box)', async () => {
        // sceneNpc stays null: the open box can't be this npc's when it isn't here at all
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(npcInteractCount).toBe(0);
    });
    test('npc absent → walks the hint, retry', async () => {
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
    });
    test('npc present but canReach false → walks to the npc tile, then Talk-to, done when dialog opens', async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        dialogOpen = false;
        const promise = Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        dialogOpen = true; // opens before the wait's condition is polled
        const r = await promise;
        // walked to the NPC tile (8,5) — not merely the hint (5,5) — then Talk-to fired
        expect(walkCalls.length).toBe(1);
        expect(walkCalls[0]).toEqual({ x: 8, z: 5, level: 0 });
        expect(npcInteractCount).toBe(1);
        expect(r).toBe('done');
    });
    test('npc present + canReach false + walk unreachable → unreachable, Talk-to never fires', async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        canReachResult = false;
        walkResult = false;
        walkLastOutcome = 'unreachable';
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('unreachable');
        expect(walkCalls[0]).toEqual({ x: 8, z: 5, level: 0 });
        expect(npcInteractCount).toBe(0);
    });
});
