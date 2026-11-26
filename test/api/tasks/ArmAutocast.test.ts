import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { ArmAutocast } from '#/bot/api/tasks/ArmAutocast.js';
import { Autocast } from '#/bot/api/magic/Autocast.js';

afterEach(() => mock.restore());

test('autocast resets its failure batch after a success and cools down only that task', async () => {
    let now = 1000;
    const messages: string[] = [];
    const bot = { log: (message: string) => messages.push(message), setStatus: () => {} };
    const config = { spell: () => 'Wind Strike', castsLeft: () => 1, warning: () => 'retry' };
    const task = new ArmAutocast(bot, config);

    spyOn(Date, 'now').mockImplementation(() => now);
    spyOn(Autocast, 'armed').mockReturnValue(false);
    spyOn(Autocast, 'staffTabAttached').mockReturnValue(true);
    const arm = spyOn(Autocast, 'arm').mockResolvedValue(false);
    for (let i = 0; i < 4; i++) await task.execute();
    arm.mockResolvedValueOnce(true);
    await task.execute();
    for (let i = 0; i < 4; i++) await task.execute();
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(messages).toEqual(['retry']);
    expect(task.validate()).toBe(false);
    expect(new ArmAutocast(bot, config).validate()).toBe(true);
    now += 60_000;
    expect(task.validate()).toBe(true);
});
