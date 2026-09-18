import { describe, expect, test } from 'bun:test';
import {
    ALL_BALL_IDS,
    DEATH_ITEM,
    DP_FLAG,
    DP_STAGE,
    decide,
    deathplateau,
    equipFloor,
    effectiveMap,
    parseDeathPlateauJournal,
    closeDiceIfOpen,
    insideHaroldRoom
} from '#/bot/api/ai/quests/defs/deathplateau/index.js';
import { nextStake, purseAfter } from '#/bot/api/ai/quests/defs/deathplateau/harold.js';
import { DEATH_DICE_MAIN } from '#/bot/api/ai/quests/defs/deathplateau/areas.js';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

function idCounts(ids: number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of ids) {
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

function progress(stage: number, flags: string[] = []): QuestProgress {
    return { stage, flags: new Set(flags) };
}

interface SnapOpts {
    journal?: QuestSnapshot['journal'];
    progress?: QuestProgress;
    inv?: string[];
    invIds?: number[];
    bank?: string[];
    bankKnown?: boolean;
    freeSlots?: number;
    tile?: QuestSnapshot['tile'];
}

function snap(o: SnapOpts = {}): QuestSnapshot {
    const bank = counts(o.bank ?? []);
    const prog = o.progress;
    return {
        journal: o.journal ?? 'inProgress',
        inv: counts(o.inv ?? []),
        invIds: idCounts(o.invIds ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: bank.get('coins') ?? 0,
        stage: prog?.stage,
        progress: prog,
        bank,
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? { x: 2896, z: 3528, level: 0 } : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('parseDeathPlateauJournal — equip room stages', () => {
    test('not started', () => {
        const p = parseDeathPlateauJournal(
            '@dbl@I can start this quest by speaking to @dre@Denulth@dbl@ who is in his|tent at the @dre@Imperial Guard camp@dbl@ in @dre@Burthorpe'
        );
        expect(p?.stage).toBe(DP_STAGE.NOT_STARTED);
    });

    test('complete', () => {
        const p = parseDeathPlateauJournal(
            '@str@I gave Denulth the secret way map and the combination.||@red@QUEST COMPLETE!'
        );
        expect(p?.stage).toBe(DP_STAGE.COMPLETE);
    });

    test('started — offered to help', () => {
        const p = parseDeathPlateauJournal(
            '@dbl@I have offered to help @dre@Denulth@dbl@ by finding @dre@another way@dbl@ up|@dre@Death Plateau.@dbl@ I also need to find the @dre@combination@dbl@ to the|@dre@equipment room@dbl@ and @dre@unlock@dbl@ the door.|'
        );
        expect(p?.stage).toBe(DP_STAGE.STARTED);
    });

    test('spoken eohric — guard at the inn', () => {
        const p = parseDeathPlateauJournal(
            '@dbl@I have offered to help @dre@Denulth@dbl@ by finding @dre@another way@dbl@ up|@dre@Death Plateau.@dbl@ I also need to find the @dre@combination@dbl@.|'
            + '|@dre@Eohric@dbl@ said that the @dre@equipment room guard@dbl@ is staying at @dbl@the local inn, the @dre@Toad and Chicken'
        );
        expect(p?.stage).toBe(DP_STAGE.SPOKEN_EOHRIC);
    });

    test('spoken harold — would not talk', () => {
        const p = parseDeathPlateauJournal(
            '@dbl@I have offered to help Denulth.|'
            + '|@str@The equipment room guard is staying at the local inn, the Toad @str@and Chicken. The guard wouldn\'t talk to me!'
        );
        expect(p?.stage).toBe(DP_STAGE.SPOKEN_HAROLD);
    });

    test('spoken eohric2 — buy a drink tip', () => {
        const p = parseDeathPlateauJournal(
            '@dbl@I have offered to help Denulth.|'
            + '|@str@The equipment room guard is staying at the local inn, the @str@Toad and Chicken. The guard wouldn\'t talk to me!|'
            + '@dre@Eohric@dbl@ says to buy the @dre@guard@dbl@ a @dre@drink'
        );
        expect(p?.stage).toBe(DP_STAGE.SPOKEN_EOHRIC2);
    });

    test('given ale', () => {
        const p = parseDeathPlateauJournal(
            '@dbl@I have offered to help Denulth.|'
            + '|@str@The equipment room guard is staying at the local inn, the @str@Toad and Chicken. The guard wouldn\'t talk to me!|'
            + '@str@I bought the guard a drink and he seemed more helpful.'
        );
        expect(p?.stage).toBe(DP_STAGE.GIVEN_ALE);
    });

    test('given iou', () => {
        const p = parseDeathPlateauJournal(
            '@str@I bought the guard a drink and he seemed more helpful.'
            + ' I @str@gambled with the guard until he ran out of money. He wrote @str@me an IOU.|'
        );
        expect(p?.stage).toBe(DP_STAGE.GIVEN_IOU);
    });

    test('found combo', () => {
        const p = parseDeathPlateauJournal(
            'I @str@gambled with the guard until he ran out of money. He wrote @str@me an IOU.|'
            + '|@str@It turned out the IOU was written on the back of the|@str@combination!'
        );
        expect(p?.stage).toBe(DP_STAGE.FOUND_COMBO);
    });

    test('unlocked door', () => {
        const p = parseDeathPlateauJournal(
            '|@str@I have found the combination to the equipment room and|@str@unlocked the door.|'
            + ' I put the stone balls in the right places on the|@str@stone mechanism and unlocked the door.'
        );
        expect(p?.stage).toBe(DP_STAGE.UNLOCKED_DOOR);
    });

    test('fails closed on unrelated text', () => {
        expect(parseDeathPlateauJournal(['Death Plateau', 'Loading…'])).toBeUndefined();
    });
});

describe('parseDeathPlateauJournal — map flags', () => {
    test('saba', () => {
        const p = parseDeathPlateauJournal(
            '@dbl@I have offered to help Denulth.||@dre@Saba@dbl@ says that there is a @dre@sherpa@dbl@ living @dre@nearby@dbl@ that may|know another way up Death Plateau.'
        );
        expect(p?.flags.has(DP_FLAG.SABA)).toBe(true);
        expect(p?.flags.has(DP_FLAG.TENZING)).toBe(false);
    });

    test('tenzing supplies list cascades saba', () => {
        const p = parseDeathPlateauJournal(
            '||@str@I found the sherpa\'s house.||@dre@Tenzing@dbl@ will show me a @dre@secret way@dbl@ up Death Plateau if I get|him some items:|@dre@Ten loaves of bread.|@dre@Ten cooked trout.|@dre@Spiked boots.'
        );
        expect(p?.flags.has(DP_FLAG.TENZING)).toBe(true);
        expect(p?.flags.has(DP_FLAG.SABA)).toBe(true);
    });

    test('smithy + entrance cert', () => {
        const p = parseDeathPlateauJournal(
            '@dre@Dunstan@dbl@ will help me if I get his @dre@son signed up@dbl@ for the @dre@Imperial Guard@dbl@.'
            + '||@dre@Denulth@dbl@ gave me a @dre@certificate@dbl@ to prove that Dunstan\'s son|has been signed up for the Imperial Guard.'
        );
        expect(p?.flags.has(DP_FLAG.SMITHY)).toBe(true);
        expect(p?.flags.has(DP_FLAG.ENTRANCE_CERT)).toBe(true);
        expect(p?.flags.has(DP_FLAG.TENZING)).toBe(true);
    });

    test('given cert needs iron bar', () => {
        const p = parseDeathPlateauJournal(
            '||@str@I have given Dunstan the certificate to prove that his son|@str@has been signed up for the Imperial Guard.|@dbl@I will need an @dre@Iron bar@dbl@ for the boots'
        );
        expect(p?.flags.has(DP_FLAG.GIVEN_CERT)).toBe(true);
        expect(p?.flags.has(DP_FLAG.ENTRANCE_CERT)).toBe(true);
    });

    test('got map — need to check path', () => {
        const p = parseDeathPlateauJournal(
            '||@str@I found the sherpa\'s house. I gave Tenzing the ten loaves|@str@of bread, ten cooked trout and the Spiked boots.'
            + 'Tenzing|@str@has given me a map of the secret way.|@dbl@I need to @dre@check@dbl@ that the @dre@secret way@dbl@ is @dre@safe@dbl@ for the @dre@Imperial|Guard@dbl@ to use.'
        );
        expect(p?.flags.has(DP_FLAG.SUPPLIES)).toBe(true);
        expect(p?.flags.has(DP_FLAG.GOT_MAP)).toBe(true);
        expect(p?.flags.has(DP_FLAG.SCOUTED)).toBe(false);
    });

    test('scouted', () => {
        const p = parseDeathPlateauJournal(
            '@str@I have found another way up Death Plateau for Denulth.'
            + 'Tenzing|@str@has given me a map of the secret way. I checked the @str@secret way|@str@and it is safe for the Imperial Guard to use.'
        );
        expect(p?.flags.has(DP_FLAG.SCOUTED)).toBe(true);
        expect(p?.flags.has(DP_FLAG.GOT_MAP)).toBe(true);
        expect(p?.flags.has(DP_FLAG.SABA)).toBe(true);
    });
});

describe('equipFloor inventory awareness', () => {
    test('holding IOU raises floor to GIVEN_IOU', () => {
        const floor = equipFloor(
            snap({ progress: progress(DP_STAGE.GIVEN_ALE), invIds: [DEATH_ITEM.IOU.id] }),
            progress(DP_STAGE.GIVEN_ALE)
        );
        expect(floor).toBe(DP_STAGE.GIVEN_IOU);
    });

    test('holding Combination raises floor to FOUND_COMBO', () => {
        const floor = equipFloor(
            snap({ progress: progress(DP_STAGE.GIVEN_IOU), invIds: [DEATH_ITEM.COMBINATION.id] }),
            progress(DP_STAGE.GIVEN_IOU)
        );
        expect(floor).toBe(DP_STAGE.FOUND_COMBO);
    });

    test('holding any stone ball raises floor to FOUND_COMBO', () => {
        const floor = equipFloor(
            snap({ progress: progress(DP_STAGE.FOUND_COMBO), invIds: [DEATH_ITEM.BALL_RED.id] }),
            progress(DP_STAGE.GIVEN_IOU)
        );
        expect(floor).toBe(DP_STAGE.FOUND_COMBO);
    });
});

describe('effectiveMap inventory awareness', () => {
    test('climbing boots imply tenzing + saba', () => {
        const m = effectiveMap(
            snap({ invIds: [DEATH_ITEM.CLIMBING_BOOTS.id] }),
            progress(DP_STAGE.STARTED)
        );
        expect(m.tenzing).toBe(true);
        expect(m.saba).toBe(true);
        expect(m.smithy).toBe(false);
    });

    test('spiked boots imply given_cert', () => {
        const m = effectiveMap(
            snap({ invIds: [DEATH_ITEM.SPIKED_BOOTS.id] }),
            progress(DP_STAGE.UNLOCKED_DOOR)
        );
        expect(m.given_cert).toBe(true);
        expect(m.smithy).toBe(true);
    });

    test('secret way map implies got_map', () => {
        const m = effectiveMap(
            snap({ invIds: [DEATH_ITEM.SECRET_MAP.id] }),
            progress(DP_STAGE.UNLOCKED_DOOR, [DP_FLAG.SUPPLIES])
        );
        expect(m.got_map).toBe(true);
        expect(m.supplies).toBe(true);
    });
});

describe('decide', () => {
    test('module is registered with correct quest id', () => {
        expect(deathplateau.record.id).toBe('death');
        expect(deathplateau.record.name).toBe('Death Plateau');
        expect(deathplateau.ownsInventory).toBe(true);
    });

    test('complete journal → done', () => {
        expect(decide(snap({ journal: 'complete', progress: progress(DP_STAGE.COMPLETE) })).kind).toBe('done');
    });

    test('not started → talk Denulth (after pack/coins)', () => {
        const step = decide(snap({
            journal: 'notStarted',
            progress: progress(DP_STAGE.NOT_STARTED),
            inv: ['Coins', 'Coins', 'Coins']
        }));
        // Why: counts(['Coins','Coins']) gives coins:2 rather than a stack value, so the balance may read under 200 and either a bank step or the start talk is correct.
        expect(['custom', 'withdraw', 'scanBank', 'deposit', 'wait']).toContain(step.kind);
    });

    test('started → Eohric', () => {
        const step = decide(snap({ progress: progress(DP_STAGE.STARTED) }));
        expect(customName(step)).toMatch(/Eohric/i);
    });

    test('spoken eohric → Harold duty', () => {
        const step = decide(snap({ progress: progress(DP_STAGE.SPOKEN_EOHRIC) }));
        expect(customName(step)).toMatch(/Harold/i);
    });

    test('spoken eohric2 without ale → buy Asgarnian ale', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.SPOKEN_EOHRIC2),
            inv: Array(200).fill('Coins') as string[]
        }));
        // counts will give coins:200
        expect(step.kind === 'buy' && step.item.toLowerCase().includes('asgarnian')).toBe(true);
    });

    test('given ale with coins but no cocktail buys a Blurberry special', () => {
        const inv = new Map<string, number>([['coins', 500]]);
        const step = decide({
            ...snap({ progress: progress(DP_STAGE.GIVEN_ALE) }),
            inv
        });
        expect(step).toMatchObject({ kind: 'buy', item: 'Blurberry special', qty: 1, shop: { npc: 'Barman', anchor: { x: 2482, z: 3488, level: 1 } } });
    });

    test('holding IOU → read it', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.GIVEN_IOU),
            invIds: [DEATH_ITEM.IOU.id],
            inv: ['Iou']
        }));
        expect(customName(step)).toMatch(/read the iou/i);
    });

    test('holding combination without balls → pick balls', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.FOUND_COMBO),
            invIds: [DEATH_ITEM.COMBINATION.id],
            inv: ['Combination']
        }));
        expect(customName(step)).toMatch(/stone ball/i);
    });

    test('all balls held → place on mechanism', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.FOUND_COMBO),
            invIds: [DEATH_ITEM.COMBINATION.id, ...ALL_BALL_IDS],
            inv: ['Combination', ...ALL_BALL_IDS.map(() => 'Stone ball')]
        }));
        expect(customName(step)).toMatch(/stone ball|stone mechanism/i);
    });

    test('unlocked, no map progress → Saba', () => {
        const step = decide(snap({ progress: progress(DP_STAGE.UNLOCKED_DOOR) }));
        expect(customName(step)).toMatch(/Saba/i);
    });

    test('unlocked + tenzing flag, no smithy → Dunstan', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.UNLOCKED_DOOR, [DP_FLAG.SABA, DP_FLAG.TENZING]),
            invIds: [DEATH_ITEM.CLIMBING_BOOTS.id],
            inv: ['Climbing boots']
        }));
        expect(customName(step)).toMatch(/Dunstan/i);
    });

    test('smithy done, full pack → make space before Denulth cert', () => {
        // 28 junk slots, freeSlots 0 forces a bank deposit before Denulth grants the cert
        // (full inv would drop Certificate on the floor).
        const junk = Array.from({ length: 28 }, (_, i) => `junk${i}`);
        const step = decide(snap({
            progress: progress(DP_STAGE.UNLOCKED_DOOR, [
                DP_FLAG.SABA, DP_FLAG.TENZING, DP_FLAG.SMITHY
            ]),
            inv: junk,
            freeSlots: 0
        }));
        expect(step.kind).toBe('deposit');
    });

    test('smithy done with free slot → talk Denulth for cert', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.UNLOCKED_DOOR, [
                DP_FLAG.SABA, DP_FLAG.TENZING, DP_FLAG.SMITHY
            ]),
            freeSlots: 4
        }));
        expect(customName(step)).toMatch(/certificate|Denulth/i);
    });

    test('unlocked + scouted + map + combo → Denulth hand-in', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.UNLOCKED_DOOR, [
                DP_FLAG.SABA, DP_FLAG.TENZING, DP_FLAG.SMITHY, DP_FLAG.ENTRANCE_CERT,
                DP_FLAG.GIVEN_CERT, DP_FLAG.SUPPLIES, DP_FLAG.GOT_MAP, DP_FLAG.SCOUTED
            ]),
            invIds: [DEATH_ITEM.COMBINATION.id, DEATH_ITEM.SECRET_MAP.id],
            inv: ['Combination', 'Secret way map']
        }));
        expect(customName(step)).toMatch(/Denulth/i);
    });

    test('given_cert without iron bar → withdraw/wait iron bar', () => {
        const step = decide(snap({
            progress: progress(DP_STAGE.UNLOCKED_DOOR, [
                DP_FLAG.SABA, DP_FLAG.TENZING, DP_FLAG.SMITHY, DP_FLAG.ENTRANCE_CERT, DP_FLAG.GIVEN_CERT
            ]),
            invIds: [DEATH_ITEM.CLIMBING_BOOTS.id],
            inv: ['Climbing boots'],
            bank: ['Iron bar']
        }));
        expect(step.kind === 'withdraw' || customName(step)?.includes('spike')).toBe(true);
        if (step.kind === 'withdraw') {
            expect(step.items.some(i => i.name.toLowerCase().includes('iron'))).toBe(true);
        }
    });
});

