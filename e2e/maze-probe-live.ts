/** Debug probe: tele into the maze NW spawn, watch the guardian until exit or 4 min.
 *  Content: mapzone 0_45_71, 16-door NW route ending at chamber door 2910,4576, then Touch Strange shrine 3634 → end_macro_maze. */
import { boot, bringUpOffIsland, cheatQuiet, launchBrowser, login, positionalArgs } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = `mz${Date.now().toString(36).slice(-5)}`;
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const consoleLogs: string[] = [];
page.on('console', m => {
    const t = m.text();
    if (/random|maze|shrine|door|Touch|rs2b0t|error|Execution/i.test(t)) {
        consoleLogs.push(t.slice(0, 280));
        console.log('[browser]', t.slice(0, 280));
    }
});

try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    await login(page, user);
    await bringUpOffIsland(page, { user });
    await page.waitForFunction(
        () => (globalThis as { rs2b0t?: { reader?: { sceneState?: () => number } } }).rs2b0t?.reader?.sceneState?.() === 2,
        undefined,
        { timeout: 90_000 }
    );
    console.log('scene ready');
    await cheatQuiet(page, 'tele 0,45,71,11,53', 5000);

    const deadline = Date.now() + 240_000;
    let i = 0;
    while (Date.now() < deadline) {
        const s = await page.evaluate(() => {
            const g = globalThis as unknown as {
                rs2b0t: {
                    reader: {
                        worldTile: () => { x: number; z: number; level: number } | null;
                        sceneState: () => number;
                    };
                };
            };
            const t = g.rs2b0t.reader.worldTile();
            return {
                t,
                scene: g.rs2b0t.reader.sceneState(),
                inMaze: t !== null && t.x >> 6 === 45 && t.z >> 6 === 71
            };
        });
        console.log(i, JSON.stringify(s.t), 'inMaze', s.inMaze);
        if (!s.inMaze && i > 2) {
            console.log('LEFT MAZE — PASS');
            break;
        }
        i++;
        await page.waitForTimeout(2500);
    }
    const left = consoleLogs.some(m => /maze solved/i.test(m)) ||
        !(await page.evaluate(() => {
            const t = (globalThis as unknown as { rs2b0t: { reader: { worldTile: () => { x: number; z: number } | null } } }).rs2b0t.reader.worldTile();
            return t !== null && t.x >> 6 === 45 && t.z >> 6 === 71;
        }));
    console.log('--- console dump ---');
    console.log(consoleLogs.join('\n'));
    await page.screenshot({ path: 'screenshots/maze-probe.png', fullPage: true });
    if (!left) {
        console.error('FAIL: still in maze after 240s');
        process.exit(1);
    }
    console.log('PASS maze probe');
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
}
