import { afterEach, expect, mock, test } from 'bun:test';
import { BuyGuildFeathers } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';
import { FISHING_METHODS } from '#/bot/data/fishingMethods.js';
import { shiloFixture } from './ShiloTripFixture.js';

afterEach(() => mock.restore());

test('routes a due Shilo trip only through bank-first supplies', () => {
    const { bot, state, task } = shiloFixture();
    state.pack.delete('Raw trout');

    const selected = [new BuyGuildFeathers(bot), task].filter(candidate => candidate.validate());

    expect(selected).toEqual([task]);
});

test('preserves Guild feather buying without selecting Shilo supplies', () => {
    const { bot, state, task } = shiloFixture('Fishing Guild');
    state.pack.delete('Raw trout');
    const guild = new BuyGuildFeathers(bot);

    const selected = [guild, task].filter(candidate => candidate.validate());

    expect(selected).toEqual([guild]);
});

test.each(['Harpoon', 'Cage'])('does not buy unwanted feathers while using %s with scheduled trips disabled', op => {
    const { bot, state } = shiloFixture('Fishing Guild');
    bot['fishMethod'] = FISHING_METHODS.find(method => method.op === op) ?? null;
    bot['guildFeatherMinutes'] = 0;
    state.pack.delete('Raw trout');
    state.pack.delete('Feather');
    expect(new BuyGuildFeathers(bot).validate()).toBe(false);
});

test('restocks missing fly-fishing bait when scheduled trips are disabled', () => {
    const { bot, state } = shiloFixture('Fishing Guild');
    bot['guildFeatherMinutes'] = 0;
    state.pack.delete('Raw trout');
    state.pack.delete('Feather');
    expect(new BuyGuildFeathers(bot).validate()).toBe(true);
});
