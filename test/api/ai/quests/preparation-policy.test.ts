import { describe, expect, test } from 'bun:test';
import { QUESTS } from '#/bot/api/ai/quests/data/quests.js';
import { questPreparationRequest } from '#/bot/api/ai/quests/engine/preparationPolicy.js';
import type { QuestModule } from '#/bot/api/ai/quests/engine/types.js';

const moduleFor = (id: string, extra: Partial<QuestModule> = {}): QuestModule => ({
    record: QUESTS.find(record => record.id === id)!, decide: () => ({ kind: 'done' }), ...extra
});
const stock = (items: [string, number][]) => new Map(items);

describe('quest preparation policy', () => {
    test('does not acquire supplies for unknown or completed quests', () => {
        expect(questPreparationRequest(moduleFor('upass'), 'Trout', 'unknown')).toBeNull();
        expect(questPreparationRequest(moduleFor('upass'), 'Trout', 'complete')).toBeNull();
    });

    test('does not impose combat food on peaceful quests without a food policy', () => {
        expect(questPreparationRequest(moduleFor('cook'), 'Lobster', 'notStarted')?.food).toBeUndefined();
        expect(questPreparationRequest(moduleFor('sheep'), 'Lobster', 'notStarted')?.food).toBeUndefined();
    });

    test('leaves food acquisition to modules that gather their own travel food', () => {
        const sustain = { foods: ['Cake'], eatBelowHp: 1 };
        expect(questPreparationRequest(moduleFor('waterfall', { sustain }), 'Lobster', 'notStarted')?.food).toBeUndefined();
        expect(questPreparationRequest(moduleFor('desertrescue', { sustain }), null, 'notStarted')?.food).toBeUndefined();
    });

    test('prepares ordinary required goods while leaving unique quest keys to their stages', () => {
        const module = moduleFor('cook');
        module.record = { ...module.record, items: [
            { name: 'Hammer', qty: 1, kind: 'mustHave' },
            { name: 'Ghostspeak amulet', qty: 1, kind: 'mustHave' }
        ] };
        expect(questPreparationRequest(module, null, 'notStarted')?.items).toEqual([{ item: 'Hammer', count: 1 }]);
        expect(questPreparationRequest(module, null, 'inProgress')?.items).toBeUndefined();
    });

    test('prepares the food accepted by strict quest loadouts despite the configured food', () => {
        expect(questPreparationRequest(moduleFor('upass'), 'Trout', 'notStarted')?.food).toEqual({ item: 'Lobster', count: 8 });
        expect(questPreparationRequest(moduleFor('regicide'), 'Trout', 'notStarted')?.food).toEqual({ item: 'Shark', count: 8 });
    });

    test('does not gather spent ingredients or source-only skills when resuming', () => {
        const request = questPreparationRequest(moduleFor('regicide'), 'Trout', 'inProgress');
        expect(request?.items).toBeUndefined();
        expect(request?.skills).not.toContainEqual({ skill: 'mining', level: 30 });
        expect(request?.food).toEqual({ item: 'Shark', count: 8 });
    });

    test('banked iron bars avoid training the Knight sword sourcing skills', () => {
        const empty = questPreparationRequest(moduleFor('squire'), null, 'notStarted');
        const supplied = questPreparationRequest(moduleFor('squire'), null, 'notStarted', stock([['iron bar', 2]]));
        expect(empty?.skills).toContainEqual({ skill: 'mining', level: 15 });
        expect(empty?.skills).toContainEqual({ skill: 'smithing', level: 15 });
        expect(supplied?.skills).toContainEqual({ skill: 'mining', level: 10 });
        expect(supplied?.skills?.some(req => req.skill === 'smithing')).toBe(false);
    });

    test('raw fish skip catching skill requirements while still requiring cooking', () => {
        const supplied = stock([['raw swordfish', 1], ['bass', 1], ['tuna', 1], ['salmon', 1], ['shrimps', 1]]);
        const request = questPreparationRequest(moduleFor('crest'), 'Tuna', 'notStarted', supplied);
        expect(request?.skills?.some(req => req.skill === 'fishing')).toBe(false);
        expect(request?.skills).toContainEqual({ skill: 'cooking', level: 45 });
        expect(request?.food?.item).not.toBe('Tuna');
    });

    test('banked bow intermediates avoid unnecessary woodcutting and crafting training', () => {
        const request = questPreparationRequest(moduleFor('ikov'), 'Trout', 'notStarted', stock([['yew logs', 1], ['bow string', 1]]));
        expect(request?.skills).toContainEqual({ skill: 'fletching', level: 65 });
        expect(request?.skills?.some(req => req.skill === 'woodcutting' || req.skill === 'crafting')).toBe(false);
        expect(questPreparationRequest(moduleFor('ikov'), 'Trout', 'notStarted', stock([['yew shortbow', 1]]))?.skills)
            .toEqual([{ skill: 'thieving', level: 42 }, { skill: 'ranged', level: 40 }]);
    });

    test('distinguishes unstrung and strung bows with the same display name', () => {
        const names = stock([['yew shortbow', 1], ['bow string', 1]]);
        const unfinished = questPreparationRequest(moduleFor('ikov'), null, 'notStarted', names, new Map([[68, 1]]));
        expect(unfinished?.skills).toContainEqual({ skill: 'fletching', level: 65 });
        expect(unfinished?.skills?.some(req => req.skill === 'woodcutting')).toBe(false);
        const ready = questPreparationRequest(moduleFor('ikov'), null, 'notStarted', names, new Map([[857, 1]]));
        expect(ready?.skills?.some(req => req.skill === 'fletching')).toBe(false);
    });

    test('banked steel bars avoid mining training for Dragon Slayer nails', () => {
        const request = questPreparationRequest(moduleFor('dragon'), null, 'notStarted', stock([['steel bar', 6], ['unfired bowl', 1]]));
        expect(request?.skills).toContainEqual({ skill: 'smithing', level: 34 });
        expect(request?.skills?.some(req => req.skill === 'mining' || req.skill === 'crafting')).toBe(false);
    });

    test('preserves explicit optional prayer strategy while preparing declared protection elsewhere', () => {
        const pray = { protect: 'melee' as const, potions: 2 };
        expect(questPreparationRequest(moduleFor('troll', { pray }), 'Trout', 'notStarted')?.skills?.some(req => req.skill === 'prayer')).toBe(false);
        expect(questPreparationRequest(moduleFor('ball', { pray }), 'Trout', 'notStarted')?.skills)
            .toContainEqual({ skill: 'prayer', level: 43 });
    });

    test('requests ordinary bank-only tools without trying to acquire unique quest items', () => {
        const request = questPreparationRequest(moduleFor('elemental_workshop'), 'Trout', 'notStarted');
        expect(request?.items).toContainEqual({ item: 'Hammer', count: 1 });
        expect(request?.items).toContainEqual({ item: 'Thread', count: 1 });
        expect(request?.items?.some(item => item.item === 'Battered key')).toBe(false);
    });

    test('prepares the lava eel chain only through its outstanding steps', () => {
        const missing = questPreparationRequest(moduleFor('hero'), null, 'notStarted');
        expect(missing?.skills).toContainEqual({ skill: 'fishing', level: 53 });
        expect(missing?.skills).toContainEqual({ skill: 'herblore', level: 25 });
        const raw = questPreparationRequest(moduleFor('hero'), null, 'notStarted', stock([['raw lava eel', 1], ['ice gloves', 1]]));
        expect(raw?.skills).toEqual([{ skill: 'cooking', level: 53 }]);
        const rod = questPreparationRequest(moduleFor('hero'), null, 'notStarted', stock([['oily fishing rod', 1]]));
        expect(rod?.skills?.some(req => req.skill === 'herblore')).toBe(false);
    });
});

test('Tourist Trap prepares eight configured rations before entering the desert', () => {
    expect(questPreparationRequest(moduleFor('desertrescue'), 'Cake', 'notStarted')?.food).toEqual({ item: 'Cake', count: 8 });
});

test('Tourist Trap resumes through its own safe supply routes instead of generic preparation banking', () => {
    expect(questPreparationRequest(moduleFor('desertrescue'), 'Cake', 'inProgress')).toBeNull();
});
