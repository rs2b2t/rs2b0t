import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ClueReward, type ClueRewardOutcome } from '#/bot/api/ai/clues/ClueReward.js';
import { fixture, item, pile, tile } from './rewardFixture.test.js';

let env: ReturnType<typeof fixture>;
beforeEach(() => { env = fixture(); });
afterEach(() => env.restore());
async function settle(tx: ClueReward): Promise<ClueRewardOutcome> {
    for (let n = 0; n < 120; n++) {
        const out = await tx.advance();
        if (out.kind !== 'yield') return out;
    }
    throw new Error('transaction did not settle');
}
function fullPack(): ClueReward {
    env.f.inv.push(...Array.from({ length: 27 }, () => item(300)));
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100, 2)]; };
    env.f.onTick = () => { if (env.f.tick === 2) { env.f.add(100, 1); env.f.ground = [pile(100)]; } };
    return new ClueReward({ casketId: 2724 });
}

test('requests return to the captured tile when bank travel unloaded the ground', async () => {
    const tx = fullPack();
    await settle(tx);
    env.f.inv = [];
    env.f.pos.x += 50;
    env.f.ground = [];
    tx.resumeAfterBank();
    expect(await tx.advance()).toMatchObject({ kind: 'yield', reason: 'return-to-tile', tile, remaining: [{ id: 100, count: 1 }] });
});

test('does not count bank withdrawals as reward delivery on resume', async () => {
    const tx = fullPack();
    await settle(tx);
    env.f.inv = [item(100)];
    tx.resumeAfterBank();
    expect((await settle(tx)).kind).toBe('complete');
    expect(env.f.takes).toEqual([100]);
    expect(env.f.inv.filter(i => i.id === 100)).toHaveLength(2);
});

test('retains the original deadline across a bank trip', async () => {
    const tx = fullPack();
    await settle(tx);
    env.f.tick = 101;
    env.f.inv = [];
    tx.resumeAfterBank();
    expect(await tx.advance()).toMatchObject({ kind: 'blocked', reason: 'delivery-deadline', remaining: [{ id: 100, count: 1 }] });
});

test('fails closed if changed manifest data never becomes visible', async () => {
    env.f.onOpen = () => { env.f.manifest = [item(100)]; env.f.add(100, 1); };
    expect(await settle(new ClueReward({ casketId: 2724 }))).toMatchObject({ kind: 'blocked', remaining: null });
});

test('leaves an inseparable merged old stack untouched', async () => {
    env.f.ground = [pile(995, 50)];
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(995, 10)]; };
    env.f.onTick = () => { env.f.ground = [pile(995, 60)]; };
    expect(await settle(new ClueReward({ casketId: 2724 }))).toMatchObject({ kind: 'blocked', remaining: [{ id: 995, count: 10 }] });
    expect(env.f.takes).toEqual([]);
});

test('does not take an ambiguous same-ID pile whose input could select old quantities', async () => {
    env.f.ground = [pile(100, 20)];
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100)]; };
    env.f.onTick = () => { if (env.f.tick === 2) env.f.ground.push(pile(100)); };
    expect(await settle(new ClueReward({ casketId: 2724 }))).toMatchObject({ kind: 'blocked', remaining: [{ id: 100, count: 1 }] });
    expect(env.f.takes).toEqual([]);
});

test('takes a reward stack into a full pack when its stack already exists', async () => {
    env.f.inv.push(item(995, 50), ...Array.from({ length: 26 }, () => item(300)));
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(995, 10), item(100)]; };
    env.f.onTick = () => { if (env.f.tick === 2) { env.f.add(100, 1); env.f.ground = [pile(995, 10)]; } };
    expect((await settle(new ClueReward({ casketId: 2724 }))).kind).toBe('complete');
    expect(env.f.inv.find(i => i.id === 995)?.count).toBe(60);
    expect(env.f.eats).toEqual([]);
});

test('does not eat non-Shark food on hard clues even if the caller allows it', async () => {
    fullPack();
    const tx = new ClueReward({ casketId: 2724, food: () => true });
    expect((await settle(tx)).kind).toBe('needs-space');
    expect(env.f.eats).toEqual([]);
});

test('does not eat an earned reward even when the caller selects it as food', async () => {
    fullPack();
    env.f.inv[0] = item(2714);
    const tx = new ClueReward({ casketId: 2714, food: i => i.id === 100 });
    expect(await settle(tx)).toMatchObject({ kind: 'needs-space', remaining: [{ id: 100, count: 1 }] });
    expect(env.f.eats).toEqual([]);
});

test('preserves caller food selection for non-hard caskets', async () => {
    fullPack();
    env.f.inv[0] = item(2714);
    const tx = new ClueReward({ casketId: 2714, food: i => i.id === 300 });
    expect((await settle(tx)).kind).toBe('complete');
    expect(env.f.eats).toEqual([300]);
});

test('fails closed on invalid manifest quantities', async () => {
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100, -1)]; };
    expect(await settle(new ClueReward({ casketId: 2724 }))).toMatchObject({ kind: 'blocked', remaining: null });
});

test('keeps pending work runnable without either clue or casket', async () => {
    const tx = fullPack();
    const out = await settle(tx);
    expect(out.kind).toBe('needs-space');
    expect(tx.active).toBe(true);
    expect(env.f.opens).toBe(1);
});
