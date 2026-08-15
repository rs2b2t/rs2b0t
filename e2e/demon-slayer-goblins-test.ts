/** Chrome + local LostCity proof for #188: [base] [minutes] [--expect-wizards].
 *  The fixture starts at the Wizards' Tower with the two non-Traiborn keys; fixed code leaves the Wizards and takes a guaranteed Bones drop from the level-2 Goblins west of Lumbridge. */

//   bun e2e/demon-slayer-goblins-test.ts http://127.0.0.1:8990 6
//   bun e2e/demon-slayer-goblins-test.ts http://127.0.0.1:8990 6 --expect-wizards
import { createHash } from 'node:crypto';
import { chromium, type Page } from 'playwright-core';

import { startFromLibrary } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog } from './tutorial/harness.js';

const args = process.argv.slice(2);
const expectWizards = args.includes('--expect-wizards');
const positional = args.filter(arg => arg !== '--expect-wizards');
const base = positional[0] ?? 'http://127.0.0.1:8990';
const budgetMinutes = positional[1] === undefined ? 6 : Number(positional[1]);
const budgetMs = budgetMinutes * 60_000;

const SERVER_TICK_MS = 300;
const DEMON_STAGE = 2;
const DEMON_VAR = 'demonstart';
const START_TILE = { x: 3107, z: 3159, level: 0 } as const;
const START_TELE = '0,48,49,35,23';
const GOBLIN_ANCHOR = { x: 3144, z: 3231, level: 0 } as const;
const GOBLIN_RADIUS = 20;

const ITEM = {
    coins: { id: 995, debug: 'coins', qty: 50_000 },
    rovinKey: { id: 2400, debug: 'silverlight_key_2', qty: 1 },
    drainKey: { id: 2401, debug: 'silverlight_key_3', qty: 1 },
    traibornKey: { id: 2399, debug: 'silverlight_key_1', qty: 1 },
    bones: { id: 526, debug: 'bones', qty: 1 }
} as const;

const NPC = {
    wizard: 13,
    goblin: 100,
    armedGoblin: 101
} as const;

const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'prayer', 'magic'] as const;

const fixedScreenshot = 'screenshots/demon-slayer-goblins-e2e.png';
const fixedProof = 'out/demon-slayer-goblins-proof.json';
const baselineScreenshot = 'out/demon-slayer-wizards-baseline.png';
const baselineProof = 'out/demon-slayer-wizards-baseline-proof.json';

type Tile = { x: number; z: number; level: number };
type ItemView = { id: number; name: string | null; count: number };
type LogLine = { time: number; level: string; msg: string };
type NpcView = {
    index: number;
    id: number;
    name: string | null;
    level: number;
    tile: Tile;
    distance: number;
    inCombat: boolean;
    health: number;
    totalHealth: number;
    faceEntity: number;
};
type GroundItemView = { id: number; name: string | null; count: number; tile: Tile; distance: number };
type AttackEvent = { at: number; id: number; name: string | null; index: number; tile: Tile; action: string };
type TargetEvent = { at: number; id: number; name: string | null; index: number; tile: Tile; health: number; totalHealth: number };
type DeathEvent = { at: number; id: number; name: string | null; index: number; tile: Tile };
type GroundEvent = { at: number; id: number; name: string | null; count: number; tile: Tile };

interface NpcHandle {
    readonly id: number;
    readonly name: string | null;
    readonly index: number;
    tile(): Tile;
}

interface AttackProbe {
    attacks: AttackEvent[];
}

interface BrowserGlobal {
    __rs2b0t: {
        Bank: {
            isOpen(): boolean;
            items(): ItemView[];
        };
        Equipment: { items(): ItemView[] };
        Inventory: { items(): ItemView[] };
        Npc: {
            prototype: {
                interact(this: NpcHandle, action: string): boolean | Promise<boolean>;
            };
        };
        Quests: { status(name: string): string };
        Skills: {
            level(name: string): number;
            effective(name: string): number;
        };
        reader: {
            chat(count: number): { text: string }[];
            groundItems(): GroundItemView[];
            inCombat(): boolean;
            npcs(): NpcView[];
            selfSlot(): number;
            worldTile(): Tile | null;
        };
    };
    rs2b0t: {
        client: {
            tutComMessage: string | null;
            out: { p1Enc(opcode: number): void };
        };
        paint: { set(key: string, value: string): void };
        runner: {
            state: string;
            bot: { stepDesc?: string } | null;
            ctx: { log: LogLine[] } | null;
            stop(reason: string): void;
        };
    };
    __demonSlayerAttackProbe?: AttackProbe;
}

