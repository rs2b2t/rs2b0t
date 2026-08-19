import { afterEach, describe, expect, test } from 'bun:test';

import { QUESTS } from '#/bot/api/ai/quests/data/quests.js';
import { QUEST_DEFS, defById } from '#/bot/api/ai/quests/defs/index.js';
import { HERO_ID } from '#/bot/api/ai/quests/defs/heroquest/areas.js';
import { HeroConfig, resetHeroGangCache } from '#/bot/api/ai/quests/defs/heroquest/config.js';
import { decide, heroquest, inSealedPocket } from '#/bot/api/ai/quests/defs/heroquest/index.js';
import { HERO_STAGE } from '#/bot/api/ai/quests/defs/heroquest/journal.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const VARROCK = { x: 3210, z: 3490, level: 0 };

// Why: the quest keeps a coin float for the 30gp ferry, so every snapshot carries one — a test that
// leaves the pack empty gets the withdrawal rather than the branch it is asking about.
function snap(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
    const stage = over.stage ?? HERO_STAGE.STARTED;
    return {
        journal: 'inProgress',
        inv: new Map(),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: VARROCK as QuestSnapshot['tile'],
        freeSlots: 20,
        stage,
        progress: { stage, flags: new Set() },
        ...over,
        invIds: new Map([[HERO_ID.COINS, 5_000], ...(over.invIds ?? [])])
    };
}

function withGang(gang: 'phoenix' | 'blackarm'): void {
    ArravConfig.gang = gang;
    resetHeroGangCache();
}

/** Every piece the Black Arm disguise and the Phoenix snipe kit need, so a test can skip past them. */
function kitted(gang: 'phoenix' | 'blackarm'): Map<number, number> {
    return gang === 'blackarm'
        ? new Map([[HERO_ID.BLACK_PLATEBODY, 1], [HERO_ID.BLACK_PLATELEGS, 1], [HERO_ID.BLACK_FULL_HELM, 1]])
        : new Map([[HERO_ID.OAK_LONGBOW, 1], [HERO_ID.STEEL_ARROW, 150]]);
}

afterEach(() => {
    ArravConfig.gang = 'random';
    HeroConfig.partner = '';
    resetHeroGangCache();
});

// Why: `no path to (2793,3180,0): unreachable without 30x Coins` is the failure in full — the Ardougne
// ferry is 30 coins and the pathfinder refuses the route without them in the pack.
describe("hero's quest coin float", () => {
    test('an empty pack withdraws before anything else', () => {
        withGang('blackarm');
        const step = decide(snap({ invIds: new Map([[HERO_ID.COINS, 0]]), stage: HERO_STAGE.BLACKARM_SPOKEN }));
        expect(step).toMatchObject({ kind: 'withdraw' });
    });

    test('a float already carried is left alone', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        expect(decide(snap({ stage: HERO_STAGE.BLACKARM_SPOKEN }))).not.toMatchObject({ kind: 'withdraw' });
    });

    // Why: a float restored on every pass costs a bank trip after every shop, so the mark is low.
    test('the change left after a purchase is enough', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.BLACKARM_SPOKEN,
            invIds: new Map([[HERO_ID.COINS, 660]])
        }));
        expect(step).not.toMatchObject({ kind: 'withdraw' });
    });

    test('an empty bank does not send the bot to a booth for nothing', () => {
        withGang('blackarm');
        const step = decide(snap({ invIds: new Map([[HERO_ID.COINS, 0]]), bankCoins: 0, stage: HERO_STAGE.BLACKARM_SPOKEN }));
        expect(step).not.toMatchObject({ kind: 'withdraw' });
    });
});

