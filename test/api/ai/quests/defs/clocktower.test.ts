import { describe, expect, test } from 'bun:test';

import { COG_OBJ, COG_STAGE, clocktower, decide, parseClockTowerJournal } from '#/bot/api/ai/quests/defs/clocktower.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const NOT_STARTED =
    '@dbl@I can start this quest by talking to @dre@Brother Kojo@dbl@ at the|@dre@Clock Tower@dbl@ which is located @dre@South@dbl@ of @dre@Ardougne|';

const PREAMBLE =
    '@str@I spoke to Brother Kojo at the Clock Tower South of|@str@Argougne and agreed to help him repair the clock.|' +
    '@dbl@To repair the clock I need to find the four coloured cogs|and place them on the four correctly coloured spindles.|';

const UNPLACED: Record<string, string> = {
    blue: "@dbl@I haven't placed the @dre@Blue Cog@dbl@ on its @dre@spindle@dbl@ yet|",
    black: "@dbl@I haven't placed the @dre@Black Cog@dbl@ on its @dre@spindle@dbl@ yet|",
    white: "@dbl@I haven't placed the @dre@White Cog@dbl@ on its @dre@spindle@dbl@ yet|",
    red: "@dbl@I haven't placed the @dre@Red Cog@dbl@ on its @dre@spindle@dbl@ yet"
};

const PLACED: Record<string, string> = {
    blue: '@str@I have successfully placed the Blue Cog on its spindle|',
    black: '@str@I have successfully placed the Black Cog on its spindle|',
    white: '@str@I have successfully placed the White Cog on its spindle|',
    red: '@str@I have successfully placed the Red Cog on its spindle'
};

function inProgress(placed: string[]): string {
    const order = ['blue', 'black', 'white', 'red'];
    return PREAMBLE + order.map(c => (placed.includes(c) ? PLACED[c] : UNPLACED[c])).join('');
}

const ALL_PLACED =
    '@str@I spoke to Brother Kojo at the Clock Tower South of|@str@Argougne and agreed to help him repair the clock.|' +
    '@str@I have placed all four cogs successfully on the spindles.|' +
    '@dbl@I should speak to @dre@Brother Kojo@dbl@ and claim my @dre@reward';

const COMPLETE =
    '@str@I spoke to Brother Kojo at the Clock Tower South of|@str@Argougne and agreed to help him repair the clock.|' +
    '@str@I have placed all four cogs successfully on the spindles.|' +
    '@str@Brother Kojo was grateful for all my help and rewarded me.||@red@QUEST COMPLETE!';

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    placed?: string[];
    stage?: number;
    inv?: string[];
    invIds?: number[];
    bank?: string[];
    bankKnown?: boolean;
    progress?: QuestProgress | undefined;
}

