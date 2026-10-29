import { describe, expect, test } from 'bun:test';
import { resumePreparation } from '#/bot/api/ai/quests/engine/resumePreparation.js';
import type { QuestModule, QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const moduleFor = (id = 'imp', extra: Partial<QuestModule> = {}): QuestModule => ({
    record: { id, name: id, questPoints: 1, requirements: {}, items: [] },
    decide: () => ({ kind: 'done' }),
    ...extra
});
const snap = (extra: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
    journal: 'inProgress', inv: new Map(), worn: new Set(['rune platebody']),
    wornIds: new Set([1127]), noProgress: 0, bankCoins: 0, freeSlots: 0, ...extra
});
const item = (id: number, name: string | null, count = 1, noted = false) => ({ id, name, count, noted });
const essence = () => Array.from({ length: 28 }, () => item(1436, 'Rune essence'));

describe('resumePreparation', () => {
    test('clears a full essence pack without confusing essence with spell runes', () => {
        expect(resumePreparation(moduleFor(), snap(), essence(), 'Trout')).toEqual({ keepIds: [], caps: [] });
    });

    test('does not prepare an unstarted, unread, completed or roomy pack', () => {
        for (const journal of ['notStarted', 'unknown', 'complete'] as const) {
            expect(resumePreparation(moduleFor(), snap({ journal }), essence(), 'Trout')).toBeNull();
        }
        expect(resumePreparation(moduleFor(), snap({ freeSlots: 5 }), essence(), 'Trout')).toBeNull();
        expect(resumePreparation(moduleFor(), snap({ freeSlots: undefined }), essence(), 'Trout')).toBeNull();
    });

    test('preserves exact quest objects sharing display names and single-copy intermediates', () => {
        const inventory = [item(779, 'Crest part'), item(780, 'Crest part'), item(781, 'Crest part'),
            item(446, "'perfect' gold ore"), item(2365, "'perfect' gold bar"), item(623, 'Sword pommel'),
            item(609, 'Rashiliya corpse'), item(610, 'Zadimus corpse'), item(605, 'Bone key'), item(1436, 'Rune essence')];
        expect(resumePreparation(moduleFor(), snap(), inventory, null)).toEqual({
            keepIds: [779, 780, 781, 446, 2365, 623, 609, 610, 605], caps: []
        });
    });

    test.each([
        ['tbwt', [item(3157, 'Karambwan vessel'), item(3159, 'Karambwan vessel'), item(3125, 'Jogre bones')], [3157, 3159, 3125]],
        ['upass', [item(942, 'Lit arrows', 10), item(1035, 'Zamorak monk top')], [942, 1035]],
        ['legends', [item(727, 'Hollow reed'), item(975, 'Machete')], [727, 975]],
        ['hero', [item(1586, 'Miscellaneous key'), item(1577, "Pete's candlestick"), item(97, 'Unfinished potion')], [1586, 1577, 97]]
    ])('preserves %s tradeable quest supplies', (id, supplies, keepIds) => {
        expect(resumePreparation(moduleFor(id), snap(), [...supplies, item(1436, 'Rune essence')], null))
            .toEqual({ keepIds, caps: [] });
    });

    test('keeps coins, spell runes, potions and normalized declared tools', () => {
        const inventory = [item(995, 'Coins', 300), item(556, 'Air rune', 500), item(560, 'Death rune', 50),
            item(177, 'Antipoison(2)'), item(139, 'Prayer potion(3)'), item(946, 'Knife'), item(1436, 'Rune essence')];
        expect(resumePreparation(moduleFor('imp', { tools: ['Knife'] }), snap(), inventory, null))
            .toEqual({ keepIds: [995, 556, 560, 177, 139, 946], caps: [] });
    });

    test('aggregates food slots and leaves room in a full food pack', () => {
        const inventory = Array.from({ length: 28 }, () => item(333, 'Trout'));
        expect(resumePreparation(moduleFor(), snap(), inventory, 'Trout'))
            .toEqual({ keepIds: [333], caps: [{ id: 333, qty: 8 }] });
    });

    test('limits mixed survival food to a shared allowance', () => {
        const inventory = [item(333, 'Trout', 8), item(379, 'Lobster', 20)];
        const module = moduleFor('imp', { sustain: { foods: ['Lobster'], eatBelowHp: 0.5 } });
        expect(resumePreparation(module, snap(), inventory, 'Trout'))
            .toEqual({ keepIds: [333, 379], caps: [{ id: 379, qty: 0 }] });
    });

    test('deposits noted food in bulk without consuming the unnoted food allowance', () => {
        const inventory = [item(386, 'Shark', 1000, true), item(385, 'Shark', 8)];
        expect(resumePreparation(moduleFor(), snap(), inventory, 'Shark'))
            .toEqual({ keepIds: [385], caps: [] });
    });

    test('caps only unnoted surplus when food display names collide', () => {
        const inventory = [item(385, 'Shark', 20), item(386, 'Shark', 1000, true)];
        expect(resumePreparation(moduleFor(), snap(), inventory, 'Shark'))
            .toEqual({ keepIds: [385], caps: [{ id: 385, qty: 8 }] });
    });

    test('does not preserve noted quest materials or tools', () => {
        const module = moduleFor('death', { tools: ['pickaxe'] });
        const inventory = [item(2310, 'Bread', 1000, true), item(1266, 'Bronze pickaxe', 20, true)];
        expect(resumePreparation(module, snap(), inventory, 'Bread')).toEqual({ keepIds: [], caps: [] });
    });

    test('banks duplicate physical spare equipment while keeping one usable copy', () => {
        const inventory = Array.from({ length: 28 }, () => item(1333, 'Rune scimitar'));
        expect(resumePreparation(moduleFor(), snap(), inventory, null))
            .toEqual({ keepIds: [1333], caps: [{ id: 1333, qty: 1 }] });
    });

    test('keeps equipment required by quest IDs, tools and declared materials', () => {
        const equipment = Array.from({ length: 28 }, () => item(1333, 'Rune scimitar'));
        expect(resumePreparation(moduleFor('imp', { tools: ['scimitar'] }), snap(), equipment, null)).toBeNull();
        const module = moduleFor();
        module.record.items = [{ name: 'Rune scimitar', qty: 2, kind: 'mustHave' }];
        expect(resumePreparation(module, snap(), equipment, null)).toBeNull();
        const disguise = Array.from({ length: 28 }, () => item(1125, 'Black platebody'));
        expect(resumePreparation(moduleFor('hero'), snap(), disguise, null)).toBeNull();
        const staffs = Array.from({ length: 28 }, () => item(1409, 'Staff of iban'));
        expect(resumePreparation(moduleFor(), snap(), staffs, null)).toBeNull();
    });

    test('does not mistake stacked ammunition and thrown weapons for duplicate gear slots', () => {
        const inventory = [item(882, 'Bronze arrow', 1000), item(806, 'Bronze dart', 1000), item(1436, 'Rune essence')];
        expect(resumePreparation(moduleFor(), snap(), inventory, null))
            .toEqual({ keepIds: [882, 806], caps: [] });
    });

    test('preserves required Death Plateau hand-in food and caps surplus Family Crest ingredients', () => {
        const death = [item(2309, 'Bread', 10), item(333, 'Trout', 10), item(1436, 'Rune essence')];
        expect(resumePreparation(moduleFor('death'), snap(), death, 'Trout'))
            .toEqual({ keepIds: [2309, 333], caps: [] });
        const module = moduleFor('crest');
        module.record.items = [{ name: 'Swordfish', qty: 1, kind: 'acquirable' }];
        expect(resumePreparation(module, snap(), [item(373, 'Swordfish', 12), item(1436, 'Rune essence')], 'Swordfish'))
            .toEqual({ keepIds: [373], caps: [{ id: 373, qty: 1 }] });
    });

    test.each([
        ['death', 333, 'Trout', 10],
        ['death', 2309, 'Bread', 10],
        ['crest', 373, 'Swordfish', 1]
    ])('makes room in a full %s material-food pack', (quest, id, name, qty) => {
        expect(resumePreparation(moduleFor(quest), snap(), Array.from({ length: 28 }, () => item(id, name)), name))
            .toEqual({ keepIds: [id], caps: [{ id, qty }] });
        expect(resumePreparation(moduleFor(quest), snap(), [item(id, name, qty - 1), item(1436, 'Rune essence')], name))
            .toEqual({ keepIds: qty > 1 ? [id] : [], caps: [] });
    });

    test('honors declared food quantities above the material minimum', () => {
        const module = moduleFor('death');
        module.record.items = [{ name: 'Trout', qty: 12, kind: 'acquirable' }];
        expect(resumePreparation(module, snap(), [item(333, 'Trout', 28)], 'Trout'))
            .toEqual({ keepIds: [333], caps: [{ id: 333, qty: 12 }] });
    });

    test.each([723, 724, 725, 726])('does not send a filled Legends bowl %i to the bank', id => {
        const inventory = [item(id, 'Golden bowl'), ...essence().slice(1)];
        expect(resumePreparation(moduleFor('legends'), snap(), inventory, 'Trout')).toBeNull();
        expect(resumePreparation(moduleFor('legends'), snap({ invIds: new Map([[id, 1]]) }), essence(), 'Trout')).toBeNull();
    });

    test.each([
        ['eadgar', 2116, 'Pineapple chunks'],
        ['tbwt', 1963, 'Banana']
    ])('does not trim %s quest materials selected as food', (quest, id, name) => {
        expect(resumePreparation(moduleFor(quest), snap(), [item(id, name, 12), item(1436, 'Rune essence')], name))
            .toEqual({ keepIds: [id], caps: [] });
    });

    test('returns no work for protected-only packs and does not change equipment or snapshots', () => {
        const state = snap();
        const inventory = [item(995, 'Coins', 100), item(605, 'Bone key'), item(99999, null)];
        const before = structuredClone({ state, inventory });
        expect(resumePreparation(moduleFor(), state, inventory, 'Trout')).toBeNull();
        expect({ state, inventory }).toEqual(before);
    });
});
