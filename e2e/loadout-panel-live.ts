/** Live proof for the loadout panel: open it in a client, define a loadout, confirm it survives a reload.
 *  Why: item icons only render against a loaded cache, which is the half a DOM test cannot cover. */

//   HEADED=1 bun e2e/loadout-panel-live.ts
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, mainlandAccount } from './tutorial/harness.js';

/**
 * Debugname, display name, slot. Chainbody, not platebody: the rune platebody
 * is Dragon Slayer-gated and refuses to equip without a word.
 */
const KIT: [string, string, string][] = [
    ['rune_scimitar', 'Rune scimitar', 'righthand'],
    ['rune_chainbody', 'Rune chainbody', 'torso'],
    ['rune_platelegs', 'Rune platelegs', 'legs'],
    ['rune_full_helm', 'Rune full helm', 'hat'],
    ['rune_kiteshield', 'Rune kiteshield', 'lefthand'],
    ['amulet_of_strength', 'Amulet of strength', 'front']
];

const base = process.env.BASE ?? 'http://localhost:8890';
const user = `load${Date.now().toString(36).slice(-6)}`;
const deploy = !process.argv.includes('--no-deploy');

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

/** A live run loads the deployed bundle, never the working tree. */
function deployBundle(): void {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
    const botDir = `${engine}/public/bot`;
    if (!existsSync(botDir)) {
        fail(`deploy: ${botDir} not found — set ENGINE_DIR to the engine serving ${base}`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    const copy = Bun.spawnSync(['sh', '-c', `cp out/botclient.js out/botclient.js.map "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundle into ${botDir}`);
    }
    console.log(`deploy: fresh botclient.js -> ${botDir}`);
}

if (deploy) {
    deployBundle();
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    await page.click('button:has-text("Loadouts")');
    // Opening gives a loadout to edit with no "+ new", which is the path a player takes on first use.
    await page.click('[data-slot=righthand]');
    await page.fill('[data-role=item-search]', 'Rune scimitar');
    await page.click('[data-item="Rune scimitar"]');
    console.log('picked Rune scimitar for the weapon slot');

    // Why: the client streams item models on demand and a fresh login has never seen a rune scimitar, so the icon appears only once the sprite builds.
    try {
        await page.waitForSelector('[data-slot=righthand] img', { timeout: 20_000 });
        console.log('item icon filled in from the client cache');
    } catch {
        fail('weapon slot never rendered an icon — the panel gave up before the model streamed in');
    }

    // "from worn" is the other half a DOM test cannot reach: it needs a live
    // character with equipment on.
    await cheatQuiet(page, 'setstat attack 70');
    await cheatQuiet(page, 'setstat defence 70');
    for (const [obj] of KIT) {
        await cheatQuiet(page, `give ${obj} 1`);
    }
    await page.waitForTimeout(1200);
    const equipped = await page.evaluate(async names => {
        const g = globalThis as never as { __rs2b0t: { Equipment: { equip(n: string): Promise<boolean> } } };
        const done: string[] = [];
        for (const n of names) {
            if (await g.__rs2b0t.Equipment.equip(n)) {
                done.push(n);
            }
        }
        return done;
    }, KIT.map(k => k[1]));
    if (equipped.length !== KIT.length) {
        fail(`only equipped ${equipped.length}/${KIT.length}: ${equipped.join(', ')}`);
    }

    await page.click('[data-action=from-worn]');
    await page.waitForTimeout(500);
    for (const [, name, slot] of KIT) {
        const got = await page.getAttribute(`[data-slot=${slot}]`, 'data-item');
        if (got !== name) {
            fail(`from worn put '${got}' in ${slot}, wanted '${name}'`);
        }
    }
    console.log(`from worn populated all ${KIT.length} slots`);

    await page.reload();
    await page.waitForSelector('button:has-text("Loadouts")', { timeout: 180_000 });
    await page.click('button:has-text("Loadouts")');
    const worn = await page.getAttribute('[data-slot=righthand]', 'data-item');
    if (worn !== 'Rune scimitar') {
        fail(`after reload the weapon slot read '${worn}', wanted 'Rune scimitar'`);
    }
    console.log('PASS (loadout defined, icon rendered, survived a reload, from worn read the character)');
} finally {
    await browser.close();
}
