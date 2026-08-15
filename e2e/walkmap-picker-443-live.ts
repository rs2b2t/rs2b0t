/** Live smoke for the walkable map picker (#443) through Playwright clicks: [base]. Deploy first — it needs botclient.js and collision.lcnav.gz on the engine.
 *  Writes out/issue443-walkable-map-picker-proof.json and screenshots/issue443-walkable-map-picker-success.png. */

//   HEADED=1 bun e2e/walkmap-picker-443-live.ts [http://localhost:8890]

// After PASS + open PR:
//   tools/attach-live-proof-to-pr.sh --pr <n> --issue 443 --slug walkable-map-picker \
//     --harness 'HEADED=1 bun e2e/walkmap-picker-443-live.ts'

// Deploy first: `~/redeploy.sh` (needs botclient.js + collision.lcnav.gz on the engine).
import { fail, launchBrowser, positionalArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const proof = createHarnessProof({ issue: 443, slug: 'walkable-map-picker' });
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
page.setDefaultTimeout(90_000);

try {
    await proof.ensureDirs();
    console.log(`loading ${base}/bot.html`);
    await page.goto(`${base}/bot.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => Boolean((globalThis as never as { rs2b0t?: unknown }).rs2b0t),
        undefined,
        { timeout: 180_000 }
    );
    await page.waitForTimeout(2000);

    // Browse → WalkTo
    await page.getByRole('button', { name: /Browse/i }).click();
    const search = page.locator('input.rs2b0t-input[placeholder*="search"]');
    await search.waitFor({ state: 'visible' });
    await search.fill('WalkTo');
    await page.waitForTimeout(300);
    const card = page.locator('.rs2b0t-library-card').filter({ hasText: /WalkTo/i }).first();
    await card.click();
    await page.waitForTimeout(400);
    console.log('selected WalkTo');

    // Edit parameters → Pick on Map
    await page.locator('button.rs2b0t-param-edit').filter({ hasText: /Edit parameters/i }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Pick on Map/i }).click();
    console.log('opened Pick on Map');

    const canvas = page.locator('canvas.rs2b0t-walkmap-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 90_000 });

    // Collision pack must finish loading
    await page.waitForFunction(
        () => {
            const t = document.querySelector('.rs2b0t-walkmap-status')?.textContent ?? '';
            return /zoom /.test(t) && !/loading collision/i.test(t) && !/HTTP \d+/.test(t);
        },
        undefined,
        { timeout: 90_000 }
    );
    console.log('status:', await page.locator('.rs2b0t-walkmap-status').textContent());

    // Zoom in a couple steps (smoke the controls), then click canvas centre
    await page.locator('.rs2b0t-walkmap-zoom-in').click();
    await page.locator('.rs2b0t-walkmap-zoom-in').click();
    const box = await canvas.boundingBox();
    if (!box) {
        fail('no canvas box');
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);

    let status = await page.locator('.rs2b0t-walkmap-status').textContent();
    console.log('after click:', status);
    if (!status || !/selected \d+,\d+,L\d/.test(status)) {
        // Nudge toward Varrock-ish centre default and try again
        await page.locator('.rs2b0t-walkmap-zoom-out').click();
        await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
        await page.waitForTimeout(400);
        status = await page.locator('.rs2b0t-walkmap-status').textContent();
        console.log('retry click:', status);
    }
    if (!status || !/selected \d+,\d+,L\d/.test(status)) {
        fail(`no selection after canvas clicks: ${status}`);
    }
    const m = status.match(/selected (\d+),(\d+),L(\d+)/)!;
    const picked = { x: Number(m[1]), z: Number(m[2]), level: Number(m[3]) };
    console.log('picked', picked);

    // Shot while the walkable-dot canvas + selection marker are still open.
    await proof.writeSuccess(page, {
        issue: 443,
        harness: 'e2e/walkmap-picker-443-live.ts',
        picked,
        status
    });

    await page.locator('button.rs2b0t-walkmap-confirm').click();
    await page.waitForTimeout(500);
    if ((await page.locator('canvas.rs2b0t-walkmap-canvas').count()) > 0) {
        fail('picker still open after Confirm');
    }

    // Tile fields in params modal
    const inputs = page.locator('input.rs2b0t-param-tilein');
    const xVal = await inputs.nth(0).inputValue();
    const zVal = await inputs.nth(1).inputValue();
    const lVal = await inputs.nth(2).inputValue();
    console.log('tile fields', xVal, zVal, lVal);
    if (Number(xVal) !== picked.x || Number(zVal) !== picked.z || Number(lVal) !== picked.level) {
        fail(`fields ${xVal},${zVal},${lVal} !== ${picked.x},${picked.z},${picked.level}`);
    }

    console.log('PASS walkable map picker (#443) — click select confirm → tile fields');
    console.log('attach: tools/attach-live-proof-to-pr.sh --pr <n> --issue 443 --slug walkable-map-picker');
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close();
}