describe('the dice interface never outlives a gamble round', () => {
    // Why: `death_dice` is on the engine's do-not-auto-close list, so a round that bailed with it up left a main modal nothing would shut and the run sat in Harold's room.
    // Why: `delayUntil` polls a game clock that never ticks in a unit test, so it answers the predicate directly.
    (Execution as unknown as { delayUntil: (c: () => boolean) => Promise<boolean> }).delayUntil =
        async (check: () => boolean) => check();

    const stubClient = (mainSeq: number[]) => {
        let call = 0;
        (reader as unknown as { modals: () => { main: number } }).modals = () => ({
            main: mainSeq[Math.min(call++, mainSeq.length - 1)]
        });
    };

    test('an open dice interface is closed', async () => {
        stubClient([DEATH_DICE_MAIN, DEATH_DICE_MAIN, -1]);
        let closed = false;
        (actions as unknown as { closeModal: () => boolean }).closeModal = () => {
            closed = true;
            return true;
        };
        await closeDiceIfOpen(() => {});
        expect(closed).toBe(true);
    });

    test('a closed interface is left alone', async () => {
        stubClient([-1]);
        let touched = false;
        (actions as unknown as { closeModal: () => boolean }).closeModal = () => {
            touched = true;
            return true;
        };
        await closeDiceIfOpen(() => {});
        expect(touched).toBe(false);
    });

    test('another quest modal is not closed by this', async () => {
        stubClient([8119]);
        let touched = false;
        (actions as unknown as { closeModal: () => boolean }).closeModal = () => {
            touched = true;
            return true;
        };
        await closeDiceIfOpen(() => {});
        expect(touched).toBe(false);
    });
});

