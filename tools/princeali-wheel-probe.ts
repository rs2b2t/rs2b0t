// docs/TESTING.md#live-harnesses
//
// Settles one question and nothing else: does the Lumbridge castle spinning wheel at
// 3209,3212,1 actually spin wool? sheepshearer avoids it on the strength of commit
// 3a8c3a9 (2026-07-16), which predates the multi-level loc-snapshot settle fix in
// e146904 (2026-07-22) by six days — and a level-1 loc queried in the tick after a
// staircase climb reads back empty. Prince Ali's whole wool leg depends on the answer.
//
// Drives the wheel directly rather than through AIOQuester: at stage 0 the quest routes
// to Hassan and would never reach the wool leg at all.
import { fail, launchBrowser } from './lib/harness.js';
import { cheat, cheatQuiet, mainlandAccount } from './tutorial/harness.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `pw${Date.now().toString(36).slice(-7)}`;
const minutes = Number(opt('--minutes') ?? 8);

// Falador's ground-level wheel, the fallback sheepshearer already uses.
const FALADOR = { x: 2982, z: 3315, level: 0, label: 'Falador' };
const LUMBRIDGE = { x: 3209, z: 3213, level: 1, label: 'Lumbridge castle' };
const target = opt('--wheel') === 'falador' ? FALADOR : LUMBRIDGE;

interface Probe {
    done: boolean;
    ok: boolean;
    reason: string;
    balls: number;
    pos: { x: number; z: number; level: number } | null;
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, base, user);
    await cheat(page, 'speed 300');
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }
    if (!(await cheatQuiet(page, 'give wool 5'))) {
        fail('could not give wool');
    }
    console.log(`probing the ${target.label} wheel at ${target.x},${target.z},${target.level}`);

    // Execution.* throws outside a running script, so the probe body is a registered
    // LoopingBot driven by the runner rather than a bare async function.
    await page.evaluate(stand => {
        const g = globalThis as never as {
            __rs2b0t: {
                LoopingBot: new () => object;
                registerScript(meta: { name: string; create: () => unknown }): void;
                Tile: new (x: number, z: number, level: number) => unknown;
                Traversal: { walkResilient(t: unknown, o: Record<string, unknown>): Promise<boolean> };
                Locs: { query(): unknown };
                ChatDialog: { isMakeMenu(): boolean; makeX(m: string, n: number): Promise<boolean>; makeProducts(): string[] };
                Inventory: { count(n: string): number };
                Execution: { delayUntil(c: () => boolean, ms: number): Promise<boolean>; delayTicks(n: number): Promise<void> };
                reader: { worldTile(): { x: number; z: number; level: number } | null };
            };
            rs2b0t: { runner: { start(meta: unknown): void }; registry: { get(name: string): unknown } };
            __paProbe?: Probe;
        };
        const abi = g.__rs2b0t;
        g.__paProbe = { done: false, ok: false, reason: '', balls: 0, pos: null };

        class WheelProbeBot extends abi.LoopingBot {
            private ran = false;

            async loop(): Promise<number> {
                if (this.ran) {
                    return 5000;
                }
                this.ran = true;
                await runProbe();
                return 5000;
            }
        }

        async function runProbe(): Promise<void> {
            const res = g.__paProbe!;
            const log = (m: string): void => console.log(`[bot] ${m}`);
            try {
                const dest = new abi.Tile(stand.x, stand.z, stand.level);
                log(`walking to the wheel stand ${stand.x},${stand.z},${stand.level}`);
                if (!(await abi.Traversal.walkResilient(dest, { radius: 2, attempts: 4, timeoutMs: 240_000, log }))) {
                    res.reason = 'could not walk to the wheel stand';
                    res.pos = abi.reader.worldTile();
                    res.done = true;
                    return;
                }
                // Every loc query is empty for about a tick after a level change.
                await abi.Execution.delayTicks(3);
                res.pos = abi.reader.worldTile();

                const find = (): { interact(op: string): boolean | Promise<boolean> } | null =>
                    (abi.Locs.query() as never as {
                        name(n: string): { action(a: string): { within(d: number): { nearest(): { interact(op: string): boolean | Promise<boolean> } | null } } };
                    })
                        .name('Spinning wheel')
                        .action('Spin')
                        .within(8)
                        .nearest();

                const wheel = find();
                if (!wheel) {
                    res.reason = 'no Spinning wheel offering Spin within 8 tiles of the stand';
                    res.done = true;
                    return;
                }
                log('found the wheel — sending Spin');
                if (!(await wheel.interact('Spin'))) {
                    res.reason = 'Spin op was refused by the client';
                    res.done = true;
                    return;
                }
                if (!(await abi.Execution.delayUntil(() => abi.ChatDialog.isMakeMenu(), 10_000))) {
                    res.reason = 'Spin sent but the make menu never opened (server dropped OPLOC2)';
                    res.done = true;
                    return;
                }
                log(`make menu open — products: [${abi.ChatDialog.makeProducts().join(', ')}]`);
                if (!(await abi.ChatDialog.makeX('Wool', abi.Inventory.count('Wool')))) {
                    res.reason = 'make menu open but Make-X on Wool failed';
                    res.done = true;
                    return;
                }
                await abi.Execution.delayUntil(() => abi.Inventory.count('Ball of wool') > 0, 20_000);
                res.balls = abi.Inventory.count('Ball of wool');
                res.ok = res.balls > 0;
                res.reason = res.ok ? 'spun' : 'Make-X accepted but no ball of wool appeared';
            } catch (e) {
                res.reason = `threw: ${String(e)}`;
            } finally {
                res.done = true;
            }
        }

        abi.registerScript({ name: 'PaWheelProbe', create: () => new WheelProbeBot() });
        g.rs2b0t.runner.start(g.rs2b0t.registry.get('PaWheelProbe'));
    }, target);

    const finished = await page
        .waitForFunction(
            () => (globalThis as never as { __paProbe?: Probe }).__paProbe?.done === true,
            undefined,
            { timeout: minutes * 60_000 }
        )
        .then(() => true)
        .catch(() => false);

    const res = await page.evaluate(() => (globalThis as never as { __paProbe?: Probe }).__paProbe ?? null);
    const pos = res?.pos ? `${res.pos.x},${res.pos.z},${res.pos.level}` : '?';
    console.log(`END wheel=${target.label} finished=${finished} ok=${res?.ok} balls=${res?.balls} pos=${pos} reason=${res?.reason}`);

    if (!res?.ok) {
        console.log('');
        console.log(`The ${target.label} wheel did not spin. Re-run with --wheel falador to confirm the`);
        console.log('fallback works, then set PA_TILE.SPIN_STAND to (2982,3315,0) in');
        console.log('src/bot/quests/defs/princeali/areas.ts and note it in the design spec.');
        fail(`${target.label} spinning wheel probe failed: ${res?.reason ?? 'no result'}`);
    }
} finally {
    await browser.close();
}
