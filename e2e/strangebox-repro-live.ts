// Live repro — Strange box ("Mysterious box") random event: [base].
// Seeds a macro_cube and watches the always-on guardian try to solve it.

//   bun e2e/strangebox-repro-live.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `sbx${Date.now().toString(36).slice(-5)}`;

interface Api {
    __rs2b0t: {
        Inventory: {
            count(name: string): number;
            contains(name: string): boolean;
            used(): number;
            items(): { id: number; name: string | null; count: number }[];
        };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            modals(): { main: number };
            ifText(com: number): string | null;
            ifModelObjId(com: number): number | null;
        };
    };
}

const browser = await launchBrowser();
const page = await browser.newPage();
const consoleLines: string[] = [];
page.on('console', m => {
    const t = m.text();
    if (t.includes('rs2b0t') || t.includes('random event')) {
        consoleLines.push(t);
    }
});

try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    await cheatQuiet(page, 'give macro_cube 1', 2000);

    const seeded = await page.evaluate(() => {
        const api = (globalThis as never as Api).__rs2b0t;
        return {
            boxes: api.Inventory.count('Strange box'),
            used: api.Inventory.used(),
            items: api.Inventory.items().map((i: { id: number; name: string | null; count: number }) => `${i.id}:${i.name}x${i.count}`)
        };
    });
    console.log(`seeded: boxes=${seeded.boxes} used=${seeded.used} items=${JSON.stringify(seeded.items)}`);
    if (seeded.boxes < 1) {
        fail('could not seed macro_cube via ::give');
    }

    // Why: the engine replicates the cube every 150 ticks (~90s) and unstacks it every 16 ticks, so a solver that fails shows a strictly growing box count across the 5-minute watch.
    const deadline = Date.now() + 300_000;
    let peak = seeded.boxes;
    let solvedToZero = false;
    while (Date.now() < deadline) {
        const s = await page.evaluate(() => {
            const api = (globalThis as never as Api).__rs2b0t;
            return {
                boxes: api.Inventory.count('Strange box'),
                used: api.Inventory.used(),
                main: api.reader.modals().main,
                q: api.reader.ifText(6561),
                models: [api.reader.ifModelObjId(6555), api.reader.ifModelObjId(6557), api.reader.ifModelObjId(6559)]
            };
        });
        peak = Math.max(peak, s.boxes);
        console.log(
            `t+${Math.round((Date.now() - (deadline - 300_000)) / 1000)}s boxes=${s.boxes} used=${s.used} main=${s.main} ` +
                `q=${JSON.stringify(s.q)} models=${JSON.stringify(s.models)}`
        );
        if (s.boxes === 0) {
            solvedToZero = true;
            console.log('ALL BOXES SOLVED');
            break;
        }
        await page.waitForTimeout(5000);
    }

    console.log('--- console lines ---');
    for (const l of consoleLines.slice(-60)) {
        console.log(`  ${l}`);
    }
    console.log(`\nRESULT: solvedToZero=${solvedToZero} peakBoxes=${peak}`);
} finally {
    await browser.close();
}
