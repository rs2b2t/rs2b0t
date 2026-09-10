import { afterEach, expect, spyOn, test } from 'bun:test';
import { armourChoice } from '#/bot/api/ai/quests/armour.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';

afterEach(() => {
    spyOn(Skills, 'level').mockRestore();
    spyOn(Quests, 'status').mockRestore();
});

function snap(overrides: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return { journal: 'inProgress', inv: new Map(), worn: new Set(), bankKnown: true,
        noProgress: 0, bankCoins: 0, ...overrides };
}

test.each([[39, 1111], [40, 1113]])('selects the wearable body at Defence %i', (defence, expected) => {
    spyOn(Skills, 'level').mockReturnValue(defence);
    const choice = armourChoice(snap({ bankIds: new Map([[1111, 1], [1113, 1]]) }), 'torso');
    expect(choice?.id).toBe(expected);
});

test('preserves already worn ranged armor', () => {
    const choice = armourChoice(snap({ worn: new Set(['studded body']), bankIds: new Map([[1113, 1]]) }), 'torso');
    expect(choice?.name).toBe('Studded body');
});

test('ignores a stale bank when its contents are unknown', () => {
    spyOn(Skills, 'level').mockReturnValue(40);
    const choice = armourChoice(snap({ bankKnown: false, bankIds: new Map([[1113, 1]]) }), 'torso');
    expect(choice).toBeNull();
});

test('prefers carried usable armor over higher banked armor', () => {
    spyOn(Skills, 'level').mockReturnValue(40);
    const choice = armourChoice(snap({ invIds: new Map([[1111, 1]]), bankIds: new Map([[1113, 1]]) }), 'torso');
    expect(choice?.id).toBe(1111);
});

test.each(['notStarted', 'complete'] as const)('respects the Rune platebody quest gate when Dragon Slayer is %s', status => {
    spyOn(Skills, 'level').mockReturnValue(40);
    spyOn(Quests, 'status').mockReturnValue(status);
    const choice = armourChoice(snap({ bankIds: new Map([[1127, 1]]) }), 'torso');
    expect(choice?.id ?? null).toBe(status === 'complete' ? 1127 : null);
});

for (const [id, slot, defence, ranged] of [
    [1129, 'torso', 1, 1], [1095, 'legs', 1, 1], [1167, 'hat', 1, 1],
    [1131, 'torso', 10, 1], [1133, 'torso', 20, 20], [1097, 'legs', 1, 20], [1169, 'hat', 1, 20]
] as const) {
    for (const location of ['invIds', 'bankIds'] as const) {
        test(`selects ranged armor ${id} from ${location} at its exact gates`, () => {
            spyOn(Skills, 'level').mockImplementation(skill => skill === 'defence' ? defence : ranged);
            expect(armourChoice(snap({ [location]: new Map([[id, 1]]) }), slot)?.id).toBe(id);
        });
    }
}

for (const [id, slot, defence, ranged] of [
    [1131, 'torso', 9, 70], [1133, 'torso', 19, 20], [1133, 'torso', 20, 19],
    [1097, 'legs', 70, 19], [1169, 'hat', 70, 19], [1129, 'torso', 70, 0]
] as const) {
    test(`rejects ranged armor ${id} at Defence ${defence}, Ranged ${ranged}`, () => {
        spyOn(Skills, 'level').mockImplementation(skill => skill === 'defence' ? defence : ranged);
        expect(armourChoice(snap({ bankIds: new Map([[id, 1]]) }), slot)).toBeNull();
    });
}

test('uses snapshot Ranged to avoid selecting an unwearable coif', () => {
    spyOn(Skills, 'level').mockReturnValue(70);
    expect(armourChoice(snap({ ranged: 19, bankIds: new Map([[1169, 1], [1167, 1]]) }), 'hat')?.id).toBe(1167);
});
