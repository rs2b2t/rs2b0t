import { afterEach, beforeEach, expect, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import JiveCrafting, { SETTINGS } from '#/bot/scripts/JiveCrafting/JiveCrafting.js';
import { stubProps } from '../../lib/stubSingletons.js';

const WOOL = 1759;
const AMULETS = [
    ['Gold amulet', 1673, 1692], ['Sapphire amulet', 1675, 1694],
    ['Emerald amulet', 1677, 1696], ['Ruby amulet', 1679, 1698],
    ['Diamond amulet', 1681, 1700], ['Dragonstone amulet', 1683, 1702]
] as const;
let restores: (() => void)[];
let inv: Map<number, number>;
let bank: Map<number, number>;
let open: boolean;
let noteMode: boolean;
let stops: string[];
let withdrawals: [number, number][];
let uses: [number, number][];

function rows(counts: Map<number, number>): InvItemSnapshot[] {
    return [...counts].filter(([, count]) => count > 0).map(([id, count], slot) => ({
        id, count, slot, comId: 3214, ops: [],
        name: id === WOOL ? 'Ball of wool' : AMULETS.find(([, raw, strung]) => id === raw || id === strung)?.[0] ?? 'Coins'
    }));
}

async function start(amulet = 'Gold amulet'): Promise<JiveCrafting> {
    const bot = new JiveCrafting();
    bot.settings = new SettingsBag({ mode: 'String amulets', amulet });
    bot.bindLog(() => {});
    await bot.onStart();
    expect(stops).toEqual([]);
    return bot;
}

beforeEach(() => {
    inv = new Map(); bank = new Map(); open = false; noteMode = false; stops = []; withdrawals = []; uses = [];
    restores = [
        stubProps(reader, { inventory: () => rows(inv), bankSideItems: () => rows(inv), bankItems: () => rows(bank), bankComId: () => open ? 5292 : -1, bankSnapshotReady: () => true }),
        stubProps(Game, { ingame: () => true, sceneReady: () => true, tile: () => ({ x: 3269, z: 3167, level: 0 }) }),
        stubProps(Skills, { level: () => 1, xp: () => 0 }),
        stubProps(ChatDialog, { canContinue: () => false }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Execution, { delayUntil: async check => check(), delayTicks: async () => {} }),
        stubProps(ScriptRunner, { stop: reason => { stops.push(reason ?? ''); } }),
        stubProps(Banking, { open: async () => { open = true; return true; } }),
        stubProps(Bank, {
            close: async () => { open = false; return true; },
            setNoteMode: async on => { noteMode = on; },
            depositInventory: async () => { for (const [id, qty] of inv) bank.set(id, (bank.get(id) ?? 0) + qty); inv.clear(); },
            withdrawXById: async (id, qty) => {
                withdrawals.push([id, qty]);
                if (noteMode) return false;
                const take = Math.min(qty, bank.get(id) ?? 0);
                bank.set(id, (bank.get(id) ?? 0) - take);
                inv.set(id, (inv.get(id) ?? 0) + take);
                return take === qty;
            }
        }),
        stubProps(Input, {
            useItemOnItem: (id, _slot, _com, target) => {
                expect(open).toBe(false);
                uses.push([id, target]);
                const recipe = AMULETS.find(([, raw]) => raw === target);
                if (id !== WOOL || !recipe || !inv.get(id) || !inv.get(target)) return false;
                inv.set(id, inv.get(id)! - 1); inv.set(target, inv.get(target)! - 1);
                inv.set(recipe[2], (inv.get(recipe[2]) ?? 0) + 1);
                return true;
            }
        })
    ];
});

afterEach(() => { for (const restore of restores.reverse()) restore(); });

test('offers stringing separately from furnace crafting', () => {
    expect(SETTINGS.mode?.options).toEqual(['Craft jewellery', 'String amulets']);
    expect(SETTINGS.mode?.default).toBe('Craft jewellery');
    expect(SETTINGS.amulet?.options).toEqual(AMULETS.map(([label]) => label));
});

for (const [label, raw, strung] of AMULETS) {
    test(`strings ${label} at Crafting 1 using the unstrung ID, including after a restart at the bank`, async () => {
        const bot = await start(label);
        open = true;
        inv = new Map([[strung, 5], [raw, 1], [WOOL, 1]]);
        await bot.loop();
        expect(uses).toEqual([[WOOL, raw]]);
        expect(inv.get(strung)).toBe(6);
        expect(inv.get(raw)).toBe(0);
    });
}

test('withdraws fourteen pairs without taking identical-named finished amulets', async () => {
    const bot = await start();
    bank = new Map([[1692, 100], [1673, 100], [WOOL, 100]]);
    await bot.loop();
    expect(withdrawals).toEqual([[1673, 14], [WOOL, 14]]);
    expect(bank.get(1692)).toBe(100);
    expect(open).toBe(false);
});

test('banks a full pack, makes a short batch, and banks the finished output before stopping', async () => {
    const bot = await start();
    inv = new Map([[1692, 28]]);
    bank = new Map([[1673, 5], [WOOL, 2]]);
    await bot.loop();
    expect(withdrawals).toEqual([[1673, 2], [WOOL, 2]]);
    await bot.loop(); await bot.loop(); await bot.loop();
    expect(bank.get(1692)).toBe(30);
    expect(bank.get(1673)).toBe(3);
    expect(stops[0]).toContain('Ball of wool');
    expect(inv.size).toBe(0);
});

test('stops with only finished amulets in the bank', async () => {
    const bot = await start();
    bank = new Map([[1692, 100], [WOOL, 100]]);
    await bot.loop();
    expect(withdrawals).toEqual([]);
    expect(stops[0]).toContain('unstrung Gold amulet');
});

test('resets an already-open bank from notes to items before withdrawing', async () => {
    const bot = await start();
    open = true; noteMode = true;
    bank = new Map([[1673, 100], [WOOL, 100]]);
    await bot.loop();
    expect(noteMode).toBe(false);
    expect(inv.get(1673)).toBe(14);
    expect(inv.get(WOOL)).toBe(14);
});

test('does not withdraw over an incompletely deposited pack', async () => {
    const bot = await start();
    inv = new Map([[995, 100]]);
    bank = new Map([[1673, 100], [WOOL, 100]]);
    restores.push(stubProps(Bank, { depositInventory: async () => {} }));
    await bot.loop();
    expect(withdrawals).toEqual([]);
});
