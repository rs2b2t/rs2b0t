import { describe, expect, mock, test, beforeEach } from 'bun:test';

// --- capture state the mocks read/write ---
let sceneLoc: { name: string; ops: string[]; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let sceneDoor: { name: string; ops: string[]; tile: { x: number; z: number; level: number }; distance: number; interactResult: boolean } | null;
let sceneNpc: { name: string; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let walkCalls: { x: number; z: number; level: number }[];
let walkResult: boolean;
let walkLastOutcome: string;
let canReachResult: boolean;
let cantReach: boolean; // GameMessages.sawSince(mark, CANT_REACH) result — the server's door signal
let locInteractCount: number;
let doorInteractCount: number;
let npcInteractCount: number;
let dialogOpen: boolean;
let expectFlips: boolean; // locOp/npcDialog's expect() reads this
let onDoorOpen: (() => void) | null; // side effect when the mock door swings (clears the block)

// Capture the REAL barrier predicates BEFORE mocking WalkExecutor. mock.module is
// process-global, so a WalkExecutor mock that omitted them would clobber them for
// every test loaded after this file. The mock factory below re-exports them.
const { isOpenableBarrier, isOpenBarrierLeaf } = await import('#/bot/nav/WalkExecutor.js');

// Same global-mock rule: spread the REAL modules so sibling suites loaded later
// still see every export (the real reader methods null-guard safely unattached;
// the real CANT_REACH regex + walkOpening/followMath helpers stay intact).
const RealAdapter = await import('#/bot/adapter/ClientAdapter.js');
mock.module('#/bot/adapter/ClientAdapter.js', () => ({
    ...RealAdapter,
    reader: { ...RealAdapter.reader, worldTile: () => ({ x: 0, z: 0, level: 0 }) }
}));
// DON'T mock GameMessages — mock.module is process-global and stubbing its
// methods leaks into gameMessages.test.ts. Use the REAL singleton: the mock
// loc/npc interact records an actual "I can't reach that!" when `cantReach` is
// set, so the reach loop's mark()/sawSince(CANT_REACH) work for real.
const { GameMessages } = await import('#/bot/events/gameMessages.js');
mock.module('#/bot/api/Execution.js', () => ({
    Execution: {
        delayUntil: async (cond: () => boolean) => cond(),
        delayTicks: async () => {}
    }
}));

// The target-loc chain: query().name().action().within().nearest() → sceneLoc.
// The door chain (openBlockingDoor): query().where(pred)…nearest() → sceneDoor,
// kept only when every predicate passes (so isOpenableBarrier/towardDest/canReach
// all gate it, exactly as production does).
const locHandle = () => (sceneLoc ? {
    name: sceneLoc.name, tile: () => sceneLoc!.tile, actions: () => sceneLoc!.ops,
    interact: async () => { locInteractCount++; if (cantReach) { GameMessages.record("I can't reach that!"); } return sceneLoc!.interactResult; }
} : null);
const doorHandle = () => (sceneDoor ? {
    name: sceneDoor.name, tile: () => sceneDoor!.tile, actions: () => sceneDoor!.ops, distance: () => sceneDoor!.distance,
    interact: async () => {
        doorInteractCount++;
        if (!sceneDoor!.interactResult) { return false; }
        onDoorOpen?.();   // clears the block (cantReach=false + expect/dialog flips)
        sceneDoor = null; // the leaf swung open — the shut loc is gone
        return true;
    }
} : null);
function whereChain(preds: ((l: unknown) => boolean)[]): unknown {
    return {
        where: (p: (l: unknown) => boolean) => whereChain([...preds, p]),
        nearest: () => { const h = doorHandle(); return h && preds.every(p => p(h)) ? h : null; }
    };
}
mock.module('#/bot/api/queries/Locs.js', () => ({
    Locs: {
        query: () => ({
            name: () => ({ action: () => ({ within: () => ({ nearest: locHandle }) }) }),
            where: (p: (l: unknown) => boolean) => whereChain([p])
        })
    }
}));
mock.module('#/bot/api/queries/Npcs.js', () => {
    const npcHandle = (): unknown => (sceneNpc ? { name: sceneNpc.name, tile: () => sceneNpc!.tile, actions: () => ['Talk-to'], interact: async () => { npcInteractCount++; if (cantReach) { GameMessages.record("I can't reach that!"); } return sceneNpc!.interactResult; } } : null);
    return {
        Npcs: {
            query: () => ({
                name: () => ({
                    nearest: npcHandle,
                    action: () => ({ nearest: npcHandle }),
                    where: (pred: (n: unknown) => boolean) => ({ nearest: () => { const h = npcHandle(); return h && pred(h) ? h : null; } })
                })
            })
        }
    };
});
mock.module('#/bot/api/hud/ChatDialog.js', () => ({
    ChatDialog: { isOpen: () => dialogOpen, canContinue: () => false }
}));
mock.module('#/bot/api/Reachability.js', () => ({
    Reachability: { canReach: () => canReachResult }
}));
mock.module('#/bot/api/Traversal.js', () => ({
    Traversal: {
        walkResilient: async (dest: { x: number; z: number; level: number }) => {
            walkCalls.push(dest);
            return walkResult;
        }
    }
}));
mock.module('#/bot/nav/WalkExecutor.js', () => ({
    WalkExecutor: { get lastOutcome() { return walkLastOutcome; } },
    isOpenableBarrier,
    isOpenBarrierLeaf
}));

const { Reach } = await import('#/bot/api/Reach.js');

beforeEach(() => {
    sceneLoc = null;
    sceneDoor = null;
    sceneNpc = null;
    walkCalls = [];
    walkResult = true;
    walkLastOutcome = 'failed';
    canReachResult = true;
    cantReach = false;
    locInteractCount = 0;
    doorInteractCount = 0;
    npcInteractCount = 0;
    dialogOpen = false;
    expectFlips = true;
    onDoorOpen = null;
    GameMessages.reset();
});

describe('Reach.locOp', () => {
    test('loc not in scene → walks the hint, returns retry', async () => {
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
        expect(walkCalls[0]).toEqual({ x: 5, z: 5, level: 0 }); // the hint, not a target tile
    });
    test('hint walk proven unreachable → unreachable', async () => {
        walkResult = false;
        walkLastOutcome = 'unreachable';
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
    });
    test('loc present + expect satisfied → done (clicks the loc, never walks to it)', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('done');
        expect(locInteractCount).toBe(1);
        expect(walkCalls.length).toBe(1);              // walks to the stand...
        expect(walkCalls[0]).toEqual({ x: 5, z: 5, level: 0 }); // ...the NEAR hint, never the loc tile
    });
    test("server 'can't reach' → open the blocking door, then the op lands → done", async () => {
        sceneLoc = { name: 'Staircase', ops: ['Climb-up'], tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = { name: 'Door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1, interactResult: true };
        cantReach = true;   // first click: the server can't reach the staircase (a door blocks)
        expectFlips = false; // not climbed yet
        // Opening the door clears the block: the leaf vanishes, and the next
        // click's op-walk reaches the staircase (level change).
        onDoorOpen = () => { cantReach = false; expectFlips = true; };
        const r = await Reach.locOp({ name: 'Staircase', op: 'Climb-up', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('done');
        expect(doorInteractCount).toBeGreaterThanOrEqual(1); // the door was opened
        expect(locInteractCount).toBeGreaterThanOrEqual(2); // clicked, opened door, clicked again
    });
    test("server 'can't reach' + no openable door → unreachable (honest block)", async () => {
        sceneLoc = { name: 'Staircase', ops: ['Climb-up'], tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = null; // nothing to open
        cantReach = true;
        expectFlips = false;
        const r = await Reach.locOp({ name: 'Staircase', op: 'Climb-up', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
        expect(locInteractCount).toBe(1);
    });
    test('loc in scene but the stand is unreachable → unreachable (op never fires)', async () => {
        sceneLoc = { name: 'Staircase', ops: ['Climb-up'], tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        walkResult = false;
        walkLastOutcome = 'unreachable';
        const r = await Reach.locOp({ name: 'Staircase', op: 'Climb-up', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
        expect(locInteractCount).toBe(0);
    });
    test('op fired but neither expect nor a can\'t-reach → retry', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        expectFlips = false;
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
    });
});

describe('Reach.npcDialog', () => {
    test('dialog already open + target adjacent → done (re-entrant, no walk/interact)', async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 0, z: 1, level: 0 }, interactResult: true };
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('done');
        expect(walkCalls.length).toBe(0);
        expect(npcInteractCount).toBe(0);
    });
    test('dialog open but target NOT adjacent → retry (foreign box, op never fires)', async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 10, z: 10, level: 0 }, interactResult: true };
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(npcInteractCount).toBe(0);
    });
    test('dialog open but target absent from scene → retry (foreign box)', async () => {
        dialogOpen = true;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(npcInteractCount).toBe(0);
    });
    test('npc absent → walks the hint, retry', async () => {
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
        expect(walkCalls[0]).toEqual({ x: 5, z: 5, level: 0 });
    });
    test('npc present + dialog opens → Talk-to fires, no walk to the npc, done', async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        dialogOpen = false;
        const promise = Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        dialogOpen = true; // opens before the wait's condition is polled
        const r = await promise;
        expect(walkCalls.length).toBe(1);              // walks to the stand, not the npc tile
        expect(npcInteractCount).toBe(1);
        expect(r).toBe('done');
    });
    test("server 'can't reach' the npc → open the door, then Talk-to lands → done", async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = { name: 'Door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1, interactResult: true };
        cantReach = true;
        dialogOpen = false;
        onDoorOpen = () => { cantReach = false; dialogOpen = true; };
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('done');
        expect(doorInteractCount).toBeGreaterThanOrEqual(1);
        expect(npcInteractCount).toBeGreaterThanOrEqual(2); // talked, opened door, talked again
    });
    test("server 'can't reach' the npc + no door → unreachable", async () => {
        sceneNpc = { name: 'Traiborn', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = null;
        cantReach = true;
        dialogOpen = false;
        const r = await Reach.npcDialog({ name: 'Traiborn', near: { x: 5, z: 5, level: 0 } });
        expect(r).toBe('unreachable');
    });
});
