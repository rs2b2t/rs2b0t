import { describe, expect, test } from 'bun:test';

import { FC_ID, FC_TILE, inCompound, nearestDwarf, nearestSpade } from '#/bot/api/ai/quests/defs/fishingcontest/areas.js';
import { decide, fishingcontest } from '#/bot/api/ai/quests/defs/fishingcontest/index.js';
import { FC_STAGE } from '#/bot/api/ai/quests/defs/fishingcontest/journal.js';
import { ENTRY_FEE, WORM_TARGET } from '#/bot/api/ai/quests/defs/fishingcontest/supplies.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: Record<number, number>;
    bank?: Record<number, number>;
    bankKnown?: boolean;
}

function idMap(counts: Record<number, number>): Map<number, number> {
    return new Map(Object.entries(counts).map(([id, n]) => [Number(id), n]));
}

/** A pack that has everything the contest needs, so a test can take one thing away. */
const READY: Record<number, number> = {
    [FC_ID.PASS]: 1,
    [FC_ID.GARLIC]: 1,
    [FC_ID.FISHING_ROD]: 1,
    [FC_ID.SPADE]: 1,
    [FC_ID.RED_VINE_WORM]: WORM_TARGET,
    [FC_ID.COINS]: 500
};

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? FC_STAGE.STARTED;
    return {
        journal: options.journal ?? 'inProgress',
        inv: new Map(),
        invIds: idMap(options.inv ?? {}),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        bank: new Map(),
        bankIds: idMap(options.bank ?? {}),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 26
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

function without(id: number): Record<number, number> {
    const pack = { ...READY };
    delete pack[id];
    return pack;
}

describe('Fishing Contest decide', () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('waits rather than guessing when the journal stage is unreadable', () => {
        const unreadable = { ...snap(), stage: undefined };

        expect(decide(unreadable).kind).toBe('wait');
    });

    test('reads the bank before believing it has to fetch anything', () => {
        expect(decide(snap({ stage: FC_STAGE.NOT_STARTED, bankKnown: false })).kind).toBe('scanBank');
    });
});

describe('Fishing Contest before the pass', () => {
    test('fetches the garlic before walking to the dwarf, since Draynor is on the way out', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.NOT_STARTED })))).toBe("take garlic from Morgan's cupboard");
    });

    test('takes a banked clove rather than climbing to the cupboard', () => {
        const step = decide(snap({ stage: FC_STAGE.NOT_STARTED, bank: { [FC_ID.GARLIC]: 1 } }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]!.id).toBe(FC_ID.GARLIC);
    });

    test('picks the spade up on the way past Falador', () => {
        const step = decide(snap({ stage: FC_STAGE.NOT_STARTED, inv: { [FC_ID.GARLIC]: 1 } }));

        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Spade');
    });

    test('starts the quest once the Draynor and Falador legs are done', () => {
        const step = decide(snap({ stage: FC_STAGE.NOT_STARTED, inv: { [FC_ID.GARLIC]: 1, [FC_ID.SPADE]: 1 } }));

        expect(customName(step)).toBe('ask the Mountain Dwarf for the competition pass');
    });
});

describe('Fishing Contest supplies', () => {
    test('asks the dwarf for a replacement when the pass is in neither pack nor bank', () => {
        expect(customName(decide(snap({ inv: without(FC_ID.PASS) })))).toBe('ask the dwarf for another competition pass');
    });

    test('buys the rod from Harry when none is banked', () => {
        const step = decide(snap({ inv: without(FC_ID.FISHING_ROD) }));

        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Harry');
    });

    test('digs worms up to the target when the pack is short', () => {
        expect(customName(decide(snap({ inv: { ...READY, [FC_ID.RED_VINE_WORM]: 2 } }))))
            .toBe(`dig ${WORM_TARGET - 2} red vine worm(s)`);
    });

    test('fetches a spade before the worms, since the dig needs one', () => {
        const pack = { ...without(FC_ID.SPADE), [FC_ID.RED_VINE_WORM]: 0 };
        const step = decide(snap({ inv: pack }));

        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Spade');
    });

    test('withdraws coins when the pack cannot cover the entry fee', () => {
        const step = decide(snap({ inv: { ...READY, [FC_ID.COINS]: ENTRY_FEE - 1 }, bank: { [FC_ID.COINS]: 2_000_000 } }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]!.id).toBe(FC_ID.COINS);
    });

    test('pays Bonzo once everything is carried', () => {
        expect(customName(decide(snap({ inv: READY })))).toBe('pay Bonzo the contest entry fee');
    });
});

