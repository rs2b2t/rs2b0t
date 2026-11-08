import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { decide } from '#/bot/api/ai/quests/defs/demonslayer.js';
import { Game } from '#/bot/api/game/Game.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

afterEach(() => mock.restore());

function fixture(bones: number, extra: number[] = [2400, 995], level = 0) {
    const ids = [...extra, ...Array<number>(bones).fill(526)];
    const pack: InvItemSnapshot[] = ids.map((id, slot) => ({
        id, slot, count: 1, name: id === 526 ? 'Bones' : id === 1925 ? 'Bucket' : id === 995 ? 'Coins' : 'Key',
        ops: [null, null, null, null, 'Drop'], comId: 3214
    }));
    const state = { tile: { x: 3144, z: 3231, level }, dialogs: [] as string[] };
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockReturnValue(pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Reach, 'locOp').mockImplementation(async options => {
        state.tile = { ...options.near, level: options.op === 'Climb-up' ? 1 : 0 };
        return 'done';
    });
    spyOn(Reach, 'npcDialog').mockImplementation(async options => {
        state.dialogs.push(options.name);
        return 'retry';
    });
    return state;
}

async function keyHunt(): Promise<boolean> {
    const step = decide({ journal: 'inProgress', inv: new Map(), worn: new Set(), noProgress: 0, bankCoins: 0 });
    if (step.kind !== 'custom') throw new Error('expected key hunt');
    return step.run(() => {});
}

test.each([25, 26])('%i bones with a free slot goes upstairs to Traiborn', async bones => {
    const state = fixture(bones, [2400]);
    expect(await keyHunt()).toBe(false);
    expect(state.tile).toEqual({ x: 3105, z: 3160, level: 1 });
});

test('25 bones in Alaska\'s 27-slot pack opens Traiborn dialogue upstairs', async () => {
    const state = fixture(25, [2400, 995], 1);
    expect(await keyHunt()).toBe(false);
    expect(state.dialogs).toEqual(['Traiborn']);
    expect(state.tile.level).toBe(1);
});

test('a full pack with fewer than 25 bones still makes a partial hand-in', async () => {
    const state = fixture(4, [2400, ...Array<number>(23).fill(9999)], 1);
    await keyHunt();
    expect(state.dialogs).toEqual(['Traiborn']);
    expect(state.tile.level).toBe(1);
});

test('fewer than 25 bones with room leaves the tower to gather more', async () => {
    const state = fixture(24, [2400, 995], 1);
    await keyHunt();
    expect(state.tile).toEqual({ x: 3105, z: 3160, level: 0 });
    expect(state.dialogs).toEqual([]);
});

test('a same-named unrelated key does not skip the Traiborn hand-in', async () => {
    const state = fixture(25, [2400, 9999], 1);
    await keyHunt();
    expect(state.dialogs).toEqual(['Traiborn']);
});

test('Traiborn\'s exact key skips the bone hand-in and continues to the drain', async () => {
    const state = fixture(25, [2400, 2399, 1925]);
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    await keyHunt();
    expect(walk.mock.calls[0]?.[0]).toMatchObject({ x: 3224, z: 3494, level: 0 });
    expect(state.dialogs).toEqual([]);
    expect(state.tile.level).toBe(0);
});

test('missing Rovin\'s key takes priority over handing in 25 bones', async () => {
    const state = fixture(25, [2401, 995]);
    const interrupted = new Error('stop before reaching Rovin');
    const walk = spyOn(Traversal, 'walkResilient').mockRejectedValue(interrupted);
    await expect(keyHunt()).rejects.toBe(interrupted);
    expect(walk.mock.calls[0]?.[0]).toMatchObject({ x: 3204, z: 3496, level: 2 });
    expect(state.dialogs).toEqual([]);
});