describe("hero's quest decide", () => {
    test('an unloaded journal waits rather than restarting a finished quest', () => {
        expect(decide(snap({ journal: 'unknown' }))).toMatchObject({ kind: 'wait' });
    });

    test('a green journal is done', () => {
        expect(decide(snap({ journal: 'complete' }))).toMatchObject({ kind: 'done' });
    });

    test('an unreadable stage waits', () => {
        expect(decide(snap({ stage: undefined, progress: undefined }))).toMatchObject({ kind: 'wait' });
    });

    // Why: ownsInventory skips the engine's provisioning, so nothing else opens a booth and a banked
    // armband, feather or eel stays invisible until the module asks for one read.
    test('an unread bank is scanned before anything else is decided', () => {
        expect(decide(snap({ bankKnown: false }))).toMatchObject({ kind: 'scanBank' });
    });

    test('a not-started quest applies to Achietties', () => {
        const step = decide(snap({ stage: HERO_STAGE.NOT_STARTED, progress: { stage: 0, flags: new Set() } }));
        expect(step).toMatchObject({ kind: 'custom' });
    });

    test('without a partner the armband stalls with a readable reason', () => {
        withGang('blackarm');
        const step = decide(snap({ stage: HERO_STAGE.BLACKARM_ARMBAND }));
        expect(step).toMatchObject({ kind: 'wait' });
        expect((step as { reason: string }).reason).toContain('heroPartner');
    });
});

describe("hero's quest hand-in", () => {
    function ready(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
        return snap({
            stage: HERO_STAGE.BLACKARM_ARMBAND,
            invIds: new Map([
                [HERO_ID.ARMBAND, 1],
                [HERO_ID.FEATHER, 1],
                [HERO_ID.LAVA_EEL, 1]
            ]),
            ...over
        });
    }

    test('all three carried hands them to Achietties', () => {
        withGang('blackarm');
        expect(decide(ready())).toMatchObject({ kind: 'custom' });
    });

    // Why: `~send_quest_complete` reads inv_total, so a banked feather is not a carried one.
    test('a banked feather is withdrawn rather than handed in', () => {
        withGang('blackarm');
        const step = decide(ready({
            invIds: new Map([[HERO_ID.ARMBAND, 1], [HERO_ID.LAVA_EEL, 1]]),
            bankIds: new Map([[HERO_ID.FEATHER, 1]])
        }));
        expect(step).toMatchObject({ kind: 'withdraw' });
    });

    test('with the armband but no eel the eel chain runs first', () => {
        withGang('blackarm');
        const step = decide(snap({
            stage: HERO_STAGE.BLACKARM_ARMBAND,
            invIds: new Map([[HERO_ID.ARMBAND, 1], [HERO_ID.FEATHER, 1]])
        }));
        expect(step).not.toMatchObject({ kind: 'done' });
        expect(JSON.stringify(step)).not.toContain('Achietties');
    });
});