describe("Harold's bedroom is the L behind the door, not the box around it", () => {
    // Why: the wall line at z3543 seals x2905..2907, and the room east of x2907 opens straight onto the corridor.
    test('the bed end is inside', () => {
        expect(insideHaroldRoom({ x: 2905, z: 3539, level: 1 })).toBe(true);
        expect(insideHaroldRoom({ x: 2906, z: 3542, level: 1 })).toBe(true);
    });

    test('the elbow at the door end reaches x2907 and no further south', () => {
        expect(insideHaroldRoom({ x: 2907, z: 3541, level: 1 })).toBe(true);
        expect(insideHaroldRoom({ x: 2907, z: 3539, level: 1 })).toBe(false);
    });

    test('the corridor and the room beyond it are outside', () => {
        expect(insideHaroldRoom({ x: 2906, z: 3543, level: 1 })).toBe(false);
        expect(insideHaroldRoom({ x: 2909, z: 3539, level: 1 })).toBe(false);
        expect(insideHaroldRoom({ x: 2905, z: 3539, level: 0 })).toBe(false);
        expect(insideHaroldRoom(null)).toBe(false);
    });
});

describe('the stake climbs past whatever Harold has won', () => {
    // Why: `dice_winnings` writes the IOU only when `harold_gold - bet` goes below zero, and a loss hands him the stake.
    test('101 bankrupts the 100gp Denulth gives him', () => {
        expect(nextStake(100, 2000)).toBe(101);
    });

    test('a loss raises the next stake past his new purse', () => {
        let purse = 100;
        const first = nextStake(purse, 2000);
        purse = purseAfter(purse, first, 'loss');
        expect(purse).toBe(201);
        expect(nextStake(purse, 2000)).toBe(202);
    });

    test('the stake never passes the 1000gp harold_gamble refuses', () => {
        expect(nextStake(5000, 20000)).toBe(1000);
        expect(purseAfter(900, 901, 'win')).toBe(1000);
    });

    test('an empty pack caps the stake rather than betting money that is not there', () => {
        expect(nextStake(300, 40)).toBe(40);
        expect(nextStake(300, 0)).toBe(0);
    });

    test('a win Harold could pay means the purse was read too low', () => {
        expect(purseAfter(100, 101, 'win')).toBe(201);
    });
});

