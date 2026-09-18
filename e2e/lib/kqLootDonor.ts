import type { Page } from 'playwright-core';
import type { Game } from '../../src/bot/api/game/Game.js';
import type { Inventory } from '../../src/bot/api/inventory/Inventory.js';
import type { Skills } from '../../src/bot/api/skills/Skills.js';
import type { reader } from '../../src/bot/adapter/ClientAdapter.js';
import type { KqItem, KqTile } from './kqEvidence.js';
import { LOOT_FIXTURE } from './kqLootEvidence.js';
import { logout } from './harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, teleTo } from '../tutorial/harness.js';

type DonorApi = { Game: typeof Game; Inventory: typeof Inventory; Skills: typeof Skills; reader: typeof reader };
type DonorWindow = typeof globalThis & {
    __rs2b0t: DonorApi;
    rs2b0t: { client: { ingame: boolean }; actions: { ifButton(id: number): boolean } };
};
const safe = (tile: KqTile | null) => tile?.level === 0 && Math.max(Math.abs(tile.x - 3308), Math.abs(tile.z - 3120)) <= 3;
interface DonorSample { at: number; ingame: boolean | null; sceneReady: boolean; hp: number; inCombat: boolean; tick: number; tile: KqTile | null; inventory: KqItem[]; ground: (KqItem & { tile: KqTile })[]; chat: string[] }

export class KqLootDonor {
    readonly proof: {
        account: string; technique: string; observations: DonorSample[];
        drops: { id: number; count: number; tile: KqTile; at: number; tick: number; inventoryBefore: number; inventoryAfter: number; groundCount: number }[];
        commands: { at: number; command: string }[]; droppedAt?: number; loggedOutAt?: number; failures: string[];
        forcedDisconnect?: { at: number; lastObservation: DonorSample | null };
    };
    private closing: Promise<void> | null = null;
    constructor(private readonly page: Page, account: string) {
        this.proof = { account, technique: 'Separate donor grants, normal inventory Drop, normal 100-tick private-to-public reveal; donor-only teleports', observations: [], drops: [], commands: [], failures: [] };
    }

    private async sample(): Promise<DonorSample> {
        const s = await this.page.evaluate(() => {
            const g = globalThis as DonorWindow;
            if (!g.rs2b0t?.client) return { at: Date.now(), ingame: null, sceneReady: false, hp: -1, inCombat: false, tick: -1, tile: null, inventory: [], ground: [], chat: [] };
            const a: DonorApi = g.__rs2b0t;
            const { Game, Inventory, Skills, reader } = a;
            return { at: Date.now(), ingame: Game.ingame(), sceneReady: Game.sceneReady(), hp: Skills.effective('hitpoints'), inCombat: Game.inCombat(), tick: Game.tick(), tile: reader.serverTile(),
                inventory: Inventory.items().map(i => ({ id: i.id, count: i.count })), ground: reader.groundItems().map(g => ({ id: g.id, count: g.count, tile: g.tile })), chat: reader.chat(8).map(c => c.text) };
        });
        this.proof.observations.push(s);
        if (s.ingame && s.sceneReady && s.hp <= 0 || s.chat.some(line => /oh dear,? you are dead/i.test(line))) {
            if (!this.proof.failures.includes('Donor died')) this.proof.failures.push('Donor died');
        }
        return s;
    }

    private async command(command: string) {
        this.proof.commands.push({ at: Date.now(), command });
        if (!(await cheatQuiet(this.page, command))) throw new Error(`Donor command rejected: ${command}`);
    }