interface Snapshot {
    at: number;
    tile: Tile | null;
    inventory: ItemView[];
    worn: ItemView[];
    levels: Record<string, number>;
    effective: Record<string, number>;
    quest: string;
    inCombat: boolean;
    selfSlot: number;
    npcs: NpcView[];
    groundItems: GroundItemView[];
    attacks: AttackEvent[];
    runner: string;
    step: string | null;
    logs: LogLine[];
}

interface RunObservations {
    path: Tile[];
    attacks: AttackEvent[];
    targets: TargetEvent[];
    deaths: DeathEvent[];
    groundBones: GroundEvent[];
    questLogs: string[];
    reachedGoblinFarm: boolean;
    sawNaturalGoblin: boolean;
    sawNaturalWizard: boolean;
    minimumEffectiveHp: number;
}

function fail(message: string): never {
    throw new Error(`FAIL: ${message}`);
}

function assertArguments(): void {
    if (positional.length > 2) fail(`unexpected arguments: ${positional.slice(2).join(' ')}`);
    if (!Number.isFinite(budgetMinutes) || budgetMinutes <= 0) fail(`invalid budget '${positional[1] ?? ''}'`);
    const url = new URL(base);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
        fail(`refusing non-loopback server ${url.origin}`);
    }
    if (url.port === '8081') {
        fail("refusing port 8081: that is reserved for the user's live multibox session");
    }
}

async function attestServedBundle(): Promise<string> {
    const local = Bun.file('out/botclient.js');
    if (!(await local.exists())) fail('out/botclient.js is missing; build this worktree before running the harness');
    const response = await fetch(new URL('/bot/botclient.js', base));
    if (!response.ok) fail(`served bot bundle returned HTTP ${response.status}`);
    const hash = (data: ArrayBuffer | Uint8Array): string => createHash('sha256').update(new Uint8Array(data)).digest('hex');
    const localHash = hash(await local.arrayBuffer());
    const servedHash = hash(await response.arrayBuffer());
    if (servedHash !== localHash) fail(`served bundle ${servedHash} != worktree bundle ${localHash}`);
    console.log(`BUNDLE ATTESTATION PASS: sha256=${localHash}`);
    return localHash;
}

async function command(page: Page, value: string, waitMs = 700): Promise<void> {
    if (!(await cheatQuiet(page, value))) fail(`could not send ::${value}`);
    if (waitMs > 700) await page.waitForTimeout(waitMs - 700);
}

async function dismissDebugOverlay(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
        if (message === null) return;
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(300);
    }
    const message = await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.tutComMessage);
    if (message !== null) fail(`could not dismiss debug overlay '${message}'`);
}

async function enforceDoubleTickRate(page: Page): Promise<void> {
    await command(page, `speed ${SERVER_TICK_MS}`);
    const confirmed = await page.evaluate(expected => {
        const { reader } = (globalThis as never as BrowserGlobal).__rs2b0t;
        return reader.chat(8).some(line => line.text.includes(`World speed was changed to ${expected}ms`));
    }, SERVER_TICK_MS);
    if (!confirmed) fail(`server did not confirm the ${SERVER_TICK_MS}ms tick rate`);
}

function countId(items: readonly ItemView[], id: number): number {
    return items.filter(item => item.id === id).reduce((sum, item) => sum + item.count, 0);
}

function tileEquals(actual: Tile | null, expected: Tile): boolean {
    return actual !== null && actual.x === expected.x && actual.z === expected.z && actual.level === expected.level;
}

