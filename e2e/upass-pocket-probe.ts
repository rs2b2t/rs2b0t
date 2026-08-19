/** Pocket probe (#265): what the CLIENT can reach and see from one tile of the pass.
 *  Why: the collision pack and the loaded scene disagree about this quest often enough that a route argued
 *  from the pack has been wrong three times — the ledge it called sealed is one the bot crosses. This asks
 *  the client instead: stand on a tile, and report which of the pass's anchors it can walk to, plus every
 *  seam loc in reach with its ops. One run per tile, and the answer is the one the module will act on. */

//   bun e2e/upass-pocket-probe.ts --from 2423,9660
//   bun e2e/upass-pocket-probe.ts --from 2375,9604 --stage 4
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, relog, teleTo } from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    stage: number;
    from: { x: number; z: number; level: number };
}

const args: Args = {
    base: process.env.BASE ?? 'http://localhost:8890',
    user: `pp${Date.now().toString(36).slice(-7)}`,
    stage: 3,
    from: { x: 2423, z: 9660, level: 0 }
};
for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    const value = process.argv[i + 1];
    if (value === undefined) break;
    if (flag === '--base') args.base = value;
    else if (flag === '--stage') args.stage = Number(value);
    else if (flag === '--from') {
        const [x, z] = value.split(',').map(Number);
        args.from = { x: x!, z: z!, level: 0 };
    }
}

/** The anchors a route through the second cavern has to join up. */
const ANCHORS: [string, number, number][] = [
    ['well landing', 2423, 9660],
    ['cage corridor west', 2380, 9655],
    ['mud cell', 2393, 9652],
    ['dig landing', 2392, 9646],
    ['ledge east', 2375, 9641],
    ['ledge west', 2374, 9638],
    ['locked railing north', 2380, 9619],
    ['locked railing east', 2405, 9620],
    ['unicorn area', 2375, 9604],
    ['unicorn door z9611', 2375, 9610],
    ['tunnel first cavern', 2371, 9666],
    ['tunnel south side', 2370, 9663],
    ['telejump landing', 2401, 9610],
    ['loose railings', 2397, 9606],
    ['boulder', 2398, 9596],
    ['orb corridor', 2418, 9674],
    ['pipe 2388 east side', 2389, 9605],
    ['pipe 2388 west side', 2387, 9605],
    ['pipe 2413 west side', 2412, 9605],
    ['pipe 2417 east side', 2419, 9605]
];

async function report(page: Page, anchors: typeof ANCHORS): Promise<void> {
    const out = await page.evaluate(list => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Locs: { query(): { within(n: number): { results(): { id: number; name?: string; tile(): { x: number; z: number; level: number }; actions(): string[] }[] } } };
                Reachability: { canReach(t: { x: number; z: number; level: number }, o?: { adjacentOk?: boolean; maxSteps?: number }): boolean; walkable(t: { x: number; z: number; level: number }): boolean; probeable(t: { x: number; z: number; level: number }): boolean };
            };
        };
        const api = g.__rs2b0t;
        const here = api.reader.worldTile();
        const reach = list.map(([name, x, z]) => {
            const tile = { x: x as number, z: z as number, level: 0 };
            return {
                name: name as string,
                walk: api.Reachability.canReach(tile, { adjacentOk: false, maxSteps: 4000 }),
                near: api.Reachability.canReach(tile, { adjacentOk: true, maxSteps: 4000 }),
                walkable: api.Reachability.walkable(tile),
                inScene: api.Reachability.probeable(tile)
            };
        });
        const locs = api.Locs.query().within(40).results()
            .filter(l => l.actions().length > 0)
            .map(l => `${l.id}${l.name ? `:${l.name}` : ''}@${l.tile().x},${l.tile().z}[${l.actions().join('|')}]`);
        return { here, reach, locs };
    }, anchors);

    console.log(`standing at (${out.here?.x},${out.here?.z},${out.here?.level})`);
    console.log('anchor                     walk-to  adjacent  walkable  in-scene');
    for (const r of out.reach) {
        console.log(`  ${r.name.padEnd(24)} ${String(r.walk).padEnd(8)} ${String(r.near).padEnd(9)} ${String(r.walkable).padEnd(9)} ${r.inScene}`);
    }
    console.log(`\n${out.locs.length} op-bearing loc(s) within 40:`);
    for (const l of out.locs) console.log(`  ${l}`);
}

const client = deployIsolatedClient(args.user);
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    await mainlandAccount(page, args.base, args.user, client.page);
    await cheatQuiet(page, `setvar upass ${args.stage}`);
    await cheatQuiet(page, 'setvar ibanmulti 2048');
    await cheatQuiet(page, 'give spade 1');
    await clearChatDialogs(page, 'seed dialog(s)');
    await relog(page, args.user);
    if (!(await teleTo(page, args.from, 10, 25_000))) {
        console.error(`FAIL: could not tele to (${args.from.x},${args.from.z})`);
        process.exit(1);
    }
    // Why: `::tele` leaves the scene unbuilt, and every loc and collision read comes back empty until a relog.
    await relog(page, args.user);
    await teleTo(page, args.from, 10, 25_000);
    await report(page, ANCHORS);
} finally {
    await browser.close();
}
