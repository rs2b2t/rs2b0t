import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { fishKarambwan, fishKarambwanji } from '#/bot/api/ai/quests/defs/tbwt/crafting.js';

afterEach(() => mock.restore());
function pack(items: InvItemSnapshot[], free: number) {
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockReturnValue(items);
    spyOn(Inventory, 'free').mockReturnValue(free);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { throw new Error('unexpected trip with an impossible catch'); });
}
const item = (id: number, name: string, slot: number): InvItemSnapshot => ({ id, name, slot, count: 1, comId: 3214, ops: ['Use', null, null, null, 'Drop'] });

test('a loaded vessel in a full pack fails before travelling to the shoal', async () => {
    pack([item(3159, 'Karambwan vessel', 0)], 0);
    const logs: string[] = [];
    expect(await fishKarambwan()(message => logs.push(message))).toBe(false);
    expect(logs.join(' ')).toContain('free inventory slot');
});

test('replacement fishing rejects an account below level 65 before travelling', async () => {
    pack([], 10);
    spyOn(Skills, 'level').mockReturnValue(64);
    const logs: string[] = [];
    expect(await fishKarambwan()(message => logs.push(message))).toBe(false);
    expect(logs.join(' ')).toContain('65 Fishing');
});

test('a zero-size bait request does not report progress', async () => {
    pack([], 0);
    expect(await fishKarambwanji(0)(() => {})).toBe(false);
});

test('a full pack with an incomplete bait batch does not make a fishing trip', async () => {
    pack([item(3150, 'Raw karambwanji', 0)], 0);
    expect(await fishKarambwanji(4)(() => {})).toBe(false);
});
