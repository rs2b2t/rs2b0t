import { expect, test } from 'bun:test';
import JiveDemons from '#/bot/scripts/JiveDemons/JiveDemons.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import JiveKBD from '#/bot/scripts/JiveKBD/JiveKBD.js';

for (const [Script, route] of [
    [JiveDemons, 'walk back to the demons'],
    [JiveDragons, 'walk back to the dragons'],
    [JiveKBD, 'walk the wilderness']
] as const) {
    test(`${Script.name} keeps hunt counters and safespots per instance`, () => {
        const bot = new Script();
        const other = new Script();
        bot.countKill();
        bot.countBankTrip();
        bot.countLoot('Coins');
        bot.countLoot('Coins');
        bot.countLoot(null);
        bot.setSafespotIndex(2);

        expect([bot.killsTotal, bot.bankTrips, bot.looted, bot.safespotIndex()]).toEqual([1, 1, 3, 2]);
        expect([...bot.lootCounts]).toEqual([['Coins', 2]]);
        expect([other.killsTotal, other.bankTrips, other.looted, other.safespotIndex()]).toEqual([0, 0, 0, 0]);
        expect(other.lootCounts.size).toBe(0);
    });

    test(`${Script.name} logs the first park reason after updating the trip and status`, () => {
        const bot = new Script();
        const logs: string[] = [];
        bot.bindLog(msg => {
            expect(bot.status).toBe('parked');
            expect(bot.parked).toBe(true);
            expect(bot.bankKnownEmpty()).toBe(true);
            expect(bot.supplyKnownEmpty()).toBe(false);
            logs.push(msg);
        });
        bot.noteTrip(true, false);
        expect(bot.supplyKnownEmpty()).toBe(true);
        expect(bot.parked).toBe(false);
        bot.noteTrip(false, true);
        bot.parkFor('second reason');

        expect(bot.parkReason).toContain(`rather than ${route} with no way to heal.`);
        expect(logs).toEqual([`PARKED: ${bot.parkReason}`]);
    });
}
