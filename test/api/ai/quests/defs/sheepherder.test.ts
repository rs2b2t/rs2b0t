import { describe, expect, test } from 'bun:test';

import {
    BONES_OBJ,
    FEED_OBJ,
    JACKET,
    JACKET_OBJ,
    PROD_OBJ,
    TROUSERS,
    TROUSERS_OBJ
} from '#/bot/api/ai/quests/defs/sheepherder/areas.js';
import { decide, sheepherder } from '#/bot/api/ai/quests/defs/sheepherder/index.js';
import { SH_STAGE } from '#/bot/api/ai/quests/defs/sheepherder/journal.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    inv?: [string, number][];
    invIds?: number[];
    wornIds?: number[];
    progress?: QuestProgress | undefined;
}

const DRESSED = [JACKET_OBJ, TROUSERS_OBJ, PROD_OBJ];

function snap(options: Options = {}): QuestSnapshot {
    const progress = 'progress' in options
        ? options.progress
        : { stage: options.stage ?? SH_STAGE.DISPOSING, flags: new Set(options.flags ?? []) };
    const invIds = new Map<number, number>();
    for (const id of options.invIds ?? [FEED_OBJ]) {
        invIds.set(id, (invIds.get(id) ?? 0) + 1);
    }
    return {
        journal: options.journal ?? 'inProgress',
        inv: new Map(options.inv ?? [['coins', 1000]]),
        invIds,
        worn: new Set(),
        wornIds: new Set(options.wornIds ?? DRESSED),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: progress?.stage,
        progress,
        bank: new Map(),
        bankKnown: true,
        freeSlots: 24
    };
}

const customName = (step: QuestStep): string | null => (step.kind === 'custom' ? step.name : null);
const talkTo = (step: QuestStep): string | null => (step.kind === 'talk' ? step.stop.npc : null);

describe('Sheep Herder decide', () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('opens with Councillor Halgrive', () => {
        expect(talkTo(decide(snap({ journal: 'notStarted' })))).toBe('Councillor Halgrive');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        expect(decide(snap({ progress: undefined })).kind).toBe('wait');
    });

    test('buys the suit from Doctor Orbon once the quest is started', () => {
        expect(talkTo(decide(snap({ stage: SH_STAGE.NEED_SUIT })))).toBe('Doctor Orbon');
    });

    test('fetches coins before walking to Orbon with an empty purse', () => {
        const step = decide(snap({ stage: SH_STAGE.NEED_SUIT, inv: [] }));

        expect(step.kind).toBe('withdraw');
    });

    test('wears a suit it is carrying rather than buying another', () => {
        const step = decide(snap({ wornIds: [PROD_OBJ], invIds: [FEED_OBJ, JACKET_OBJ, TROUSERS_OBJ] }));

        expect(step).toEqual({ kind: 'equip', item: JACKET });
    });

    test('goes back to Orbon when a half of the suit is gone entirely', () => {
        expect(talkTo(decide(snap({ wornIds: [JACKET_OBJ, PROD_OBJ] })))).toBe('Doctor Orbon');
    });

    test('equips the trousers when only they are missing', () => {
        const step = decide(snap({ wornIds: [JACKET_OBJ, PROD_OBJ], invIds: [FEED_OBJ, TROUSERS_OBJ] }));

        expect(step).toEqual({ kind: 'equip', item: TROUSERS });
    });

    test('fetches the prod from the barn before herding', () => {
        expect(customName(decide(snap({ wornIds: [JACKET_OBJ, TROUSERS_OBJ] })))).toBe('fetch the Prod from the barn');
    });

    test('asks Halgrive for more feed when the pack has none', () => {
        expect(talkTo(decide(snap({ invIds: [] })))).toBe('Councillor Halgrive');
    });

    test('herds the first sheep that has not been burnt', () => {
        expect(customName(decide(snap({ flags: ['burnt-1'] })))).toBe('herd and kill sheep 2');
    });

    test('burns the remains it is carrying before herding anything else', () => {
        const step = decide(snap({ flags: ['burnt-1'], invIds: [FEED_OBJ, BONES_OBJ[2]] }));

        expect(customName(step)).toBe('incinerate the remains of sheep 2');
    });

    test('tells the four sets of remains apart by id, since all four render "Bones"', () => {
        const step = decide(snap({ flags: ['burnt-1', 'burnt-2'], invIds: [FEED_OBJ, BONES_OBJ[3]] }));

        expect(customName(step)).toBe('incinerate the remains of sheep 3');
    });

    test('burns held remains with no prod worn, since only the suit gates the enclosure', () => {
        const step = decide(snap({ wornIds: [JACKET_OBJ, TROUSERS_OBJ], invIds: [BONES_OBJ[1]] }));

        expect(customName(step)).toBe('incinerate the remains of sheep 1');
    });

    test('dresses before burning, since the incinerator stands inside the enclosure', () => {
        const step = decide(snap({ wornIds: [PROD_OBJ], invIds: [BONES_OBJ[1], JACKET_OBJ, TROUSERS_OBJ] }));

        expect(step).toEqual({ kind: 'equip', item: JACKET });
    });

    test('returns to Halgrive once all four are incinerated', () => {
        const step = decide(snap({ flags: ['burnt-1', 'burnt-2', 'burnt-3', 'burnt-4'] }));

        expect(talkTo(step)).toBe('Councillor Halgrive');
    });

    test('re-herds a sheep the journal calls penned but whose remains are gone', () => {
        expect(customName(decide(snap({ flags: ['herded-1', 'killed-1'] })))).toBe('herd and kill sheep 1');
    });
});

describe('Sheep Herder module', () => {
    test('requires nothing up front — the suit, prod and feed all come from the quest', () => {
        expect(sheepherder.record.items).toEqual([]);
    });

    test('keeps the coin float and every quest item off the deposit list', () => {
        for (const tool of ['coins', 'prod', 'feed', 'plague jacket', 'plague trousers', 'bones']) {
            expect(sheepherder.tools).toContain(tool);
        }
    });

    test('banks at Ardougne West, the booth nearest both the chapel and the enclosure', () => {
        expect(sheepherder.bank).toEqual(expect.objectContaining({ x: 2616, z: 3332, level: 0 }));
    });
});
