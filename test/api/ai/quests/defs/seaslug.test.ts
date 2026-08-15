import { describe, expect, test } from 'bun:test';

import { SS_OBJ, SS_TILE } from '#/bot/api/ai/quests/defs/seaslug/areas.js';
import { decide, seaslug, sourcePaste, torchStep } from '#/bot/api/ai/quests/defs/seaslug/index.js';
import { SS_STAGE, parseSeaSlugJournal } from '#/bot/api/ai/quests/defs/seaslug/journal.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const CAROLINE_LINE = '@str@I have spoken to Caroline and agreed to help.||';
const PASTE_LINE = '@str@I gave Holgart the Swamp Paste and his boat is now|@str@ready to take me to the Fishing Platform.||';
const KENNITH_LINE = "@str@I've found Kennith, he's hiding behind some boxes.||";
const KENT_LINE = "@str@I've found Kent on a small island.||";
const TORCH_LINE = '@str@I should find a way of lighting this damp torch.|';
const SLUGS_LINE = "@dre@Kennith@dbl@ won't go near the @dre@Sea Slugs@dbl@.|I need to find another way to get him out.";
const OPENING_LINE = "@str@I've created an opening to let Kenneth escape.||";
const DOWNSTAIRS_LINE = "@str@Kennith can't get downstairs without some help.||";
const CRANE_LINE = "@str@I've used the Crane to lower Kennith into the boat.||";

const PAGE: Record<number, string> = {
    [SS_STAGE.NOT_STARTED]:
        '@dbl@I can start this quest by speaking to @dre@Caroline@dbl@ who is @dre@East of Ardougne||'
        + '@dbl@Requirements:|@dbl@You\'ll need level 30 @dre@Firemaking',
    [SS_STAGE.STARTED]:
        CAROLINE_LINE
        + "@dbl@I need to talk to @dre@Holgart@dbl@ He'll take me to the @dre@Fishing Platform@dbl@.||"
        + "@dbl@I need to get to the @dre@Fishing Platform@dbl@ and find out what's happened to @dre@Kent@dbl@ and @dre@Kennith@dbl@.",
    [SS_STAGE.SPOKEN_HOLGART]:
        CAROLINE_LINE
        + "@dbl@I've spoken to @dre@Holgart@dbl@, but his boat is broken.|He needs me to bring him some @dre@Swamp Paste@dbl@.||"
        + '@dbl@I can find @dre@Swamp Tar@dbl@ in the @dre@Swamp South of Lumbridge@dbl@.||',
    [SS_STAGE.BOAT_REPAIRED]: CAROLINE_LINE + PASTE_LINE + '@dbl@I need to find @dre@Kent@dbl@ and @dre@Kennith@dbl@.',
    [SS_STAGE.SPOKEN_KENNITH]: CAROLINE_LINE + PASTE_LINE + KENNITH_LINE + '@dbl@I need to find @dre@Kent.',
    [SS_STAGE.SPOKEN_KENT]: CAROLINE_LINE + PASTE_LINE + KENNITH_LINE + KENT_LINE + TORCH_LINE,
    [SS_STAGE.LIT_TORCH]: CAROLINE_LINE + PASTE_LINE + KENNITH_LINE + KENT_LINE + TORCH_LINE + SLUGS_LINE,
    [SS_STAGE.KENNITH_NEED_ESCAPE]:
        CAROLINE_LINE + PASTE_LINE + KENNITH_LINE + KENT_LINE + TORCH_LINE + OPENING_LINE + SLUGS_LINE,
    [SS_STAGE.NEED_KENNITH_PATH]:
        CAROLINE_LINE + PASTE_LINE + KENNITH_LINE + KENT_LINE + TORCH_LINE + OPENING_LINE + DOWNSTAIRS_LINE + SLUGS_LINE,
    [SS_STAGE.SAVED_KENNITH]:
        CAROLINE_LINE + PASTE_LINE + KENNITH_LINE + KENT_LINE + TORCH_LINE + OPENING_LINE + DOWNSTAIRS_LINE + CRANE_LINE
        + '@dbl@I need to take the boat back to shore and talk to @dre@Caroline@dbl@.',
    [SS_STAGE.COMPLETE]:
        CAROLINE_LINE + PASTE_LINE + KENNITH_LINE + KENT_LINE + TORCH_LINE + OPENING_LINE + DOWNSTAIRS_LINE + CRANE_LINE
        + '@str@I\'ve spoken to Caroline and she thanked me for rescuing|@str@her family from the Sea Slugs.|@red@QUEST COMPLETE!'
};

