/**
 * PowerMiner location probe.
 *
 * Teleports to each candidate mining camp and dumps the iron rocks in scene:
 * live ids, depleted ids, coordinates and Chebyshev distance from the stand.
 * No mining, no settings, no script start.
 *
 *   ENGINE_DIR=/home/shonc/rs2bot/Server/engine bun e2e/power-miner/probe.ts
 */
import { deployIsolatedClient, launchBrowser, logout } from '../lib/harness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, teleTo } from '../tutorial/harness.js';
import { MINING_LOCATIONS } from '../../src/bot/data/miningLocations.js';
import { ROCK_TYPES } from '../../src/bot/data/miningRocks.js';

const CANDIDATES = [
    'Legends Guild Iron (west)',
    'Legends Guild Iron (east)',
    'Wilderness Hobgoblin Mine',
    'Edgeville Dungeon Mine',
    'Dwarven Mine',
    'Southeast Varrock Mine',
    'Al Kharid Mine',
    'Fight Arena Mine',
    'Mining Guild'
] as const;

const IRON = new Set(ROCK_TYPES.Iron);
const DEPLETED = new Set([450, 452]);

type Rock = { id: number; x: number; z: number; dist: number };
type Scan = {
    tile: { x: number; z: number; level: number } | null;
    rocks: Rock[];
    otherRocks: { id: number; name: string | null }[];
};

type PageAbi = {
    rs2b0t: {
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): { id: number; name: string | null; ops: (string | null)[]; tile: { x: number; z: number; level: number }; distance: number }[];
        };
    };
    __rs2b0t: {
        Game: { tile(): { x: number; z: number; level: number } | null };
        Locs: { query(): { name(n: string): { results(): { id: number; tile(): { x: number; z: number; level: number }; distance(): number }[] } } };
    };
};

function cluster(rocks: Rock[], radius: number): number {
    return rocks.filter(r => r.dist <= radius).length;
}

async function main(): Promise<void> {
    const base = process.env.BASE ?? 'http://localhost:8888';
    const tag = `pm-${Date.now().toString(36).slice(-6)}`;
    const client = deployIsolatedClient(tag);
    const browser = await launchBrowser();
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
        await mainlandAccount(page, base, tag, client.page);
        await maxmeAndClearDialogs(page);
        for (const command of ['~clearinv', 'give rune_pickaxe 1']) {
            if (!(await cheatQuiet(page, command))) throw new Error(command);
        }

        const custom = process.env.CUSTOM ? process.env.CUSTOM.split(',').map(Number) : null;
        const rows: unknown[] = [];
        for (const name of custom ? ['CUSTOM'] : CANDIDATES) {
            const camp = custom
                ? { name: 'CUSTOM', spot: { x: custom[0]!, z: custom[1]!, level: 0 } }
                : MINING_LOCATIONS.find(loc => loc.name === name);
            if (!camp) {
                rows.push({ name, error: 'missing from MINING_LOCATIONS' });
                continue;
            }
            const arrived = await teleTo(page, camp.spot, 1, 25_000);
            await page.waitForTimeout(1200);
            const scan = await page.evaluate(([live, depleted]) => {
                const g = globalThis as never as PageAbi;
                const liveSet = new Set(live);
                const depletedSet = new Set(depleted);
                const me = g.rs2b0t.reader.worldTile() ?? g.__rs2b0t.Game.tile();
                const locs = g.rs2b0t.reader.locs().filter(l => l.name === 'Rocks');
                const dist = (t: { x: number; z: number }) =>
                    me ? Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z)) : 999;
                const rocks = locs
                    .filter(l => liveSet.has(l.id) || depletedSet.has(l.id))
                    .map(l => ({ id: l.id, x: l.tile.x, z: l.tile.z, dist: dist(l.tile) }))
                    .sort((a, b) => a.dist - b.dist || a.x - b.x || a.z - b.z);
                const otherRocks = [...new Map(
                    locs
                        .filter(l => !liveSet.has(l.id) && !depletedSet.has(l.id))
                        .map(l => [`${l.id}`, { id: l.id, name: l.name }])
                ).values()];
                return { tile: me, rocks, otherRocks };
            }, [[...IRON], [...DEPLETED]] as const) as unknown as Scan;

            const live = scan.rocks.filter(r => IRON.has(r.id));
            rows.push({
                name,
                seed: camp.spot,
                arrived,
                tile: scan.tile,
                liveIron: live.length,
                depletedIron: scan.rocks.length - live.length,
                minDist: live.length ? Math.min(...live.map(r => r.dist)) : null,
                clusters: {
                    d1: cluster(live, 1),
                    d2: cluster(live, 2),
                    d3: cluster(live, 3),
                    d5: cluster(live, 5)
                },
                rocks: live.slice(0, 40),
                otherRockIds: scan.otherRocks.map(r => r.id)
            });
            console.log('CAMP', JSON.stringify(rows.at(-1)));
        }
        console.log('PROBE', JSON.stringify(rows, null, 2));
    } finally {
        await logout(page).catch(() => undefined);
        await browser.close();
        client.cleanup();
        if (errors.length) console.error('page errors:', errors);
    }
}

if (import.meta.main) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
