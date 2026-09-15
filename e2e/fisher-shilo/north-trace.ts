import type { Page } from 'playwright-core';
import type { Game } from '../../src/bot/api/game/Game.js';
import type { Npc } from '../../src/bot/api/model/Npc.js';
import type { Npcs } from '../../src/bot/api/npcs/Npcs.js';
import type { Inventory } from '../../src/bot/api/inventory/Inventory.js';
import type { Bank } from '../../src/bot/api/bank/Bank.js';
import type { Skills } from '../../src/bot/api/skills/Skills.js';
import type { NorthSample } from './north-contract.js';
import './trace.js';

type Selection = { readonly tick: number; readonly id: number; readonly index: number; readonly x: number; readonly z: number; readonly action: string };
declare global {
    interface Window {
        __rs2b0t: { Game: typeof Game; Npc: typeof Npc; Npcs: typeof Npcs; Inventory: typeof Inventory; Bank: typeof Bank; Skills: typeof Skills };
    }
    var __northTrace: { samples: NorthSample[]; selections: Selection[]; restore(): void } | undefined;
}

export async function installNorthTrace(page: Page): Promise<void> {
    await page.evaluate(() => {
        const api = window.__rs2b0t;
        const host = globalThis.rs2b0t.host;
        const samples: NorthSample[] = [];
        const selections: Selection[] = [];
        let bankFish = 0;
        const capture = () => {
            const tile = api.Game.tile();
            if (!tile) return;
            const bankOpen = api.Bank.isOpen();
            if (bankOpen) bankFish = api.Bank.count('Raw trout') + api.Bank.count('Raw salmon');
            samples.push({ at: Date.now(), tick: host.tickCount, ...tile,
                fish: api.Inventory.count('Raw trout') + api.Inventory.count('Raw salmon'),
                used: api.Inventory.used(), xp: api.Skills.xp('fishing'), bankOpen, bankFish });
        };
        const interact = api.Npc.prototype.interact;
        api.Npc.prototype.interact = function (action) {
            const tile = this.tile();
            selections.push({ tick: host.tickCount, id: this.id, index: this.index, x: tile.x, z: tile.z, action });
            return interact.call(this, action);
        };
        capture();
        const stop = host.addTickListener(capture);
        globalThis.__northTrace = { samples, selections, restore() { stop(); api.Npc.prototype.interact = interact; } };
    });
}

export async function readNorthTrace(page: Page) {
    return page.evaluate(() => ({ samples: globalThis.__northTrace?.samples ?? [], selections: globalThis.__northTrace?.selections ?? [] }));
}