const PASTE_HELD = '@str@I have spoken to Caroline and agreed to help.||'
    + "@dbl@I need to take the @dre@Swamp Paste@dbl@ to @dre@Holgart@dbl@ He's near @dre@Caroline@dbl@, they're @dre@East of Ardougne@dbl@.||";

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    invIds?: number[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: { x: number; z: number; level: number };
    progress?: QuestSnapshot['progress'];
}

const ON_SHORE = { x: 2716, z: 3302, level: 0 };
const ON_DECK = { x: 2782, z: 3276, level: 0 };
const UPPER_DECK = { x: 2784, z: 3286, level: 1 };
const ON_ISLAND = { x: 2797, z: 3320, level: 0 };

function idCounts(ids: number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of ids) {
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        out.set(name.toLowerCase(), (out.get(name.toLowerCase()) ?? 0) + 1);
    }
    return out;
}

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? SS_STAGE.STARTED;
    const progress = 'progress' in options ? options.progress : { stage, flags: new Set<string>() };
    return {
        journal: options.journal ?? 'inProgress',
        inv: new Map(),
        invIds: idCounts(options.invIds ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: progress?.stage,
        progress,
        bank: counts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: (options.tile ?? ON_SHORE) as QuestSnapshot['tile'],
        freeSlots: 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Sea Slug journal parsing', () => {
    for (const [stage, page] of Object.entries(PAGE)) {
        test(`reads the stage ${stage} page back as stage ${stage}`, () => {
            expect(parseSeaSlugJournal(page)?.stage).toBe(Number(stage));
        });
    }

    test('reads the swamp-paste-in-hand variant as the same stage as the broken-boat one', () => {
        expect(parseSeaSlugJournal(PASTE_HELD)?.stage).toBe(SS_STAGE.SPOKEN_HOLGART);
    });

    test('flags the pair of stages the scroll writes one page for', () => {
        expect(parseSeaSlugJournal(PAGE[SS_STAGE.SPOKEN_KENNITH])?.flags.has('kennith-or-kent')).toBe(true);
        expect(parseSeaSlugJournal(PAGE[SS_STAGE.KENNITH_NEED_ESCAPE])?.flags.has('panel-or-call')).toBe(true);
    });

    test('leaves the unambiguous pages without a flag', () => {
        expect([...(parseSeaSlugJournal(PAGE[SS_STAGE.LIT_TORCH])?.flags ?? [])]).toEqual([]);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseSeaSlugJournal('some other quest entirely')).toBeUndefined();
    });
});

