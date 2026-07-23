import { InvItem } from '#/bot/api/hud/Inventory.js';
import { expect, test, describe, mock, beforeEach } from 'bun:test';

import Tile from '#/bot/api/Tile.js';

const COORD_CLUE_ID = 2801;

let held: string[];
let coordClueId: number | null;
let playerTile: Tile;
let walks: string[];
let groundSpades: Tile[];
let takes: number;
let npcByName: Record<string, { x: number; z: number }>;

mock.module('#/bot/api/Game.js', () => ({ Game: { tile: () => playerTile, ingame: () => true, inCombat: () => false } }));
mock.module('#/bot/api/Execution.js', () => ({
    Execution: {
        delayUntil: async (fn: () => boolean): Promise<boolean> => fn(),
        delayTicks: async (): Promise<void> => {}
    }
}));
mock.module('#/bot/api/hud/Inventory.js', () => ({
    InvItem,
    Inventory: {
        items: () => {
            const clue = coordClueId !== null ? [{ id: coordClueId, name: 'coord clue', count: 1, slot: 0 }] : [];
            const tools = held.map((name, i) => ({ id: 5000 + i, name, count: 1, slot: i + 1 }));
            return [...clue, ...tools];
        },
        first: (name: string) => (held.includes(name) ? { name } : null),
        count: (name: string) => held.filter(n => n === name).length
    }
}));
mock.module('#/bot/api/Traversal.js', () => ({
    Traversal: {
        walkResilient: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        },
        walkTo: async (dest: { x: number; z: number }): Promise<boolean> => {
            walks.push(`${dest.x},${dest.z}`);
            playerTile = new Tile(dest.x, dest.z, 0);
            return true;
        }
    }
}));
mock.module('#/bot/api/queries/GroundItems.js', () => ({
    GroundItems: {
        query: () => {
            let list = groundSpades.map(t => ({
                id: 952,
                name: 'Spade',
                tile: () => t,
                distance: () => t.distanceTo(playerTile),
                interact: async (): Promise<boolean> => {
                    takes++;
                    groundSpades = groundSpades.filter(g => g !== t);
                    held.push('Spade');
                    return true;
                }
            }));
            const chain = {
                where: (p: (g: (typeof list)[number]) => boolean) => {
                    list = list.filter(p);
                    return chain;
                },
                nearest: () => list.sort((a, b) => a.distance() - b.distance())[0] ?? null
            };
            return chain;
        }
    }
}));
mock.module('#/bot/api/queries/Npcs.js', () => ({
    Npcs: {
        query: () => {
            let name = '';
            const chain = {
                name: (n: string) => {
                    name = n;
                    return chain;
                },
                action: () => chain,
                where: () => chain,
                results: () => [],
                nearest: () => {
                    const s = npcByName[name];
                    return s
                        ? { name, tile: () => new Tile(s.x, s.z, 0), distance: () => new Tile(s.x, s.z, 0).distanceTo(playerTile), actions: () => ['Talk-to'], interact: async () => true }
                        : null;
                }
            };
            return chain;
        }
    }
}));

const { ensureSpade, ensureCoordTools } = await import('#/bot/clues/AcquireTools.js');

beforeEach(() => {
    held = [];
    coordClueId = COORD_CLUE_ID;
    playerTile = new Tile(2660, 3300, 0);
    walks = [];
    groundSpades = [];
    takes = 0;
    npcByName = {
        'Observatory professor': { x: 2438, z: 3186 },
        Murphy: { x: 2668, z: 3162 },
        'Brother Kojo': { x: 2569, z: 3249 }
    };
});

describe('ensureSpade', () => {
    test('already held -> true, no walk', async () => {
        held = ['Spade'];
        expect(await ensureSpade(() => {})).toBe(true);
        expect(walks).toEqual([]);
    });
    test('walks to the NEARER spawn and takes the spade', async () => {
        playerTile = new Tile(2600, 3320, 0);
        groundSpades = [new Tile(2574, 3331, 0)];
        expect(await ensureSpade(() => {})).toBe(true);
        expect(walks[0]).toBe('2574,3331');
        expect(takes).toBe(1);
        expect(held).toContain('Spade');
    });
    test('picks Falador when closer', async () => {
        playerTile = new Tile(2950, 3360, 0);
        groundSpades = [new Tile(2981, 3369, 0)];
        expect(await ensureSpade(() => {})).toBe(true);
        expect(walks[0]).toBe('2981,3369');
    });
    test('no spade at either spawn -> false', async () => {
        playerTile = new Tile(2600, 3320, 0);
        groundSpades = [];
        expect(await ensureSpade(() => {})).toBe(false);
    });
});

describe('ensureCoordTools', () => {
    test('all three held -> true immediately, no walk', async () => {
        held = ['Sextant', 'Watch', 'Chart'];
        expect(await ensureCoordTools(() => {})).toBe(true);
        expect(walks).toEqual([]);
    });
    test('needs a coordinate clue held -> false + no walk when none', async () => {
        coordClueId = null;
        expect(await ensureCoordTools(() => {})).toBe(false);
        expect(walks).toEqual([]);
    });
    test('none held -> visits the professor FIRST (learn), then Murphy for the sextant', async () => {
        expect(await ensureCoordTools(() => {})).toBe(false);
        expect(walks[0]).toBe('2438,3186');
        expect(walks).toContain('2668,3162');
    });
    test('sextant+watch held -> straight to the professor for the chart, no Murphy/Kojo', async () => {
        held = ['Sextant', 'Watch'];
        await ensureCoordTools(() => {});
        expect(walks[0]).toBe('2438,3186');
        expect(walks).not.toContain('2668,3162');
        expect(walks).not.toContain('2569,3249');
    });
});
