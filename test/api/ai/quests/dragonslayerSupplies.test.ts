import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { dragonslayer } from '#/bot/api/ai/quests/defs/dragonslayer/index.js';
import { SUPPLY_GATHERS } from '#/bot/api/ai/quests/defs/dragonslayer/supplies.js';
import { planProvisioning } from '#/bot/api/ai/quests/engine/provisioning.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { Skills } from '#/bot/api/skills/Skills.js';

let levels = spyOn(Skills, 'effective');
beforeEach(() => { levels = spyOn(Skills, 'effective').mockReturnValue(99); });
afterEach(() => levels.mockRestore());

function snapshot(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 0,
        bankKnown: true,
        freeSlots: 10,
        ...over
    } as QuestSnapshot;
}

/** The nails leg's mining load: what fills the pack mid-quest. */
const ORE_LOAD = new Map([
    ['coins', 200], ['bronze pickaxe', 1], ['hammer', 1], ['maze key', 1],
    ['lobster', 6], ['iron ore', 6], ['coal', 12]
]);

describe('Dragon Slayer supply gathers', () => {
    test('waits before acquiring bowl materials when Crafting is 7', () => {
        levels.mockReturnValue(7);
        const given = snapshot({ inv: ORE_LOAD, freeSlots: 0 });

        const step = SUPPLY_GATHERS['unfired bowl'](given, 1);

        expect(step.kind).toBe('wait');
        if (step.kind !== 'wait') throw new Error('expected a blocked production step');
        expect(step.reason).toMatch(/Crafting 8/);
        expect(step.reason).toMatch(/bank|obtain/i);
    });

    test('produces a bowl when Crafting is exactly 8', () => {
        levels.mockReturnValue(8);
        const given = snapshot();

        const step = SUPPLY_GATHERS['unfired bowl'](given, 1);

        expect(step).toMatchObject({ kind: 'custom', name: 'make an unfired bowl' });
    });

    test('a full pack banks before it shops', () => {
        // Why: a purchase into a full pack is not refused, inv_add drops the overflow at the bot's feet and the coins go anyway.
        for (const name of Object.keys(SUPPLY_GATHERS)) {
            const step = SUPPLY_GATHERS[name](snapshot({ inv: ORE_LOAD, freeSlots: 0 }), 1);
            expect({ name, kind: step.kind }).toEqual({ name, kind: 'deposit' });
        }
    });

    test('the mining load is what gets banked, not the shopping', () => {
        const step = SUPPLY_GATHERS["wizard's mind bomb"](snapshot({ inv: ORE_LOAD, freeSlots: 0 }), 1);
        const keep = (step as { keep: string[] }).keep;
        expect(keep).toContain('coins');
        expect(keep).toContain("wizard's mind bomb");
        expect(keep).not.toContain('iron ore');
        expect(keep).not.toContain('coal');
    });

    test('room to spare still shops', () => {
        expect(SUPPLY_GATHERS["wizard's mind bomb"](snapshot({ freeSlots: 5 }), 1).kind).toBe('custom');
        expect(SUPPLY_GATHERS.hammer(snapshot({ freeSlots: 5 }), 1).kind).toBe('buy');
    });

    test('planks need a slot each', () => {
        expect(SUPPLY_GATHERS.plank(snapshot({ inv: ORE_LOAD, freeSlots: 2 }), 3).kind).toBe('deposit');
        expect(SUPPLY_GATHERS.plank(snapshot({ freeSlots: 3 }), 3).kind).toBe('custom');
    });

    test('a full pack with nothing spare says so instead of shopping', () => {
        // Every slot is something the shopping legs need, banking would be a
        // no-op, so the step has to be honest and let the engine park it.
        const onlyKeepers = new Map([['coins', 1], ['silk', 1], ['plank', 3]]);
        const step = SUPPLY_GATHERS.hammer(snapshot({ inv: onlyKeepers, freeSlots: 0 }), 1);
        expect(step.kind).toBe('wait');
    });
});

describe('Dragon Slayer record', () => {
    test('lists nothing the quest consumes, so a resumed session re-provisions nothing', () => {
        // Why: the engine walks record.items on every session start and after every death, and the door and the hull eat six of what the record used to list.
        const plan = planProvisioning(dragonslayer.record.items, new Map([['coins', 1]]), new Map());
        expect(plan.gather).toEqual([]);
        expect(plan.satisfied).toBe(true);
    });
});
