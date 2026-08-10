import * as RealInventory from '#/bot/api/hud/Inventory.js';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { GroundItems } from '#/bot/api/queries/GroundItems.js';
import { Locs } from '#/bot/api/queries/Locs.js';
import { Npcs } from '#/bot/api/queries/Npcs.js';
import Tile from '#/bot/api/Tile.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { GameMessages } from '#/bot/events/gameMessages.js';
import { stubProps } from '../lib/stubSingletons.js';

// riddle001: kill Black Heather at the Bandit Camp for the chest key.
const CLUE_ID = 2831;
const KEY_ID = CLUE_DB[CLUE_ID].keyFrom!.keyId;
const NPC_NAME = CLUE_DB[CLUE_ID].keyFrom!.npc;
const ANCHOR = KILL_ANCHORS[CLUE_ID];
const FOOD_ID = 379;

// player_combat.rs2 refuses op2 in single-way combat while we are still flagged
// from another fight — routine at a spawn ringed by aggressive bandits.
const REFUSAL = "I'm already under attack!";

interface FakeEntity {
    id: number;
    name: string | null;
    ops: string[];
    tile: { x: number; z: number; level: number };
    dist: number;
    busy?: boolean;
}

let inv: { id: number; count: number }[];
let npcsUp: FakeEntity[];
let ground: FakeEntity[];
let inCombat: boolean;
let attacks: number;
let refusalsLeft: number;
let walks: string[];
let removeFoodOnWalk: boolean;
let ticks: number;
let onTick: (() => void) | null;

function chain<T extends FakeEntity>(supply: () => T[], onInteract: (e: T, op: string) => void) {
    const build = (rows: T[]) => {
        const wrap = (e: T) => ({
            id: e.id,
            name: e.name,
            actions: () => e.ops,
            tile: () => new Tile(e.tile.x, e.tile.z, e.tile.level),
            distance: () => e.dist,
            targetsMe: () => false,
            targetsAnotherPlayer: () => e.busy === true,
            valid: () => supply().includes(e),
            interact: async (op: string): Promise<boolean> => {
                onInteract(e, op);
                return true;
            }
        });
        const q = {
            name: (...names: string[]) => build(rows.filter(r => names.some(n => n.toLowerCase() === (r.name ?? '').toLowerCase()))),
            action: (op: string) => build(rows.filter(r => r.ops.some(o => o.toLowerCase() === op.toLowerCase()))),
            // The executor's `where` runs against wrapped entities.
            where: (fn: (e: ReturnType<typeof wrap>) => boolean) => build(rows.filter(r => fn(wrap(r)))),
            nearest: () => (rows.length > 0 ? wrap(rows[0]) : null),
            results: () => rows.map(wrap)
        };
        return q as never;
    };
    return () => build(supply());
}

const restoreReader = stubProps(reader, {
    countDialogOpen: () => false,
    modals: () => ({ main: -1, chat: -1, side: -1 }),
    worldTile: () => ({ x: ANCHOR.x, z: ANCHOR.z, level: 0 })
});
const restoreActions = stubProps(actions, {
    answerCountDialog: (): boolean => true,
    closeModal: (): boolean => true
});
const restoreChat = stubProps(ChatDialog, {
    isOpen: () => false,
    canContinue: () => false,
    continue: async (): Promise<boolean> => false,
    options: () => [],
    chooseOption: async (): Promise<boolean> => false
});
const restoreExec = stubProps(Execution, {
    delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
    // The hunt waits on the tick, so the fake world has to move on the tick too —
    // otherwise a wait for something that never arrives burns its budget for real.
    delayTicks: async (): Promise<void> => {
        ticks++;
        onTick?.();
    }
});
const restoreGame = stubProps(Game, {
    inCombat: () => inCombat,
    tile: () => new Tile(ANCHOR.x, ANCHOR.z, 0)
});
const restoreTraversal = stubProps(Traversal, {
    walkResilient: async (dest: { x: number; z: number }): Promise<boolean> => {
        walks.push(`walk ${dest.x},${dest.z}`);
        if (removeFoodOnWalk) {
            // What Sustain does mid-walk: a lobster leaves the pack.
            inv = inv.filter(i => i.id !== FOOD_ID);
        }
        return true;
    }
});

