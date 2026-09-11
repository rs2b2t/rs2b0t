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

test('confirms Shark consumption when reward delivery immediately refills its slot', async () => {
    env.f.inv.push(...Array.from({ length: 27 }, () => item(385)));
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100, 3)]; };
    env.f.onTick = () => {
        if (env.f.tick === 2) {
            env.f.add(100, 1);
            env.f.ground = [pile(100), pile(100)];
        }
        if (env.f.eats.length === 1 && env.f.inv.length === 27) {
            env.f.add(100, 1);
            env.f.ground.shift();
        }
    };
    const tx = new ClueReward({ casketId: 2724 });

    const out = await settle(tx);

    expect(out).toEqual({ kind: 'complete', remaining: [], tile });
    expect(env.f.inv.filter(i => i.id === 100)).toHaveLength(3);
    expect(env.f.inv.filter(i => i.id === 385)).toHaveLength(25);
    expect(env.f.eats).toEqual([385, 385]);
    expect(env.f.takes).toEqual([100]);
});

test('completes reconciled delivery when an event clears after the deadline', async () => {
    env.f.onOpen = () => {
        env.f.modal = 6960;
        env.f.manifest = [item(100)];
        env.f.add(100, 1);
    };
    const tx = new ClueReward({ casketId: 2724 });
    await tx.advance();
    env.f.event = true;
    expect(await tx.advance()).toMatchObject({ kind: 'yield', reason: 'event', remaining: [] });
    env.f.tick = 101;
    expect(await tx.advance()).toMatchObject({ kind: 'yield', reason: 'event', remaining: [] });
    env.f.event = false;

    const out = await tx.advance();

    expect(out).toEqual({ kind: 'complete', remaining: [], tile });
    expect(tx.active).toBe(false);
    expect(env.f.opens).toBe(1);
});

test('expires outstanding delivery when a long event clears without resetting the deadline', async () => {
    env.f.onOpen = () => { env.f.modal = 6960; env.f.manifest = [item(100, 2)]; env.f.add(100, 1); };
    const tx = new ClueReward({ casketId: 2724 });
    await tx.advance();
    env.f.event = true;
    env.f.tick = 101;
    expect(await tx.advance()).toMatchObject({ kind: 'yield', reason: 'event', remaining: [{ id: 100, count: 1 }] });
    env.f.event = false;
    env.f.ground = [pile(100)];

    const out = await tx.advance();

    expect(out).toEqual({ kind: 'blocked', reason: 'delivery-deadline', remaining: [{ id: 100, count: 1 }], tile });
    expect(env.f.takes).toEqual([]);
});
