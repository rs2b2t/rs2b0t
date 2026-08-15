/** Live smoke B for the basemap + walkable map picker: login → tele near Varrock → pick a tile through the picker UI → WalkTo arrives inside the radius. BOT_USER/BOT_PASS, or a name is auto-minted.
 *  Needs a botclient with the picker and the collision pack, a basemap preferred, and cheats if tele is used. Proof: out/issue0-map-picker-walkto-e2e-proof.json, screenshots/issue0-map-picker-walkto-e2e-success.png */

//   HEADED=1 BOT_USER=harness1 BOT_PASS=test \
//     bun e2e/map-picker-walkto-e2e-live.ts [http://localhost:8890]

// Or auto-mint a name (local engine with cheats):
//   HEADED=1 bun e2e/map-picker-walkto-e2e-live.ts http://localhost:8890
import { boot, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings, stopScript } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = process.env.BOT_USER ?? `mp${Date.now().toString(36).slice(-6)}`;
const pass = process.env.BOT_PASS ?? 'test';
/** Stand near Varrock west bank area — walkable mainland. */
const TELE = { x: 3185, z: 3436 };
/** Target a short walk away (Varrock centre / fountain area-ish). */
const WANT_MIN_DIST = 12;
const ARRIVE_RADIUS = 3;
const WALK_TIMEOUT_MS = Number(process.env.WALK_TIMEOUT_MS ?? 120_000);

const proof = createHarnessProof({ issue: 0, slug: 'map-picker-walkto-e2e' });
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
page.setDefaultTimeout(90_000);

type Tile = { x: number; z: number; level: number };

async function worldTile(): Promise<Tile | null> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t?: { reader?: { worldTile(): Tile | null } };
            __rs2b0t?: { reader?: { worldTile(): Tile | null } };
        };
        return g.rs2b0t?.reader?.worldTile?.() ?? g.__rs2b0t?.reader?.worldTile?.() ?? null;
    });
}

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

