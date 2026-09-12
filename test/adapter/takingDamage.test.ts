import { afterEach, beforeEach, expect, test } from 'bun:test';

import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import ClientEntity from '#/client/dash3d/ClientEntity.js';

class Hitmarks extends ClientEntity {
    isReady(): boolean { return true; }
}

let player: Hitmarks;
let client: { ingame: boolean; localPlayer: Hitmarks | null; constructor: { loopCycle: number } };

beforeEach(() => {
    player = new Hitmarks();
    client = { ingame: true, localPlayer: player, constructor: { loopCycle: 1000 } };
    attach(client);
});
afterEach(detach);

test('a positive combat hit is damage until its splat expires', () => {
    player.addHitmark(1000, 1, 2);
    expect(reader.takingDamage()).toBe(true);
    client.constructor.loopCycle = 1069;
    expect(reader.takingDamage()).toBe(true);
    client.constructor.loopCycle = 1070;
    expect(reader.takingDamage()).toBe(false);
});

test('a blocked hit can show combat without taking damage', () => {
    player.addHitmark(1000, 0, 0);
    player.combatCycle = 1400;
    expect(reader.inCombat()).toBe(true);
    expect(reader.takingDamage()).toBe(false);
});

test('a zero-valued red splat is not damage', () => {
    player.addHitmark(1000, 1, 0);
    expect(reader.takingDamage()).toBe(false);
});

test('poison alone does not identify a new combat hit', () => {
    player.addHitmark(1000, 2, 2);
    expect(reader.takingDamage()).toBe(false);
});

test('reads every splat slot and retains a hit alongside a later miss', () => {
    player.addHitmark(1000, 0, 0);
    player.addHitmark(1000, 2, 1);
    player.addHitmark(1000, 1, 3);
    player.addHitmark(1000, 0, 0);
    expect(reader.takingDamage()).toBe(true);
});

test('no player or a logged-out client has no current damage', () => {
    expect(reader.takingDamage()).toBe(false);
    player.addHitmark(1000, 1, 2);
    client.ingame = false;
    expect(reader.takingDamage()).toBe(false);
    client.ingame = true;
    client.localPlayer = null;
    expect(reader.takingDamage()).toBe(false);
    detach();
    expect(reader.takingDamage()).toBe(false);
});
