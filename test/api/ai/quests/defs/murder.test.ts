import { describe, expect, test } from 'bun:test';

import { MURDER_OBJ, SUSPECTS, suspectOrder } from '#/bot/api/ai/quests/defs/murder/areas.js';
import { decide, murder, sourcePot } from '#/bot/api/ai/quests/defs/murder/index.js';
import { MURDER_STAGE, POISON_PROVED, THREAD_FOUND, parseMurderJournal } from '#/bot/api/ai/quests/defs/murder/journal.js';
import { accused, heldThread } from '#/bot/api/ai/quests/defs/murder/state.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const NOT_STARTED =
    '@dbl@I can start this quest by speaking to one of the @dre@Guards@dbl@ at|'
    + "@dbl@the @dre@Sinclair Mansion@dbl@, North of the @dre@Seer's Village@dbl@";

const PREAMBLE =
    '@str@Lord Sinclair, a prominent nobleman, had been horribly|'
    + '@str@murdered at his mansion. The guards had been sent to|'
    + '@str@investigate his murder, but have been completely stuck.|'
    + '@dbl@One of the @dre@guards@dbl@ has asked me for my help in solving the|'
    + '@dbl@murder. I should @dre@examine the crime scene@dbl@ very closely for|'
    + '@dbl@evidence, and @dre@investigate everybody@dbl@ in the area carefully||';

const THREAD_LINE = '@dbl@I have found some @dre@coloured thread@dbl@. It might be useful.|';
const WEAPON_LINE = '@dbl@I have taken the @dre@murder weapon@dbl@. I think it might help me.|';

const POISON_PAGE =
    '@str@Lord Sinclair, a prominent nobleman, had been horribly|'
    + '@str@murdered at his mansion. The guards had been sent to|'
    + '@str@investigate his murder, but have been completely stuck.|'
    + '@str@One of the guards asked me for my help in solving the|'
    + '@str@murder. After careful examination of the crime scene and|'
    + '@str@interrogating all suspects, I worked out who was guilty.|'
    + '@dbl@I have @dre@indisputable evidence@dbl@ of who the murderer must be.|'
    + '@dbl@I should take it to one of the @dre@Guards@dbl@ immediately.';

const COMPLETE =
    '@str@One of the guards asked me for my help in solving the|'
    + '@str@murder. After careful examination of the crime scene and|'
    + '@str@interrogating all suspects, I worked out who was guilty. I|'
    + '@str@took the evidence I had collected to the Guards and|'
    + '@str@explained how it could identify the killer. Impressed with|'
    + '@str@my deductions, the killer was arrested and I was given a|'
    + '@str@fair reward for my help in solving the crime.||'
    + '@red@QUEST COMPLETE!';

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    flags?: string[];
    stage?: number;
    invIds?: number[];
    bankIds?: number[];
    bankKnown?: boolean;
    progress?: QuestProgress | undefined;
}

