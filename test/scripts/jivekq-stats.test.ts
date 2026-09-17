import { expect, test } from 'bun:test';
import { CombatStats } from '../../src/bot/scripts/JiveKQ/stats.js';

test('DPS counts direct damage and includes time spent eating during the fight', () => {
    const stats = new CombatStats();
    stats.observe(0, 1000, false);
    stats.observe(1000, 1000, true);
    stats.observe(3000, 1040, true);
    stats.observe(6000, 1040, false);
    expect(stats.damage).toBe(10);
    expect(stats.fightingMs).toBe(5000);
    expect(stats.dps).toBe(2);
});

test('banking, respawn waits and paused time do not dilute combat DPS', () => {
    const stats = new CombatStats();
    stats.observe(0, 1000, true);
    stats.observe(2000, 1040, false);
    stats.observe(30000, 1080, false);
    stats.observe(60000, 1080, true);
    stats.observe(62000, 1120, false);
    expect(stats.damage).toBe(20);
    expect(stats.fightingMs).toBe(4000);
    expect(stats.dps).toBe(5);
});

test('XP resets and a newly started script cannot create negative damage or infinite DPS', () => {
    const stats = new CombatStats();
    expect(stats.dps).toBe(0);
    stats.observe(1000, 1000, true);
    stats.observe(2000, 100, true);
    expect(stats.damage).toBe(0);
    expect(stats.dps).toBe(0);
});