function within(tile: Tile | null, anchor: Tile, radius: number): boolean {
    return tile !== null && tile.level === anchor.level && Math.max(Math.abs(tile.x - anchor.x), Math.abs(tile.z - anchor.z)) <= radius;
}

function questLogs(logs: readonly LogLine[]): string[] {
    return logs.map(line => line.msg).filter(message => message.startsWith('Demon Slayer:'));
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(skillNames => {
        const g = globalThis as never as BrowserGlobal;
        const api = g.__rs2b0t;
        return {
            at: Date.now(),
            tile: api.reader.worldTile(),
            inventory: api.Inventory.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            worn: api.Equipment.items().map(item => ({ id: item.id, name: item.name, count: item.count })),
            levels: Object.fromEntries(skillNames.map(name => [name, api.Skills.level(name)])),
            effective: Object.fromEntries(skillNames.map(name => [name, api.Skills.effective(name)])),
            quest: api.Quests.status('Demon Slayer'),
            inCombat: api.reader.inCombat(),
            selfSlot: api.reader.selfSlot(),
            npcs: api.reader.npcs(),
            groundItems: api.reader.groundItems(),
            attacks: [...(g.__demonSlayerAttackProbe?.attacks ?? [])],
            runner: g.rs2b0t.runner.state,
            step: g.rs2b0t.runner.bot?.stepDesc ?? null,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-800)
        };
    }, COMBAT_SKILLS);
}

async function assertEmptyBank(page: Page): Promise<void> {
    await command(page, '~bank');
    await page.waitForFunction(() => (globalThis as never as BrowserGlobal).__rs2b0t.Bank.isOpen(), undefined, { timeout: 5000 });
    await page.waitForTimeout(SERVER_TICK_MS * 2);
    const bank = await page.evaluate(() => (globalThis as never as BrowserGlobal).__rs2b0t.Bank.items().map(item => ({ id: item.id, name: item.name, count: item.count })));
    if (bank.length !== 0) fail(`bank clear did not stick: ${JSON.stringify(bank)}`);
    await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.client.out.p1Enc(51));
    await page.waitForFunction(() => !(globalThis as never as BrowserGlobal).__rs2b0t.Bank.isOpen(), undefined, { timeout: 5000 });
}

async function installAttackProbe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        const prototype = g.__rs2b0t.Npc.prototype;
        const original = prototype.interact;
        g.__demonSlayerAttackProbe = { attacks: [] };
        prototype.interact = function (this: NpcHandle, action: string): boolean | Promise<boolean> {
            if (action.toLowerCase() === 'attack') {
                g.__demonSlayerAttackProbe!.attacks.push({
                    at: Date.now(),
                    id: this.id,
                    name: this.name,
                    index: this.index,
                    tile: this.tile(),
                    action
                });
            }
            return original.call(this, action);
        };
    });
}

