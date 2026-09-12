import { afterEach, beforeEach, expect, test } from 'bun:test';
import { ClueReward, type ClueRewardOutcome } from '#/bot/api/ai/clues/ClueReward.js';
import { Input } from '#/bot/input/Input.js';
import { rewardCooldownFixture } from './rewardCooldownFixture.js';
import { item, tile } from './rewardFixture.test.js';

let env: ReturnType<typeof rewardCooldownFixture>;
beforeEach(() => { env = rewardCooldownFixture(); });
afterEach(() => env.restore());

async function settle(tx: ClueReward): Promise<ClueRewardOutcome> {
    for (let n = 0; n < 120; n++) {
        const out = await tx.advance();
        if (out.kind !== 'yield') return out;
    }
    throw new Error('transaction did not settle');
}

test('server fixture rejects equality despite accepting client input and publishes quantity asynchronously', () => {
    Input.heldOp(385, 1, 3214, 2);
    expect(env.f.inv.filter(i => i.id === 385)).toHaveLength(27);
    env.server.step();
    expect(env.f.inv.filter(i => i.id === 385)).toHaveLength(26);
    env.server.step();

    expect(Input.heldOp(385, 1, 3214, 2)).toBe(true);
    env.server.step();

    expect(env.server.bites).toEqual([{ tick: 376, consumed: true }, { tick: 378, consumed: false }]);
    expect(env.f.inv.filter(i => i.id === 385)).toHaveLength(26);
});

test.each([0, 1])('collects every unit of a nine-unit reward with inventory lag %s', async inventoryLag => {
    env.server.inventoryLag = inventoryLag;
    const tx = new ClueReward({ casketId: 2724 });

    const out = await settle(tx);

    expect(out).toEqual({ kind: 'complete', remaining: [], tile });
    for (const id of [145, 157, 163]) expect(env.f.inv.filter(i => i.id === id)).toHaveLength(3);
    expect(env.f.ground).toEqual([]);
    expect(env.server.bites).toHaveLength(8);
    expect(env.server.bites.every(bite => bite.consumed)).toBe(true);
    if (inventoryLag === 0) expect(env.server.bites.slice(0, 2)).toEqual([
        { tick: 378, consumed: true }, { tick: 381, consumed: true }
    ]);
});

test('spaces consecutive bites when each inventory update includes same-tick reward refill', async () => {
    env.server.refill = true;
    const tx = new ClueReward({ casketId: 2724 });

    const out = await settle(tx);

    expect(out).toEqual({ kind: 'complete', remaining: [], tile });
    expect(env.f.inv).toHaveLength(28);
    expect(env.f.inv.filter(i => i.id === 385)).toHaveLength(19);
    expect(env.server.bites.every(bite => bite.consumed)).toBe(true);
    for (const id of [145, 157, 163]) expect(env.f.inv.filter(i => i.id === id)).toHaveLength(3);
});

test('observes consumption during an event without restarting cooldown on resume', async () => {
    env.server.refill = true;
    const tx = new ClueReward({ casketId: 2724 });
    await tx.advance();
    await tx.advance();
    await tx.advance();
    env.f.event = true;
    expect(await tx.advance()).toMatchObject({ kind: 'yield', reason: 'event' });
    env.server.step();
    expect(await tx.advance()).toMatchObject({ kind: 'yield', reason: 'event' });
    expect(env.server.bites).toEqual([{ tick: 378, consumed: true }]);
    env.server.step();
    env.f.event = false;

    await tx.advance();

    expect(env.server.bites).toEqual([{ tick: 378, consumed: true }, { tick: 381, consumed: true }]);
    expect(await settle(tx)).toMatchObject({ kind: 'complete', remaining: [] });
});

test('retains cooldown when a bank resume supplies another Shark', async () => {
    env.server.refill = true;
    env.f.inv = [item(2724), item(385), ...Array.from({ length: 26 }, () => item(300))];
    env.server.inventory = env.f.inv.map(i => ({ ...i }));
    const tx = new ClueReward({ casketId: 2724 });
    expect(await settle(tx)).toMatchObject({ kind: 'needs-space' });
    env.server.step();
    env.f.inv[0] = item(385);
    env.server.inventory = env.f.inv.map(i => ({ ...i }));
    tx.resumeAfterBank();

    await tx.advance();

    expect(env.server.bites).toEqual([{ tick: 378, consumed: true }]);
    await tx.advance();
    expect(env.server.bites).toEqual([{ tick: 378, consumed: true }, { tick: 381, consumed: true }]);
});

test('expires outstanding reward at the original deadline after an interrupted bite', async () => {
    env.server.refill = true;
    const tx = new ClueReward({ casketId: 2724 });
    await tx.advance();
    await tx.advance();
    await tx.advance();
    env.f.event = true;
    await tx.advance();
    while (env.f.tick < 227) env.server.step();
    env.f.event = false;
    tx.resumeAfterBank();

    const out = await tx.advance();

    expect(out).toMatchObject({ kind: 'blocked', reason: 'delivery-deadline' });
    expect(env.server.bites).toEqual([{ tick: 378, consumed: true }]);
});

test('still blocks truly unconsumed food exactly five ticks after accepted input', async () => {
    env.f.eatWorks = false;
    const tx = new ClueReward({ casketId: 2724 });

    const out = await settle(tx);

    expect(out).toMatchObject({ kind: 'blocked', reason: 'food-not-consumed' });
    expect(env.f.tick).toBe(134);
    expect(env.server.bites).toEqual([{ tick: 378, consumed: false }]);
    expect(env.f.inv.filter(i => i.id === 385)).toHaveLength(27);
});