try {
    await proof.ensureDirs();
    console.log(`loading ${base}/bot.html as ${user}`);
    await page.goto(`${base}/bot.html`, { waitUntil: 'domcontentloaded' });
    await boot(page);
    if (!(await login(page, user, pass))) {
        fail(`login failed for ${user}`);
    }
    console.log('ingame');

    // Short hop: tele near Varrock so the walk is bounded.
    const teleCmd = `tele 0,${TELE.x >> 6},${TELE.z >> 6},${TELE.x & 63},${TELE.z & 63}`;
    await cheatQuiet(page, teleCmd, 3500);
    let from = await worldTile();
    if (!from) {
        // Live servers may reject cheats — stay put and pick far on map.
        from = await worldTile();
    }
    console.log('start tile', from);

    // Open WalkTo → Pick on Map (UI path exercises basemap + snap).
    await page.getByRole('button', { name: /Browse/i }).click();
    const search = page.locator('input.rs2b0t-input[placeholder*="search"]');
    await search.waitFor({ state: 'visible' });
    await search.fill('WalkTo');
    await page.waitForTimeout(300);
    await page.locator('.rs2b0t-library-card').filter({ hasText: /WalkTo/i }).first().click();
    await page.waitForTimeout(400);

    await page.locator('button.rs2b0t-param-edit').filter({ hasText: /Edit parameters/i }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Pick on Map/i }).click();

    const canvas = page.locator('canvas.rs2b0t-walkmap-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 90_000 });
    await page.waitForFunction(
        () => {
            const t = document.querySelector('.rs2b0t-walkmap-status')?.textContent ?? '';
            return /zoom /.test(t) && !/loading collision/i.test(t);
        },
        undefined,
        { timeout: 90_000 }
    );
    await page.waitForFunction(
        () => {
            const s = document.querySelector('canvas.rs2b0t-walkmap-canvas')?.getAttribute('data-basemap');
            return s === 'ready' || s === 'missing' || s === 'error';
        },
        undefined,
        { timeout: 60_000 }
    );
    const basemapAttr = await canvas.getAttribute('data-basemap');
    console.log('basemap', basemapAttr);

    // Zoom out a bit so a click can land farther than WANT_MIN_DIST from tele stand.
    await page.locator('.rs2b0t-walkmap-zoom-out').click();
    await page.locator('.rs2b0t-walkmap-zoom-out').click();

    const box = await canvas.boundingBox();
    if (!box) {
        fail('no canvas box');
    }

    // Click east of centre to prefer a different stand than the player.
    const clickTargets: Array<[number, number]> = [
        [0.72, 0.45],
        [0.65, 0.55],
        [0.55, 0.35],
        [0.5, 0.5]
    ];
    let picked: Tile | null = null;
    for (const [fx, fy] of clickTargets) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        await page.waitForTimeout(350);
        const status = await page.locator('.rs2b0t-walkmap-status').textContent();
        const m = status?.match(/selected (\d+),(\d+),L(\d+)/);
        if (!m) {
            continue;
        }
        const cand = { x: Number(m[1]), z: Number(m[2]), level: Number(m[3]) };
        const here = from ?? (await worldTile());
        if (here && chebyshev(here, cand) < WANT_MIN_DIST) {
            console.log('pick too close', cand, 'dist', here ? chebyshev(here, cand) : -1);
            continue;
        }
        picked = cand;
        console.log('picked', picked, 'status', status);
        break;
    }
    if (!picked) {
        fail('could not select a sufficiently distant walkable tile');
    }

    await page.locator('button.rs2b0t-walkmap-confirm').click();
    await page.waitForTimeout(400);
    if ((await page.locator('canvas.rs2b0t-walkmap-canvas').count()) > 0) {
        fail('picker still open after Confirm');
    }

    const inputs = page.locator('input.rs2b0t-param-tilein');
    const xVal = await inputs.nth(0).inputValue();
    const zVal = await inputs.nth(1).inputValue();
    const lVal = await inputs.nth(2).inputValue();
    if (Number(xVal) !== picked.x || Number(zVal) !== picked.z || Number(lVal) !== picked.level) {
        fail(`fields ${xVal},${zVal},${lVal} !== ${picked.x},${picked.z},${picked.level}`);
    }

    // Close params modal if still open, then start WalkTo with custom tile.
    const backdrop = page.locator('.rs2b0t-modal-backdrop, .rs2b0t-modal-overlay').first();
    if (await backdrop.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
    }

    await setSettings(page, 'WalkTo', {
        customTile: `${picked.x},${picked.z},${picked.level}`,
        arriveRadius: ARRIVE_RADIUS
    });

    await page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: { registry: { get(n: string): unknown }; runner: { start(m: unknown): void } };
        };
        const meta = g.rs2b0t.registry.get('WalkTo');
        if (!meta) {
            throw new Error('WalkTo not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('WalkTo started →', picked);

    const startTile = (await worldTile()) ?? from;
    const t0 = Date.now();
    let final: Tile | null = null;
    let moved = false;
    let maxDistMoved = 0;

    while (Date.now() - t0 < WALK_TIMEOUT_MS) {
        final = await worldTile();
        if (final && startTile) {
            const movedDist = chebyshev(startTile, final);
            maxDistMoved = Math.max(maxDistMoved, movedDist);
            if (movedDist >= 2) {
                moved = true;
            }
            if (chebyshev(final, picked) <= ARRIVE_RADIUS + 1) {
                break;
            }
        }
        // Check runner logs for arrived
        const arrivedLog = await page.evaluate(() => {
            const g = globalThis as never as {
                rs2b0t: { runner: { ctx: { log: { msg: string }[] } | null; state: string } };
            };
            const logs = g.rs2b0t.runner.ctx?.log ?? [];
            return logs.some(l => /arrived/i.test(l.msg));
        });
        if (arrivedLog) {
            final = await worldTile();
            break;
        }
        await page.waitForTimeout(800);
    }

    const elapsedMs = Date.now() - t0;
    final = final ?? (await worldTile());
    const dist = final && picked ? chebyshev(final, picked) : -1;
    console.log({ from: startTile, picked, final, dist, moved, maxDistMoved, elapsedMs, basemapAttr });

    if (!moved && dist > ARRIVE_RADIUS + 1) {
        fail(`no movement toward target (dist=${dist}, maxMoved=${maxDistMoved})`);
    }
    if (dist < 0 || dist > ARRIVE_RADIUS + 2) {
        fail(`did not arrive: dist=${dist} (want ≤ ${ARRIVE_RADIUS + 2}) after ${elapsedMs}ms`);
    }

    await proof.writeSuccess(page, {
        issue: 0,
        harness: 'e2e/map-picker-walkto-e2e-live.ts',
        basemap: basemapAttr,
        from: startTile,
        picked,
        final,
        dist,
        moved,
        maxDistMoved,
        elapsedMs
    });

    await stopScript(page).catch(() => undefined);
    console.log(`PASS map-picker WalkTo e2e — arrived dist=${dist} basemap=${basemapAttr}`);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close();
}
