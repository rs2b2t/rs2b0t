import { afterEach, expect, mock, test } from 'bun:test';
import { BuyGuildFeathers } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';
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
