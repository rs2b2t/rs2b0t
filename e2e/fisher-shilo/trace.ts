import type { Page } from 'playwright-core';
import type { Observation } from './contracts.js';

type Item = { name: string | null; count: number };
declare global {
    var __rs2b0t: {
        Inventory: { items(): Item[]; used(): number; count(name: string): number };
        Bank: { count(name: string): number; isOpen(): boolean; close(timeoutMs?: number): Promise<boolean> };
        Skills: { xp(name: string): number; level(name: string): number };
        Shop: { open(name: string): Promise<boolean>; stock(): Item[] };
    };
    var rs2b0t: {
        host: { tickCount: number; addTickListener(callback: () => void): () => void; addFrameListener(callback: () => void): () => void };
        client: { ingame: boolean; loginUser: string; loginscreen: number };
        reader: { chat(limit: number): { text: string }[]; inCombat(): boolean };
        runner: { state: string; stop(reason: string): void };
    };
    var __fisherShoppingTrace: { events: Observation[]; intervals: number[]; restore(): void } | undefined;
}

export async function installTrace(page: Page): Promise<void> {
    await page.evaluate(() => {
        const api = globalThis.__rs2b0t;
        const host = globalThis.rs2b0t.host;
        const events: Observation[] = [];
        const intervals: number[] = [];
        const capture = (detail: Partial<Observation> = {}) => {
            const event: Observation = {
                kind: 'sample', at: performance.now(), tick: host.tickCount,
                keeper: '', opened: false, stock: [],
                inventory: api.Inventory.items().map(item => ({ name: item.name, count: item.count })),
                bankVials: api.Bank.count('Vial of water'), bankTrout: api.Bank.count('Raw trout'),
                bankDagger: api.Bank.count('Bronze dagger'), bankCoins: api.Bank.count('Coins'),
                bankOpen: api.Bank.isOpen(), xp: api.Skills.xp('fishing'),
                runner: globalThis.rs2b0t.runner.state, ...detail
            };
            events.push(event);
        };
        const open = api.Shop.open;
        const close = api.Bank.close;
        api.Shop.open = async name => {
            capture({ kind: 'shop-before', keeper: name });
            const opened = await open.call(api.Shop, name);
            capture({ kind: 'shop-after', keeper: name, opened, stock: api.Shop.stock() });
            return opened;
        };
        api.Bank.close = async timeout => {
            capture({ kind: 'bank-close' });
            return close.call(api.Bank, timeout);
        };
        let lastTick = performance.now();
        const untick = host.addTickListener(() => {
            const now = performance.now();
            intervals.push(now - lastTick);
            lastTick = now;
            capture();
        });
        let signature = '';
        const unframe = host.addFrameListener(() => {
            const next = JSON.stringify([api.Inventory.items(), api.Skills.xp('fishing'), api.Bank.count('Vial of water')]);
            if (next !== signature) { signature = next; capture(); }
        });
        capture();
        globalThis.__fisherShoppingTrace = {
            events, intervals,
            restore() { api.Shop.open = open; api.Bank.close = close; untick(); unframe(); }
        };
    });
}

export function retainBankSnapshots(events: readonly Observation[]): Observation[] {
    let bank = { bankVials: 0, bankTrout: 0, bankDagger: 0, bankCoins: 0 };
    return events.map(event => {
        if (event.bankOpen) bank = {
            bankVials: event.bankVials, bankTrout: event.bankTrout,
            bankDagger: event.bankDagger, bankCoins: event.bankCoins
        };
        return { ...event, ...bank };
    });
}

export async function readTrace(page: Page, startIndex = 0) {
    const trace = await page.evaluate(() => {
        const trace = globalThis.__fisherShoppingTrace;
        return { events: trace?.events ?? [], intervals: trace?.intervals ?? [] };
    });
    return { ...trace, events: retainBankSnapshots(trace.events).slice(startIndex) };
}