async function createFixture(page: Page, username: string): Promise<Snapshot> {
    await mainlandAccount(page, base, username);
    await command(page, '~clearinv inv');
    await command(page, '~clearinv worn');
    await command(page, '~clearbank');
    await assertEmptyBank(page);
    await command(page, 'setvar tutorial 1000');
    await command(page, `setvar ${DEMON_VAR} ${DEMON_STAGE}`);
    for (const skill of COMBAT_SKILLS) await command(page, `setstat ${skill} 20`);
    await command(page, `give ${ITEM.rovinKey.debug} ${ITEM.rovinKey.qty}`);
    await command(page, `give ${ITEM.drainKey.debug} ${ITEM.drainKey.qty}`);
    await command(page, `give ${ITEM.coins.debug} ${ITEM.coins.qty}`);
    await command(page, `tele ${START_TELE}`, 1400);
    await relog(page, username);
    await dismissDebugOverlay(page);
    await enforceDoubleTickRate(page);
    await page.waitForTimeout(1200);

    const tutorial = await getServerVarQuiet(page, 'tutorial');
    await dismissDebugOverlay(page);
    const demonStage = await getServerVarQuiet(page, DEMON_VAR);
    await dismissDebugOverlay(page);
    if (tutorial !== 1000 || demonStage !== DEMON_STAGE) {
        fail(`bad server fixture: tutorial=${tutorial}, ${DEMON_VAR}=${demonStage}`);
    }

    const initial = await snapshot(page);
    if (!tileEquals(initial.tile, START_TILE)) fail(`start tile is ${JSON.stringify(initial.tile)}, expected ${JSON.stringify(START_TILE)}`);
    if (initial.inCombat) fail('fixture starts in combat');
    if (initial.quest !== 'inProgress') fail(`Demon Slayer status is '${initial.quest}', expected inProgress`);
    if (initial.worn.length !== 0) fail(`worn inventory is not empty: ${JSON.stringify(initial.worn)}`);
    const expectedInventory = new Map<number, number>([
        [ITEM.coins.id, ITEM.coins.qty],
        [ITEM.rovinKey.id, ITEM.rovinKey.qty],
        [ITEM.drainKey.id, ITEM.drainKey.qty]
    ]);
    if (initial.inventory.length !== expectedInventory.size) fail(`fixture has extra inventory stacks: ${JSON.stringify(initial.inventory)}`);
    for (const [id, qty] of expectedInventory) {
        if (countId(initial.inventory, id) !== qty) fail(`fixture item ${id} count is ${countId(initial.inventory, id)}, expected ${qty}`);
    }
    if (countId(initial.inventory, ITEM.traibornKey.id) !== 0 || countId(initial.inventory, ITEM.bones.id) !== 0) {
        fail(`fixture already has Traiborn's key or Bones: ${JSON.stringify(initial.inventory)}`);
    }
    for (const skill of COMBAT_SKILLS) {
        if (initial.levels[skill] !== 20 || initial.effective[skill] !== 20) {
            fail(`${skill} is ${initial.levels[skill]}/${initial.effective[skill]}, expected 20/20`);
        }
    }
    if (!initial.npcs.some(npc => npc.id === NPC.wizard)) {
        fail(`natural Wizard ID ${NPC.wizard} is absent from the start scene: ${JSON.stringify(initial.npcs)}`);
    }
    return initial;
}

async function startAioQuester(page: Page): Promise<string> {
    await page.evaluate(() => {
        const g = globalThis as never as BrowserGlobal;
        sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'demon');
        sessionStorage.setItem('rs2b0t:set:AIOQuester:food', '');
        g.rs2b0t.paint.set('tabs:aio', 'Current');
    });
    await installAttackProbe(page);
    await startFromLibrary(page, 'Quest', 'AIOQuester');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const state = await snapshot(page);
        const first = questLogs(state.logs)[0];
        if (first) return first.slice('Demon Slayer: '.length);
        if (state.runner === 'crashed' || state.runner === 'stopped') {
            fail(`AIOQuester ${state.runner} before first Demon Slayer step: ${JSON.stringify(state.logs.slice(-30))}`);
        }
        await page.waitForTimeout(100);
    }
    fail('AIOQuester did not publish a Demon Slayer step within 30 seconds');
}

