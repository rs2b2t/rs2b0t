import { expect, test } from 'bun:test';
import { Survival, SurvivalFailure, safetyThresholds, type SurvivalPort, type SurvivalState } from '../../src/bot/scripts/JiveTT/survival.js';

function fixture(overrides: Partial<SurvivalState> = {}) {
    const state: SurvivalState = { ready: true, hp: 90, maxHp: 90, prayer: 70, maxPrayer: 70, sharks: 15, prayerDoses: 12, shield: true, poisoned: false, tick: 1, boosts: { attack: 0, strength: 0, defence: 0 }, ...overrides };
    const calls: string[] = [];
    const active = new Set<string>();
    const port: SurvivalPort = {
        state: () => state,
        eat: async () => { calls.push('eat'); state.hp += 20; state.sharks--; return true; },
        drink: async family => { calls.push(family); if (family === 'prayer') { state.prayer += 20; state.prayerDoses--; } return true; },
        prayerActive: name => active.has(name),
        setPrayer: async name => { calls.push(name); active.add(name); return true; }
    };
    return { state, calls, active, port, owner: new Survival(port, { offensivePrayers: false, boostThreshold: 0.1, eatHp: 65, retreatHp: 45 }) };
}

test('guardian upkeep owns the overhead and replenishes prayer', async () => {
    const f = fixture({ prayer: 7 });
    await f.owner.run({ phase: 'guardian', dragonfire: false, antipoison: false });
    expect(f.calls).toContain('prayer');
    expect(f.active.has('Protect from Magic')).toBe(true);
    expect(f.active.has('Protect from Melee')).toBe(false);
});

test('a failed drink or unconfirmed overhead prevents a fight', async () => {
    const f = fixture({ prayer: 3 });
    f.port.drink = async () => false;
    await expect(f.owner.run({ phase: 'hunt', dragonfire: false, antipoison: false })).rejects.toBeInstanceOf(SurvivalFailure);
    expect(f.calls).not.toContain('Protect from Melee');
    f.state.prayer = 70;
    f.port.setPrayer = async () => true;
    await expect(f.owner.run({ phase: 'hunt', dragonfire: false, antipoison: false })).rejects.toThrow('Protect from Melee');
});

test('mixed sites require shield and refresh antifire before expiration', async () => {
    const f = fixture();
    const hazard = { phase: 'hunt', dragonfire: true, antipoison: false } as const;
    await f.owner.run(hazard);
    expect(f.calls.filter(c => c === 'antifire')).toHaveLength(1);
    f.state.tick = 560;
    await f.owner.run(hazard);
    expect(f.calls.filter(c => c === 'antifire')).toHaveLength(1);
    f.state.tick = 581;
    await f.owner.run(hazard);
    expect(f.calls.filter(c => c === 'antifire')).toHaveLength(2);
    f.state.shield = false;
    await expect(f.owner.run(hazard)).rejects.toThrow('shield');
});

test('reserves and hazard floors cannot be lowered through settings', async () => {
    expect(safetyThresholds(90, 1, 1)).toEqual({ eat: 65, retreat: 45 });
    const f = fixture({ sharks: 3 });
    expect(f.owner.canStartFight()).toBe(false);
    f.state.sharks = 15;
    f.state.hp = 44;
    await expect(f.owner.run({ phase: 'hunt', dragonfire: false, antipoison: false })).rejects.toThrow('Emergency');
});

test('travel upkeep eats and cures poison without wasting defence under melee prayer', async () => {
    const f = fixture({ hp: 60, poisoned: true });
    await f.owner.run({ phase: 'travel', dragonfire: false, antipoison: false });
    expect(f.calls).toContain('eat');
    expect(f.calls).toContain('superantipoison');
    f.calls.length = 0;
    f.state.poisoned = false;
    await f.owner.run({ phase: 'hunt', dragonfire: false, antipoison: false });
    expect(f.calls).not.toContain('defence');
});

test('guardian potion delays recheck health before the next action', async () => {
    const f = fixture();
    f.port.drink = async family => { f.calls.push(family); f.state.hp -= 20; return true; };
    await f.owner.run({ phase: 'guardian', dragonfire: false, antipoison: false });
    expect(f.calls.indexOf('eat')).toBeGreaterThan(f.calls.indexOf('strength'));
    expect(f.calls.indexOf('eat')).toBeLessThan(f.calls.indexOf('defence'));
});

test('retreat keeps protective upkeep active without recursing on exhausted supplies', async () => {
    const f = fixture({ hp: 44, prayer: 5 });
    f.owner.retreating = true;
    await f.owner.run({ phase: 'hunt', dragonfire: true, antipoison: false });
    expect(f.calls).toContain('eat');
    expect(f.calls).toContain('antifire');
    expect(f.calls).toContain('prayer');
    expect(f.active.has('Protect from Melee')).toBe(true);
    expect(f.calls).not.toContain('attack');
    f.port.drink = async () => false;
    f.state.tick += 600;
    await expect(f.owner.run({ phase: 'hunt', dragonfire: true, antipoison: false })).resolves.toBeUndefined();
});

test('low health after a verified escape heals during safe bank travel', async () => {
    const f = fixture({ hp: 44 });
    await f.owner.run({ phase: 'travel', dragonfire: false, antipoison: false });
    expect(f.calls).toContain('eat');
    expect(f.calls).not.toContain('antifire');
});
