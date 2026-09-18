import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import { BANK_LOCATIONS, USE_MAGE_BANK, approachOf, bankCostForFinder, bankCostForNavigator, bankDistance, nearestBank, nearestBanks, nearestBankReachable, nearestUsableBank, nearestWalkableBank, nearestWalkableBankAsync } from '#/bot/api/bank/BankLocations.js';
import type { BankLocation, BankPathCost, NavigatorLike } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { richTransportQuestMap } from '#/bot/event/webwalk/transportQuestReqs.js';
import { emptyWorldStateData, type WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const MAGE_KEY = `rs2b0t:set:Global:${USE_MAGE_BANK}`;

function setSetting(on: boolean | null): void {
    if (on === null) {
        localStorage.removeItem(MAGE_KEY);
        sessionStorage.removeItem(MAGE_KEY);
        return;
    }
    localStorage.setItem(MAGE_KEY, String(on));
}

afterEach(() => setSetting(null));

test('bank names are unique', () => {
    const names = BANK_LOCATIONS.map(b => b.name);
    expect(new Set(names).size).toBe(names.length);
});

test('every bank centre is a plausible world tile', () => {
    for (const b of BANK_LOCATIONS) {
        expect(b.tile.level, b.name).toBeGreaterThanOrEqual(0);
        expect(b.tile.level, b.name).toBeLessThanOrEqual(3);
        expect(b.tile.x, b.name).toBeGreaterThan(2300);
        expect(b.tile.x, b.name).toBeLessThan(3600);
        expect(b.tile.z, b.name).toBeGreaterThan(2900);
        // Why: the Mage Arena chamber is its own region above the surface map (^mage_arena_finish_coord z=4716), so the band is asserted on the walked-to tile.
        expect(b.tile.z, b.name).toBeLessThan(b.name === 'Zanaris' ? 9600 : 4800);
    }
});

test('every bank is approached from somewhere on the surface map', () => {
    for (const b of BANK_LOCATIONS) {
        const a = approachOf(b);
        expect(a.x, b.name).toBeGreaterThan(2300);
        expect(a.x, b.name).toBeLessThan(3600);
        expect(a.z, b.name).toBeGreaterThan(2900);
        expect(a.z, b.name).toBeLessThan(b.name === 'Zanaris' ? 9600 : 4000);
    }
});

test('Grand Tree bank is 1F at booths (no quest gate)', () => {
    const gt = BANK_LOCATIONS.find(b => b.name === 'Grand Tree');
    // Field-wise, like the Yanille case below: a Tile carries methods an object literal
    // does not, so toEqual against a bare literal does not typecheck.
    expect(gt?.tile.x).toBe(2449);
    expect(gt?.tile.z).toBe(3482);
    expect(gt?.tile.level).toBe(1);
    expect(gt?.requires).toBeUndefined();
});

test('Yanille bank centre matches its bank_zones midpoint', () => {
    const yanille = BANK_LOCATIONS.find(b => b.name === 'Yanille');
    expect(yanille?.tile.x).toBe(2612);
    expect(yanille?.tile.z).toBe(3092);
});

test('Duel Arena opens its chest before using the bank action', () => {
    const duelArena = BANK_LOCATIONS.find(b => b.name === 'Duel Arena');
    expect(duelArena?.access).toEqual({
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    });
});

test('Shantay Pass banks via the Shantay chest (Open then continue chat)', () => {
    const shantay = BANK_LOCATIONS.find(b => b.name === 'Shantay Pass');
    expect(shantay?.tile.x).toBe(3308);
    expect(shantay?.tile.z).toBe(3120);
    expect(shantay?.access).toEqual({ name: 'Shantay chest', op: 'Open' });
    expect(BANK_LOCATIONS.filter(bank => bank.access).map(bank => bank.name).sort()).toEqual([
        'Duel Arena',
        'Shantay Pass'
    ]);
});

test('nearestBank returns the closest bank on the same level', () => {
    expect(nearestBank({ x: 2605, z: 3085, level: 0 })?.name).toBe('Yanille');
    expect(nearestBank({ x: 3270, z: 3168, level: 0 })?.name).toBe('Al Kharid');
    expect(nearestBank({ x: 3090, z: 3245, level: 0 })?.name).toBe('Draynor');
});

test('Barbarian Village tin/coal banks at Edgeville (not Falador East)', () => {
    // Chebyshev wrongly picks Falador East; Euclidean walk is shorter to Edgeville.
    expect(nearestBank({ x: 3080, z: 3420, level: 0 })?.name).toBe('Edgeville');
    expect(nearestBank({ x: 3078, z: 3415, level: 0 })?.name).toBe('Edgeville');
});

test('nearestBank on Grand Tree 1F picks Grand Tree (ungated)', () => {
    expect(nearestBank({ x: 2449, z: 3482, level: 1 })?.name).toBe('Grand Tree');
});

test('Grand Tree still wins from the ground floor beneath it', () => {
    expect(nearestBank({ x: 2460, z: 3490, level: 0 })?.name).toBe('Grand Tree');
});

describe('upstairs banks at the nearest bank, not the only bank off level 0', () => {
    // Why: the Grand Tree is the only bank off level 0, so filtering by plane made it the sole candidate for anyone upstairs. Stairs are in the nav graph; rank on x/z.
    test('Varrock East 1F banks downstairs, not at the Grand Tree', () => {
        expect(nearestBank({ x: 3250, z: 3420, level: 1 })?.name).toBe('Varrock East');
    });

    test('Al Kharid palace 1F banks at Al Kharid', () => {
        expect(nearestBank({ x: 3301, z: 3169, level: 1 })?.name).toBe('Al Kharid');
    });

    test('Falador 1F banks at Falador West', () => {
        expect(nearestBank({ x: 2971, z: 3386, level: 1 })?.name).toBe('Falador West');
    });

    test('level 2 finds a bank rather than giving up', () => {
        expect(nearestBank({ x: 2748, z: 3495, level: 2 })?.name).toBe('Seers');
        expect(nearestBank({ x: 2612, z: 3092, level: 2 })?.name).toBe('Yanille');
    });
});

const openOnly = (b: BankLocation): boolean => b.requires === undefined;
const all = (): boolean => true;

describe('bank entry gates', () => {
    test('Fishing Guild carries the Fishing 68 gate', () => {
        const guild = BANK_LOCATIONS.find(b => b.name === 'Fishing Guild')!;
        expect(guild.requires?.skill).toEqual({ name: 'fishing', level: 68 });
    });

    test('Shilo Village carries its quest gate', () => {
        const shilo = BANK_LOCATIONS.find(b => b.name === 'Shilo Village')!;
        expect(shilo.requires?.quest).toBe('Shilo Village');
    });

    test('Canifis carries its Priest in Peril gate', () => {
        const canifis = BANK_LOCATIONS.find(b => b.name === 'Canifis')!;
        expect(canifis.requires?.quest).toBe('Priest in Peril');
    });

    test('Grand Tree bank is ungated (mine still needs the quest)', () => {
        const gt = BANK_LOCATIONS.find(b => b.name === 'Grand Tree')!;
        expect(gt.requires).toBeUndefined();
    });

    test('every other bank is ungated', () => {
        const gated = BANK_LOCATIONS.filter(b => b.requires !== undefined).map(b => b.name).sort();
        expect(gated).toEqual(['Canifis', 'Fishing Guild', 'Mage Arena', 'Shilo Village', 'Zanaris']);
    });
});

describe('nearestUsableBank', () => {
    test('near Hemenster, a gated-out character routes past the Fishing Guild to Ardougne West', () => {
        const picked = nearestUsableBank({ x: 2600, z: 3420, level: 0 }, openOnly);
        expect(picked?.name).toBe('Ardougne West');
    });

    test('near Hemenster, a 68+ fisher still gets the Fishing Guild', () => {
        const picked = nearestUsableBank({ x: 2600, z: 3420, level: 0 }, all);
        expect(picked?.name).toBe('Fishing Guild');
    });

    test('near Shilo without the quest, routes to Yanille instead', () => {
        const picked = nearestUsableBank({ x: 2850, z: 2950, level: 0 }, openOnly);
        expect(picked?.name).toBe('Yanille');
    });

    test('in Canifis, a Priest-in-Peril character banks at Canifis', () => {
        const picked = nearestUsableBank({ x: 3510, z: 3481, level: 0 }, all);
        expect(picked?.name).toBe('Canifis');
    });

    test('an upstairs caller still gets its nearest bank', () => {
        expect(nearestUsableBank({ x: 2600, z: 3420, level: 2 }, all)?.name).toBe('Fishing Guild');
        expect(nearestUsableBank({ x: 2600, z: 3420, level: 2 }, openOnly)?.name).toBe('Ardougne West');
    });

    test('on Grand Tree 1F, banks at Grand Tree without a quest gate', () => {
        expect(nearestUsableBank({ x: 2449, z: 3482, level: 1 }, openOnly)?.name).toBe('Grand Tree');
        expect(nearestUsableBank({ x: 2449, z: 3482, level: 1 }, all)?.name).toBe('Grand Tree');
    });
});

describe('nearestBanks', () => {
    test('is a shortlist in straight-line order, not an answer', () => {
        // Why: from the Lumbridge respawn the three nearest banks by air sit behind the 10gp toll gate a dead bot cannot pay, so callers must probe this shortlist for path costs.
        const order = nearestBanks({ x: 3222, z: 3218, level: 0 }).map(b => b.name);
        expect(order.slice(0, 4)).toEqual(['Al Kharid', 'Shantay Pass', 'Draynor', 'Duel Arena']);
    });

    test('agrees with nearestBank on the head, and covers the same banks', () => {
        for (const from of [
            { x: 3013, z: 3355, level: 0 },
            { x: 2660, z: 3300, level: 0 },
            { x: 3222, z: 3218, level: 0 }
        ]) {
            const list = nearestBanks(from);
            expect(list[0]?.name ?? '').toBe(nearestBank(from)?.name ?? '');
            for (let i = 1; i < list.length; i++) {
                expect(bankDistance(from, list[i - 1].tile)).toBeLessThanOrEqual(bankDistance(from, list[i].tile));
            }
        }
    });

    test('shortlists banks on another plane too', () => {
        const upstairs = nearestBanks({ x: 2449, z: 3482, level: 1 }).map(b => b.name);
        expect(upstairs[0]).toBe('Grand Tree');
        expect(upstairs).toContain('Ardougne West');
        expect(upstairs.length).toBeGreaterThan(1);
    });
});

// --- nav-cost edit to nearest bank (dungeon offset) ---

const NAV_SKILLS = Object.fromEntries(
    [
        'agility', 'prayer', 'mining', 'smithing', 'crafting', 'woodcutting', 'firemaking',
        'ranged', 'attack', 'strength', 'defence', 'hitpoints', 'magic', 'thieving', 'fishing',
        'cooking', 'runecraft', 'herblore', 'fletching', 'slayer', 'farming'
    ].map(s => [s, 99])
);

function navState(): WorldStateData {
    return {
        ...emptyWorldStateData(),
        members: true,
        skills: NAV_SKILLS,
        quests: richTransportQuestMap(),
        items: { Coins: 200_000, 'Shantay pass': 5, Rope: 5, Spade: 1, Machete: 1, 'Climbing boots': 1 },
        worn: { 'Climbing boots': 1 },
        freeSlots: 14,
        canSlashWeb: true
    };
}

function loadFinder(): PathFinder | null {
    const packPath = path.join(process.cwd(), 'out/collision.lcnav.gz');
    if (!fs.existsSync(packPath)) {
        return null;
    }
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes as Uint8Array);
    loadDefaultNavEdges(finder);
    return finder;
}

