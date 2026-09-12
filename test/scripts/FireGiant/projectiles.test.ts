import { expect, test } from 'bun:test';
import FireGiant from '#/bot/scripts/FireGiant/FireGiant.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../lib/stubSingletons.js';

class Fighter extends FireGiant {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void {
        this.registered.push(...tasks);
    }
}

test.each(['Rune knife', 'Rune dart', 'Rune arrow'])('merges carried %s into an equipped stack', async projectile => {
    let equipped = 1;
    let carried = 500;
    const item = { id: 868, name: projectile, slot: 0, count: 1, ops: ['Wield'], comId: 1 };
    const restores = [
        stubProps(reader, {
            bankComId: () => -1,
            inventory: () => carried > 0 ? [{ ...item, count: carried }] : [],
            equipment: () => [{ ...item, count: equipped }]
        }),
        stubProps(Game, { ingame: () => true, tile: () => new Tile(2568, 9892) }),
        stubProps(Quests, { status: () => 'complete' }),
        stubProps(Execution, { delayUntil: async check => check() }),
        stubProps(Input, { heldOp: () => { equipped += carried; carried = 0; return true; } })
    ];
    const bot = new Fighter();
    bot.settings = new SettingsBag({
        combatStyle: 'range', bow: projectile.endsWith('arrow') ? 'Maple shortbow' : 'Other',
        customBow: projectile, ammo: 'Other', customAmmo: projectile
    });
    bot.bindLog(() => {});
    try {
        await bot.onStart();
        const gear = bot.registered.find(task => task.constructor.name === 'GearEquip')!;
        expect(await gear.validate()).toBe(true);
        await gear.execute();
        expect(equipped).toBe(501);
        expect(carried).toBe(0);
        expect(await gear.validate()).toBe(false);
    } finally {
        bot.disposeSubscriptions();
        for (const restore of restores.reverse()) restore();
    }
});

test.each([
    { label: 'equipping an elemental staff clears the temporary rune shortage', style: 'mage', weapon: 'Staff of air', empty: true, runes: true },
    { label: 'equipping a bow without ammo preserves the next bank trip', style: 'range', weapon: 'Maple shortbow', empty: false, runes: false }
])('$label', async ({ style, weapon, empty, runes }) => {
    let worn = false;
    const staff = { id: 1381, name: weapon, slot: 0, count: 1, ops: ['Wield'], comId: 1 };
    const mind = { id: 558, name: 'Mind rune', slot: 1, count: 100, ops: [], comId: 1 };
    const restores = [
        stubProps(reader, {
            bankComId: () => -1,
            inventory: () => [...(worn ? [] : [staff]), ...(runes ? [mind] : [])],
            equipment: () => worn ? [staff] : []
        }),
        stubProps(Game, { ingame: () => true, tile: () => new Tile(2568, 9892) }),
        stubProps(Quests, { status: () => 'complete' }),
        stubProps(Execution, { delayUntil: async check => check() }),
        stubProps(Input, { heldOp: () => { worn = true; return true; } })
    ];
    const bot = new Fighter();
    bot.settings = new SettingsBag({ combatStyle: style, staff: weapon, bow: weapon, spell: 'Wind Strike' });
    bot.bindLog(() => {});
    try {
        await bot.onStart();
        bot.noteSupplyEmpty(empty);
        const gear = bot.registered.find(task => task.constructor.name === 'GearEquip')!;
        expect(await gear.validate()).toBe(true);
        await gear.execute();
        expect(worn).toBe(true);
        expect(bot.supplyKnownEmpty()).toBe(false);
    } finally {
        bot.disposeSubscriptions();
        for (const restore of restores.reverse()) restore();
    }
});
