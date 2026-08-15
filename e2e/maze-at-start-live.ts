/** Regression: a bot that relogs inside the maze random must still solve it: [--base].
 *  Why: the door list only works in sequence from its spawn corner, so a player already partway in is out of step with it and the next door sits behind a wall. */

// Usage: bun e2e/maze-at-start-live.ts [--base http://localhost:8895]
import { boot, bringUpOffIsland, cheatQuiet, launchBrowser, login, parseArgs } from './lib/harness.js';
import type { Page } from 'playwright-core';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8895' });
const MAZE_TELE = 'tele 0,45,71,11,53';
const SOLVE_BUDGET_MS = 300_000;

function inMaze(page: Page): Promise<{ tile: { x: number; z: number; level: number } | null; inMaze: boolean }> {
    return page.evaluate(() => {
        const tile = (globalThis as unknown as {
            rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null } };
        }).rs2b0t.reader.worldTile();
        return { tile, inMaze: tile !== null && tile.level === 0 && tile.x >> 6 === 45 && tile.z >> 6 === 71 };
    });
}

const browser = await launchBrowser();
const page = await browser.newPage();
const user = `mz${Date.now().toString(36).slice(-5)}`;
const maze: string[] = [];
page.on('console', m => {
    const t = m.text();
    if (/maze|shrine/i.test(t)) {
        maze.push(t.slice(0, 200));
    }
});

try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) {
        throw new Error('login failed');
    }
    await bringUpOffIsland(page, { user });
    await page.waitForFunction(
        () => (globalThis as unknown as { rs2b0t: { reader: { sceneState(): number } } }).rs2b0t.reader.sceneState() === 2,
        undefined,
        { timeout: 90_000 }
    );

    await cheatQuiet(page, MAZE_TELE, 4000);
    if (!(await inMaze(page)).inMaze) {
        throw new Error('tele did not land inside the maze square');
    }

    // The trigger: relog while the solver is partway through the route.
    await page.reload();
    await boot(page);
    for (let i = 0; i < 8 && !(await login(page, user)); i++) {
        await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(3000);
    console.log(`relogged inside the maze at ${JSON.stringify((await inMaze(page)).tile)}`);

    const deadline = Date.now() + SOLVE_BUDGET_MS;
    while (Date.now() < deadline) {
        const s = await inMaze(page);
        if (!s.inMaze) {
            console.log(`PASS: left the maze at ${JSON.stringify(s.tile)}`);
            process.exit(0);
        }
        await page.waitForTimeout(3000);
    }
    console.log(maze.slice(-30).join('\n'));
    console.error(`FAIL: still inside the maze after ${SOLVE_BUDGET_MS / 1000}s`);
    process.exit(1);
} catch (err) {
    console.error(err);
    process.exit(1);
} finally {
    await browser.close();
}
