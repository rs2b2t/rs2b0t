import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { stubProps } from '../../lib/stubSingletons.js';

let sceneLoc: { name: string; id?: number; ops: string[]; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let sceneDoor: { name: string; ops: string[]; tile: { x: number; z: number; level: number }; distance: number; interactResult: boolean } | null;
let sceneNpc: { name: string; tile: { x: number; z: number; level: number }; interactResult: boolean } | null;
let walkCalls: { x: number; z: number; level: number }[];
let walkResult: boolean;
let _walkLastOutcome: string;
let canReachResult: boolean;
let cantReach: boolean;
let locBlankQueries: number;
let locInteractCount: number;
let doorInteractCount: number;
let npcInteractCount: number;
let onNpcInteract: (() => void) | null;
let dialogOpen: boolean;
let expectFlips: boolean;
let onDoorOpen: (() => void) | null;

const { GameMessages } = await import('#/bot/api/chatbox/gameMessages.js');

// Why: Bun's mock.module is permanent for the process, so stub the singleton instead.
const restoreReader = stubProps(reader, { worldTile: () => ({ x: 0, z: 0, level: 0 }) });
const restoreExec = stubProps(Execution, {
    delayUntil: async (cond: () => boolean) => cond(),
    delayTicks: async () => {}
});

/** Re-checks the predicate up to `rounds` times, the way Execution.delayUntil polls across ticks. */
const pollingDelayUntil = (rounds: number) => async (cond: () => boolean): Promise<boolean> => {
    for (let i = 0; i < rounds; i++) {
        if (cond()) {
            return true;
        }
    }
    return cond();
};

/** Scene queries that come back blank before the loc appears, standing in for a rebuild in flight. */
const locHandle = () =>
    sceneLoc && locBlankQueries-- <= 0
        ? {
            name: sceneLoc.name,
            id: sceneLoc.id ?? 0,
            tile: () => sceneLoc!.tile,
            actions: () => sceneLoc!.ops,
            interact: async () => {
                locInteractCount++;
                if (cantReach) {
                    GameMessages.record("I can't reach that!");
                }
                return sceneLoc!.interactResult;
            }
        }
        : null;
const doorHandle = () =>
    sceneDoor
        ? {
            name: sceneDoor.name,
            tile: () => sceneDoor!.tile,
            actions: () => sceneDoor!.ops,
            distance: () => sceneDoor!.distance,
            interact: async () => {
                doorInteractCount++;
                if (!sceneDoor!.interactResult) {
                    return false;
                }
                onDoorOpen?.();
                sceneDoor = null;
                return true;
            }
        }
        : null;
const npcHandle = () =>
    sceneNpc
        ? {
            name: sceneNpc.name,
            tile: () => sceneNpc!.tile,
            distance: () => 1,
            actions: () => ['Talk-to', 'Attack'],
            interact: async () => {
                npcInteractCount++;
                onNpcInteract?.();
                if (cantReach) {
                    GameMessages.record("I can't reach that!");
                }
                return sceneNpc?.interactResult ?? false;
            }
        }
        : null;
function whereChain(preds: ((l: unknown) => boolean)[]): unknown {
    return {
        where: (p: (l: unknown) => boolean) => whereChain([...preds, p]),
        nearest: () => {
            const h = doorHandle();
            return h && preds.every(p => p(h)) ? h : null;
        }
    };
}
const restoreLocs = stubProps(Locs, {
    query: () =>
        ({
            name: () => ({
                action: () => ({
                    within: () => ({
                        nearest: locHandle,
                        where: (p: (l: unknown) => boolean) => ({
                            nearest: () => {
                                const h = locHandle();
                                return h && p(h) ? h : null;
                            }
                        })
                    }),
                    where: (p: (l: unknown) => boolean) => whereChain([p]),
                    nearest: locHandle
                }),
                where: (p: (l: unknown) => boolean) => whereChain([p]),
                nearest: locHandle
            }),
            where: (p: (l: unknown) => boolean) => whereChain([p])
        }) as never
});
const restoreNpcs = stubProps(Npcs, {
    query: () =>
        ({
            name: () => ({
                nearest: npcHandle,
                action: () => ({ nearest: npcHandle }),
                where: (pred: (n: unknown) => boolean) => ({
                    nearest: () => {
                        const h = npcHandle();
                        return h && pred(h) ? h : null;
                    }
                })
            })
        }) as never
});
const restoreChat = stubProps(ChatDialog, { isOpen: () => dialogOpen, canContinue: () => false });
const restoreReach = stubProps(Reachability, { canReach: () => canReachResult });
const restoreTraversal = stubProps(Traversal, {
    walkResilient: async (dest: { x: number; z: number; level: number }) => {
        walkCalls.push(dest);
        return walkResult;
    }
});
// WalkExecutor — pin lastOutcome via the writable field (no module mock).
const realLastOutcome = WalkExecutor.lastOutcome;
afterAll(() => {
    restoreReader();
    restoreExec();
    restoreLocs();
    restoreNpcs();
    restoreChat();
    restoreReach();
    restoreTraversal();
    WalkExecutor.lastOutcome = realLastOutcome;
});

const { Reach } = await import('#/bot/api/walking/Reach.js');

beforeEach(() => {
    sceneLoc = null;
    sceneDoor = null;
    sceneNpc = null;
    walkCalls = [];
    walkResult = true;
    _walkLastOutcome = 'failed';
    WalkExecutor.lastOutcome = 'failed';
    canReachResult = true;
    cantReach = false;
    locBlankQueries = 0;
    locInteractCount = 0;
    doorInteractCount = 0;
    npcInteractCount = 0;
    onNpcInteract = null;
    dialogOpen = false;
    expectFlips = true;
    onDoorOpen = null;
    GameMessages.reset();
});

describe('Reach.entityOp', () => {
    test('normal success dispatches once without opening a door', async () => {
        sceneNpc = { name: 'Guard', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        expectFlips = false;
        onNpcInteract = () => { expectFlips = true; };

        const r = await Reach.entityOp({ find: npcHandle, op: 'Attack', expect: () => expectFlips, what: 'Guard' });

        expect(r).toBe('done');
        expect(npcInteractCount).toBe(1);
        expect(doorInteractCount).toBe(0);
    });

    test("fresh server can't-reach opens the door and a fresh retry succeeds", async () => {
        sceneNpc = { name: 'Guard', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = { name: 'Large door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1, interactResult: true };
        cantReach = true;
        expectFlips = false;
        onNpcInteract = () => { if (!cantReach) { expectFlips = true; } };
        onDoorOpen = () => { cantReach = false; };

        const r = await Reach.entityOp({ find: npcHandle, op: 'Attack', expect: () => expectFlips, what: 'Guard' });

        expect(r).toBe('done');
        expect(npcInteractCount).toBe(2);
        expect(doorInteractCount).toBe(1);
    });

    test('success arriving while the door opens does not dispatch a redundant retry', async () => {
        sceneNpc = { name: 'Guard', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = { name: 'Large door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1, interactResult: true };
        cantReach = true;
        expectFlips = false;
        onDoorOpen = () => {
            cantReach = false;
            expectFlips = true;
        };

        const r = await Reach.entityOp({ find: npcHandle, op: 'Attack', expect: () => expectFlips, what: 'Guard' });

        expect(r).toBe('done');
        expect(npcInteractCount).toBe(1);
        expect(doorInteractCount).toBe(1);
    });

    test('a stale pre-mark can\'t-reach message is ignored', async () => {
        sceneNpc = { name: 'Guard', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        expectFlips = false;
        GameMessages.record("I can't reach that!");

        const r = await Reach.entityOp({ find: npcHandle, op: 'Attack', expect: () => expectFlips, what: 'Guard' });

        expect(r).toBe('retry');
        expect(npcInteractCount).toBe(1);
        expect(doorInteractCount).toBe(0);
    });

    test("fresh server can't-reach with no openable door is unreachable after one call", async () => {
        sceneNpc = { name: 'Guard', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        cantReach = true;
        expectFlips = false;

        const r = await Reach.entityOp({ find: npcHandle, op: 'Attack', expect: () => expectFlips, what: 'Guard' });

        expect(r).toBe('unreachable');
        expect(npcInteractCount).toBe(1);
        expect(doorInteractCount).toBe(0);
    });

    test('dispatch false returns retry after one call', async () => {
        sceneNpc = { name: 'Guard', tile: { x: 8, z: 5, level: 0 }, interactResult: false };
        expectFlips = false;

        const r = await Reach.entityOp({ find: npcHandle, op: 'Attack', expect: () => expectFlips, what: 'Guard' });

        expect(r).toBe('retry');
        expect(npcInteractCount).toBe(1);
        expect(doorInteractCount).toBe(0);
    });

    test('target disappearing after a successful door open returns retry without a stale second interaction', async () => {
        sceneNpc = { name: 'Guard', tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = { name: 'Large door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1, interactResult: true };
        cantReach = true;
        expectFlips = false;
        onDoorOpen = () => {
            cantReach = false;
            sceneNpc = null;
        };

        const r = await Reach.entityOp({ find: npcHandle, op: 'Attack', expect: () => expectFlips, what: 'Guard' });

        expect(r).toBe('retry');
        expect(npcInteractCount).toBe(1);
        expect(doorInteractCount).toBe(1);
    });
});

describe('Reach.locOp', () => {
    test('loc not in scene → walks the hint, returns retry', async () => {
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('retry');
        expect(walkCalls.length).toBe(1);
        expect(walkCalls[0]).toEqual({ x: 5, z: 5, level: 0 });
    });
    test('hint walk proven unreachable → unreachable', async () => {
        walkResult = false;
        _walkLastOutcome = 'unreachable';
        WalkExecutor.lastOutcome = 'unreachable';
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
    });
    test('loc present + expect satisfied → done (clicks the loc, never walks to it)', async () => {
        sceneLoc = { name: 'Ladder', ops: ['Climb-down'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('done');
        expect(locInteractCount).toBe(1);
        expect(walkCalls.length).toBe(1);
        expect(walkCalls[0]).toEqual({ x: 5, z: 5, level: 0 });
    });
    test('an id that matches the scene loc still clicks it', async () => {
        sceneLoc = { name: 'Crate', id: 2071, ops: ['Search'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        const r = await Reach.locOp({ name: 'Crate', op: 'Search', near: { x: 5, z: 5, level: 0 }, id: 2071, expect: () => expectFlips });
        expect(r).toBe('done');
        expect(locInteractCount).toBe(1);
    });
    test('a same-named loc with the wrong id is never clicked', async () => {
        sceneLoc = { name: 'Crate', id: 366, ops: ['Search'], tile: { x: 6, z: 5, level: 0 }, interactResult: true };
        const r = await Reach.locOp({ name: 'Crate', op: 'Search', near: { x: 5, z: 5, level: 0 }, id: 2071, expect: () => expectFlips });
        expect(r).not.toBe('done');
        expect(locInteractCount).toBe(0);
    });
    test("server 'can't reach' → open the blocking door, then the op lands → done", async () => {
        sceneLoc = { name: 'Staircase', ops: ['Climb-up'], tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = { name: 'Door', ops: ['Open'], tile: { x: 1, z: 0, level: 0 }, distance: 1, interactResult: true };
        cantReach = true;
        expectFlips = false;
        onDoorOpen = () => { cantReach = false; expectFlips = true; };
        const r = await Reach.locOp({ name: 'Staircase', op: 'Climb-up', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('done');
        expect(doorInteractCount).toBeGreaterThanOrEqual(1);
        expect(locInteractCount).toBeGreaterThanOrEqual(2);
    });
    test("server 'can't reach' + no openable door → unreachable (honest block)", async () => {
        sceneLoc = { name: 'Staircase', ops: ['Climb-up'], tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        sceneDoor = null;
        cantReach = true;
        expectFlips = false;
        const r = await Reach.locOp({ name: 'Staircase', op: 'Climb-up', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
        expect(r).toBe('unreachable');
        expect(locInteractCount).toBe(1);
    });
    test('loc in scene but the stand is unreachable → unreachable (op never fires)', async () => {
        sceneLoc = { name: 'Staircase', ops: ['Climb-up'], tile: { x: 8, z: 5, level: 0 }, interactResult: true };
        walkResult = false;
        _walkLastOutcome = 'unreachable';
        WalkExecutor.lastOutcome = 'unreachable';
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
    test('a scene still rebuilding at the stand is waited out, not read as absent', async () => {
        sceneLoc = { name: 'Portal', id: 4171, ops: ['Use'], tile: { x: 5, z: 5, level: 0 }, interactResult: true };
        locBlankQueries = 3;
        const restore = stubProps(Execution, { delayUntil: pollingDelayUntil(6) });
        try {
            const r = await Reach.locOp({ name: 'Portal', op: 'Use', near: { x: 5, z: 5, level: 0 }, id: 4171, expect: () => expectFlips });
            expect(r).toBe('done');
            expect(locInteractCount).toBe(1);
        } finally {
            restore();
        }
    });
    test('a blank scene far from the stand still walks the hint without waiting', async () => {
        reader.worldTile = () => ({ x: 90, z: 90, level: 0 });
        let waited = false;
        const restore = stubProps(Execution, { delayUntil: async () => { waited = true; return false; } });
        try {
            const r = await Reach.locOp({ name: 'Ladder', op: 'Climb-down', near: { x: 5, z: 5, level: 0 }, expect: () => expectFlips });
            expect(r).toBe('retry');
            expect(waited).toBe(false);
            expect(walkCalls.length).toBe(1);
        } finally {
            restore();
            reader.worldTile = () => ({ x: 0, z: 0, level: 0 });
        }
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
        dialogOpen = true;
        const r = await promise;
        expect(walkCalls.length).toBe(1);
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
        expect(npcInteractCount).toBeGreaterThanOrEqual(2);
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
