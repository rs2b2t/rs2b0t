import type { Page } from 'playwright-core';
import type { PrivateRuntime, PrivateEvent } from './jive-private-types.js';
import { installPrivateHostTraceFactory } from './jive-private-host-trace.js';
export { installPrivateHostTraceFactory };

export async function installPrivateTrace(page: Page, clueId: number) {
    await page.evaluate(installPrivateHostTraceFactory);
    await page.evaluate(clueId => {
        function ready(value: unknown): value is PrivateRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value && 'rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('private trace ABI absent');
        const a: PrivateRuntime['__rs2b0t'] = g.__rs2b0t;
        const r = g.rs2b0t.reader;
        const events: PrivateEvent[] = [], restores: (() => void)[] = [];
        let bank = globalThis.__jiveBank?.items ?? [], bankConfirmed = globalThis.__jiveBank?.error === null;
        let lastSharks = a.Inventory.count('Shark'), eaten = 0, pendingEat = false;
        const capture = (kind: string, detail: { action?: string; itemId?: number } = {}) => {
            const inventory = a.Inventory.items().map(i => ({ id: i.id, count: i.count }));
            if (a.Bank.ready()) { bank = a.Bank.items().map(i => ({ id: i.id, count: i.count })); bankConfirmed = true; }
            const sharks = a.Inventory.count('Shark');
            const consumedNow = pendingEat && sharks === lastSharks - 1;
            if (consumedNow) { eaten++; pendingEat = false; }
            lastSharks = sharks;
            const event: PrivateEvent = { at: Date.now(), tick: a.Game.tick(), kind, action: detail.action ?? '', itemId: detail.itemId ?? -1,
                inventory, bank, bankConfirmed, hp: a.Skills.effective('hitpoints'), maxHp: a.Skills.level('hitpoints'), sharks,
                used: a.Inventory.used(), weaponId: a.Equipment.items().find(i => i.slot === 3)?.id ?? -1,
                special: r.varp(300), antipoisonDoses: inventory.reduce((n, i) => n + i.count * ({ 2448: 4, 181: 3, 183: 2, 185: 1 }[i.id] ?? 0), 0),
                attack: a.Skills.level('attack'), lostCity: a.Quests.status('Lost City') === 'complete',
                clueHeld: inventory.some(i => i.id === clueId), status: hostTrace.status(),
                tile: a.Game.tile(), manifest: r.modals().main === 6960 ? r.shopInv(6963).map(i => ({ id: i.id, count: i.count })) : [],
                modalId: r.modals().main, ground: r.groundItems().map(i => ({ id: i.id, count: i.count })),
                consumed: [{ id: 385, count: eaten }], progress: g.rs2b0t.clueProgress() };
            if (consumedNow) events.push({ ...event, kind: 'eat-confirmed', action: 'Eat Shark' });
            events.push(event);
        };
        const held = a.InvItem.prototype.interact;
        a.InvItem.prototype.interact = function (action) {
            capture('inventory-action', { action, itemId: this.id });
            if (this.id === 385 && action === 'Eat') pendingEat = true;
            return held.call(this, action);
        };
        restores.push(() => { a.InvItem.prototype.interact = held; });
        const ground = a.GroundItem.prototype.interact;
        a.GroundItem.prototype.interact = function (action) { capture('ground-action', { action, itemId: this.id }); return ground.call(this, action); };
        restores.push(() => { a.GroundItem.prototype.interact = ground; });
        const walk = a.Traversal.walkResilient;
        a.Traversal.walkResilient = function (...args) { capture('departure', { action: 'walk' }); return walk.apply(this, args); };
        restores.push(() => { a.Traversal.walkResilient = walk; });
        const actions = g.rs2b0t.actions;
        const walkTo = actions.walkTo;
        actions.walkTo = function (...args) { capture('departure', { action: 'walkTo' }); return walkTo.apply(this, args); };
        restores.push(() => { actions.walkTo = walkTo; });
        const button = actions.ifButton;
        actions.ifButton = function (id) {
            if ([1164, 1167, 1170, 1174, 1540, 1541, 7455].includes(id)) capture('departure', { action: 'teleport' });
            return button.call(this, id);
        };
        restores.push(() => { actions.ifButton = button; });
        const open = a.Bank.openNearest;
        a.Bank.openNearest = function (...args) { capture('departure', { action: 'bank' }); return open.apply(this, args); };
        restores.push(() => { a.Bank.openNearest = open; });
        const createHostTrace = globalThis.__jiveHostTraceFactory;
        if (!createHostTrace) throw new Error('private host trace factory absent');
        const hostTrace = createHostTrace(g.rs2b0t, kind => capture(kind));
        globalThis.__jiveHostTraceFactory = undefined;
        globalThis.__jivePrivate = { events, restore() { hostTrace.restore(); restores.splice(0).reverse().forEach(restore => restore()); } };
        capture('installed');
    }, clueId);
}
