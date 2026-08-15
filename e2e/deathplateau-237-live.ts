/** Live staged proof for Death Plateau (#237): [base] [stage].
 *  Stages (death_equiproom): 0 start, 10 Eohric, 20 Harold duty, 40 ale, 50 gamble, 55 IOU, 60 combo, 70 unlocked door. */

//   bun e2e/deathplateau-237-live.ts [base] [stage]
import { launchBrowser, positionalArgs } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const seedStage = Number(process.env.DEATH_STAGE ?? args[1] ?? '55');
const minutes = Number(process.env.MINUTES ?? args[2] ?? '15');
const user = args[3] ?? `dp${Date.now().toString(36).slice(-6)}`;
const target = Number(process.env.DEATH_TARGET ?? '80');

const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user);

    const tele =
    seedStage >= 70 ? 'tele 0,45,55,16,8' // Denulth / camp
        : seedStage >= 55 ? 'tele 0,45,55,14,41' // stone balls ~2894,3561
            : seedStage >= 40 ? 'tele 1,45,55,26,19' // Harold
                : seedStage >= 10 ? 'tele 1,45,55,19,45' // Eohric area
                    : 'tele 0,45,55,16,8';

    // Seed bank-style supplies and the stage varp only — the IOU, combination, boots and secret map must come from doing the steps.
    const seed = [
        'speed 300',
        '~clearinv inv',
        `setvar death_equiproom ${seedStage}`,
        'give coins 50000',
        ...(seedStage >= 70
            ? ['give iron_bar 2', 'give bread 10', 'give trout 10']
            : seedStage >= 10
                ? ['give iron_bar 1']
                : []),
        tele,
    ];
    for (const c of seed) await cheatQuiet(page, c);
    await relog(page, user);
    for (const c of seed) {
        if (/^(setvar|give|tele|speed|~clear)/.test(c)) await cheatQuiet(page, c);
    }

    console.log('seeded death_equiproom=', await getServerVarQuiet(page, 'death_equiproom'), 'target=', target);

    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'death');
    });
    await startScript(page, 'AIOQuester');

    const deadline = Date.now() + minutes * 60_000;
    let last = '';
    while (Date.now() < deadline) {
        await page.waitForTimeout(2500);
        const snap = await page.evaluate(() => {
            const g = globalThis as never as {
        __rs2b0t: {
          reader: { worldTile(): { x: number; z: number; level: number } | null; modals(): { main: number } };
          Quests: { status(n: string): string };
          Inventory: { items(): { name: string | null; id: number; count: number }[] };
        };
        rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
      };
            const inv = g.__rs2b0t.Inventory.items();
            const has = (n: string) => inv.some(i => (i.name ?? '').toLowerCase() === n.toLowerCase());
            const hasId = (id: number) => inv.some(i => i.id === id);
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                status: g.__rs2b0t.Quests.status('Death Plateau'),
                runner: g.rs2b0t.runner.state,
                log: (g.rs2b0t.runner.ctx?.log ?? []).slice(-6).map(l => l.msg),
                iou: has('Iou') || has('IOU') || hasId(3103),
                combo: has('Combination') || hasId(3102),
                map: has('Secret way map') || hasId(3104),
                boots: has('Climbing boots') || has('Spiked boots'),
                main: g.__rs2b0t.reader.modals().main,
            };
        });
        const equip = await getServerVarQuiet(page, 'death_equiproom');
        const tip = snap.log[snap.log.length - 1] ?? '';
        const line = `[eq=${equip} ${snap.status} L${snap.pos?.level} ${snap.pos?.x},${snap.pos?.z} iou=${snap.iou} combo=${snap.combo} map=${snap.map} boots=${snap.boots}] ${tip}`;
        if (line !== last) {
            console.log(line);
            last = line;
        }
        if (snap.status === 'complete' || equip === 80 || (equip !== null && Number(equip) >= target)) {
            console.log(`PASS death_equiproom=${equip} status=${snap.status}`);
            break;
        }
        if (snap.runner === 'stopped') {
            console.log('runner stopped; tail:', snap.log);
            break;
        }
    }
    console.log('final death_equiproom=', await getServerVarQuiet(page, 'death_equiproom'),
        'status=', await page.evaluate(() => (globalThis as never as { __rs2b0t: { Quests: { status(n: string): string } } }).__rs2b0t.Quests.status('Death Plateau')));
} finally {
    await browser.close();
}
