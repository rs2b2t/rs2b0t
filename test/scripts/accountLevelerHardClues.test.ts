import { expect, test } from 'bun:test';
import Skill from '#/client/shell/Skill.js';
import { hardCluePlan, ownedClueId } from '#/bot/scripts/AccountLeveler/hardClues.js';
import { clueRequirements, missingClueRequirements } from '#/bot/api/ai/clues/requirements.js';
import type { LevelerSnapshot, SessionMemory } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({ levels: Object.fromEntries(Skill.names.map(name => [name, 80])), stock: { coins: 100000, shark: 100, lobster: 100, 'superantipoison(3)': 10, 'dragon dagger': 1, 'dusty key': 1, 'dragonfire shield': 1 }, quests: { 'Lost City': true, 'Dragon Slayer': true }, bankReady: true, target: 70, wilderness: false, now: 1000 });
const memory = (): SessionMemory => ({ objective: null, recent: [], attempted: {}, cooldowns: {}, deaths: 0 });

test('hard farming keeps running above the skill target with an actual hard drop source', () => {
    const plan = hardCluePlan(snapshot(), memory(), () => 0);
    expect('script' in plan && plan.script).toBe('AutoFighter');
    if (!('script' in plan)) return;
    expect(plan.settings.target).toBe('Hellhound');
    expect(plan.settings.solveClues).toBe(true);
    expect(plan.settings.prepareClueRequirements).toBe(true);
    expect(plan.settings.allowClueWilderness).toBe(false);
    expect(plan.needs.map(need => need.item)).toContain('Dusty key');
});

test('hard preparation can train beyond the configured level target', () => {
    const s = snapshot(); s.levels.cooking = 70; s.stock.shark = 0;
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.prerequisiteLevels).toEqual({ cooking: 80 });
});

test('blocked Regicide clues train required skills while retaining the clue', () => {
    const s = snapshot(); s.stock['#3564'] = 1; s.levels.agility = 20;
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.prerequisiteLevels?.agility).toBeGreaterThan(20);
    expect('script' in plan && plan.prerequisiteLevels?.agility).toBeLessThanOrEqual(56);
    expect(ownedClueId(s.stock)).toBe(3564);
});

test('clue quest prerequisites resolve ids into display names and run in order', () => {
    const s = snapshot(); s.stock['#3564'] = 1;
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.quest).toBe('Plague City');
});

test('failed clue prerequisites abandon through the solver instead of repeatedly replanning', () => {
    const s = snapshot(); s.stock['#3564'] = 1;
    const m = memory(); m.cooldowns['quest-elena'] = 5000;
    const plan = hardCluePlan(s, m, () => 0);
    expect('script' in plan && plan.settings.abandonClueId).toBe(3564);
});

test('Wilderness clues are rejected independently of prerequisite training', () => {
    expect(clueRequirements(2723).wilderness).toBe(true);
    expect(clueRequirements(2790).wilderness).toBe(false);
    expect(missingClueRequirements(3564, snapshot())).toEqual({ quests: ['Regicide'], skills: {} });
});

test('banked caskets are restored and solved before farming another clue', () => {
    const s = snapshot(); s.stock['#2724'] = 1;
    expect(ownedClueId(s.stock)).toBe(2724);
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.needs.some(need => need.id === 2724 && need.carry === 1)).toBe(true);
});

test('shield access starts Dragon Slayer without requiring the whole quest', () => {
    const s = snapshot(); s.quests['Dragon Slayer'] = false; s.stock['dragonfire shield'] = 0; s.questPoints = 32;
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.script).toBe('HardClueAccess');
    expect('script' in plan && plan.settings.item).toBe('Dragonfire shield');
});

test('herblore preparation finishes Druidic Ritual before applying the training goal', () => {
    const s = snapshot(); s.stock['superantipoison(3)'] = 0; s.levels.herblore = 1;
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.quest).toBe('Druidic Ritual');
    expect('script' in plan && plan.prerequisiteLevels).toBeUndefined();
});


test('combat preparation preserves its next milestone before the hard farm minimum', () => {
    const s = snapshot(); Object.assign(s.levels, { attack: 1, strength: 1, defence: 1, hitpoints: 10 });
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.prerequisiteLevels).toEqual({ strength: 5 });
});


test('hard clue melee preparation uses its own goal when the general target is lower', () => {
    const s = snapshot();
    s.target = 10;
    Object.assign(s.levels, { attack: 10, strength: 10, defence: 1 });
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.prerequisiteLevels).toEqual({ strength: 15 });
});

test('rejecting a Wilderness clue still prepares the hard kit before invoking the solver', () => {
    const s = snapshot(); s.stock['#2723'] = 1; s.stock.shark = 0; s.levels.cooking = 70;
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.prerequisiteLevels).toEqual({ cooking: 80 });
});


test('buying the guardian weapon resolves Zanaris access before attempting the shop', () => {
    const s = snapshot(); s.stock['dragon dagger'] = 0; s.stock['dramen staff'] = 1;
    const plan = hardCluePlan(s, memory(), () => 0);
    expect('script' in plan && plan.needs.slice(0, 2)).toEqual([{ item: 'Diamond', count: 1 }, { item: 'Dramen staff', count: 1 }]);
    s.levels.crafting = 35;
    const training = hardCluePlan(s, memory(), () => 0);
    expect('script' in training && training.prerequisiteLevels?.crafting).toBeGreaterThan(35);
    expect('script' in training && training.prerequisiteLevels?.crafting).toBeLessThanOrEqual(43);
    s.stock['dramen staff'] = 0;
    expect(hardCluePlan(s, memory(), () => 0)).toEqual({ reason: 'Need a Dramen staff to buy the hard clue guardian weapon; Lost City staff recovery is not supported' });
});