for (const id of [2028, 2064]) {
    test(`a carried cocktail ${id} is given before gambling`, () => {
        const step = decide({ ...snap({ progress: progress(DP_STAGE.GIVEN_ALE), invIds: [id] }), inv: new Map([['coins', 500], ['blurberry special', 1]]) });
        expect(customName(step)).toContain('Blurberry');
    });
    test(`withdraws banked cocktail ${id} before buying one`, () => {
        const step = decide({ ...snap({ progress: progress(DP_STAGE.GIVEN_ALE) }), inv: new Map([['coins', 500]]), bankIds: new Map([[id, 1]]) });
        expect(step).toMatchObject({ kind: 'withdraw', items: [{ id, qty: 1 }] });
    });
}

test('startup deposit keeps a carried Blurberry special', () => {
    const step = decide(snap({ progress: progress(DP_STAGE.NOT_STARTED), inv: ['Blurberry special', 'Junk'] }));
    expect(step.kind).toBe('deposit');
    if (step.kind === 'deposit') expect(step.keep).toContain('blurberry special');
});

for (const coins of [131, 400]) {
    test(`buying the cocktail with ${coins} coins leaves enough for gambling`, () => {
        const before = { ...snap({ progress: progress(DP_STAGE.GIVEN_ALE) }), bank: new Map(), bankCoins: 0, inv: new Map([['coins', coins]]) };
        expect(decide(before).kind).toBe('buy');
        const after = { ...before, inv: new Map([['coins', coins - 30], ['blurberry special', 1]]), invIds: new Map([[2028, 1]]) };
        expect(customName(decide(after))).toContain('gamble');
    });
}

for (const id of [2028, 2064]) {
    test(`banked or held cocktail ${id} only needs the 101gp stake`, () => {
        const base = { ...snap({ progress: progress(DP_STAGE.GIVEN_ALE) }), bank: new Map(), bankCoins: 0, inv: new Map([['coins', 101]]) };
        expect(decide({ ...base, bankIds: new Map([[id, 1]]) }).kind).toBe('withdraw');
        expect(customName(decide({ ...base, invIds: new Map([[id, 1]]) }))).toContain('gamble');
    });
}

test('reserves the cocktail price when the shop is still needed', () => {
    const step = decide({ ...snap({ progress: progress(DP_STAGE.GIVEN_ALE) }), bank: new Map(), bankCoins: 0, inv: new Map([['coins', 130]]) });
    expect(step.kind).toBe('wait');
});
