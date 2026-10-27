import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import {
    LOOT_BLACKLIST_MS,
    LOOT_STUCK_MS,
    LootBlacklist,
    matchesLoot,
    pickWanderTile,
    shouldBankLoot,
    shouldDepositOnBank,
    shouldIdleBank
} from '#/bot/scripts/WanderLooter/WanderLooterLogic.js';

const here = new Tile(3200, 3200);

describe('loot matching and banking rules', () => {
    test('loot names are exact, trimmed and case-insensitive', () => {
        expect(matchesLoot('Pumpkin', ['pumpkin'])).toBe(true);
        expect(matchesLoot('  PUMPKIN  ', ['Pumpkin'])).toBe(true);
        expect(matchesLoot('Pumpkin pie', ['Pumpkin'])).toBe(false);
        expect(matchesLoot(null, ['Pumpkin'])).toBe(false);
    });

    test('banking keeps coins and only the desired food amount', () => {
        expect(shouldDepositOnBank('Coins', 'Trout', 50, 10)).toBe(false);
        expect(shouldDepositOnBank('Pumpkin', 'Trout', 5, 10)).toBe(true);
        expect(shouldDepositOnBank('Trout', 'Trout', 5, 10)).toBe(false);
        expect(shouldDepositOnBank('Trout', 'Trout', 15, 10)).toBe(true);
    });

    test('banking triggers at the slot threshold or a full pack with loot', () => {
        expect(shouldBankLoot(0, 28, true)).toBe(false);
        expect(shouldBankLoot(27, 28, false)).toBe(false);
        expect(shouldBankLoot(28, 28, false)).toBe(true);
        expect(shouldBankLoot(1, 28, true)).toBe(true);
    });

    test('idle banking uses the last loot time', () => {
        expect(shouldIdleBank(600_000, 0, 600_000)).toBe(true);
        expect(shouldIdleBank(599_999, 0, 600_000)).toBe(false);
    });
});

describe('loot blacklist', () => {
    test('unreachable loot is blocked immediately for 30 minutes', () => {
        let now = 1_000;
        const blacklist = new LootBlacklist(() => now);
        expect(blacklist.failure(1, here, 'unreachable')).toBe('blacklisted');
        expect(blacklist.blocked(1, here)).toBe(true);
        expect(blacklist.blocked(1, here.translate(1, 0))).toBe(false);

        now += LOOT_BLACKLIST_MS - 1;
        expect(blacklist.blocked(1, here)).toBe(true);
        now += 1;
        expect(blacklist.blocked(1, here)).toBe(false);
    });

    test('ambiguous failures only blacklist after 30 seconds of stuck attempts', () => {
        let now = 1_000;
        const blacklist = new LootBlacklist(() => now);
        expect(blacklist.failure(1, here, 'retry')).toBe('retrying');

        now += LOOT_STUCK_MS - 1;
        expect(blacklist.failure(1, here, 'retry')).toBe('retrying');
        now += 1;
        expect(blacklist.failure(1, here, 'retry')).toBe('blacklisted');
        expect(blacklist.blocked(1, here)).toBe(true);
    });

    test('damage near a pickup marks its item+tile unsafe immediately', () => {
        const blacklist = new LootBlacklist(() => 1_000);
        blacklist.markUnsafe(1, here);
        expect(blacklist.blocked(1, here)).toBe(true);
        expect(blacklist.count()).toBe(1);
    });

    test('a successful pickup clears both the stuck timer and the blacklist', () => {
        let now = 1_000;
        const blacklist = new LootBlacklist(() => now);
        blacklist.failure(1, here, 'retry');
        now += LOOT_STUCK_MS;
        blacklist.failure(1, here, 'retry');
        expect(blacklist.blocked(1, here)).toBe(true);

        blacklist.success(1, here);
        expect(blacklist.blocked(1, here)).toBe(false);
    });
});

describe('wander targets', () => {
    test('prefers a navigable 30-step target', () => {
        let checked = 0;
        const target = pickWanderTile(here, 30, tile => {
            checked++;
            return tile.distanceTo(here) === 30;
        }, () => 0.5);

        expect(checked).toBe(1);
        expect(target?.distanceTo(here)).toBe(30);
    });

    test('falls back to a shorter navigable hop', () => {
        const target = pickWanderTile(here, 30, tile => tile.distanceTo(here) === 15, () => 0.25);
        expect(target?.distanceTo(here)).toBe(15);
    });

    test('always steps down to level 0 instead of wandering upstairs', () => {
        const upstairs = new Tile(3200, 3200, 1);
        for (const roll of [0, 0.5, 0.99]) {
            const target = pickWanderTile(upstairs, 30, tile => tile.level === 0, () => roll);
            expect(target).toEqual(new Tile(3200, 3200, 0));
        }
    });

    test('never chooses an upper floor from ground level', () => {
        const target = pickWanderTile(here, 30, () => true, () => 0);
        expect(target?.level).toBe(0);
    });

    test('avoids doubling back while forward targets remain navigable', () => {
        const target = pickWanderTile(here, 30, () => true, () => 0.5, [0, -1]);
        expect(target).not.toBeNull();
        expect(target!.z).toBeLessThanOrEqual(here.z);
    });

    test('allows a backwards hop when it is the only navigable option', () => {
        const target = pickWanderTile(here, 30, tile => tile.z > here.z, () => 0.5, [0, -1]);
        expect(target).not.toBeNull();
    });

    test('returns null instead of walking to an unnavigable tile', () => {
        let checked = 0;
        const target = pickWanderTile(here, 30, () => {
            checked++;
            return false;
        }, () => 0.5);

        expect(target).toBeNull();
        expect(checked).toBe(24);
    });
});
