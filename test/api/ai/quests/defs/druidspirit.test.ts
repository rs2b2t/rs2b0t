import { describe, expect, test } from 'bun:test';

import { NS_ID, NS_STAGE } from '#/bot/api/ai/quests/defs/druidspirit/areas.js';
import { decide, druidspirit } from '#/bot/api/ai/quests/defs/druidspirit/index.js';
import { NS_FLAG } from '#/bot/api/ai/quests/defs/druidspirit/journal.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const CAMP = { x: 3440, z: 3336, level: 0 };
const GROTTO = { x: 3442, z: 9734, level: 0 };
const BANK = { x: 3253, z: 3420, level: 0 };

function snap(options: {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    invIds?: [number, number][];
    bankIds?: [number, number][];
    wornIds?: number[];
    tile?: QuestSnapshot['tile'];
} = {}): QuestSnapshot {
    const stage = options.stage ?? NS_STAGE.NOT_STARTED;
    return {
        journal: options.journal ?? (stage === NS_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: new Map(),
        invIds: new Map([[NS_ID.COINS, 50_000], ...(options.invIds ?? [])]),
        worn: new Set(),
        wornIds: new Set(options.wornIds ?? [NS_ID.GHOSTSPEAK]),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set(options.flags ?? []) },
        bank: new Map(),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: true,
        tile: options.tile ?? CAMP,
        freeSlots: 20
    };
}

const step = (options: Parameters<typeof snap>[0] = {}): QuestStep => decide(snap(options));
const named = (s: QuestStep): string => (s.kind === 'custom' ? s.name : s.kind);