describe('Fishing Contest inside the contest', () => {
    test('never fishes the willow spot — it stashes the garlic instead', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.IN_COMP, inv: READY })))).toBe('stash the garlic in the wall pipe');
    });

    test('unwinds a round already fished at the willow spot by handing the sardines over', () => {
        const pack = { ...without(FC_ID.GARLIC), [FC_ID.RAW_SARDINE]: 2 };

        expect(customName(decide(snap({ stage: FC_STAGE.IN_COMP, inv: pack }))))
            .toBe('hand the sardines to Bonzo and re-enter');
    });

    test('re-sources garlic at the willow spot when there is neither clove nor catch', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.IN_COMP, inv: without(FC_ID.GARLIC) }))))
            .toBe("take garlic from Morgan's cupboard");
    });

    test('fishes the pipes spot once the stranger has moved', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.GARLIC_COMP, inv: READY }))))
            .toBe('fish the contest beside the pipes');
    });

    test('keeps fishing on a half-spent pack rather than walking out to restock', () => {
        const pack = { ...READY, [FC_ID.RED_VINE_WORM]: 1, [FC_ID.RAW_GIANT_CARP]: 2 };

        expect(customName(decide(snap({ stage: FC_STAGE.GARLIC_COMP, inv: pack }))))
            .toBe('fish the contest beside the pipes');
    });

    test('gets the pass back before walking into a contest it has already paid for', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.GARLIC_COMP, inv: without(FC_ID.PASS) }))))
            .toBe('ask the dwarf for another competition pass');
    });

    test('restocks worms mid-contest only once the last one is spent', () => {
        const pack = { ...READY, [FC_ID.RED_VINE_WORM]: 0 };

        expect(customName(decide(snap({ stage: FC_STAGE.GARLIC_COMP, inv: pack }))))
            .toBe(`dig ${WORM_TARGET} red vine worm(s)`);
    });
});

describe('Fishing Contest after the win', () => {
    test('carries the trophy to the dwarf', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.WON_COMP, inv: { [FC_ID.TROPHY]: 1 } }))))
            .toBe('take the trophy to the Mountain Dwarf');
    });

    test('takes a banked trophy rather than asking Bonzo for a spare', () => {
        const step = decide(snap({ stage: FC_STAGE.WON_COMP, bank: { [FC_ID.TROPHY]: 1 } }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]!.id).toBe(FC_ID.TROPHY);
    });

    test('needs the pass back before it can walk in for a spare trophy', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.WON_COMP }))))
            .toBe('ask the dwarf for another competition pass');
    });

    test('asks Bonzo for a spare trophy once the pass is in hand', () => {
        expect(customName(decide(snap({ stage: FC_STAGE.WON_COMP, inv: { [FC_ID.PASS]: 1 } }))))
            .toBe('ask Bonzo for a spare trophy');
    });
});

describe('Fishing Contest map', () => {
    test('the fenced competition ground holds both fishing spots and the pipes', () => {
        expect(inCompound({ x: 2630, z: 3435, level: 0 })).toBe(true);
        expect(inCompound({ x: 2637, z: 3444, level: 0 })).toBe(true);
        expect(inCompound(FC_TILE.PIPE_STAND)).toBe(true);
        expect(inCompound(FC_TILE.GATE_INSIDE)).toBe(true);
    });

    test('Morris and the gate stand outside it, so the crossing is never skipped', () => {
        expect(inCompound(FC_TILE.GATE_OUTSIDE)).toBe(false);
        expect(inCompound({ x: 2643, z: 3440, level: 0 })).toBe(false);
        expect(inCompound(null)).toBe(false);
    });

    test('picks the tunnel mouth on the side the bot is standing', () => {
        expect(nearestDwarf({ x: 2900, z: 3480, level: 0 })).toBe(FC_TILE.DWARF_EAST);
        expect(nearestDwarf({ x: 2800, z: 3480, level: 0 })).toBe(FC_TILE.DWARF_WEST);
        expect(nearestDwarf(null)).toBe(FC_TILE.DWARF_EAST);
    });

    test('takes the spade on its own side of the mountain, not the one that is nearer as the crow flies', () => {
        expect(nearestSpade({ x: 3000, z: 3370, level: 0 })).toBe(FC_TILE.SPADE_FALADOR);
        expect(nearestSpade(FC_TILE.GATE_OUTSIDE)).toBe(FC_TILE.SPADE_ARDOUGNE);
        // Catherby: Falador is 146 tiles away and Edmond's 261, but only Edmond's avoids the ridge.
        expect(nearestSpade({ x: 2835, z: 3445, level: 0 })).toBe(FC_TILE.SPADE_ARDOUGNE);
        expect(nearestSpade(null)).toBe(FC_TILE.SPADE_FALADOR);
    });
});

describe('Fishing Contest module', () => {
    test('lists no required items, so an empty bank cannot block the start', () => {
        expect(fishingcontest.record.items).toEqual([]);
    });

    test('keeps every quest item off the deposit list', () => {
        for (const tool of ['fishing pass', 'garlic', 'fishing rod', 'spade', 'red vine worm', 'fishing trophy', 'coins']) {
            expect(fishingcontest.tools).toContain(tool);
        }
    });

    test('banks wherever it happens to be, since the quest spans two kingdoms', () => {
        expect(fishingcontest.bank).toBe('nearest');
    });
});
