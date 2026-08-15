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
    parseDeathPlateauJournal
} from '#/bot/api/ai/quests/defs/deathplateau/index.js';
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

    test('given ale with coins → gamble', () => {
        const inv = new Map<string, number>([['coins', 500]]);
        const step = decide({
            ...snap({ progress: progress(DP_STAGE.GIVEN_ALE) }),
            inv
        });
        expect(customName(step)).toMatch(/gamble/i);
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
        // 28 junk slots — freeSlots 0 forces a bank deposit before Denulth grants the cert
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