describe("hero's quest gang branches", () => {
    test('the Black Arm bot buys its disguise before crossing to Brimhaven', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({ stage: HERO_STAGE.BLACKARM_SPOKEN }));
        expect((step as { name: string }).name).toContain('Black platebody');
    });

    test('the Phoenix bot buys a bow before crossing to Brimhaven', () => {
        withGang('phoenix');
        HeroConfig.partner = 'rival';
        const step = decide(snap({ stage: HERO_STAGE.PHOENIX_SPOKEN }));
        expect((step as { name: string }).name).toContain('Oak longbow');
    });

    test('a kitted Black Arm bot goes for the hideout password', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({ stage: HERO_STAGE.BLACKARM_SPOKEN, invIds: kitted('blackarm') }));
        expect(step).toMatchObject({ kind: 'custom' });
    });

    test('the Black Arm bot hands the spare key over the moment Grip gives it', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN,
            invIds: new Map([...kitted('blackarm'), [HERO_ID.MISC_KEY, 1]])
        }));
        expect((step as { name: string }).name).toContain('give-key');
    });

    // Why: the key is only useful with a bow worn, and fetching one afterwards starts in Brimhaven.
    test('a carried bow is worn before the key is asked for', () => {
        withGang('phoenix');
        HeroConfig.partner = 'rival';
        const step = decide(snap({ stage: HERO_STAGE.PHOENIX_CHARLIE, invIds: kitted('phoenix') }));
        expect(step).toMatchObject({ kind: 'equip' });
    });

    test('a kitted Phoenix bot waits for that key before it walks to the slit', () => {
        withGang('phoenix');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.PHOENIX_CHARLIE,
            wornIds: new Set([HERO_ID.OAK_LONGBOW, HERO_ID.STEEL_ARROW])
        }));
        expect((step as { name: string }).name).toContain('take-key');
    });

    test('holding the key, the Phoenix bot goes to the arrow slit', () => {
        withGang('phoenix');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.PHOENIX_CHARLIE,
            invIds: new Map([...kitted('phoenix'), [HERO_ID.MISC_KEY, 1]]),
            wornIds: new Set([HERO_ID.OAK_LONGBOW, HERO_ID.STEEL_ARROW])
        }));
        expect((step as { name: string }).name).toContain('arrow slit');
    });

    // Why: the chest hands over two, one of which is the rival's payment.
    test('two candlesticks means one is owed to the rival', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.BLACKARM_LOOTED,
            invIds: new Map([[HERO_ID.CANDLESTICK, 2]])
        }));
        expect((step as { name: string }).name).toContain('give-candlestick');
    });

    test('one candlestick left goes to Katrine', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.BLACKARM_LOOTED,
            invIds: new Map([[HERO_ID.CANDLESTICK, 1]])
        }));
        expect((step as { name: string }).name).toContain('Katrine');
    });
});

// Why: every Brimhaven pocket is sealed in the baked graph, so a shop or bank walk planned from inside
// one reads `unreachable` before it takes a step — the module owes the way out first.
describe("hero's quest sealed pockets", () => {
    const MANSION = { x: 2774, z: 3192, level: 0 } as QuestSnapshot['tile'];

    test('a bank scan from inside the mansion leaves it first', () => {
        withGang('blackarm');
        const step = decide(snap({ bankKnown: false, tile: MANSION }));
        expect((step as { name: string }).name).toContain('sealed');
    });

    // Why: a withdraw is a walk the navigator plans, where a buy leg crosses its own doors first.
    test('a bank withdrawal from inside the mansion leaves it first', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.BLACKARM_SPOKEN,
            tile: MANSION,
            bankIds: new Map([[HERO_ID.BLACK_PLATEBODY, 1]])
        }));
        expect((step as { name: string }).name).toContain('sealed');
    });

    test('a custom leg is left alone — it crosses its own doors', () => {
        withGang('blackarm');
        HeroConfig.partner = 'rival';
        const step = decide(snap({
            stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN,
            tile: MANSION,
            invIds: new Map([...kitted('blackarm'), [HERO_ID.GRIP_KEYS, 1]])
        }));
        expect((step as { name: string }).name).toContain('treasure room');
    });

    test('the pocket test knows the street from the rooms', () => {
        expect(inSealedPocket(snap({ tile: MANSION }))).toBe(true);
        expect(inSealedPocket(snap({ tile: { x: 2793, z: 3180, level: 0 } as QuestSnapshot['tile'] }))).toBe(false);
    });
});

describe("hero's quest module", () => {
    test('the record is the one in the quest data', () => {
        expect(heroquest.record).toBe(QUESTS.find(q => q.id === 'hero')!);
    });

    test('it is registered, and after Dragon Slayer', () => {
        expect(defById('hero')).toBe(heroquest);
        expect(QUEST_DEFS.indexOf(heroquest)).toBeGreaterThan(QUEST_DEFS.indexOf(defById('dragon')!));
    });

    test('it owns its inventory, because nothing it needs is provisioned up front', () => {
        expect(heroquest.ownsInventory).toBe(true);
    });

    test('readiness warns while no partner is set', () => {
        expect(heroquest.warnReadiness?.()).toContain('partner');
        HeroConfig.partner = 'rival';
        expect(heroquest.warnReadiness?.()).toBeNull();
    });
});