async function observeUntilBone(page: Page): Promise<{ final: Snapshot; observations: RunObservations }> {
    const deadline = Date.now() + budgetMs;
    const path: Tile[] = [];
    const targets: TargetEvent[] = [];
    const deaths: DeathEvent[] = [];
    const groundBones: GroundEvent[] = [];
    const seenTargets = new Map<number, TargetEvent>();
    const seenDeaths = new Set<number>();
    const seenGround = new Set<string>();
    const seenLogs = new Set<string>();
    const collectedLogs: string[] = [];
    let reachedGoblinFarm = false;
    let sawNaturalGoblin = false;
    let sawNaturalWizard = false;
    let minimumEffectiveHp = Number.POSITIVE_INFINITY;
    let lastStep = '';

    while (Date.now() < deadline) {
        const state = await snapshot(page);
        const tile = state.tile;
        const previousTile = path[path.length - 1];
        if (tile && (!previousTile || !tileEquals(tile, previousTile))) path.push(tile);
        reachedGoblinFarm ||= within(tile, GOBLIN_ANCHOR, GOBLIN_RADIUS);
        sawNaturalGoblin ||= state.npcs.some(npc => npc.id === NPC.goblin);
        sawNaturalWizard ||= state.npcs.some(npc => npc.id === NPC.wizard);
        minimumEffectiveHp = Math.min(minimumEffectiveHp, state.effective.hitpoints ?? 0);

        if (state.step && state.step !== lastStep) {
            console.log(`step: ${state.step}; tile=${JSON.stringify(state.tile)}; HP=${state.effective.hitpoints}/${state.levels.hitpoints}`);
            lastStep = state.step;
        }
        for (const line of questLogs(state.logs)) {
            if (!seenLogs.has(line)) {
                seenLogs.add(line);
                collectedLogs.push(line);
                console.log(line);
            }
        }

        const me = 32768 + state.selfSlot;
        for (const npc of state.npcs.filter(candidate => candidate.faceEntity === me && candidate.inCombat)) {
            if (!seenTargets.has(npc.index)) {
                const target = { at: state.at, id: npc.id, name: npc.name, index: npc.index, tile: npc.tile, health: npc.health, totalHealth: npc.totalHealth };
                seenTargets.set(npc.index, target);
                targets.push(target);
            }
        }
        const currentNpcIndices = new Set(state.npcs.map(npc => npc.index));
        for (const target of seenTargets.values()) {
            if (!currentNpcIndices.has(target.index) && !seenDeaths.has(target.index)) {
                seenDeaths.add(target.index);
                deaths.push({ at: state.at, id: target.id, name: target.name, index: target.index, tile: target.tile });
            }
        }
        for (const item of state.groundItems.filter(candidate => candidate.id === ITEM.bones.id)) {
            const key = `${item.id}|${item.tile.x}|${item.tile.z}|${item.tile.level}`;
            if (!seenGround.has(key)) {
                seenGround.add(key);
                groundBones.push({ at: state.at, id: item.id, name: item.name, count: item.count, tile: item.tile });
            }
        }

        if (countId(state.inventory, ITEM.bones.id) >= 1) {
            return {
                final: state,
                observations: {
                    path,
                    attacks: state.attacks,
                    targets,
                    deaths,
                    groundBones,
                    questLogs: collectedLogs,
                    reachedGoblinFarm,
                    sawNaturalGoblin,
                    sawNaturalWizard,
                    minimumEffectiveHp
                }
            };
        }
        if (state.effective.hitpoints <= 0 || state.logs.some(line => /oh dear.*you are dead|died during Demon Slayer/i.test(line.msg))) {
            fail(`player died: ${JSON.stringify(state)}`);
        }
        if (state.runner === 'crashed' || state.runner === 'stopped') {
            fail(`AIOQuester ${state.runner} before obtaining Bones: ${JSON.stringify(state.logs.slice(-40))}`);
        }
        await page.waitForTimeout(75);
    }
    fail(`did not obtain exact Bones ID ${ITEM.bones.id} within ${budgetMinutes} minutes: ${JSON.stringify(await snapshot(page))}`);
}

