import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ClueReward, type ClueRewardOutcome } from '#/bot/api/ai/clues/ClueReward.js';
import { fixture, item, pile, tile } from './rewardFixture.test.js';

let env: ReturnType<typeof fixture>;
beforeEach(() => { env = fixture(); });
afterEach(() => env.restore());
function reward(): ClueReward { return new ClueReward({ casketId: 2724 }); }
async function finish(tx: ClueReward): Promise<ClueRewardOutcome> {
    for (let n = 0; n < 150; n++) {
        const out = await tx.advance();
        if (out.kind !== 'yield') return out;
    }
    throw new Error('transaction did not settle');
}
function openWith(id: number, count = 1): void {
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(id, count)]; };
}

test('waits for delayed overflow after casket consumption and empty ground scans', async () => {
    openWith(100);
    env.f.onTick = () => { if (env.f.tick === 4) env.f.ground = [pile(100)]; };
    const tx = reward();
    const out = await finish(tx);
    expect(out.kind).toBe('complete');
    expect(env.f.takes).toEqual([100]);
    expect(env.f.tick).toBeGreaterThanOrEqual(4);
});

test('does not finish when the casket disappears before delivery', async () => {
    openWith(100);
    const out = await reward().advance();
    expect(out.kind).toBe('yield');
    expect(env.f.inv.some(i => i.id === 2724)).toBe(false);
});

test('accounts for reward quantities merged into existing inventory stacks', async () => {
    env.f.inv.push(item(995, 1000));
    openWith(995, 25);
    env.f.onTick = () => { if (env.f.tick === 2) env.f.add(995, 25); };
    expect((await finish(reward())).kind).toBe('complete');
    expect(env.f.inv.find(i => i.id === 995)?.count).toBe(1025);
});

test('eats Sharks at full HP for more than six nonstackable reward units', async () => {
    env.f.inv.push(...Array.from({ length: 27 }, () => item(385)));
    openWith(100, 9);
    env.f.onTick = () => {
        if (env.f.tick === 2) { env.f.add(100, 1); env.f.ground = Array.from({ length: 8 }, () => pile(100)); }
    };
    expect((await finish(reward())).kind).toBe('complete');
    expect(env.f.eats).toEqual(Array(8).fill(385));
    expect(env.f.inv.filter(i => i.id === 100)).toHaveLength(9);
});

test('ignores unrelated old piles including an old same-ID quantity', async () => {
    env.f.ground = [pile(100, 1), pile(200, 20)];
    openWith(100);
    env.f.onTick = () => { if (env.f.tick === 2) env.f.ground.push(pile(100)); };
    expect((await finish(reward())).kind).toBe('complete');
    expect(env.f.ground.map(g => [g.id, g.count])).toEqual([[200, 20], [100, 1]]);
    expect(env.f.takes).toEqual([100]);
});

test('fails closed when the fresh modal has no manifest', async () => {
    env.f.onOpen = () => { env.f.modal = 6960; };
    const out = await finish(reward());
    expect(out.kind).toBe('blocked');
    expect(out.remaining).toBeNull();
});

test('rejects cached prior manifest without a fresh reward modal', async () => {
    env.f.modal = 6960;
    env.f.manifest = [item(100)];
    env.f.onOpen = () => { env.f.add(100, 1); };
    const out = await finish(reward());
    expect(out.kind).toBe('blocked');
    expect(out.remaining).toBeNull();
});

test('accepts identical rewards from a fresh second casket after closing the old modal', async () => {
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100)]; env.f.ground = [pile(100)]; };
    expect((await finish(reward())).kind).toBe('complete');
    env.f.ground = [];
    env.f.modal = 6960;
    env.f.inv.push(item(2724));
    const out = await finish(reward());
    expect(out.kind).toBe('complete');
    expect(env.f.opens).toBe(2);
    expect(env.f.inv.filter(i => i.id === 100)).toHaveLength(2);
});

test('captures changed manifest only after fresh reward visibility', async () => {
    env.f.modal = 6960;
    env.f.manifest = [item(200)];
    openWith(100);
    env.f.onTick = () => { if (env.f.opens && env.f.tick > 2) env.f.ground = [pile(100)]; };
    expect((await finish(reward())).kind).toBe('complete');
    expect(env.f.takes).toEqual([100]);
});

test('requests space without food and resumes after banking collected rewards', async () => {
    env.f.inv.push(...Array.from({ length: 27 }, () => item(300)));
    openWith(100, 2);
    env.f.onTick = () => { if (env.f.tick === 2) { env.f.add(100, 1); env.f.ground = [pile(100)]; } };
    const tx = reward();
    const out = await finish(tx);
    expect(out).toMatchObject({ kind: 'needs-space', remaining: [{ id: 100, count: 1 }], tile });
    env.f.inv = [];
    tx.resumeAfterBank();
    expect((await finish(tx)).kind).toBe('complete');
    expect(env.f.opens).toBe(1);
});

test('preserves a manifest across an event yield after open', async () => {
    openWith(100);
    const tx = reward();
    await tx.advance();
    env.f.event = true;
    expect(await tx.advance()).toMatchObject({ kind: 'yield', reason: 'event', remaining: [{ id: 100, count: 1 }] });
    env.f.event = false;
    env.f.ground = [pile(100)];
    expect((await finish(tx)).kind).toBe('complete');
});

test('blocks with an explicit remainder when pickup never gains an item', async () => {
    openWith(100);
    env.f.pickupWorks = false;
    env.f.onTick = () => { env.f.ground = [pile(100)]; };
    expect(await finish(reward())).toMatchObject({ kind: 'blocked', remaining: [{ id: 100, count: 1 }] });
});

test('blocks when eating sends input without reducing food count or slots', async () => {
    env.f.inv.push(...Array.from({ length: 27 }, () => item(385)));
    openWith(100, 2);
    env.f.eatWorks = false;
    env.f.onTick = () => { if (env.f.tick === 2) { env.f.add(100, 1); env.f.ground = [pile(100)]; } };
    expect(await finish(reward())).toMatchObject({ kind: 'blocked', remaining: [{ id: 100, count: 1 }] });
    expect(env.f.takes).toEqual([]);
});

test('captures the adjacent delivery tile rather than roaming after interpolation', async () => {
    env.f.onOpen = () => { env.f.pos.x++; env.f.modal = 6960; env.f.manifest = [item(100)]; };
    env.f.onTick = () => { if (env.f.tick === 2) env.f.ground = [{ ...pile(100), tile: { ...env.f.pos } }]; };
    expect((await finish(reward())).kind).toBe('complete');
});

test('does not collect a reward-ID pile at an unobserved neighboring tile', async () => {
    openWith(100);
    env.f.onTick = () => { env.f.ground = [{ ...pile(100), tile: { ...tile, x: tile.x + 1 } }]; };
    expect((await finish(reward())).kind).toBe('blocked');
    expect(env.f.takes).toEqual([]);
});
