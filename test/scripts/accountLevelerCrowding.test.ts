import { expect, test } from 'bun:test';
import { CrowdWatch, crowdKey, spotCrowded, trainingArea } from '#/bot/scripts/AccountLeveler/crowding.js';
import { methodFor } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const spot = { x: 100, z: 100, level: 0 };
const area = { spot, radius: 10, bank: { ...spot, x: 110 } };
const peer = (name: string, x = 101, level = 0) => ({ name, tile: { ...spot, x, level } });

test('requires two individual peers to stay ten seconds, excluding self, other floors and the bank', () => {
    const watch = new CrowdWatch();
    const sample = (second: number) => watch.observe(second * 1000, area, spot, 'Player', [
        peer('PLAYER'), peer('One'), peer(second < 6 ? 'Passerby' : 'Two'), peer('Banker', 110), peer('Upstairs', 101, 1)
    ]);
    for (let second = 0; second < 16; second++) expect(sample(second)).toBe(false);
    expect(sample(16)).toBe(true);
    expect(watch.observe(17000, area, area.bank, 'Player', [peer('One'), peer('Two')])).toBe(false);
    expect(sample(18)).toBe(false);
    expect(sample(40)).toBe(false);
});

test('the crowd watcher skips fishing', () => {
    expect(trainingArea({ id: 'fish', label: 'Fish', script: 'Fisher', objective: 'fishing', needs: [], settings: { location: 'Catherby' } })).toBeUndefined();
});

test('woodcutting rotates to another available site until its crowd cooldown expires', () => {
    const s: LevelerSnapshot = { levels: Object.fromEntries(enabledSkills.map(skill => [skill, 60])), stock: { coins: 500000, shrimps: 30 },
        bankReady: true, quests: {}, target: 70, wilderness: false, now: 1000 };
    const memory = emptyMemory();
    const choose = () => methodFor(s, 'woodcutting', memory, () => 0)!;
    const original = choose();
    const first = trainingArea(original)!;
    expect(original.settings.location).toBe('Seers Willows');
    memory.cooldowns[crowdKey(first.spot)] = s.now + 30 * 60000;
    expect(resolveActivity(s, original, memory, () => 0).kind).toBe('blocked');
    const other = choose();
    expect(other.settings.location).toBe('Draynor Willows');
    memory.cooldowns[crowdKey(trainingArea(other)!.spot)] = s.now + 30 * 60000;
    expect(choose()).toBeNull();
    s.now += 30 * 60000;
    expect(choose().id).toBe(original.id);
});

test('nearby training anchors share the cooldown on the same floor', () => {
    const memory = emptyMemory();
    memory.cooldowns[crowdKey(spot)] = 2000;
    expect(spotCrowded({ ...spot, x: 105 }, memory, 1000)).toBe(true);
    expect(spotCrowded({ ...spot, level: 1 }, memory, 1000)).toBe(false);
    expect(spotCrowded({ ...spot, z: 120 }, memory, 1000)).toBe(false);
    expect(spotCrowded(spot, memory, 2000)).toBe(false);
});

test('the crowd watcher skips green dragons for suppliers and Prayer training', () => {
    for (const objective of ['economy', 'prayer'] as const) {
        expect(trainingArea({ id: 'prayer-green-dragons', label: 'Green dragons', script: 'GreenDragon', objective, needs: [], settings: {} })).toBeUndefined();
    }
});
