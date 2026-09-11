import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { cheatQuiet, clearChatDialogs, relog, teleTo } from './tutorial/harness.js';
import { privateScenario, type PrivateScenario } from './jive-private-config.js';
import type { PrivateRuntime } from './jive-private-types.js';
import { confirmPrivateTrail, privateMutation } from './jive-private-session.js';

type PrivateObservation = { readonly server: string; readonly user: string; readonly since: number };

type PrivateQuestSession = {
    readonly cheat: (command: string) => Promise<boolean>;
    readonly relog: () => Promise<void>;
    readonly waitForQuest: (status: 'complete' | 'notStarted' | 'inProgress', quest?: string) => Promise<void>;
};

export async function seedPrivateQuest(scenario: PrivateScenario, session: PrivateQuestSession) {
    const f = privateScenario(scenario);
    for (const command of [`setvar zanaris ${f.lostCity ? 6 : 0}`, `setvar trail_status ${f.trailStatus}`]) assert(await session.cheat(command));
    if (scenario === 'guardian') {
        for (const command of ['setvar priestperil 61', 'setvar druidspirit 5']) assert(await session.cheat(command));
    }
    await session.relog();
    await session.waitForQuest(f.lostCity ? 'complete' : 'notStarted');
    if (scenario === 'guardian') {
        await session.waitForQuest('complete', 'Priest in Peril');
        await session.waitForQuest('inProgress', 'Nature Spirit');
    }
}