const restoreNpcs = stubProps(Npcs, {
    query: chain(
        () => npcsUp,
        (e, op) => {
            if (op !== 'Attack') {
                return;
            }
            attacks++;
            if (refusalsLeft > 0) {
                refusalsLeft--;
                GameMessages.record(REFUSAL);
                return;
            }
            npcsUp = npcsUp.filter(n => n !== e);
            inCombat = false;
            ground.push({ id: KEY_ID, name: 'Key', ops: ['Take'], tile: e.tile, dist: 0 });
        }
    )
});
const restoreGround = stubProps(GroundItems, {
    query: chain(
        () => ground,
        (e, op) => {
            if (op !== 'Take') {
                return;
            }
            ground = ground.filter(g => g !== e);
            inv.push({ id: e.id, count: 1 });
        }
    )
});
const restoreLocs = stubProps(Locs, {
    query: chain(
        () => [],
        () => {}
    )
});

const realInventoryFns = { ...RealInventory.Inventory };
const stubInventory = {
    items: () => inv.map(i => ({ ...i, actions: () => (i.id === FOOD_ID ? ['Eat'] : []), interact: async (): Promise<boolean> => true })),
    first: (name: string) => (['Spade', 'Sextant', 'Watch', 'Chart', 'Rope'].includes(name) ? { id: 0, count: 1, interact: async (): Promise<boolean> => true } : null),
    isFull: () => false,
    used: () => inv.length,
    free: () => 28 - inv.length
};

afterAll(() => {
    restoreReader();
    restoreActions();
    restoreChat();
    restoreExec();
    restoreGame();
    restoreTraversal();
    restoreNpcs();
    restoreGround();
    restoreLocs();
    Object.assign(RealInventory.Inventory, realInventoryFns);
});

const { ClueExecutor } = await import('#/bot/clues/ClueExecutor.js');

function heather(dist = 1): FakeEntity {
    return { id: 202, name: NPC_NAME, ops: ['Talk-to', 'Attack'], tile: { x: ANCHOR.x, z: ANCHOR.z, level: 0 }, dist };
}

beforeEach(() => {
    Object.assign(RealInventory.Inventory, stubInventory);
    inv = [{ id: CLUE_ID, count: 1 }];
    npcsUp = [heather()];
    ground = [];
    inCombat = false;
    attacks = 0;
    refusalsLeft = 0;
    walks = [];
    removeFoodOnWalk = false;
    ticks = 0;
    onTick = null;
    GameMessages.reset();
});

describe('riddle key hunt', () => {
    // More refusals than the executor has step attempts: the retry has to live
    // inside the hunt. The regression sent one fire-and-forget op per attempt
    // and parked silently for 20s after each, so it ran out of attempts first.
    test('a refused attack is re-sent within the same attempt', async () => {
        refusalsLeft = 6;
        await ClueExecutor.solveHeldClue(() => {});
        expect(attacks).toBeGreaterThanOrEqual(7);
        expect(inv.some(i => i.id === KEY_ID)).toBe(true);
    });

    test('an attack that lands is not re-sent', async () => {
        await ClueExecutor.solveHeldClue(() => {});
        expect(attacks).toBe(1);
        expect(inv.some(i => i.id === KEY_ID)).toBe(true);
    });

    test('an absent target is waited out rather than abandoning the riddle', async () => {
        npcsUp = [];
        onTick = () => {
            if (ticks >= 3 && npcsUp.length === 0) {
                npcsUp = [heather()];
            }
        };
        const lines: string[] = [];
        await ClueExecutor.solveHeldClue(m => lines.push(m));
        expect(lines.some(l => l.includes('respawn'))).toBe(true);
        expect(inv.some(i => i.id === KEY_ID)).toBe(true);
    });

    test('a target another player is fighting is left alone until it is free', async () => {
        const busy = { ...heather(), busy: true };
        npcsUp = [busy];
        const attacksWhileBusy: number[] = [];
        onTick = () => {
            attacksWhileBusy.push(attacks);
            if (ticks >= 3) {
                busy.busy = false;
            }
        };
        await ClueExecutor.solveHeldClue(() => {});
        expect(attacksWhileBusy.slice(0, 3)).toEqual([0, 0, 0]);
        expect(inv.some(i => i.id === KEY_ID)).toBe(true);
    });
});

describe('step progress', () => {
    test('eating mid-leg is not mistaken for solving the step', async () => {
        // 2811 digs at Baxtorian Falls; nothing here can ever solve it, so the
        // only inventory movement is Sustain eating during the walk.
        inv = [{ id: 2811, count: 1 }, { id: FOOD_ID, count: 1 }];
        npcsUp = [];
        removeFoodOnWalk = true;
        const lines: string[] = [];
        const outcome = await ClueExecutor.solveHeldClue(m => lines.push(m));
        expect(outcome).toBe('abandon');
        expect(lines.some(l => l.includes('no progress after'))).toBe(true);
        expect(lines.some(l => l === 'step done')).toBe(false);
    });
});
