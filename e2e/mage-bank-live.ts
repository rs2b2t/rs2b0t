/** Live proof of the Mage Arena bank route: Ardougne → wilderness lever → north-west across the Wilderness → slash both webs along z=3957 → down magearena_ladder_to_cellar → Gundai → bank open.
 *  Why: the only cheat after setup is the one that puts the account outside Ardougne; every hop after that is the nav graph and the bot's own APIs. Proof: out/mage-bank-proof.json */

//   HEADED=1 SLOWMO=0 bun e2e/mage-bank-live.ts
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { HARNESS_VIEWPORT, boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, parseArgs, setSettings } from './lib/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888' });
const user = process.env.USER_NAME ?? `mageb${Date.now() % 100000}`;

/** Outside Ardougne, a walk away from the lever, so the first leg is a true walk. */
const START = { x: 2570, z: 3320, level: 0 } as const;
const LEVER_ARDY = { x: 2562, z: 3311, level: 0 } as const;
const LEVER_WILD = { x: 3154, z: 3924, level: 0 } as const;
const WEBS = { x: 3096, z: 3957, level: 0 } as const;
const LADDER = { x: 3091, z: 3958, level: 0 } as const;
/** magearena_ladder_to_cellar lands here; Gundai banks in this cellar. */
const CELLAR = { x: 2542, z: 4714, level: 0 } as const;

const SCIMITAR = 1333;
const STATS = [
    'attack', 'strength', 'defence', 'ranged', 'magic', 'hitpoints', 'prayer',
    'crafting', 'mining', 'smithing', 'fishing', 'cooking', 'firemaking',
    'woodcutting', 'runecraft', 'herblore', 'agility', 'thieving', 'fletching'
];
const LEVEL = 70;
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 600_000);

type WTile = { x: number; z: number; level: number };
type Abi = {
    __rs2b0t: {
        Game: { tile(): WTile | null };
        Equipment: { contains(n: string): boolean };
        Inventory: { items(): { id: number; interact(a: string): unknown }[] };
        Bank: {
            isOpen(): boolean;
            openNpcAccess(a: { name: string; op: string; choose: string }, log?: (m: string) => void): Promise<boolean>;
        };
        Traversal: {
            walkResilient(
                d: WTile,
                o: {
                    radius?: number; attempts?: number; timeoutMs?: number; log?: (m: string) => void;
                    useTeleportCatalog?: boolean; policy?: { useTeleports: boolean; distanceBeforeTeleport?: number };
                }
            ): Promise<boolean>;
        };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null; start(m: unknown): void; stop(r: string): void } };
    __mageBank?: { done: boolean; walked: boolean; banked: boolean };
};

const tile = (page: Page): Promise<WTile | null> =>
    page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Game.tile());