function idCounts(ids: number[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const id of ids) {
        result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const progress = 'progress' in options
        ? options.progress
        : { stage: options.stage ?? MURDER_STAGE.STARTED, flags: new Set(options.flags ?? []) };
    return {
        journal: options.journal ?? 'inProgress',
        inv: new Map(),
        invIds: idCounts(options.invIds ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: progress?.stage,
        progress,
        bank: new Map(),
        bankIds: idCounts(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 28
    };
}

const ANNA = SUSPECTS[0];
const BOB = SUSPECTS[1];
const CAROL = SUSPECTS[2];
const DAVID = SUSPECTS[3];
const ELIZABETH = SUSPECTS[4];
const FRANK = SUSPECTS[5];

/** A pack that has cleared every hurdle before the named one. */
const POT = MURDER_OBJ.POT;

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Murder Mystery journal parsing', () => {
    test('reads the not-started page as stage 0', () => {
        const progress = parseMurderJournal(NOT_STARTED);

        expect(progress?.stage).toBe(MURDER_STAGE.NOT_STARTED);
        expect([...(progress?.flags ?? [])]).toEqual([]);
    });

    test('reads a started page with no evidence as stage 1 and no flags', () => {
        const progress = parseMurderJournal(PREAMBLE + '||');

        expect(progress?.stage).toBe(MURDER_STAGE.STARTED);
        expect([...(progress?.flags ?? [])]).toEqual([]);
    });

    test('flags the thread and the weapon only when their lines are on the page', () => {
        const progress = parseMurderJournal(PREAMBLE + THREAD_LINE + '|');

        expect(progress?.flags.has('thread')).toBe(true);
        expect(progress?.flags.has('weapon')).toBe(false);
        expect(parseMurderJournal(PREAMBLE + THREAD_LINE + WEAPON_LINE)?.flags.has('weapon')).toBe(true);
    });

    test('reads the indisputable-evidence page as the poison proved', () => {
        const progress = parseMurderJournal(POISON_PAGE);

        expect(progress?.stage).toBe(MURDER_STAGE.STARTED);
        expect(progress?.flags.has(POISON_PROVED)).toBe(true);
    });

    test('reads the finished page as complete', () => {
        expect(parseMurderJournal(COMPLETE)?.stage).toBe(MURDER_STAGE.COMPLETE);
    });

    test('reports nothing for a page it does not recognise', () => {
        expect(parseMurderJournal('')).toBeUndefined();
    });
});

describe('Murder Mystery suspect order', () => {
    test('puts the two whose clothes match the thread first', () => {
        expect(suspectOrder(MURDER_OBJ.THREAD_GREEN).slice(0, 2)).toEqual([ANNA, DAVID]);
        expect(suspectOrder(MURDER_OBJ.THREAD_RED).slice(0, 2)).toEqual([BOB, CAROL]);
        expect(suspectOrder(MURDER_OBJ.THREAD_BLUE).slice(0, 2)).toEqual([ELIZABETH, FRANK]);
    });

    test('still lists every suspect, so a colour that convicts nobody is not a dead end', () => {
        expect(suspectOrder(MURDER_OBJ.THREAD_BLUE)).toHaveLength(SUSPECTS.length);
        expect(new Set(suspectOrder(MURDER_OBJ.THREAD_BLUE))).toEqual(new Set(SUSPECTS));
    });
});

describe('Murder Mystery deduction from the pack', () => {
    test('names nobody while the killers print is missing', () => {
        expect(accused(snap({ invIds: [ANNA.silver] }), MURDER_OBJ.THREAD_GREEN)).toBeNull();
    });

    test('names the last keepsake in test order, which is the suspect the print matched', () => {
        const pack = [MURDER_OBJ.KILLERS_PRINT, ANNA.silver, DAVID.silver];

        expect(accused(snap({ invIds: pack }), MURDER_OBJ.THREAD_GREEN)).toBe(DAVID);
        expect(accused(snap({ invIds: [MURDER_OBJ.KILLERS_PRINT, ANNA.silver] }), MURDER_OBJ.THREAD_GREEN)).toBe(ANNA);
    });

    test('names nobody when the keepsakes are gone', () => {
        expect(accused(snap({ invIds: [MURDER_OBJ.KILLERS_PRINT] }), MURDER_OBJ.THREAD_RED)).toBeNull();
    });

    test('reads the thread colour off the pack', () => {
        expect(heldThread(snap({ invIds: [MURDER_OBJ.THREAD_BLUE] }))).toBe(MURDER_OBJ.THREAD_BLUE);
        expect(heldThread(snap())).toBeNull();
    });
});

describe('Murder Mystery pot sourcing', () => {
    test('scans the bank before deciding the pot has to be bought', () => {
        expect(sourcePot(snap({ bankKnown: false }))).toEqual({ kind: 'scanBank', bank: murder.bank as never });
    });

    test('withdraws a banked pot rather than walking to Catherby', () => {
        const step = sourcePot(snap({ bankIds: [POT] }));

        expect(step?.kind).toBe('withdraw');
    });

    test('buys from Arhein when neither the pack nor the bank holds one', () => {
        const step = sourcePot(snap());

        expect(step?.kind).toBe('buy');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Arhein');
    });

    test('asks for nothing once a pot or a pot of flour is carried', () => {
        expect(sourcePot(snap({ invIds: [POT] }))).toBeNull();
        expect(sourcePot(snap({ invIds: [MURDER_OBJ.POT_FLOUR] }))).toBeNull();
    });
});

describe('Murder Mystery decide', () => {
    test('waits while the journal has not loaded', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the journal is green', () => {
        expect(decide(snap({ journal: 'complete' }))).toEqual({ kind: 'done' });
    });

    test('waits when a started journal cannot be read', () => {
        expect(decide(snap({ progress: undefined })).kind).toBe('wait');
    });

    test('buys the pot before the quest is even started, so the trip is not made twice', () => {
        const step = decide(snap({ journal: 'notStarted', stage: MURDER_STAGE.NOT_STARTED }));

        expect(step.kind).toBe('buy');
    });

    test('starts the quest with the guard once a pot is carried', () => {
        const step = decide(snap({ journal: 'notStarted', progress: { stage: MURDER_STAGE.NOT_STARTED, flags: new Set() }, invIds: [POT] }));

        expect(step.kind === 'talk' && step.stop.prefer).toEqual(["Sure, I'll help"]);
    });

    test('withdraws evidence the bank is holding before any leg that a banked copy would block', () => {
        const step = decide(snap({ invIds: [POT], bankIds: [MURDER_OBJ.DAGGER] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items.map(i => i.id)).toEqual([MURDER_OBJ.DAGGER]);
    });

    test('takes the thread first, because its colour is what halves the suspect list', () => {
        const step = decide(snap({ invIds: [POT], flags: [THREAD_FOUND] }));

        expect(customName(step)).toBe('take the thread from the smashed window');
    });

    test('hunts the prints once the thread is in the pack', () => {
        const step = decide(snap({ invIds: [POT, MURDER_OBJ.THREAD_RED], flags: [THREAD_FOUND] }));

        expect(customName(step)).toBe("match the murderer's fingerprints");
    });

    test('proves the poison once the killers print is in the pack', () => {
        const step = decide(snap({
            invIds: [MURDER_OBJ.THREAD_RED, MURDER_OBJ.KILLERS_PRINT, BOB.silver],
            flags: [THREAD_FOUND]
        }));

        expect(customName(step)).toBe('prove the family lied about the poison');
    });

    test('stops asking for a pot once the prints are matched', () => {
        const step = decide(snap({
            invIds: [MURDER_OBJ.THREAD_RED, MURDER_OBJ.KILLERS_PRINT, BOB.silver],
            flags: [THREAD_FOUND]
        }));

        expect(step.kind).toBe('custom');
    });

    test('hands in to the guard once the poison is proved as well', () => {
        const step = decide(snap({
            invIds: [MURDER_OBJ.THREAD_RED, MURDER_OBJ.KILLERS_PRINT, BOB.silver],
            flags: [THREAD_FOUND, POISON_PROVED]
        }));

        expect(step.kind === 'talk' && step.stop.prefer).toEqual(['I know who did it']);
    });
});
