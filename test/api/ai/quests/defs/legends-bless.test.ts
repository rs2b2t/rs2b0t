import { expect, test } from 'bun:test';

import { blessPrayerFloor, needsDose } from '#/bot/api/ai/quests/defs/legends/shaman.js';

/** `gujuo_bless_bowl`'s roll: `stat_random(prayer, 80, 250)`, where true is the miss. */
function missChance(points: number): number {
    const value = Math.floor((80 * (99 - points)) / 98) + Math.floor((250 * (points - 1)) / 98) + 1;
    return value / 256;
}

// Why: each prayer point adds about 1.73 to the failure roll.
test('the trance only gets harder as prayer rises', () => {
    expect(missChance(42)).toBeLessThan(missChance(70));
    expect(missChance(70)).toBeLessThan(missChance(99));
});

// Why: 42 is both Gujuo's minimum and the best success chance.
test('the floor is the gate itself, whatever the bar can hold', () => {
    expect(blessPrayerFloor()).toBe(42);
    expect(missChance(blessPrayerFloor())).toBeLessThan(missChance(43));
});

// Why: the stat block can lag a miss, so waiting would waste a second throw.
test('a miss is counted rather than waited for', () => {
    expect(needsDose('missed', 42)).toBe(true);
    expect(needsDose('missed', 37)).toBe(true);
});

// Why: Gujuo's refusal is authoritative when the stat block lags.
test('a refusal is believed over the stat block', () => {
    expect(needsDose('refused', 99)).toBe(true);
});

// Why: extra prayer above the five-point cost only worsens the odds.
test('a miss with room to spare does not drink', () => {
    expect(needsDose('missed', 99)).toBe(false);
    expect(needsDose('quiet', 20)).toBe(false);
});