const logLines = (page: Page): Promise<string[]> =>
    page.evaluate(() => ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

function near(a: WTile | null, b: { x: number; z: number }, r = 6): boolean {
    return a !== null && Math.abs(a.x - b.x) <= r && Math.abs(a.z - b.z) <= r;
}

async function main(): Promise<void> {
    const browser = await launchBrowser({ swiftshader: !process.env.HEADED });
    const context = await browser.newContext({ viewport: HARNESS_VIEWPORT });
    const page = await context.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const proof: Record<string, unknown> = { user, base };
    const seen: Record<string, boolean> = { leverArdy: false, leverWild: false, webs: false, ladder: false, cellar: false };
    try {
        await page.goto(`${base}/bot.html`);
        await boot(page);
        if (!(await login(page, user))) {
            fail(`login failed for ${user}`);
        }
        await bringUpOffIsland(page, { user });

        for (const s of STATS) {
            await cheatQuiet(page, `setstat ${s} ${LEVEL}`, 250);
        }
        // A wielded slash weapon is what makes the webs passable at all.
        await cheatQuiet(page, 'give rune_scimitar 1', 1000);
        for (let i = 0; i < 4 && !(await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Equipment.contains('Rune scimitar'))); i++) {
            await page.evaluate(id => {
                const it = (globalThis as never as Abi).__rs2b0t.Inventory.items().find(x => x.id === id);
                it?.interact('Wield');
            }, SCIMITAR);
            await page.waitForTimeout(1000);
        }
        if (!(await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Equipment.contains('Rune scimitar')))) {
            fail('no slash weapon wielded — the webs are impassable without one');
        }
        await cheatQuiet(page, `tele 0,${START.x >> 6},${START.z >> 6},${START.x & 63},${START.z & 63}`, 3500);

        // Why: navTeleports gates lever-kind edges too (teleportAllowedByPolicy refuses them with useTeleports=false), and without the Ardougne lever nav walks 1223 tiles overland through the gates.
        await setSettings(page, 'Global', {
            useMageBank: true,
            navTeleports: true,
            showNavPath: true,
            navPathShowText: true,
            navCameraFollow: true
        });

        console.log(`start ${JSON.stringify(await tile(page))} — walking to Gundai at (${CELLAR.x},${CELLAR.z})`);

        await page.evaluate(
            ({ dest, budget }) => {
                const g = globalThis as never as Abi;
                const api = g.__rs2b0t;
                g.__mageBank = { done: false, walked: false, banked: false };

                class Probe extends api.LoopingBot {
                    override async loop(): Promise<void> {
                        try {
                            const walked = await api.Traversal.walkResilient(dest, {
                                radius: 6,
                                attempts: 6,
                                timeoutMs: budget,
                                log: m => this.log(m),
                                // The Global toggle is not enough here: lever edges are
                                // teleport-kind, so the walk needs the policy explicitly.
                                useTeleportCatalog: true,
                                policy: { useTeleports: true, distanceBeforeTeleport: 20 }
                            });
                            g.__mageBank!.walked = walked;
                            if (walked) {
                                this.log('arrived in the cellar — talking to Gundai');
                                g.__mageBank!.banked = await api.Bank.openNpcAccess(
                                    { name: 'Gundai', op: 'Talk-to', choose: "I'd like to access my bank account" },
                                    m => this.log(m)
                                );
                            }
                        } finally {
                            g.__mageBank!.done = true;
                            g.rs2b0t.runner.stop('harness: route finished');
                        }
                    }
                }
                g.rs2b0t.runner.start(api.registerScript({ name: 'MageBankRoute', create: () => new Probe() }));
            },
            { dest: CELLAR, budget: BUDGET_MS }
        );

        const deadline = Date.now() + BUDGET_MS + 60_000;
        let lastAt = '';
        let seenLines = 0;
        while (Date.now() < deadline) {
            await page.waitForTimeout(500);
            const lines = await logLines(page);
            for (const l of lines.slice(seenLines)) {
                console.log(`   ${l}`);
            }
            seenLines = lines.length;

            const at = await tile(page);
            const key = at ? `${at.x},${at.z},${at.level}` : '?';
            if (key !== lastAt) {
                lastAt = key;
                if (near(at, LEVER_ARDY, 4) && !seen.leverArdy) { seen.leverArdy = true; console.log('>> at the Ardougne lever'); }
                if (near(at, LEVER_WILD, 8) && !seen.leverWild) { seen.leverWild = true; console.log('>> pulled through into the Wilderness'); }
                if (near(at, WEBS, 4) && !seen.webs) { seen.webs = true; console.log('>> at the webs on z=3957'); }
                if (near(at, LADDER, 3) && !seen.ladder) { seen.ladder = true; console.log('>> through the webs, at the ladder'); }
                if (near(at, CELLAR, 10) && !seen.cellar) { seen.cellar = true; console.log(">> down in Gundai's cellar"); }
            }
            const state = await page.evaluate(() => (globalThis as never as Abi).__mageBank);
            if (state?.done) {
                break;
            }
        }

        const state = await page.evaluate(() => (globalThis as never as Abi).__mageBank);
        proof.reached = seen;
        proof.finalTile = await tile(page);
        proof.walked = state?.walked ?? false;
        proof.banked = state?.banked ?? false;
        proof.log = await logLines(page);
        if (!existsSync('out')) {
            mkdirSync('out', { recursive: true });
        }
        writeFileSync('out/mage-bank-proof.json', JSON.stringify(proof, null, 2));

        console.log('\n==== result ====');
        for (const [k, v] of Object.entries(seen)) {
            console.log(`${v ? 'ok  ' : 'MISS'} ${k}`);
        }
        console.log(`final ${JSON.stringify(proof.finalTile)} | walked ${proof.walked} | bank open ${proof.banked}`);
        console.log('proof: out/mage-bank-proof.json');
        if (proof.banked !== true) {
            fail('never opened the bank with Gundai');
        }
        // Do not claim a route that did not happen: the lever is the point.
        if (!seen.leverWild) {
            fail('banked, but never used the lever — nav walked overland instead');
        }
        console.log('\nPASS: Ardougne -> lever -> webs -> ladder -> Gundai.');
    } finally {
        await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.stop('harness end')).catch(() => undefined);
        if (!process.env.HEADED) {
            await browser.close();
        }
    }
}

await main();