describe('nature spirit decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(step({ journal: 'unknown' })).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('a complete journal is done', () => {
        expect(step({ journal: 'complete', stage: NS_STAGE.COMPLETE })).toEqual({ kind: 'done' });
    });

    test('not started talks to Drezel', () => {
        const s = step();
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.npc).toBe('Drezel');
    });

    test('the amulet is fetched before the quest is even started', () => {
        const s = step({ wornIds: [] });
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.npc).toBe('Father Urhney');
    });

    test('the amulet is worn before the spirit is approached', () => {
        expect(step({ stage: NS_STAGE.STARTED, wornIds: [], invIds: [[NS_ID.GHOSTSPEAK, 1]] }))
            .toEqual({ kind: 'equip', item: 'Ghostspeak amulet' });
    });

    test('started walks to the camp and talks', () => {
        expect(named(step({ stage: NS_STAGE.STARTED }))).toBe('find Filliman');
    });

    test('a failed talk is the same leg once the amulet is on', () => {
        expect(named(step({ stage: NS_STAGE.FAILED_TALK }))).toBe('find Filliman');
    });

    test('spoken means fetch the mirror', () => {
        expect(named(step({ stage: NS_STAGE.SPOKEN_FILLIMAN }))).toBe('mirror');
    });

    test('shown the mirror means fetch the journal', () => {
        expect(named(step({ stage: NS_STAGE.SHOWN_MIRROR }))).toBe("Tarlock's journal");
    });

    test('journal handed over means ask how to help', () => {
        expect(named(step({ stage: NS_STAGE.GIVEN_JOURNAL }))).toBe('offer to help');
    });

    test('holding the spell means get blessed', () => {
        const s = step({ stage: NS_STAGE.RECEIVED_SPELL });
        expect(s.kind).toBe('talk');
        expect(s.kind === 'talk' && s.stop.npc).toBe('Drezel');
    });

    test('blessed casts the bloom scroll', () => {
        expect(named(step({ stage: NS_STAGE.BLESSED, invIds: [[NS_ID.SPELL, 1]] }))).toBe('bloom the swamp for a fungus');
    });

    test('a lost scroll is re-issued by Filliman rather than parking', () => {
        expect(named(step({ stage: NS_STAGE.BLESSED }))).toBe('ask for another bloom scroll');
    });

    test('a spent scroll cannot be cast again, so another is asked for', () => {
        expect(named(step({ stage: NS_STAGE.BLESSED, invIds: [[NS_ID.SPELL_USED, 1]] }))).toBe('ask for another bloom scroll');
    });

    test('cast but no fungus blooms again rather than hunting a reverted log', () => {
        expect(named(step({ stage: NS_STAGE.CASTED_SPELL, invIds: [[NS_ID.SPELL, 1]] }))).toBe('bloom the swamp for a fungus');
    });

    test('a held fungus outranks a journal that has not caught up', () => {
        expect(named(step({ stage: NS_STAGE.BLESSED, invIds: [[NS_ID.FUNGI, 1], [NS_ID.SPELL_USED, 1]] })))
            .toBe('feed the ritual stones');
    });

    test('resuming at the fungus stage with an empty pack blooms again', () => {
        expect(named(step({ stage: NS_STAGE.PICKED_FUNGI, invIds: [[NS_ID.SPELL, 1]] }))).toBe('bloom the swamp for a fungus');
    });

    test('with the fungus and no stones fed, the stones come first', () => {
        expect(named(step({ stage: NS_STAGE.PICKED_FUNGI, invIds: [[NS_ID.FUNGI, 1], [NS_ID.SPELL_USED, 1]] })))
            .toBe('feed the ritual stones');
    });

    test('one stone fed still feeds the other', () => {
        expect(named(step({
            stage: NS_STAGE.SPOKEN_FILLIMAN2,
            flags: [NS_FLAG.NATURE],
            invIds: [[NS_ID.SPELL_USED, 1]]
        }))).toBe('feed the ritual stones');
    });

    test('both stones fed stands on the faith stone and solves the puzzle', () => {
        expect(named(step({ stage: NS_STAGE.SPOKEN_FILLIMAN2, flags: [NS_FLAG.NATURE, NS_FLAG.SPIRIT] })))
            .toBe('solve the ritual');
    });

    test('ritual done enters the grotto', () => {
        expect(named(step({ stage: NS_STAGE.PERFORMED_RITUAL }))).toBe('enter the grotto');
    });

    test('inside the grotto, the transformation is a talk', () => {
        expect(named(step({ stage: NS_STAGE.ENTERED_GROTTO, tile: GROTTO }))).toBe('watch the transformation');
    });

    test('transformed sources the sickle before returning', () => {
        expect(step({ stage: NS_STAGE.FULL_TRANSFORM, tile: BANK }).kind).toBe('buy');
    });

    test('a sourcing step taken from inside the grotto leaves the pocket first', () => {
        expect(named(step({ stage: NS_STAGE.FULL_TRANSFORM, tile: GROTTO }))).toBe('leave the grotto');
    });

    test('transformed with a sickle held hands it over', () => {
        expect(named(step({ stage: NS_STAGE.FULL_TRANSFORM, invIds: [[NS_ID.SICKLE, 1]] }))).toBe('hand over the sickle');
    });

    test('a blessed sickle blooms the swamp', () => {
        expect(named(step({
            stage: NS_STAGE.BLESSED_SICKLE,
            invIds: [[NS_ID.SICKLE_BLESSED, 1], [NS_ID.POUCH_EMPTY, 1]]
        }))).toBe('harvest natures bounty');
    });

    test('a lost blessed sickle is re-dipped in the grotto', () => {
        expect(named(step({ stage: NS_STAGE.BLESSED_SICKLE, invIds: [[NS_ID.SICKLE, 1]] }))).toBe('bless the sickle');
    });

    test('three harvests fill the pouch', () => {
        expect(named(step({
            stage: NS_STAGE.PICKED_SICKLE,
            invIds: [[NS_ID.SICKLE_BLESSED, 1], [NS_ID.POUCH_EMPTY, 1], [NS_ID.PEAR, 3]]
        }))).toBe('fill the druid pouch');
    });

    test('a charged pouch hunts a ghast', () => {
        expect(named(step({
            stage: NS_STAGE.ADDED_POUCH,
            invIds: [[NS_ID.SICKLE_BLESSED, 1], [NS_ID.POUCH, 6]]
        }))).toBe('kill a ghast');
    });

    test('the charged pouch is read by id, never by its shared display name', () => {
        expect(named(step({
            stage: NS_STAGE.KILLED_GHAST1,
            invIds: [[NS_ID.SICKLE_BLESSED, 1], [NS_ID.POUCH_EMPTY, 1]]
        }))).toBe('harvest natures bounty');
    });

    test('three ghasts down reports back', () => {
        expect(named(step({ stage: NS_STAGE.KILLED_GHAST3, invIds: [[NS_ID.SICKLE_BLESSED, 1]] }))).toBe('claim the reward');
    });

    test('the module is registered in the queue after its prerequisites', () => {
        const ids = QUEST_DEFS.map(d => d.record.id);
        expect(ids).toContain('druidspirit');
        expect(ids.indexOf('druidspirit')).toBeGreaterThan(ids.indexOf('priestperil'));
        expect(ids.indexOf('druidspirit')).toBeGreaterThan(ids.indexOf('priest'));
    });

    test('the module owns its own inventory', () => {
        expect(druidspirit.ownsInventory).toBe(true);
        expect(druidspirit.record.id).toBe('druidspirit');
        expect(druidspirit.record.name).toBe('Nature Spirit');
    });
});
