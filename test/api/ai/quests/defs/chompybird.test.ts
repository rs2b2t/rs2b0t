import { beforeEach, describe, expect, test } from 'bun:test';

import { CB_ID, CB_STAGE } from '#/bot/api/ai/quests/defs/chompybird/areas.js';
import { CookState } from '#/bot/api/ai/quests/defs/chompybird/cook.js';
import { ChestState } from '#/bot/api/ai/quests/defs/chompybird/hunt.js';
import { chompybird, decide } from '#/bot/api/ai/quests/defs/chompybird/index.js';
import { ARROW_TARGET } from '#/bot/api/ai/quests/defs/chompybird/supplies.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const RANTZ = { x: 2630, z: 2981, level: 0 };

const SEASONINGS: [number, number][] = [
    [CB_ID.POTATO, 1], [CB_ID.ONION, 1], [CB_ID.CABBAGE, 1],
    [CB_ID.TOMATO, 1], [CB_ID.EQUA, 1], [CB_ID.DOOGLE, 1]
];

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    invIds?: [number, number][];
    inv?: [string, number][];
    bank?: [string, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    wornIds?: number[];
}

/** A pack that has already been through the bank: coins, food and an axe. */
function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? CB_STAGE.NOT_STARTED;
    const inv = new Map<string, number>([
        ['coins', 2000],
        ['trout', 6],
        ['bronze axe', 1],
        ...(options.inv ?? [])
    ]);
    return {
        journal: options.journal ?? (stage === CB_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv,
        invIds: new Map([[CB_ID.FEATHER, ARROW_TARGET * 4], ...(options.invIds ?? [])]),
        worn: new Set(),
        wornIds: new Set(options.wornIds ?? []),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set<string>() },
        bank: new Map(options.bank ?? [['coins', 2_000_000]]),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: RANTZ,
        freeSlots: 20
    };
}

const step = (options: Options = {}): QuestStep => decide(snap(options));
const named = (s: QuestStep): string => (s.kind === 'custom' ? s.name : s.kind);

/** Tools bought from Bugs, so the arrow leg is past its shopping. */
const TOOLED: [number, number][] = [[CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1]];

