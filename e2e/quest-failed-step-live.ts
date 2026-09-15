import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { reader } from '../src/bot/adapter/ClientAdapter.js';
import type { AbstractBot, Task } from '../src/bot/api/bot/Bot.js';
import type { QuestEngine } from '../src/bot/api/ai/quests/engine/QuestEngine.js';
import type { QuestModule } from '../src/bot/api/ai/quests/engine/types.js';
import type AIOQuester from '../src/bot/scripts/AIOQuester/AIOQuester.js';
import type { ScriptRegistry } from '../src/bot/runtime/ScriptRegistry.js';
import type { ScriptRunner } from '../src/bot/runtime/ScriptRunner.js';
import { deployIsolatedClient, launchBrowser, logout, positionalArgs, requireSim } from './lib/harness.js';
import { mainlandAccount } from './tutorial/harness.js';

declare const globalThis: {
    readonly rs2b0t: { readonly runner: typeof ScriptRunner; readonly registry: typeof ScriptRegistry; readonly reader: typeof reader };
    questFailedProof: { attempts: number; nextExecuted: boolean; bot: AIOQuester };
};

const [base = 'http://localhost:8890'] = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'local engine only');
const tag = `qfail-${crypto.randomUUID().slice(0, 8)}`;
const username = `qf${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
async function evidence(page: Page, outcome: 'success' | 'failure', error: string | null): Promise<void> {
    const state = await page.evaluate(() => {
        const { runner, reader } = globalThis.rs2b0t;
        const proof = globalThis.questFailedProof;
        return {
            attempts: proof?.attempts, nextExecuted: proof?.nextExecuted,
            selected: proof?.bot['runningId'], parked: proof?.bot['parkedCount'], rows: proof?.bot['rows'],
            runner: runner.state, logs: runner.ctx?.log ?? [], inventory: reader.inventory(), tile: reader.worldTile(),
            ingame: reader.ingame(), modals: reader.modals(), chat: reader.chat(12),
            settings: sessionStorage.getItem('rs2b0t:set:AIOQuester:quests')
        };
    });
    const path = `out/${tag}-${outcome}`;
    await Bun.write(`${path}.json`, JSON.stringify({ username, error, ...state }, null, 2));
    await page.screenshot({ path: `${path}.png`, fullPage: true });
    console.log('failed-step evidence', { path, username, attempts: state.attempts, selected: state.selected });
}
await requireSim(base);
const deployment = deployIsolatedClient(tag);
try {
    const browser = await launchBrowser({ swiftshader: true });
    try {
        const page = await browser.newPage();
        console.log('starting failed-step scenario', { tag, username });
        try {
            await mainlandAccount(page, base, username, deployment.page);
            await page.evaluate(() => {
                const { runner, registry } = globalThis.rs2b0t;
                const meta = registry.get('AIOQuester');
                if (!meta) throw new Error('AIOQuester unavailable');
                sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'runemysteries,doric');
                function isQuester(bot: AbstractBot): bot is AIOQuester {
                    return 'tasks' in bot && 'requestSkip' in bot;
                }
                function isEngine(task: Task): task is QuestEngine {
                    return 'buildSnapshot' in task && 'parkOrGiveUp' in task;
                }
                runner.start({
                    ...meta,
                    create: () => {
                        const bot = meta.create();
                        if (!isQuester(bot)) throw new Error('unexpected AIOQuester ABI');
                        globalThis.questFailedProof = { attempts: 0, nextExecuted: false, bot };
                        const start = bot.onStart.bind(bot);
                        const stop = bot.onStop.bind(bot);
                        const originals = new Map<QuestModule, QuestModule['decide']>();
                        let restoreSnapshot = () => {};
                        bot.onStart = async () => {
                            await start();
                            const engine = bot['tasks'].find(isEngine);
                            if (!engine) throw new Error('quest engine task unavailable');
                            for (const id of ['runemysteries', 'doric']) {
                                engine['freshened'].add(id);
                                engine['deposited'].add(id);
                                engine['provisioned'].add(id);
                            }
                            const snapshot = engine['buildSnapshot'].bind(engine);
                            restoreSnapshot = () => { engine['buildSnapshot'] = snapshot; };
                            engine['buildSnapshot'] = (module, stage, progress) => {
                                if (!originals.has(module)) {
                                    originals.set(module, module.decide);
                                    module.decide = () => ({
                                        kind: 'custom', name: 'controlled failed-step queue proof',
                                        run: async () => {
                                            const proof = globalThis.questFailedProof;
                                            if (module.record.id === 'runemysteries') {
                                                proof.attempts++;
                                                return false;
                                            }
                                            proof.nextExecuted = true;
                                            return true;
                                        }
                                    });
                                }
                                return snapshot(module, stage, progress);
                            };
                        };
                        bot.onStop = async () => {
                            restoreSnapshot();
                            for (const [module, decide] of originals) module.decide = decide;
                            await stop();
                        };
                        return bot;
                    }
                });
            });
            await page.waitForFunction(() => globalThis.questFailedProof?.nextExecuted, undefined, { timeout: 120_000 });
            const result = await page.evaluate(() => {
                const { attempts, nextExecuted, bot } = globalThis.questFailedProof;
                return { attempts, nextExecuted, running: bot['runningId'], rows: bot['rows'] };
            });
            assert.equal(result.attempts, 8);
            assert.equal(result.nextExecuted, true);
            assert.equal(result.running, 'doric');
            assert.equal(result.rows.find(row => row.id === 'runemysteries')?.status, 'PARKED');
            await evidence(page, 'success', null);
            console.log(`PASS ${username}: ${JSON.stringify(result)}`);
        } catch (error) {
            await evidence(page, 'failure', error instanceof Error ? error.message : String(error));
            throw error;
        } finally {
            await page.evaluate(() => globalThis.rs2b0t.runner.stop('failed-step harness teardown'));
            await page.waitForFunction(() => ['stopped', 'crashed', 'idle'].includes(globalThis.rs2b0t.runner.state), undefined, { timeout: 10_000 });
            const firstLogout = await logout(page);
            if (!firstLogout) {
                await evidence(page, 'failure', 'first logout did not complete');
                assert(await logout(page, 20000), `logout retry failed: ${username}`);
            }
            const ingame = await page.evaluate(() => globalThis.rs2b0t.reader.ingame());
            assert.equal(ingame, false);
            await Bun.write(`out/${tag}-teardown.json`, JSON.stringify({ username, firstLogout, ingame }, null, 2));
            console.log('logged out test account', username);
        }
    } finally {
        await browser.close();
    }
} finally {
    deployment.cleanup();
}
console.log('PASS failed-step queue and teardown', username);