export async function seedPrivateClue(page: Page, scenario: PrivateScenario, account: Omit<PrivateObservation, 'since'>) {
    const f = privateScenario(scenario);
    for (const command of ['~clearinv inv', '~clearinv worn', '~clearbank']) assert(await cheatQuiet(page, command));
    for (const [skill, level] of Object.entries(f.levels)) assert(await cheatQuiet(page, `setstat ${skill} ${level}`));
    await clearChatDialogs(page, 'private clue levels');
    const since = Date.now();
    await seedPrivateQuest(scenario, {
        cheat: command => privateMutation(account.server, account.user, () => cheatQuiet(page, command)),
        relog: () => privateMutation(account.server, account.user, () => relog(page, account.user)),
        waitForQuest: (status, quest = 'Lost City') => privateMutation(account.server, account.user, async () => {
            await page.waitForFunction(({ expected, quest }) => {
                function ready(value: unknown): value is PrivateRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
                const g = globalThis;
                return ready(g) && g.__rs2b0t.Quests.status(quest) === expected;
            }, { expected: status, quest }, { timeout: 10000 });
            console.log('private quest ready', { quest, status });
        }),
    });
    const stock = f.casketOnly ? [['3dose2attack', 7]] as const : [['coins', 10000], ['airrune', 300], ['waterrune', 300], ['earthrune', 300], ['firerune', 300], ['lawrune', 100]] as const;
    for (const [name, count] of stock) assert(await cheatQuiet(page, `~bankitem ${name} ${count}`));
    {
        for (const name of ['magic_shortbow', 'rune_arrow']) assert(await cheatQuiet(page, `give ${name} ${name === 'rune_arrow' ? 500 : 1}`));
        await page.evaluate(async () => {
            function ready(value: unknown): value is PrivateRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
            const g = globalThis;
            if (!ready(g)) throw new Error('fixture ABI absent');
            if (!(await g.__rs2b0t.Equipment.equip('Magic shortbow')) || !(await g.__rs2b0t.Equipment.equip('Rune arrow'))) throw new Error('ranged fixture equip refused');
        });
    }
    const items: readonly (readonly [string, number])[] = f.casketOnly ? [[`${f.clue}_casket`, 1], ['shark', f.sharks]] : [
        [f.clue, 1], ['spade', 1], ['trail_watch', 1], ['trail_chart', 1], ['trail_sextant', 1], ['shark', f.sharks],
        ...(f.dds ? [['dragon_dagger_p', 1] as const] : []), ...(f.superanti ? [['4dose2antipoison', 1] as const] : [])];
    for (const [name, count] of items) assert(await cheatQuiet(page, `give ${name} ${count}`));
    await clearChatDialogs(page, 'private clue fixture');
    assert(await teleTo(page, f.bank, 0, 30000));
    await page.evaluate(() => {
        function ready(value: unknown): value is PrivateRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value && 'rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('bank fixture ABI absent');
        const a: PrivateRuntime['__rs2b0t'] = g.__rs2b0t;
        class ConfirmBank extends a.LoopingBot {
            private ran = false;
            override async loop() {
                if (this.ran) return 1000;
                this.ran = true;
                if (!(await a.Bank.openNearest('Bank booth', 'Use-quickly')) || !(await a.Bank.waitReady())) {
                    globalThis.__jiveBank = { items: [], error: 'bank unconfirmed' };
                    return 1000;
                }
                const items = a.Bank.items().map(i => ({ id: i.id, count: i.count }));
                const closed = await a.Bank.close();
                globalThis.__jiveBank = { items, error: closed ? null : 'bank close refused' };
                return 1000;
            }
        }
        a.registerScript({ name: 'PrivateClueBankCheck', create: () => new ConfirmBank() });
        g.rs2b0t.runner.start(g.rs2b0t.registry.get('PrivateClueBankCheck'));
    });
    await page.waitForFunction(() => globalThis.__jiveBank !== undefined, undefined, { timeout: 30000 });
    const actual = await page.evaluate(() => {
        function ready(value: unknown): value is PrivateRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value && 'rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('fixture ABI absent');
        g.rs2b0t.runner.stop('fixture verified');
        const a: PrivateRuntime['__rs2b0t'] = g.__rs2b0t;
        return { inventory: a.Inventory.items().map(i => ({ id: i.id, count: i.count })), bank: globalThis.__jiveBank,
            worn: a.Equipment.items().map(i => ({ id: i.id, count: i.count })), trailStatus: g.rs2b0t.reader.varp(292),
            levels: { attack: a.Skills.level('attack'), strength: a.Skills.level('strength'), defence: a.Skills.level('defence'),
                hitpoints: a.Skills.level('hitpoints'), prayer: a.Skills.level('prayer') }, hp: a.Skills.effective('hitpoints'),
            lostCity: a.Quests.status('Lost City') === 'complete' };
    });
    await verifyPrivateClue(actual, scenario, { ...account, since });
    return actual;
}

export async function verifyPrivateClue(actual: Awaited<ReturnType<typeof seedPrivateClue>>, scenario: PrivateScenario, observation: PrivateObservation): Promise<void> {
    const f = privateScenario(scenario);
    assert.equal(actual.bank?.error, null);
    await confirmPrivateTrail(observation.server, { user: observation.user, since: observation.since, trailStatus: f.trailStatus });
    assert.equal(actual.lostCity, f.lostCity);
    assert.equal(actual.hp, 77);
    for (const skill of ['attack', 'strength', 'defence', 'hitpoints', 'prayer'] as const) assert.equal(actual.levels[skill], f.levels[skill]);
    const all = [...actual.inventory, ...(actual.bank?.items ?? []), ...actual.worn];
    assert.equal(all.filter(i => i.id === 385).reduce((n, i) => n + i.count, 0), f.sharks);
    assert.equal(all.some(i => [1215, 1231].includes(i.id)), f.dds);
    assert.equal(all.some(i => [2448, 181, 183, 185].includes(i.id)), f.superanti);
    assert(actual.inventory.some(i => i.id === (f.casketOnly ? f.casketId : f.clueId)));
    if (f.casketOnly) {
        assert.equal(actual.inventory.reduce((n, i) => n + i.count, 0), 28);
        assert.equal(actual.bank?.items.find(i => i.id === 145)?.count, 7);
    } else assert(actual.worn.some(i => i.id === 861));
}
