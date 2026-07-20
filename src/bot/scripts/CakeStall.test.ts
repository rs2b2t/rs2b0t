import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '../api/Tile.js';

// Driver regression tests over mocked I/O singletons. The scripted "world"
// advances a fake game tick inside Execution.delayUntil/delayTicks so lockout
// waits and stall respawns resolve without wall-clock time. Shared script
// modules (ArdyFighterLogic, CakeStallLogic) are real — bun module mocks leak
// across test files, so only leaf client singletons are mocked here.

let tick: number;
let cakeCount: number;
let inCombat: boolean;
let stallStocked: boolean;
let bakerNear: boolean;
let playerTile: Tile;
let walks: string[]; // every walkTo dest
let clicks: number; // stall interacts issued
let chatHandler: ((e: { text: string }) => void) | null;
// per-click script: what the world does when the stall is clicked
let onClick: () => void;
// called on every stall Locs poll — lets a test script the respawn
let pollHook: () => void;

mock.module('../api/Execution.js', () => ({
    Execution: {
        delayUntil: async (fn: () => boolean, _ms?: number): Promise<boolean> => {
            for (let i = 0; i < 60; i++) {
                if (fn()) {
                    return true;
                }
                tick++;
            }
            return fn();
        },
        delayTicks: async (n: number = 1): Promise<void> => {
            tick += n;
        }
    }
}));
mock.module('../api/Game.js', () => ({
    Game: {
        tick: () => tick,
        inCombat: () => inCombat,
        tile: () => playerTile,
        ingame: () => true
    }
}));
mock.module('../api/hud/Inventory.js', () => ({
    Inventory: {
        items: () => Array.from({ length: cakeCount }, (_, i) => ({ id: 1891, name: 'Cake', count: 1, slot: i })),
        isFull: () => cakeCount >= 28,
        count: (name: string) => (name.toLowerCase().includes('cake') ? cakeCount : 0),
        used: () => cakeCount,
        first: () => null
    }
}));
mock.module('../api/Traversal.js', () => ({
    Traversal: {
        walkTo: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        },
        walkResilient: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        }
    }
}));
mock.module('../api/queries/Locs.js', () => ({
    Locs: {
        query: () => {
            const chain = {
                name: () => chain,
                action: () => chain,
                where: () => chain,
                results: () => [],
                nearest: () => {
                    pollHook();
                    return stallStocked
                        ? {
                              tile: () => new Tile(2667, 3310, 0),
                              interact: async (): Promise<boolean> => {
                                  clicks++;
                                  onClick();
                                  return true;
                              }
                          }
                        : null;
                }
            };
            return chain;
        }
    }
}));
mock.module('../api/queries/Npcs.js', () => ({
    Npcs: {
        query: () => {
            const chain = {
                name: () => chain,
                action: () => chain,
                where: () => chain,
                results: () => [],
                nearest: () => (bakerNear ? { tile: () => new Tile(2668, 3311, 0) } : null)
            };
            return chain;
        },
        all: () => []
    }
}));
mock.module('../events/EventBus.js', () => ({
    bus: {
        on: (_event: string, cb: (e: { text: string }) => void): (() => void) => {
            chatHandler = cb;
            return () => {
                chatHandler = null;
            };
        },
        emit: () => {}
    }
}));

const { stealCakes } = await import('./CakeStall.js');

const say = (text: string): void => {
    chatHandler?.({ text });
};

function opts(over: Record<string, unknown> = {}) {
    return {
        fillTo: 5,
        abort: () => false,
        setStatus: () => {},
        log: () => {},
        ...over
    };
}

describe('stealCakes driver', () => {
    beforeEach(() => {
        tick = 100;
        cakeCount = 0;
        inCombat = false;
        stallStocked = true;
        bakerNear = false;
        playerTile = new Tile(2668, 3312, 0); // already on the stand
        walks = [];
        clicks = 0;
        chatHandler = null;
        pollHook = () => {};
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            cakeCount++;
        };
    });

    test('steals to the fill target and reports stocked, no reset walks', async () => {
        expect(await stealCakes(opts())).toBe('stocked');
        expect(cakeCount).toBe(5);
        expect(clicks).toBe(5);
        expect(walks).toEqual([]); // on the stand the whole time
    });

    test('claims the stand once when off it, and still steals if the claim walk fails', async () => {
        playerTile = new Tile(2660, 3308, 0);
        expect(await stealCakes(opts())).toBe('stocked');
        expect(walks[0]).toBe('2668,3312'); // one claim walk, then stealing
    });

    test('a guard catch (combat, no cake) returns combat immediately', async () => {
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            inCombat = true;
        };
        expect(await stealCakes(opts())).toBe('combat');
        expect(clicks).toBe(1); // no clicking into a fight
    });

    test('three silent refusals walk to the reset tile, then stealing resumes', async () => {
        let refused = 0;
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            if (refused < 3) {
                refused++;
                bakerNear = true;
                return; // Baker watching: nothing gained
            }
            bakerNear = false;
            cakeCount++;
        };
        const resets: number[] = [];
        expect(await stealCakes(opts({ onReset: () => { resets.push(clicks); bakerNear = false; } }))).toBe('stocked');
        expect(resets).toEqual([3]); // exactly one reset, after the 3rd refusal
        expect(walks).toContain('2668,3320'); // walked off to the reset tile
        expect(walks[walks.length - 1]).toBe('2668,3312'); // and re-claimed the stand after
    });

    test('the lockout message parks clicks until the 10-tick window passes', async () => {
        // Locked until tick 110: the first click at tick 100 gets the engine
        // lockout line; the driver must then WAIT (selfLockout = 100 + 10),
        // and the next click at tick >= 110 succeeds.
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            if (tick < 110) {
                say('You can\'t steal from the market stall during combat!');
                return;
            }
            cakeCount++;
        };
        expect(await stealCakes(opts())).toBe('stocked');
        // 1 locked click + 5 successes — a 10-tick wait, not click spam
        expect(clicks).toBe(6);
    });

    test('abort wins between actions', async () => {
        let calls = 0;
        expect(await stealCakes(opts({ abort: () => ++calls > 1 }))).toBe('aborted');
    });

    test('an emptied stall waits for the respawn instead of clicking nothing', async () => {
        // Respawn model: after each success the stall empties; the stocked
        // variant returns after 5 Locs polls (the tick-advancing delayUntil
        // in the Execution mock drives those polls).
        let emptyPolls = 0;
        pollHook = () => {
            if (!stallStocked && ++emptyPolls >= 5) {
                stallStocked = true;
                emptyPolls = 0;
            }
        };
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            cakeCount++;
            stallStocked = false; // our steal emptied it
        };
        expect(await stealCakes(opts({ fillTo: 3 }))).toBe('stocked');
        expect(cakeCount).toBe(3); // waited out two respawns to get there
    });
});
