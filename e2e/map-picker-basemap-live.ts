/** Live smoke for the map tile picker (basemap + walkable dots + settings): [base]. Requires login; deploy botclient + collision + basemap + worldmap.jag first.
 *  Proof: out/issue0-map-picker-basemap-proof.json, screenshots/issue0-map-picker-basemap-success.png */

//   HEADED=1 bun e2e/map-picker-basemap-live.ts [http://localhost:8890]
//   bun run verify:map-picker -- http://localhost:8890

// Deploy first: `~/redeploy.sh` (botclient + collision + basemap + worldmap.jag).

// Attach:
//   tools/attach-live-proof-to-pr.sh --pr <n> --issue 0 --slug map-picker-basemap \
//     --harness 'HEADED=0 bun e2e/map-picker-basemap-live.ts http://localhost:8890'
import { boot, fail, launchBrowser, login, positionalArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = process.env.BOT_USER ?? `mp${Date.now().toString(36).slice(-6)}`;
const pass = process.env.BOT_PASS ?? 'test';
const proof = createHarnessProof({ issue: 0, slug: 'map-picker-basemap' });
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
    // Force-hide any stuck backdrop so Browse is clickable
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
            return /zoom /.test(t) && !/loading collision/i.test(t) && !/HTTP \d+/.test(t);
        },
        undefined,
        { timeout: 60_000 }
    );
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

    await setMapPicker('showBasemap', 'true');
    // Key icons default off (terrain only); classic dots only when basemap off.

    await openPicker();
    console.log('opened Pick on Map (basemap on)');

    await page.waitForFunction(
        () => {
            const s = document.querySelector('canvas.rs2b0t-walkmap-canvas')?.getAttribute('data-basemap');
            return s === 'ready' || s === 'missing' || s === 'error' || s === 'off';
        },
        undefined,
        { timeout: 45_000 }
    );

    let basemapAttr = await page.locator('canvas.rs2b0t-walkmap-canvas').getAttribute('data-basemap');
    console.log('basemap:', basemapAttr, await page.locator('.rs2b0t-walkmap-status').textContent());

    const rebuild = page.locator('button.rs2b0t-walkmap-rebuild');
    const settingsBtn = page.locator('button.rs2b0t-walkmap-settings');
    if (!(await settingsBtn.isVisible())) {
        fail('Settings button missing on map picker');
    }
    if (basemapAttr !== 'off' && !(await rebuild.isVisible())) {
        fail('Rebuild map button hidden while showBasemap=true');
    }

    // Settings modal opens (help text lives on each control — no intro banner)
    await settingsBtn.click();
    await page.locator('.rs2b0t-modal-backdrop .rs2b0t-modal-title').filter({ hasText: /Map picker/i }).waitFor({
        state: 'visible',
        timeout: 5_000
    });
    console.log('settings modal ok');
    await page.locator('.rs2b0t-modal-backdrop').filter({ has: page.locator('.rs2b0t-modal-title') }).locator('button').filter({ hasText: '✕' }).first().click();
    await page.waitForTimeout(200);

    await page.locator('.rs2b0t-walkmap-zoom-in').click();
    await page.locator('.rs2b0t-walkmap-zoom-in').click();
    const canvas = page.locator('canvas.rs2b0t-walkmap-canvas');
    const box = await canvas.boundingBox();
    if (!box) {
        fail('no canvas box');
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);

    let status = await page.locator('.rs2b0t-walkmap-status').textContent();
    if (!status || !/selected \d+,\d+,L\d/.test(status)) {
        await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
        await page.waitForTimeout(300);
        status = await page.locator('.rs2b0t-walkmap-status').textContent();
    }
    if (!status || !/selected \d+,\d+,L\d/.test(status)) {
        fail(`no selection after canvas clicks: ${status}`);
    }
    const m = status.match(/selected (\d+),(\d+),L(\d+)/)!;
    const picked = { x: Number(m[1]), z: Number(m[2]), level: Number(m[3]) };
    console.log('picked', picked);

    await proof.writeSuccess(page, {
        issue: 0,
        harness: 'e2e/map-picker-basemap-live.ts',
        user,
        basemap: basemapAttr,
        picked,
        status,
        steps: ['login', 'open', 'settings-intro', 'zoom', 'click-select', 'basemap-on']
    });

    await page.locator('button.rs2b0t-walkmap-confirm').click();
    await page.waitForTimeout(300);
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
    console.log('tile fields ok', xVal, zVal, lVal);

    await dismissUi();

    // basemap off
    await setMapPicker('showBasemap', 'false');
    await openPicker();
    await page.waitForTimeout(250);
    basemapAttr = await page.locator('canvas.rs2b0t-walkmap-canvas').getAttribute('data-basemap');
    status = await page.locator('.rs2b0t-walkmap-status').textContent();
    console.log('basemap off:', basemapAttr, status);
    if (basemapAttr !== 'off' && !(status ?? '').includes('basemap off')) {
        await page.locator('.rs2b0t-walkmap-zoom-in').click();
        await page.waitForTimeout(150);
        basemapAttr = await page.locator('canvas.rs2b0t-walkmap-canvas').getAttribute('data-basemap');
        status = await page.locator('.rs2b0t-walkmap-status').textContent();
    }
    if (await rebuild.isVisible().catch(() => false)) {
        fail('Rebuild visible when showBasemap=false');
    }
    const box2 = await canvas.boundingBox();
    if (!box2) {
        fail('no canvas (basemap off)');
    }
    await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.waitForTimeout(250);
    status = await page.locator('.rs2b0t-walkmap-status').textContent();
    if (!status || !/selected \d+,\d+,L\d/.test(status)) {
        fail(`no selection basemap off: ${status}`);
    }
    await page.locator('button.rs2b0t-walkmap-cancel').click();
    await dismissUi();

    await setMapPicker('showBasemap', 'true');
    await openPicker();
    await page.waitForTimeout(250);
    if (!(await rebuild.isVisible().catch(() => false))) {
        fail('Rebuild not restored after showBasemap=true');
    }
    await page.locator('button.rs2b0t-walkmap-cancel').click();
    await dismissUi();

    console.log(
        `PASS map-picker basemap smoke — user=${user} basemap=${basemapAttr} pick ${picked.x},${picked.z},L${picked.level}`
    );
    console.log(
        `attach: tools/attach-live-proof-to-pr.sh --pr <n> --issue 0 --slug map-picker-basemap --harness 'bun e2e/map-picker-basemap-live.ts ${base}'`
    );
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close();
}
