import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cheatQuiet, deployIsolatedClient, launchBrowser } from './lib/harness.js';
import { runNavWalk, type NavWalkResult } from './lib/navLiveHarness.js';
import { clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `mt${Date.now().toString(36).slice(-7)}`;
const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage();
const results: Record<string, NavWalkResult> = {};
try {
    await mainlandAccount(page, base, user, client.page);
    assert(await cheatQuiet(page, 'setstat hitpoints 99'));
    await clearChatDialogs(page, 'hitpoints level');
    const legs = [
        ['town-razmire', { x: 3490, z: 3290, level: 0 }, { x: 3489, z: 3296, level: 0 }],
        ['razmire-ulsquire', null, { x: 3496, z: 3289, level: 0 }],
        ['temple-razmire', { x: 3509, z: 3312, level: 0 }, { x: 3489, z: 3296, level: 0 }]
    ] as const;
    for (const [name, from, dest] of legs) {
        if (from) assert(await teleTo(page, from, 0, 30_000));
        results[name] = await runNavWalk(page, { dest, radius: 1, budgetMs: 60_000, useTeleports: false, scriptNamePrefix: 'Mortton798', progressEverySec: 15 });
        console.log(name, JSON.stringify(results[name]));
        assert(results[name].walkOk, name);
        await page.screenshot({ path: `docs/e2e/mortton-798-${name}.png` });
    }
    writeFileSync('docs/e2e/mortton-798.json', JSON.stringify(results, null, 2) + '\n');
} finally {
    await browser.close();
    client.cleanup();
}
