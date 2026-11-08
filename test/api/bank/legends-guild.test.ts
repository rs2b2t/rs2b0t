import { afterEach, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { BANK_LOCATIONS, bankCostForFinder, bankUnlocked, nearestWalkableBank } from '#/bot/api/bank/BankLocations.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { stubProps } from '../../lib/stubSingletons.js';

const guild = BANK_LOCATIONS.find(bank => bank.name === 'Legends Guild')!;
let restore: (() => void) | undefined;
afterEach(() => restore?.());

test('Legends Guild banks with the bankers on the second floor after Legends Quest', () => {
    expect(guild.tile).toMatchObject({ x: 2732, z: 3378, level: 2 });
    expect(guild.npcAccess).toEqual({ name: 'Banker', op: 'Bank' });
    restore = stubProps(Quests, { status: () => 'notStarted' });
    expect(bankUnlocked(guild)).toBe(false);
    restore();
    restore = stubProps(Quests, { status: () => 'complete' });
    expect(bankUnlocked(guild)).toBe(true);
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('shadow warriors can bank upstairs and walk back through the dungeon stairs', () => {
    restore = stubProps(Quests, { status: (name: string) => name === 'Legends Quest' ? 'complete' : 'notStarted' });
    const finder = new PathFinder(gunzipSync(readFileSync('out/collision.lcnav.gz')));
    loadDefaultNavEdges(finder);
    const basement = { x: 2700, z: 9774, level: 0 };
    const opts = { maxExpansions: 500_000, useTeleportCatalog: false };
    const outward = finder.findPath(basement, guild.tile, opts);
    const returning = finder.findPath(guild.tile, basement, opts);
    expect(outward.ok).toBe(true);
    expect(returning.ok).toBe(true);
    if (!outward.ok || !returning.ok) return;
    expect(outward.hops?.map(hop => hop.action)).toEqual(['Climb-up', 'Climb-up', 'Climb-up']);
    expect(returning.hops?.map(hop => hop.action)).toEqual(['Climb-down', 'Climb-down', 'Climb-down']);
    expect(nearestWalkableBank(basement, bankCostForFinder(finder, opts))?.name).toBe('Legends Guild');
}, 30_000);