function verifyProof(initial: Snapshot, final: Snapshot, observations: RunObservations): void {
    const expectedNpc = expectWizards ? NPC.wizard : NPC.goblin;
    const forbiddenNpc = expectWizards ? NPC.goblin : NPC.wizard;
    if (!observations.attacks.some(event => event.id === expectedNpc)) {
        fail(`never dispatched Attack to expected NPC ID ${expectedNpc}: ${JSON.stringify(observations.attacks)}`);
    }
    if (observations.attacks.some(event => event.id === forbiddenNpc)) {
        fail(`dispatched Attack to forbidden NPC ID ${forbiddenNpc}: ${JSON.stringify(observations.attacks)}`);
    }
    if (!observations.targets.some(event => event.id === expectedNpc)) {
        fail(`expected NPC ID ${expectedNpc} never targeted the player: ${JSON.stringify(observations.targets)}`);
    }
    if (!observations.deaths.some(event => event.id === expectedNpc)) {
        fail(`expected NPC ID ${expectedNpc} never disappeared after combat: ${JSON.stringify(observations.deaths)}`);
    }
    if (!observations.groundBones.some(event => event.id === ITEM.bones.id)) {
        fail(`never observed natural ground Bones ID ${ITEM.bones.id}: ${JSON.stringify(observations.groundBones)}`);
    }
    if (countId(final.inventory, ITEM.bones.id) < 1) fail(`final inventory lacks exact Bones ID ${ITEM.bones.id}`);
    if (observations.minimumEffectiveHp <= 0 || final.effective.hitpoints <= 0) {
        fail(`player did not survive: minimum HP=${observations.minimumEffectiveHp}, final=${final.effective.hitpoints}`);
    }
    if (!observations.questLogs.includes('Demon Slayer: key hunt')) {
        fail(`real AIOQuester never entered key hunt: ${JSON.stringify(observations.questLogs)}`);
    }
    if (!expectWizards) {
        if (!observations.reachedGoblinFarm || !observations.sawNaturalGoblin) {
            fail(`fixed run never reached the natural west-Lumbridge Goblins: ${JSON.stringify(observations.path)}`);
        }
        if (initial.npcs.some(npc => npc.id === NPC.goblin) || observations.attacks.some(event => event.id === NPC.armedGoblin)) {
            fail('Goblin proof was polluted by an initial/stronger Goblin fixture');
        }
    }
}

async function stopRunner(page: Page): Promise<void> {
    await page.evaluate(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.stop('harness stop'));
    await page.waitForFunction(() => (globalThis as never as BrowserGlobal).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10_000 });
}

assertArguments();
const bundleSha256 = await attestServedBundle();
const username = `d188${expectWizards ? 'w' : 'g'}${Date.now().toString(36).slice(-5)}`;
const screenshotPath = expectWizards ? baselineScreenshot : fixedScreenshot;
const proofPath = expectWizards ? baselineProof : fixedProof;
const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.env.HEADED,
    slowMo: process.env.HEADED ? Number(process.env.SLOWMO ?? 100) : 0,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});

try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', error => console.error(`[${username}] PAGEERROR: ${error}`));
    page.on('requestfailed', request => console.error(`[${username}] REQUEST FAILED: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`));
    const initial = await createFixture(page, username);
    const startedAt = Date.now();
    const firstStep = await startAioQuester(page);
    if (firstStep !== 'key hunt') fail(`first Demon Slayer step was '${firstStep}', expected 'key hunt'`);
    const { final, observations } = await observeUntilBone(page);
    verifyProof(initial, final, observations);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await stopRunner(page);
    const stopped = await snapshot(page);
    const stage = await getServerVarQuiet(page, DEMON_VAR);
    await dismissDebugOverlay(page);
    if (stage !== DEMON_STAGE) fail(`${DEMON_VAR} changed unexpectedly to ${stage}`);

    await Bun.write(
        proofPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                result: 'PASS',
                mode: expectWizards ? 'clean-upstream-wizard-baseline' : 'fixed-west-lumbridge-goblins',
                base,
                username,
                elapsedMs: Date.now() - startedAt,
                tickMs: SERVER_TICK_MS,
                tickRateCommandConfirmed: true,
                bundleSha256,
                fixture: {
                    tutorial: 1000,
                    demonStage: DEMON_STAGE,
                    startTile: START_TILE,
                    inventory: initial.inventory,
                    worn: initial.worn,
                    levels: initial.levels,
                    effective: initial.effective,
                    naturalStartNpcs: initial.npcs.map(npc => ({ id: npc.id, name: npc.name, level: npc.level, tile: npc.tile }))
                },
                firstStep,
                observations,
                finalBeforeStop: final,
                finalAfterStop: stopped
            },
            null,
            2
        ) + '\n'
    );
    console.log(`${expectWizards ? 'BASELINE' : 'FIXED'} PASS: exact NPC ${expectWizards ? NPC.wizard : NPC.goblin} → exact Bones ${ITEM.bones.id}; min HP=${observations.minimumEffectiveHp}`);
    console.log(`proof=${proofPath}`);
    console.log(`screenshot=${screenshotPath}`);
    await page.close();
} finally {
    await browser.close();
}
