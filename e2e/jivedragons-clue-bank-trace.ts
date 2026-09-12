import type { Page } from 'playwright-core';
import type { Bank } from '../src/bot/api/bank/Bank.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Game } from '../src/bot/api/game/Game.js';
import type { Traversal } from '../src/bot/api/walking/Traversal.js';

type Runtime = {
    readonly __rs2b0t: { readonly Bank: typeof Bank; readonly Inventory: typeof Inventory; readonly Game: typeof Game; readonly Traversal: typeof Traversal };
    readonly rs2b0t: { readonly host: { addTickListener(fn: () => void): () => void }; clueProgress(): unknown };
};
declare global { var __clueBankTrace: { readonly events: unknown[]; restore(): void } | undefined; }

export async function installClueBankTrace(page: Page) {
    await page.evaluate(() => {
        function ready(value: unknown): value is Runtime { return typeof value === 'object' && value !== null && '__rs2b0t' in value && 'rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('clue trace runtime absent');
        const api: Runtime['__rs2b0t'] = g.__rs2b0t;
        const events: unknown[] = [];
        const capture = (kind: string, detail: object = {}) => {
            events.push({ at: Date.now(), kind, tile: api.Game.tile(), bankOpen: api.Bank.isOpen(),
                clueHeld: api.Inventory.items().some(i => i.id === 2693), hides: api.Inventory.count('Dragonhide'),
                bankHides: api.Bank.isOpen() ? api.Bank.count('Dragonhide') : 0,
                solver: g.rs2b0t.clueProgress(), ...detail });
        };
        const walk = api.Traversal.walkResilient;
        api.Traversal.walkResilient = function (...args) { capture('walk-request', { goal: args[0] }); return walk.apply(this, args); };
        const open = api.Bank.openNearestAccess;
        api.Bank.openNearestAccess = function (...args) { capture('bank-request'); return open.apply(this, args); };
        const booth = api.Bank.openBooth;
        api.Bank.openBooth = function (...args) { capture('bank-request', { goal: args[0] }); return booth.apply(this, args); };
        const deposit = api.Bank.depositAllMatching;
        api.Bank.depositAllMatching = async function (...args) { capture('deposit-start'); await deposit.apply(this, args); capture('deposit-end'); };
        const untick = g.rs2b0t.host.addTickListener(() => capture('tick'));
        globalThis.__clueBankTrace = { events, restore() { untick(); api.Traversal.walkResilient = walk;
            api.Bank.openNearestAccess = open; api.Bank.openBooth = booth; api.Bank.depositAllMatching = deposit; } };
        capture('installed');
    });
}