    async prepare(base: string, clientPage: string): Promise<void> {
        await mainlandAccount(this.page, base, this.proof.account, clientPage);
        for (const skill of ['hitpoints', 'defence', 'prayer']) await this.command(`setstat ${skill} 99`);
        await clearChatDialogs(this.page);
        for (const item of LOOT_FIXTURE) await this.command(`give ${item.debugName} ${item.count}`);
        await this.page.waitForFunction(items => {
            const a: DonorApi = (globalThis as DonorWindow).__rs2b0t;
            const { Inventory, Skills } = a;
            return Skills.effective('hitpoints') === 99 && items.every(i => Inventory.countById(i.id) === i.count);
        }, [...LOOT_FIXTURE], { timeout: 10_000 });
        if (!(await teleTo(this.page, { x: 3308, z: 3120, level: 0 }, 3))) throw new Error('Donor could not prepare at Shantay');
        await this.sample();
    }

    async drop(tile: KqTile): Promise<void> {
        try {
            await this.page.evaluate(() => { const g = globalThis as DonorWindow; if (g.__rs2b0t.reader.varp(95) !== 1) g.rs2b0t.actions.ifButton(5621); });
            await this.page.waitForFunction(() => (globalThis as DonorWindow).__rs2b0t.reader.varp(95) === 1, undefined, { timeout: 10_000 });
            this.proof.commands.push({ at: Date.now(), command: `fixture teleport to ${tile.x},${tile.z},${tile.level}` });
            if (!(await teleTo(this.page, tile, 0, 5000))) throw new Error('Donor did not reach the fixture tile');
            const before = await this.sample();
            if (before.tile?.x !== tile.x || before.tile.z !== tile.z || before.tile.level !== tile.level) throw new Error('Donor server position differs from the fixture tile');
            if (before.ground.some(g => g.tile.x === tile.x && g.tile.z === tile.z && LOOT_FIXTURE.some(i => i.id === g.id))) throw new Error('Donor tile already contains a fixture item');
            const sent = await this.page.evaluate(async items => {
                const a: DonorApi = (globalThis as DonorWindow).__rs2b0t;
                const { Inventory } = a;
                return Promise.all(items.map(item => Inventory.items().find(i => i.id === item.id)?.interact('Drop') ?? false));
            }, [...LOOT_FIXTURE]);
            if (!sent.every(Boolean)) throw new Error('A donor Drop input was rejected');
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
                const s = await this.sample();
                if (this.proof.failures.length) throw new Error(this.proof.failures.join('; '));
                for (const item of LOOT_FIXTURE) {
                    if (this.proof.drops.some(d => d.id === item.id)) continue;
                    const inventoryBefore = before.inventory.filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
                    const inventoryAfter = s.inventory.filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
                    const groundCount = s.ground.filter(g => g.id === item.id && g.tile.x === tile.x && g.tile.z === tile.z && g.tile.level === tile.level).reduce((n, g) => n + g.count, 0);
                    if (inventoryBefore - inventoryAfter === item.count && groundCount >= item.count) this.proof.drops.push({ id: item.id, count: item.count, tile, at: s.at, tick: s.tick, inventoryBefore, inventoryAfter, groundCount });
                }
                if (this.proof.drops.length === LOOT_FIXTURE.length) { this.proof.droppedAt = s.at; return; }
                await this.page.waitForTimeout(200);
            }
            throw new Error('Donor drops lacked inventory-to-ground confirmation');
        } finally { await this.close(); }
    }

    close(): Promise<void> {
        this.closing ??= this.exit();
        return this.closing;
    }

    private async exit(): Promise<void> {
        let lastTeleport = 0;
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
            const s = await this.sample();
            if (s.ingame === false) { this.proof.loggedOutAt = s.at; return; }
            if (s.ingame === true && safe(s.tile)) {
                if (!s.inCombat) await logout(this.page, 1500);
            } else if (s.ingame === true && Date.now() - lastTeleport >= 2000) {
                lastTeleport = Date.now();
                this.proof.commands.push({ at: lastTeleport, command: 'fixture donor exit teleport to Shantay' });
                await teleTo(this.page, { x: 3308, z: 3120, level: 0 }, 3, 1500);
            }
            await this.page.waitForTimeout(200);
        }
        this.proof.failures.push('Donor logout was not verified within 60 seconds');
        throw new Error(this.proof.failures.at(-1));
    }
}