describe('big chompy bird hunting decide', () => {
    beforeEach(() => {
        CookState.kidsAsked = false;
        ChestState.refused = false;
    });

    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(step({ journal: 'unknown' })).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('a complete journal is done', () => {
        expect(step({ journal: 'complete', stage: CB_STAGE.COMPLETE })).toEqual({ kind: 'done' });
    });

    test('an unreadable stage waits', () => {
        const bare = { ...snap({ journal: 'inProgress' }), stage: undefined, progress: undefined };
        expect(decide(bare)).toEqual({ kind: 'wait', reason: 'quest stage not readable' });
    });

    test('a dressed pack starts the quest with Rantz', () => {
        expect(named(step())).toBe("agree to make Rantz his 'stabbers'");
    });

    test('an axe is withdrawn before the walk south when the bank has one', () => {
        const s = step({ inv: [['bronze axe', 0]], bank: [['coins', 2_000_000], ['iron axe', 1]] });
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items.some(i => i.name === 'Iron axe')).toBe(true);
    });

    test('an axeless bank buys one from Bob rather than parking', () => {
        const s = step({ inv: [['bronze axe', 0]] });
        expect(s.kind).toBe('buy');
        expect(s.kind === 'buy' && s.item).toBe('Bronze axe');
        expect(s.kind === 'buy' && s.shop.npc).toBe('Bob');
    });

    test('feathers are bought from Gerrant before the quest starts', () => {
        const s = step({ invIds: [[CB_ID.FEATHER, 0]] });
        expect(s.kind).toBe('buy');
        expect(s.kind === 'buy' && s.item).toBe('Feather');
        expect(s.kind === 'buy' && s.qty).toBe(ARROW_TARGET * 4);
    });

    test('banked feathers are withdrawn instead of bought', () => {
        const s = step({ invIds: [[CB_ID.FEATHER, 0]], bankIds: [[CB_ID.FEATHER, 500]] });
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items[0]?.id).toBe(CB_ID.FEATHER);
    });

    test('the started quest buys the knife and chisel from Bugs', () => {
        expect(named(step({ stage: CB_STAGE.STARTED }))).toBe('buy the knife and chisel from Bugs');
    });

    test('a banked knife and chisel are withdrawn rather than bought', () => {
        const s = step({ stage: CB_STAGE.STARTED, bankIds: [[CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1]] });
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items.map(i => i.id)).toEqual([CB_ID.KNIFE, CB_ID.CHISEL]);
    });

    test('with tools and no logs it chops an achey tree', () => {
        expect(named(step({ stage: CB_STAGE.STARTED, invIds: TOOLED }))).toBe('chop an achey tree');
    });

    test('logs in the pack are cut into shafts', () => {
        const s = step({ stage: CB_STAGE.STARTED, invIds: [...TOOLED, [CB_ID.ACHEY_LOGS, 1]] });
        expect(s.kind).toBe('useOn');
        expect(s.kind === 'useOn' && s.target).toBe('Achey tree logs');
        expect(s.kind === 'useOn' && s.product).toBe('Ogre arrow shaft');
    });

    test('a batch of six shafts is feathered rather than fed in threes', () => {
        const s = step({ stage: CB_STAGE.STARTED, invIds: [...TOOLED, [CB_ID.SHAFT, 6]] });
        expect(s.kind).toBe('useOn');
        expect(s.kind === 'useOn' && s.product).toBe('Flighted ogre arrow');
    });

    test('flighted arrows with no tips arm the account before the wolf', () => {
        const s = step({
            stage: CB_STAGE.STARTED,
            invIds: [...TOOLED, [CB_ID.FLIGHTED, 6]],
            bank: [['coins', 2_000_000], ['rune scimitar', 1]]
        });
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items.some(i => i.name === 'Rune scimitar')).toBe(true);
    });

    test('an armed account fights the wolf itself', () => {
        const s = step({
            stage: CB_STAGE.STARTED,
            invIds: [...TOOLED, [CB_ID.FLIGHTED, 6]],
            inv: [['rune scimitar', 0]],
            wornIds: [1333]
        });
        expect(named(s)).toBe('kill a wolf for bones');
    });

    test('flighted arrows and tips make ogre arrows', () => {
        const s = step({ stage: CB_STAGE.STARTED, invIds: [...TOOLED, [CB_ID.FLIGHTED, 6], [CB_ID.ARROWTIPS, 6]] });
        expect(s.kind).toBe('useOn');
        expect(s.kind === 'useOn' && s.product).toBe('Ogre arrow');
    });

    test('a full quiver hands six over to Rantz', () => {
        const s = step({ stage: CB_STAGE.STARTED, invIds: [...TOOLED, [CB_ID.ARROW, ARROW_TARGET]] });
        expect(named(s)).toBe('hand Rantz the six ogre arrows');
    });

    test('the given-arrows stage asks how to make the chompys come', () => {
        expect(named(step({ stage: CB_STAGE.GIVEN_ARROWS }))).toBe('ask Rantz how to make the chompys come');
    });

    test('the chest is searched for the bellows once the kids have been mentioned', () => {
        expect(named(step({ stage: CB_STAGE.KIDS_PLAY_WITH_TOAD }))).toBe('take the ogre bellows from the chest');
    });

    test('a refused chest sends it to the bank for the pair the account already owns', () => {
        ChestState.refused = true;
        const s = step({ stage: CB_STAGE.KIDS_PLAY_WITH_TOAD, bankIds: [[CB_ID.BELLOWS_EMPTY, 1]] });
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items[0]?.id).toBe(CB_ID.BELLOWS_EMPTY);
    });

    test('a refused chest and an empty bank park with a reason', () => {
        ChestState.refused = true;
        expect(step({ stage: CB_STAGE.KIDS_PLAY_WITH_TOAD })).toEqual({
            kind: 'wait',
            reason: 'no ogre bellows in the chest or the bank'
        });
    });

    test('bellows in the pack inflate a toad', () => {
        const s = step({ stage: CB_STAGE.REMOVED_ROCK, invIds: [[CB_ID.BELLOWS3, 1]] });
        expect(named(s)).toBe('inflate a swamp toad');
    });

    test('a bloated toad is shown to Rantz before it is placed', () => {
        const s = step({ stage: CB_STAGE.REMOVED_ROCK, invIds: [[CB_ID.BELLOWS1, 1], [CB_ID.TOAD, 1]] });
        expect(named(s)).toBe('show Rantz the bloated toad');
    });

    test('the shown-toad stage baits the clearing and waits for Rantz', () => {
        const s = step({ stage: CB_STAGE.SHOWN_TOAD, invIds: [[CB_ID.BELLOWS3, 1], [CB_ID.TOAD, 1]] });
        expect(named(s)).toBe('bait the clearing and watch Rantz shoot');
    });

    test('a missed shot sends it back to Rantz for the bow', () => {
        expect(named(step({ stage: CB_STAGE.RANTZ_MISSED }))).toBe('borrow the ogre bow from Rantz');
    });

    // Why: past the loan Rantz sells the replacement for 500-550 coins and answers an empty purse with "come back when you have".
    test('coins come out of the bank before the bow is asked for', () => {
        const s = step({ stage: CB_STAGE.GOT_BOW, inv: [['coins', 0]] });
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items.some(i => i.name === 'Coins')).toBe(true);
    });

    test('the empty-purse withdrawal leaves the axe alone', () => {
        const s = step({ stage: CB_STAGE.GOT_BOW, inv: [['coins', 0], ['bronze axe', 0]] });
        expect(s.kind).toBe('withdraw');
        expect(s.kind === 'withdraw' && s.items.every(i => !i.name.endsWith('axe'))).toBe(true);
    });

    test('bow, arrows and bellows in hand hunt the chompy', () => {
        const s = step({
            stage: CB_STAGE.GOT_BOW,
            invIds: [[CB_ID.BOW, 1], [CB_ID.ARROW, 6], [CB_ID.BELLOWS3, 1]]
        });
        expect(named(s)).toBe('shoot and pluck a chompy bird');
    });

    test('a quivered arrow counts, since the worn count is not on the wire', () => {
        const s = step({
            stage: CB_STAGE.GOT_BOW,
            invIds: [[CB_ID.BELLOWS3, 1]],
            wornIds: [CB_ID.BOW, CB_ID.ARROW]
        });
        expect(named(s)).toBe('shoot and pluck a chompy bird');
    });

    test('an empty quiver goes back to the fletching chain', () => {
        const s = step({
            stage: CB_STAGE.GOT_BOW,
            invIds: [...TOOLED, [CB_ID.BOW, 1], [CB_ID.BELLOWS3, 1]]
        });
        expect(named(s)).toBe('chop an achey tree');
    });

    test('a plucked chompy is shown to Rantz', () => {
        const s = step({ stage: CB_STAGE.KILLED_CHOMPY, invIds: [[CB_ID.RAW_CHOMPY, 1]] });
        expect(named(s)).toBe('show Rantz the raw chompy');
    });

    test('the killed stage hunts again when the carcass was lost', () => {
        const s = step({ stage: CB_STAGE.KILLED_CHOMPY, invIds: [[CB_ID.BOW, 1], [CB_ID.ARROW, 6], [CB_ID.BELLOWS3, 1]] });
        expect(named(s)).toBe('shoot and pluck a chompy bird');
    });

    // Why: the chompy takes several shots, so a handful of arrows is a fight that runs dry with the bird alive.
    test('a short quiver goes back to the fletching chain rather than hunting', () => {
        const s = step({
            stage: CB_STAGE.GOT_BOW,
            invIds: [...TOOLED, [CB_ID.BOW, 1], [CB_ID.ARROW, 3], [CB_ID.BELLOWS3, 1]]
        });
        expect(named(s)).toBe('chop an achey tree');
    });

    test('the cook stage asks the children first', () => {
        const s = step({ stage: CB_STAGE.TOLD_TO_COOK, invIds: [[CB_ID.RAW_CHOMPY, 1]] });
        expect(named(s)).toBe('ask Bugs and Fycie what they want');
    });

    test('every seasoning is carried, since none of the three choices is on the wire', () => {
        CookState.kidsAsked = true;
        const s = step({ stage: CB_STAGE.TOLD_TO_COOK, invIds: [[CB_ID.RAW_CHOMPY, 1]] });
        expect(named(s)).toBe('pick a potato');
    });

    test('a stocked pack roasts the chompy', () => {
        CookState.kidsAsked = true;
        const s = step({
            stage: CB_STAGE.TOLD_TO_COOK,
            invIds: [[CB_ID.RAW_CHOMPY, 1], ...SEASONINGS]
        });
        expect(named(s)).toBe('roast the chompy on the ogre spit');
    });

    test('the cooked stage hands the seasoned chompy over', () => {
        const s = step({ stage: CB_STAGE.CHOMPY_COOKED, invIds: [[CB_ID.SEASONED_CHOMPY, 1]] });
        expect(named(s)).toBe('hand Rantz the seasoned chompy');
    });
});

describe('big chompy bird hunting module', () => {
    test('is registered in the quest queue', () => {
        expect(QUEST_DEFS.some(d => d.record.id === 'chompybird')).toBe(true);
    });

    test('owns its own inventory and banks at Yanille', () => {
        expect(chompybird.ownsInventory).toBe(true);
        expect(chompybird.bank).toMatchObject({ x: 2612, z: 3092, level: 0 });
    });

    test('declares the official requirements', () => {
        const skills = chompybird.record.requirements.skills ?? [];
        expect(skills).toEqual([
            { skill: 'fletching', level: 5 },
            { skill: 'cooking', level: 30 },
            { skill: 'ranged', level: 30 }
        ]);
    });
});
