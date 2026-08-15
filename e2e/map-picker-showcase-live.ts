/** Live showcase: login → open the map picker → capture a screenshot for each basemap mode / Worldmap layer combo: [base].
 *  Writes screenshots/issue0-map-picker-showcase-{terrain,labels,key-bank,full,dots}.png and -proof.json. */

//   HEADED=0 bun e2e/map-picker-showcase-live.ts [http://localhost:8890]
import { mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { boot, fail, launchBrowser, login, positionalArgs } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = process.env.BOT_USER ?? `mpsh${Date.now().toString(36).slice(-5)}`;
const pass = process.env.BOT_PASS ?? 'test';
const shotDir = 'screenshots';
const shots: { name: string; path: string; note: string }[] = [];

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
page.setDefaultTimeout(45_000);

async function dismissUi(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        const walkCancel = page.locator('button.rs2b0t-walkmap-cancel');
        if (await walkCancel.isVisible().catch(() => false)) {
            await walkCancel.click({ timeout: 3_000 }).catch(() => undefined);
            await page.waitForTimeout(150);
            continue;
        }
        const modalClose = page.locator('.rs2b0t-modal-backdrop .rs2b0t-modal-header button').filter({ hasText: '✕' });
        if (await modalClose.first().isVisible().catch(() => false)) {
            await modalClose.first().click({ timeout: 3_000 }).catch(() => undefined);
            await page.waitForTimeout(150);
            continue;
        }
        const backdrop = page.locator('.rs2b0t-modal-backdrop');
        if (await backdrop.isVisible().catch(() => false)) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(150);
            continue;
        }
        break;
    }
    await page.evaluate(() => {
        document.querySelectorAll('.rs2b0t-modal-backdrop').forEach(el => {
            (el as HTMLElement).style.display = 'none';
        });
        document.querySelectorAll('.rs2b0t-walkmap-overlay').forEach(el => el.remove());
    });
}

async function setMapPicker(key: string, value: string): Promise<void> {
    await page.evaluate(
        ([k, v]) => {
            const g = globalThis as never as {
                __rs2b0t?: { SettingsStore?: { save(n: string, key: string, raw: string): void } };
            };
            if (g.__rs2b0t?.SettingsStore?.save) {
                g.__rs2b0t.SettingsStore.save('MapPicker', k, v);
                return;
            }
            sessionStorage.setItem(`rs2b0t:set:MapPicker:${k}`, v);
            try {
                localStorage.setItem(`rs2b0t:set:MapPicker:${k}`, v);
            } catch {
                /* private mode */
            }
        },
        [key, value] as const
    );
}

async function openPicker(): Promise<void> {
    await dismissUi();
    await page.getByRole('button', { name: /Browse/i }).click({ timeout: 10_000 });
    const search = page.locator('input.rs2b0t-input[placeholder*="search"]');
    await search.waitFor({ state: 'visible', timeout: 10_000 });
    await search.fill('WalkTo');
    await page.waitForTimeout(200);
    await page.locator('.rs2b0t-library-card').filter({ hasText: /WalkTo/i }).first().click();
    await page.waitForTimeout(250);
    await page.locator('button.rs2b0t-param-edit').filter({ hasText: /Edit parameters/i }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: /Pick on Map/i }).click();
    await page.locator('canvas.rs2b0t-walkmap-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForFunction(
        () => {
            const t = document.querySelector('.rs2b0t-walkmap-status')?.textContent ?? '';
            return /zoom /.test(t) && !/loading collision/i.test(t);
        },
        undefined,
        { timeout: 60_000 }
    );
    await page.waitForFunction(
        () => {
            const s = document.querySelector('canvas.rs2b0t-walkmap-canvas')?.getAttribute('data-basemap');
            return s === 'ready' || s === 'missing' || s === 'error' || s === 'off';
        },
        undefined,
        { timeout: 45_000 }
    );
    // Zoom in a bit so Key icons / labels are readable.
    for (let i = 0; i < 3; i++) {
        await page.locator('.rs2b0t-walkmap-zoom-in').click().catch(() => undefined);
        await page.waitForTimeout(80);
    }
    await page.waitForTimeout(200);
}