describe('Sea Slug decide', () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('opens with Caroline when the quest has not started', () => {
        const step = decide(snap({ journal: 'notStarted' }));

        expect(step.kind === 'talk' && step.stop.npc).toBe('Caroline');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        expect(decide(snap({ progress: undefined })).kind).toBe('wait');
    });

    test('asks Holgart for the ride once Caroline has been spoken to', () => {
        const step = decide(snap({ stage: SS_STAGE.STARTED }));

        expect(step.kind === 'talk' && step.stop.npc).toBe('Holgart');
    });

    test('reads the bank before believing it has no swamp paste', () => {
        expect(decide(snap({ stage: SS_STAGE.SPOKEN_HOLGART, bankKnown: false })).kind).toBe('scanBank');
    });

    test('takes banked swamp paste rather than walking to Port Khazard', () => {
        const step = decide(snap({ stage: SS_STAGE.SPOKEN_HOLGART, bank: ['Swamp paste'] }));

        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Swamp paste');
    });

    test('buys the swamp paste from the Khazard counter when nothing is banked', () => {
        const step = decide(snap({ stage: SS_STAGE.SPOKEN_HOLGART }));

        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Swamp paste');
        expect(step.kind === 'buy' && step.shop.anchor).toBe(SS_TILE.KHAZARD_SHOP);
    });

    test('hands the paste over once it is in the pack', () => {
        const step = decide(snap({ stage: SS_STAGE.SPOKEN_HOLGART, invIds: [SS_OBJ.SWAMP_PASTE] }));

        expect(step.kind === 'talk' && step.stop.npc).toBe('Holgart');
    });

    test('calls to Kennith once the boat is repaired', () => {
        expect(customName(decide(snap({ stage: SS_STAGE.BOAT_REPAIRED })))).toBe('call to Kennith behind the crates');
    });

    test('runs one leg for both of the stages the Kennith page covers', () => {
        for (const stage of [SS_STAGE.SPOKEN_KENNITH, SS_STAGE.SAILED_KENT]) {
            expect(customName(decide(snap({ stage })))).toBe('find Kent on the island');
        }
    });

    test('sails to the platform before hunting for a torch', () => {
        const step = decide(snap({ stage: SS_STAGE.SPOKEN_KENT }));

        expect(customName(step)).toBe('sail to the fishing platform');
    });

    test('asks Bailey for the torch on the deck', () => {
        const step = decide(snap({ stage: SS_STAGE.SPOKEN_KENT, tile: ON_DECK }));

        expect(step.kind === 'talk' && step.stop.npc).toBe('Bailey');
    });

    test('grabs the damp sticks before the glass', () => {
        const step = decide(snap({ stage: SS_STAGE.SPOKEN_KENT, tile: ON_DECK, invIds: [SS_OBJ.TORCH_UNLIT] }));

        expect(step.kind === 'grabGround' && step.item).toBe('Damp sticks');
    });

    test('grabs the broken glass once the sticks are held', () => {
        const step = decide(snap({
            stage: SS_STAGE.SPOKEN_KENT,
            tile: ON_DECK,
            invIds: [SS_OBJ.TORCH_UNLIT, SS_OBJ.DAMP_STICKS]
        }));

        expect(step.kind === 'grabGround' && step.item).toBe('Broken glass');
    });

    test('dries the sticks with the glass rather than the other way round', () => {
        const step = decide(snap({
            stage: SS_STAGE.SPOKEN_KENT,
            tile: ON_DECK,
            invIds: [SS_OBJ.TORCH_UNLIT, SS_OBJ.DAMP_STICKS, SS_OBJ.BROKEN_GLASS]
        }));

        expect(step.kind).toBe('useOn');
        expect(step.kind === 'useOn' && step.item).toBe('Broken glass');
        expect(step.kind === 'useOn' && step.target).toBe('Damp sticks');
    });

    test('rubs the dry sticks once they are dry', () => {
        const step = decide(snap({
            stage: SS_STAGE.SPOKEN_KENT,
            tile: ON_DECK,
            invIds: [SS_OBJ.TORCH_UNLIT, SS_OBJ.DRY_STICKS]
        }));

        expect(customName(step)).toBe('rub the dry sticks together');
    });

    test('still rubs on stage 6 when the torch is already lit', () => {
        const step = decide(snap({
            stage: SS_STAGE.SPOKEN_KENT,
            tile: ON_DECK,
            invIds: [SS_OBJ.TORCH_LIT, SS_OBJ.DRY_STICKS]
        }));

        expect(customName(step)).toBe('rub the dry sticks together');
    });

    test('climbs down before working the torch chain from the upper deck', () => {
        const step = decide(snap({ stage: SS_STAGE.SPOKEN_KENT, tile: UPPER_DECK }));

        expect(customName(step)).toBe('climb down to the lower deck');
    });

    test('shows Kennith the lit torch on stage 7', () => {
        const step = decide(snap({ stage: SS_STAGE.LIT_TORCH, tile: ON_DECK, invIds: [SS_OBJ.TORCH_LIT] }));

        expect(customName(step)).toBe('show Kennith the lit torch');
    });

    test('relights a torch that went out rather than climbing into the fishermen', () => {
        const step = decide(snap({ stage: SS_STAGE.LIT_TORCH, tile: ON_DECK, invIds: [SS_OBJ.TORCH_UNLIT] }));

        expect(step.kind === 'grabGround' && step.item).toBe('Damp sticks');
    });

    test('runs one leg for both of the stages the opening page covers', () => {
        for (const stage of [SS_STAGE.KENNITH_NEED_ESCAPE, SS_STAGE.PANEL_OPENED]) {
            const step = decide(snap({ stage, tile: ON_DECK, invIds: [SS_OBJ.TORCH_LIT] }));

            expect(customName(step)).toBe('kick the panel open and call Kennith through');
        }
    });

    test('swings the crane once Kennith is waiting for a way down', () => {
        const step = decide(snap({ stage: SS_STAGE.NEED_KENNITH_PATH, tile: UPPER_DECK, invIds: [SS_OBJ.TORCH_LIT] }));

        expect(customName(step)).toBe('swing the crane over to Kennith');
    });

    test('stops rather than looping when stage 10 has no torch to climb with', () => {
        const step = decide(snap({ stage: SS_STAGE.NEED_KENNITH_PATH, tile: ON_DECK }));

        expect(step.kind).toBe('wait');
    });

    test('sails home from the platform once Kennith is in the boat', () => {
        const step = decide(snap({ stage: SS_STAGE.SAVED_KENNITH, tile: ON_DECK, invIds: [SS_OBJ.TORCH_LIT] }));

        expect(customName(step)).toBe('sail back to the Ardougne shore');
    });

    test('sails home from the island too, rather than walking at Caroline', () => {
        const step = decide(snap({ stage: SS_STAGE.SAVED_KENNITH, tile: ON_ISLAND }));

        expect(customName(step)).toBe('sail back to the Ardougne shore');
    });

    test('claims the reward from Caroline once ashore', () => {
        const step = decide(snap({ stage: SS_STAGE.SAVED_KENNITH, tile: ON_SHORE }));

        expect(step.kind === 'talk' && step.stop.npc).toBe('Caroline');
    });
});

describe('Sea Slug module', () => {
    test('gates on the Firemaking the rub needs', () => {
        expect(seaslug.record.requirements.skills).toEqual([{ skill: 'firemaking', level: 30 }]);
    });

    test('carries no bank list, so a resume past Holgart fetches no second paste', () => {
        expect(seaslug.record.items).toEqual([]);
    });

    test('keeps every quest item off the deposit list', () => {
        for (const tool of ['torch', 'damp sticks', 'dry sticks', 'broken glass', 'swamp paste', 'coins']) {
            expect(seaslug.tools).toContain(tool);
        }
    });

    test('banks in East Ardougne, the only bank on this quest\'s side of the map', () => {
        expect(seaslug.bank).toBe(SS_TILE.BANK);
    });

    test('sourcePaste stands down once the paste is carried', () => {
        expect(sourcePaste(snap({ invIds: [SS_OBJ.SWAMP_PASTE] }))).toBeNull();
    });

    test('torchStep sails first from anywhere off the platform', () => {
        expect(customName(torchStep(snap({ stage: SS_STAGE.SPOKEN_KENT })))).toBe('sail to the fishing platform');
    });
});
