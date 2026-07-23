import { InvItem } from '#/bot/api/hud/Inventory.js';
import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '#/bot/api/Tile.js';

let tick: number;
let cakeCount: number;
let inCombat: boolean;
let stallStocked: boolean;
let playerTile: Tile;
let walks: string[];
let clicks: number;
let chatHandler: ((e: { text: string }) => void) | null;
let onClick: () => void;
let pollHook: () => void;
let walkFails: number;

mock.module('#/bot/api/Execution.js', () => ({
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
mock.module('#/bot/api/Game.js', () => ({
    Game: {
        tick: () => tick,
        inCombat: () => inCombat,
        tile: () => playerTile,
        ingame: () => true
    }
}));
mock.module('#/bot/api/hud/Inventory.js', () => ({
    InvItem,
    Inventory: {
        items: () => Array.from({ length: cakeCount }, (_, i) => ({ id: 1891, name: 'Cake', count: 1, slot: i })),
        isFull: () => cakeCount >= 28,
        count: (name: string) => (name.toLowerCase().includes('cake') ? cakeCount : 0),
        used: () => cakeCount,
        first: () => null
    }
}));
mock.module('#/bot/api/Traversal.js', () => ({
    Traversal: {
        walkTo: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            if (walkFails > 0) {
                walkFails--;
                return false;
            }
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
mock.module('#/bot/api/queries/Locs.js', () => ({
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
mock.module('#/bot/events/EventBus.js', () => ({
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

const { stealCakes } = await import('#/bot/scripts/CakeStall.js');

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
        playerTile = new Tile(2668, 3312, 0);
        walks = [];
        clicks = 0;
        chatHandler = null;
        pollHook = () => {};
        walkFails = 0;
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            cakeCount++;
        };
    });

    test('steals to the fill target and reports stocked, no reset walks', async () => {
        expect(await stealCakes(opts())).toBe('stocked');
        expect(cakeCount).toBe(5);
        expect(clicks).toBe(5);
        expect(walks).toEqual([]);
    });

    test('claims the stand when off it, then steals', async () => {
        playerTile = new Tile(2660, 3308, 0);
        expect(await stealCakes(opts())).toBe('stocked');
        expect(walks[0]).toBe('2668,3312');
    });

    test('a fallen-short claim far from the stall does NOT click — re-claims instead', async () => {
        playerTile = new Tile(2655, 3298, 0);
        walkFails = 1;
        expect(await stealCakes(opts())).toBe('stocked');
        expect(walks.slice(0, 2)).toEqual(['2668,3312', '2668,3312']);
        expect(clicks).toBe(5);
    });

    test('a guard catch (combat, no cake) returns combat immediately', async () => {
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            inCombat = true;
        };
        expect(await stealCakes(opts())).toBe('combat');
        expect(clicks).toBe(1);
    });

    test('three silent refusals swap to the SE stand, then stealing resumes there', async () => {
        let refused = 0;
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            if (refused < 3) {
                refused++;
                return;
            }
            cakeCount++;
        };
        const resets: number[] = [];
        expect(await stealCakes(opts({ onReset: () => resets.push(clicks) }))).toBe('stocked');
        expect(resets).toEqual([3]);
        expect(walks).toContain('2669,3310');
        expect(walks[walks.length - 1]).toBe('2669,3310');
    });

    test('a second watched streak swaps back to the north stand', async () => {
        let refused = 0;
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            refused++;
            if (refused <= 6) {
                return;
            }
            cakeCount++;
        };
        expect(await stealCakes(opts({ fillTo: 2 }))).toBe('stocked');
        const swaps = walks.filter(w => w === '2669,3310' || w === '2668,3312');
        expect(swaps[0]).toBe('2669,3310');
        expect(swaps[1]).toBe('2668,3312');
    });

    test('the lockout message parks clicks until the 10-tick window passes', async () => {
        onClick = () => {
            say('You attempt to steal a cake from the baker\'s stall.');
            if (tick < 110) {
                say('You can\'t steal from the market stall during combat!');
                return;
            }
            cakeCount++;
        };
        expect(await stealCakes(opts())).toBe('stocked');
        expect(clicks).toBe(6);
    });

    test('abort wins between actions', async () => {
        let calls = 0;
        expect(await stealCakes(opts({ abort: () => ++calls > 1 }))).toBe('aborted');
    });

    test('an emptied stall waits for the respawn instead of clicking nothing', async () => {
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
            stallStocked = false;
        };
        expect(await stealCakes(opts({ fillTo: 3 }))).toBe('stocked');
        expect(cakeCount).toBe(3);
    });
});
