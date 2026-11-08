import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import Tile from '#/bot/geometry/Tile.js';
import SmithingBot, { SETTINGS } from '#/bot/scripts/SmithingBot/SmithingBot.js';
import FireGiant from '#/bot/scripts/FireGiant/FireGiant.js';
import { AMULET } from '#/bot/scripts/FireGiant/FireGiantLogic.js';

afterEach(() => mock.restore());

class Giant extends FireGiant {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

function base() {
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2616, 3332));
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Skills, 'xp').mockReturnValue(0);
}

test.each(['Adamantite', 'Runite'])('#808 %s uses the engine bar name', async tier => {
    base();
    expect(SETTINGS.bar.options).toContain(tier);
    const bot = new SmithingBot();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ bar: tier });
    await bot.onStart();
    expect(bot.barItemName()).toBe(`${tier} bar`);
    bot.disposeSubscriptions();
});

test('#793 FireGiant closes before healing, refills the consumed food and closes before departure', async () => {
    base();
    const bot = new Giant();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ food: 'Lobster', foodWithdraw: 5, combatStyle: 'melee' });
    let open = false;
    let hp = 50;
    let eaten = 0;
    const events: string[] = [];
    const pack = new Map([[AMULET, 1], ['Rope', 1], ['Air rune', 100], ['Law rune', 100]]);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(Skills, 'effective').mockImplementation(() => hp);
    spyOn(Skills, 'level').mockReturnValue(80);
    spyOn(Equipment, 'items').mockReturnValue([]);
    spyOn(Inventory, 'items').mockImplementation(() => [...pack].flatMap(([name, count], id) =>
        Array.from({ length: name === 'Lobster' ? count : 1 }, (_, slot) => new InvItem({ id, name, count: name === 'Lobster' ? 1 : count, slot, comId: 3214, ops: ['Eat'] }))));
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    spyOn(Bank, 'isOpen').mockImplementation(() => open);
    spyOn(Bank, 'openNearest').mockImplementation(async () => { open = true; events.push('open'); return true; });
    spyOn(Bank, 'close').mockImplementation(async () => { open = false; events.push('close'); return true; });
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    spyOn(Bank, 'withdraw').mockImplementation(async (name, op) => {
        expect(open).toBe(true);
        pack.set(name, (pack.get(name) ?? 0) + (op === 'Withdraw-5' ? 5 : 1));
        events.push('withdraw');
        return true;
    });
    spyOn(Input, 'heldOp').mockImplementation(() => {
        expect(open).toBe(false);
        pack.set('Lobster', (pack.get('Lobster') ?? 0) - 1);
        hp += 12;
        eaten++;
        events.push('eat');
        return true;
    });
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    await bot.onStart();
    await bot.registered.find(task => task.constructor.name === 'BankRun')!.execute();
    expect(eaten).toBe(2);
    expect(pack.get('Lobster')).toBe(5);
    expect(open).toBe(false);
    expect(events.indexOf('close')).toBeLessThan(events.indexOf('eat'));
    expect(events.at(-1)).toBe('close');
    expect(events.filter(event => event === 'open')).toHaveLength(2);
    bot.disposeSubscriptions();
});