test('bankCostForNavigator maps navigator outcomes to a cost, off by catalog', async () => {
    const navigator = {
        async findPath(_from: unknown, _to: unknown, opts?: unknown) {
            return (opts as { useTeleportCatalog?: boolean }).useTeleportCatalog === false
                ? { ok: true, cost: 42 }
                : { ok: false, reason: 'catalog on' };
        }
    };
    const cost = bankCostForNavigator(navigator);
    await expect(cost({ x: 0, z: 0, level: 0 }, new Tile(1, 1, 0))).resolves.toBe(42);
    await expect(
        bankCostForNavigator({ findPath: async () => ({ ok: false, reason: 'blocked' }) })({ x: 0, z: 0, level: 0 }, new Tile(1, 1, 0))
    ).resolves.toBeNull();
});

describe('nearestWalkableBank picks the walkable-nearest bank, not the air-nearest one', () => {
    // Why: these run the real nav pack (~13MB cold), so they're skipped unless the pack is present.

    const finder = loadFinder();
    const state = navState();
    if (!finder) {
        return;
    }

    const costWalk = bankCostForFinder(finder, { state, maxExpansions: 500_000 });
    const blockedCost = bankCostForFinder(finder, { state, maxExpansions: 500_000, avoidDoors: new Set(['3091|3957']) });
    const walkTo = (from: { x: number; z: number; level: number }, name: string, cost: BankPathCost = costWalk): number | null => {
        const bank = BANK_LOCATIONS.find(b => b.name === name)!;
        return cost(from, bank.tile);
    };

    test('inside the Dwarven Mine the walk to Falador East beats the straight-nearest Edgeville', () => {
        // Why: surface z sits ~6400 tiles below the overworld, so straight-line ranking collapses onto the x-axis (Edgeville wins on x) while the real exits land at the Falador end; miningLocations.ts already banks this seed at faladorEast and the walk-cost ranker agrees.
        const from = { x: 3021, z: 9800, level: 0 };
        expect(nearestBank(from)?.name).toBe('Edgeville');
        const picked = nearestWalkableBank(from, costWalk);
        expect(picked?.name).toBe('Falador East');
        expect(walkTo(from, 'Falador East')).not.toBeNull();
        expect(walkTo(from, 'Edgeville')).not.toBeNull();
        expect(walkTo(from, 'Falador East')!).toBeLessThan(walkTo(from, 'Edgeville')!);
    }, 120_000);

    test('async twin walks the same shortlist and agrees with the sync pick', async () => {
        // Why: live callers pay costs through the Navigator worker, so the select loop batches one Promise.all over the same candidate order.
        const from = { x: 3021, z: 9800, level: 0 };
        const picked = await nearestWalkableBankAsync(from, async (f, t) => costWalk(f, t));
        expect(picked?.name).toBe('Falador East');
    }, 120_000);

    test('at the Mage Arena webs, the walk to Edgeville beats the air-close Gundai cellar', () => {
        setSetting(true);
        const from = { x: 3094, z: 3785, level: 0 };
        // Why: off the ladder mouth the air line to Gundai's cellar is a few tiles, but the full route is a run to the webs plus the ladder, and Edgeville's plain road is cheaper.
        expect(nearestBank(from)?.name).toBe('Mage Arena');
        expect(walkTo(from, 'Edgeville')!).toBeLessThan(walkTo(from, 'Mage Arena')!);
        expect(nearestWalkableBank(from, costWalk)?.name).toBe('Edgeville');
    }, 120_000);

    test('ladder edge blocked, the Mage Arena is rejected outright', () => {
        setSetting(true);
        const from = { x: 3091, z: 3958, level: 0 };
        // Why: the ladder loc at 3091|3957 is the only route to the cellar; blocking it makes the bank unreachable so the selector skips it and returns the nearest surface bank instead.
        expect(walkTo(from, 'Mage Arena', blockedCost)).toBeNull();
        expect(nearestWalkableBank(from, blockedCost)?.name).not.toBe('Mage Arena');
    }, 120_000);

    test('nearestBankReachable wires the live pick, and falls back to the air pick without a route', async () => {
        const from = { x: 3021, z: 9800, level: 0 };
        const navigator: NavigatorLike = {
            async findPath(f, t) {
                const c = costWalk(f, new Tile(t.x, t.z, t.level));
                return c === null ? { ok: false, reason: 'unreachable' } : { ok: true, cost: c };
            }
        };
        expect((await nearestBankReachable(from, navigator))?.name).toBe('Falador East');
        // Why: a dead navigator must not take the bank down with it, so the air-nearest pick stays the fallback.
        await expect(nearestBankReachable(from, { findPath: async () => ({ ok: false, reason: 'offline' }) })).resolves.toEqual(nearestBank(from));
    }, 120_000);
});