async function shot(slug: string, note: string): Promise<void> {
    const path = `${shotDir}/issue0-map-picker-showcase-${slug}.png`;
    // Prefer the picker overlay (full chrome) when open.
    const overlay = page.locator('.rs2b0t-walkmap-overlay');
    if (await overlay.isVisible().catch(() => false)) {
        await overlay.screenshot({ path });
    } else {
        await page.screenshot({ path, fullPage: true });
    }
    shots.push({ name: slug, path, note });
    console.log(`shot ${path} — ${note}`);
}

async function closePicker(): Promise<void> {
    const cancel = page.locator('button.rs2b0t-walkmap-cancel');
    if (await cancel.isVisible().catch(() => false)) {
        await cancel.click();
        await page.waitForTimeout(200);
    }
    await dismissUi();
}

try {
    await mkdir(shotDir, { recursive: true });
    await mkdir('out', { recursive: true });

    console.log(`loading ${base}/bot.html as ${user}`);
    await page.goto(`${base}/bot.html`, { waitUntil: 'domcontentloaded' });
    await boot(page);
    if (!(await login(page, user, pass))) {
        fail(`login failed for ${user}`);
    }
    console.log('ingame');

    // ── 1. Terrain only (default: basemap on, no layers) ──
    await setMapPicker('showBasemap', 'true');
    await setMapPicker('keyIconTypes', '');
    await setMapPicker('showPlaceLabels', 'false');
    await setMapPicker('showMultiTint', 'false');
    await setMapPicker('showFreeTint', 'false');
    await openPicker();
    await shot('terrain', 'Basemap on — terrain only (nothing overlays)');
    await closePicker();

    // ── 2. Place names ──
    await setMapPicker('showPlaceLabels', 'true');
    await openPicker();
    await shot('labels', 'Basemap + place names (town labels overlay)');
    await closePicker();

    // ── 3. Key icons: Bank only ──
    await setMapPicker('showPlaceLabels', 'false');
    await setMapPicker('keyIconTypes', 'Bank');
    await openPicker();
    await shot('key-bank', 'Basemap + Key icons: Bank only');
    await closePicker();

    // ── 4. Full showcase: labels + several Key types + multi ──
    await setMapPicker(
        'keyIconTypes',
        'Bank,Altar,Fishing Spot,General Store,Dungeon,Mining Site,Quest Start'
    );
    await setMapPicker('showPlaceLabels', 'true');
    await setMapPicker('showMultiTint', 'true');
    await openPicker();
    await shot(
        'full',
        'Basemap + place names + Key multiselect (Bank/Altar/Fishing Spot/…) + multicombat'
    );
    await closePicker();

    // ── 5. Classic dots mode ──
    await setMapPicker('showBasemap', 'false');
    await setMapPicker('keyIconTypes', '');
    await setMapPicker('showPlaceLabels', 'false');
    await setMapPicker('showMultiTint', 'false');
    await openPicker();
    await shot('dots', 'Show basemap off — classic walkable dots + destination markers');
    await closePicker();

    // ── 6. Settings modal ──
    await setMapPicker('showBasemap', 'true');
    await openPicker();
    await page.locator('button.rs2b0t-walkmap-settings').click();
    await page.locator('.rs2b0t-modal-backdrop .rs2b0t-modal-title').filter({ hasText: /Map picker/i }).waitFor({
        state: 'visible',
        timeout: 5_000
    });
    await shot('settings', 'Map picker Settings modal (Worldmap layers)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await closePicker();

    const proofPath = 'out/issue0-map-picker-showcase-proof.json';
    writeFileSync(
        proofPath,
        JSON.stringify(
            {
                issue: 0,
                slug: 'map-picker-showcase',
                harness: 'e2e/map-picker-showcase-live.ts',
                user,
                base,
                shots,
                passed: true,
                at: new Date().toISOString()
            },
            null,
            2
        ) + '\n'
    );
    console.log(`proof=${proofPath}`);
    console.log(`PASS map-picker showcase — ${shots.length} screenshots`);
    for (const s of shots) {
        console.log(`  ${s.path}`);
    }
} catch (e) {
    console.error(e);
    await page.screenshot({ path: `${shotDir}/issue0-map-picker-showcase-failure.png`, fullPage: true }).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close();
}
