import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { maintainGuardianPrayer } from '#/bot/api/ai/clues/guardianKit.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';

let points: number;
let pack: InvItemSnapshot[];
beforeEach(() => {
    points = 8;
    pack = [{ id: 2434, name: 'Prayer potion(4)', count: 1, slot: 0, comId: 1, ops: ['Drink'] }];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(Prayer, 'points').mockImplementation(() => points);
    spyOn(Prayer, 'max').mockReturnValue(60);
    spyOn(Prayer, 'set').mockResolvedValue(true);
    spyOn(Prayer, 'active').mockReturnValue(true);
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async fn => fn());
});
afterEach(() => mock.restore());

test('a click without dose and prayer changes cannot resume a guardian fight', async () => {
    spyOn(InvItem.prototype, 'interact').mockReturnValue(true);
    expect(await maintainGuardianPrayer()).toBe(false);
    expect(Prayer.set).not.toHaveBeenCalled();
});

test('a dose change without restored prayer cannot resume a guardian fight', async () => {
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { pack[0].id = 139; return true; });
    expect(await maintainGuardianPrayer()).toBe(false);
});

test('a confirmed four-to-three dose transition restores protection', async () => {
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { pack[0].id = 139; points = 30; return true; });
    expect(await maintainGuardianPrayer()).toBe(true);
    expect(pack[0].id).toBe(139);
    expect(Prayer.set).toHaveBeenCalledWith('Protect from Magic', true);
});

test('inactive overhead after a successful toggle prevents fighting', async () => {
    points = 60;
    spyOn(Prayer, 'active').mockReturnValue(false);
    expect(await maintainGuardianPrayer()).toBe(false);
});
