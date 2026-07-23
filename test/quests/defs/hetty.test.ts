import { expect, test, describe } from 'bun:test';
import { decide, gatherOnion, gatherRatsTail, gatherEyeOfNewt, gatherBurntMeat, hetty } from '#/bot/quests/defs/hetty.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (journal: string, items: [string, number][] = [], bankCoins = 0): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(items),
    worn: new Set(),
    noProgress: 0,
    bankCoins
});

const ALL_FOUR: [string, number][] = [['rats tail', 1], ['onion', 1], ['eye of newt', 1], ['burnt meat', 1]];

describe('hetty decide — quest states', () => {
    test('complete -> done, unknown -> wait', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
    });

    test('notStarted talks to Hetty with the start dialogue options', () => {
        const s = decide(snap('notStarted'));
        expect(s.kind === 'talk' && s.stop.npc).toBe('Hetty');
        expect(s.kind === 'talk' && s.stop.prefer).toEqual(['I am in search of a quest.', 'Yes help me become one with my darker side.']);
    });

    test('holding all four ingredients hands in and drinks (one custom step)', () => {
        const s = decide(snap('inProgress', ALL_FOUR));
        expect(s.kind).toBe('custom');
        expect(s.kind === 'custom' && s.name).toMatch(/drink/i);
    });
});

describe('hetty decide — gather routing (record-item order, self-heal any gap)', () => {
    test('nothing held -> the quest-gated rat tail first', () => {
        const s = decide(snap('inProgress'));
        expect(s.kind === 'custom' && s.name).toMatch(/rat/i);
    });
    test('tail held -> onion next', () => {
        const s = decide(snap('inProgress', [['rats tail', 1]]));
        expect(s.kind === 'pickLoc' && s.item).toBe('Onion');
    });
    test('tail+onion held, funded -> buy the eye of newt from Betty', () => {
        const s = decide(snap('inProgress', [['rats tail', 1], ['onion', 1]], 50));
        expect(s.kind === 'buy' && s.shop.npc).toBe('Betty');
        expect(s.kind === 'buy' && s.item).toBe('Eye of newt');
    });
    test('tail+onion+eye held, funded -> burnt meat buys raw beef from Wydin', () => {
        const s = decide(snap('inProgress', [['rats tail', 1], ['onion', 1], ['eye of newt', 1]], 50));
        expect(s.kind === 'buy' && s.shop.npc).toBe('Wydin');
        expect(s.kind === 'buy' && s.item).toBe('Raw beef');
    });
});

describe('hetty gathers — startedOr gate + shape', () => {
    test('every gather starts the quest first when notStarted (the rat tail is quest-gated)', () => {
        for (const g of [gatherOnion, gatherRatsTail, gatherEyeOfNewt, gatherBurntMeat]) {
            const s = g(snap('notStarted'));
            expect(s.kind === 'talk' && s.stop.npc).toBe('Hetty');
        }
    });
    test('onion picks from the field; rat tail is a custom kill', () => {
        expect(gatherOnion(snap('inProgress')).kind).toBe('pickLoc');
        expect(gatherRatsTail(snap('inProgress')).kind).toBe('custom');
    });
    test('eye of newt: buy when funded, park when broke', () => {
        expect(gatherEyeOfNewt(snap('inProgress', [], 50)).kind).toBe('buy');
        const broke = gatherEyeOfNewt(snap('inProgress'));
        expect(broke.kind === 'wait' && broke.reason).toMatch(/gp for Eye of newt/);
    });
    test('burnt meat: raw meat first (buy), then the burn custom once meat is held', () => {
        expect(gatherBurntMeat(snap('inProgress', [], 50)).kind).toBe('buy');
        expect(gatherBurntMeat(snap('inProgress', [['raw beef', 2]])).kind).toBe('custom');
        expect(gatherBurntMeat(snap('inProgress', [['cooked meat', 1]])).kind).toBe('custom');
        const broke = gatherBurntMeat(snap('inProgress'));
        expect(broke.kind === 'wait' && broke.reason).toMatch(/gp for Raw beef/);
    });
});

describe('hetty module wiring', () => {
    test('binds the existing record, banks at Draynor, grinds the Rat, gathers all four', () => {
        expect(hetty.record.id).toBe('hetty');
        expect(hetty.record.name).toBe("Witch's Potion");
        expect(hetty.grind).toContain('Rat');
        expect(Object.keys(hetty.gather ?? {}).sort()).toEqual(['burnt meat', 'eye of newt', 'onion', 'rats tail']);
    });
});