function counts(names: string[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
}

function idCounts(ids: number[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const id of ids) {
        result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const placed = options.placed ?? [];
    const progress =
        'progress' in options
            ? options.progress
            : { stage: options.stage ?? COG_STAGE.STARTED, flags: new Set(placed.map(c => `placed-${c}`)) };
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        invIds: idCounts(options.invIds ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: progress?.stage,
        progress,
        bank: counts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Clock Tower journal parsing', () => {
    test('reads the not-started page as stage 0 with no cogs placed', () => {
        const progress = parseClockTowerJournal(NOT_STARTED);

        expect(progress?.stage).toBe(COG_STAGE.NOT_STARTED);
        expect([...(progress?.flags ?? [])]).toEqual([]);
    });

    test('reads a started page with nothing placed as stage 1 and no flags', () => {
        const progress = parseClockTowerJournal(inProgress([]));

        expect(progress?.stage).toBe(COG_STAGE.STARTED);
        expect([...(progress?.flags ?? [])]).toEqual([]);
    });

    test('flags only the cogs the page reports as placed', () => {
        const progress = parseClockTowerJournal(inProgress(['blue', 'red']));

        expect(progress?.stage).toBe(COG_STAGE.STARTED);
        expect(progress?.flags.has('placed-blue')).toBe(true);
        expect(progress?.flags.has('placed-red')).toBe(true);
        expect(progress?.flags.has('placed-black')).toBe(false);
        expect(progress?.flags.has('placed-white')).toBe(false);
    });

    test('treats the reward page as all four placed, since it drops the per-cog lines', () => {
        const progress = parseClockTowerJournal(ALL_PLACED);

        expect(progress?.stage).toBe(COG_STAGE.ALL_PLACED);
        expect([...(progress?.flags ?? [])].sort()).toEqual(['placed-black', 'placed-blue', 'placed-red', 'placed-white']);
    });

    test('reads the finished page as complete', () => {
        expect(parseClockTowerJournal(COMPLETE)?.stage).toBe(COG_STAGE.COMPLETE);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseClockTowerJournal('some other quest entirely')).toBeUndefined();
    });
});

describe('Clock Tower decide', () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('opens with Brother Kojo when the quest has not started', () => {
        const step = decide(snap({ journal: 'notStarted' }));

        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Brother Kojo');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        expect(decide(snap({ progress: undefined })).kind).toBe('wait');
    });

    test('returns to Kojo for the reward once all four are placed', () => {
        const step = decide(snap({ placed: ['blue', 'black', 'white', 'red'] }));

        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Brother Kojo');
    });

    test('places the cog it is carrying before fetching another', () => {
        const step = decide(snap({ invIds: [COG_OBJ.red], inv: ['Cog', 'Bucket of water'] }));

        expect(customName(step)).toBe('place the red cog');
    });

    test('tells the four cogs apart by object id rather than by their shared name', () => {
        const step = decide(snap({ invIds: [COG_OBJ.white], inv: ['Cog', 'Bucket of water'] }));

        expect(customName(step)).toBe('place the white cog');
    });

    test('fills a bucket before the black cog leg, since the cog is too hot to lift', () => {
        const step = decide(snap({ inv: ['Bucket'] }));

        expect(step).toEqual({
            kind: 'useOn',
            item: 'Bucket',
            targetKind: 'loc',
            target: 'Well',
            anchor: expect.anything(),
            product: 'Bucket of water'
        });
    });

    test('fetches a bucket from the ground when the bank has been read and holds none', () => {
        const step = decide(snap({}));

        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Bucket');
    });

    test('takes the banked bucket rather than the single ground spawn', () => {
        const step = decide(snap({ bank: ['Bucket'] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Bucket');
    });

    test('reads the bank before believing it has no bucket', () => {
        expect(decide(snap({ bankKnown: false })).kind).toBe('scanBank');
    });

    test('fetches the black cog once the water is carried', () => {
        expect(customName(decide(snap({ inv: ['Bucket of water'] })))).toBe('fetch the black cog');
    });

    test('needs no bucket once the black cog is placed', () => {
        expect(customName(decide(snap({ placed: ['black'] })))).toBe('fetch the red cog');
    });

    test('leaves the white cog last, since its leg has to poison the rats first', () => {
        expect(customName(decide(snap({ placed: ['black', 'red', 'blue'] })))).toBe('fetch the white cog');
    });

    test('stops rather than looping when it holds a cog whose spindle is already filled', () => {
        const step = decide(snap({ placed: ['red'], invIds: [COG_OBJ.red], inv: ['Cog'] }));

        expect(step.kind).toBe('wait');
    });
});

describe('Clock Tower module', () => {
    test('leaves the bucket off the record, so a resume past the black cog fetches no water', () => {
        expect(clocktower.record.items).toEqual([]);
    });

    test('keeps every cog and the poison off the deposit list', () => {
        for (const tool of ['cog', 'rat poison', 'bucket', 'bucket of water']) {
            expect(clocktower.tools).toContain(tool);
        }
    });

    test('hops name the cellar ladder alone, since a sealed room is nearer than it from most of the dungeon', () => {
        const stands = (clocktower.hops ?? []).map(h => `${h.stand.x},${h.stand.z}`);

        expect(stands.sort()).toEqual(['2566,3243', '2566,9643']);
    });
});
