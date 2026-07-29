import { describe, expect, test } from 'bun:test';
import { SV_ITEM, inDolmenRoom, shiloArea } from '#/bot/quests/defs/shilo/areas.js';
import { SV_STAGE, parseShiloJournal } from '#/bot/quests/defs/shilo/journal.js';
import { decide, shilo } from '#/bot/quests/defs/shilo/index.js';
import { evaluate } from '#/bot/quests/EligibilityEvaluator.js';
import { flagValue, hasFlag } from '#/bot/quests/engine/types.js';
import type { QuestProgress, QuestSnapshot } from '#/bot/quests/engine/types.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

const KARAMJA = at(2809, 3086);
const MAINLAND = at(2616, 3332);

function progress(stage: number, flags: string[] = []): QuestProgress {
    // The parser emits exactly one counted flag of each kind, so defaults are only
    // filled in when the caller has not named its own.
    const counted = ['bones-placed', 'naza'].filter(key => !flags.some(f => f.startsWith(key + ':')));
    return { stage, flags: new Set([...counted.map(key => `${key}:0`), ...flags]) };
}

function snapshot(o: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: o.inv ?? new Map(),
        invIds: o.invIds ?? new Map(),
        worn: o.worn ?? new Set(),
        wornIds: o.wornIds ?? new Set(),
        noProgress: 0,
        bankCoins: o.bankCoins ?? 0,
        stage: o.stage ?? o.progress?.stage,
        progress: o.progress,
        bank: o.bank ?? new Map(),
        bankIds: o.bankIds ?? new Map(),
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? KARAMJA : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

/** Everything the quest cannot buy on Karamja, so `provision` stays out of the way. */
const PROVISIONED = new Map<number, number>([
    [SV_ITEM.COINS.id, 5000],
    [SV_ITEM.BONES.id, 3]
]);

function carrying(...pairs: [number, number][]): Map<number, number> {
    return new Map([...PROVISIONED, ...pairs]);
}

const name = (s: ReturnType<typeof decide>): string => (s.kind === 'custom' ? s.name : s.kind);

describe('shiloArea', () => {
    test('classifies each sealed pocket by a tile inside it', () => {
        expect(shiloArea(at(2898, 9401))).toBe('ahZaRhoonNorth');
        expect(shiloArea(at(2888, 9283))).toBe('ahZaRhoonSouth');
        expect(shiloArea(at(2760, 9389))).toBe('berviriusTomb');
        expect(shiloArea(at(2929, 9525))).toBe('rashEntry');
        expect(shiloArea(at(2929, 9515))).toBe('rashLedge');
        expect(shiloArea(at(2928, 9511))).toBe('rashInner');
        expect(shiloArea(at(2852, 2954))).toBe('shiloVillage');
    });

    test('the ledge between the gate and the rocks is its own area', () => {
        // Collapsing it into either neighbour makes the gate open and re-open forever.
        expect(shiloArea(at(2929, 9516))).toBe('rashEntry');
        expect(shiloArea(at(2929, 9515))).toBe('rashLedge');
        expect(shiloArea(at(2928, 9512))).toBe('rashLedge');
        expect(shiloArea(at(2928, 9511))).toBe('rashInner');
        expect(shiloArea(at(2892, 9487))).toBe('rashInner');
        expect(shiloArea(at(2892, 9480))).toBe('rashInner');
    });

    test('the east jungle and Tai Bwo Wannai are one open region', () => {
        expect(shiloArea(at(2921, 2999))).toBe('karamja');
        expect(shiloArea(at(2916, 3090))).toBe('karamja');
        expect(shiloArea(KARAMJA)).toBe('karamja');
        expect(shiloArea(MAINLAND)).toBe('karamja');
    });

    test('a null tile is unknown, never a default area', () => {
        expect(shiloArea(null)).toBe('unknown');
        expect(shiloArea(undefined)).toBe('unknown');
    });
});

describe('parseShiloJournal', () => {
    test('not started', () => {
        expect(parseShiloJournal('@dbl@I can start this quest by speaking to @dre@Mosol Rei@dbl@')?.stage)
            .toBe(SV_STAGE.NOT_STARTED);
    });

    test('complete', () => {
        expect(parseShiloJournal('@red@QUEST COMPLETE!')?.stage).toBe(SV_STAGE.COMPLETE);
    });

    test('started, looking for Ah Za Rhoon', () => {
        const p = parseShiloJournal([
            '@str@I spoke to Mosol Rei in South Karamja, and have agreed to|',
            "@str@help his village. He gave me a 'Wampum belt'.|",
            "|@dbl@I need to find the location of '@dre@Ah Za Rhoon@dbl@'."
        ]);
        expect(p?.stage).toBe(SV_STAGE.STARTED);
    });

    test('each mound step outranks the history above it', () => {
        const found = ["@str@I need to find the location of 'Ah Za Rhoon'.|"];
        expect(parseShiloJournal([
            ...found,
            "@dbl@I've found a @dre@mound of earth@dbl@ in the jungle which seems curious."
        ])?.stage).toBe(SV_STAGE.SEARCHED_MOUND);
        expect(parseShiloJournal([
            ...found,
            "@str@I've found a mound of earth in the jungle which seems|",
            "@str@curious. I've used a spade to excavate the mound of earth.|"
        ])?.stage).toBe(SV_STAGE.DUG_MOUND);
        expect(parseShiloJournal([
            ...found,
            "@str@I've used a spade to excavate the mound of earth.|",
            '@str@I illuminated the fissure and saw it was a long way down.|'
        ])?.stage).toBe(SV_STAGE.LIT_MOUND);
        expect(parseShiloJournal([
            ...found,
            '@str@I illuminated the fissure and saw it was a long way down.|',
            '@str@I attached a rope to the start of the fissure.|'
        ])?.stage).toBe(SV_STAGE.ROPED_MOUND);
    });

    test('the cavern block reports which scrolls have been read', () => {
        const p = parseShiloJournal([
            '@str@I climbed down the rope into some sort of underground cavern|',
            '@str@system, I need to identify this place.|',
            "@str@I've read the tattered scroll, it gives details about Bervirius|",
            "@str@who was Rashiliyia's son.|"
        ]);
        expect(p?.stage).toBe(SV_STAGE.ENTERED_AH_ZA_RHOON);
        expect(hasFlag(p, 'read-tattered')).toBe(true);
        expect(hasFlag(p, 'read-crumpled')).toBe(false);
        expect(hasFlag(p, 'pommel-taken')).toBe(false);
    });

    test('searching the Bervirius dolmen is the pommel flag, and does not move the stage', () => {
        const p = parseShiloJournal([
            '@str@I climbed down the rope into some sort of underground cavern|',
            '@str@I searched the dolmen in Bervirius tomb and found a crystal,|',
            '@str@some notes and a bone sword pommel.|'
        ]);
        expect(p?.stage).toBe(SV_STAGE.ENTERED_AH_ZA_RHOON);
        expect(hasFlag(p, 'pommel-taken')).toBe(true);
    });

    test('the bone lock line is the found-door flag', () => {
        const p = parseShiloJournal([
            '@str@I climbed down the rope into some sort of underground cavern|',
            '@str@I searched the dolmen in Bervirius tomb and found a crystal,|',
            "@str@I've found a door in the jungle to the North of Ah Za Rhoon|",
            '@str@which I cannot get past. The lock is made out of bone!|'
        ]);
        expect(hasFlag(p, 'found-door')).toBe(true);
        expect(p?.stage).toBe(SV_STAGE.ENTERED_AH_ZA_RHOON);
    });

    test('the bone key line moves the stage past the carved doors', () => {
        const p = parseShiloJournal([
            "@str@I've found a door in the jungle to the North of Ah Za Rhoon|",
            '@str@which I cannot get past. The lock is made out of bone! I|',
            '@str@made a bone key from the bone shard that Zadimus gave|',
            '@str@me and I managed to get past the door.|'
        ]);
        expect(p?.stage).toBe(SV_STAGE.UNLOCKED_RASH_TOMB);
    });

    test('partial bone placements are counted', () => {
        const one = parseShiloJournal([
            '@str@I made a bone key from the bone shard that Zadimus gave|',
            "@dbl@I've placed one @dre@bone@dbl@ in one of the @dre@recesses@dbl@.|"
        ]);
        expect(one?.stage).toBe(SV_STAGE.UNLOCKED_RASH_TOMB);
        expect(flagValue(one, 'bones-placed')).toBe(1);

        const two = parseShiloJournal([
            '@str@I made a bone key from the bone shard that Zadimus gave|',
            "@dbl@I've placed two @dre@bones@dbl@ in the door @dre@recesses@dbl@.|"
        ]);
        expect(flagValue(two, 'bones-placed')).toBe(2);

        const three = parseShiloJournal([
            "@str@I've placed three bones in each of the|",
            '@str@recesses this seemed to unlock the door.|'
        ]);
        expect(three?.stage).toBe(SV_STAGE.UNLOCKED_TOMBDOOR);
        expect(flagValue(three, 'bones-placed')).toBe(3);
    });

    test('the kill paragraphs are cumulative rewrites, so the newest wins', () => {
        const base = ["@str@I've placed three bones in each of the recesses.|"];
        expect(flagValue(parseShiloJournal(base), 'naza')).toBe(0);
        expect(flagValue(parseShiloJournal([
            ...base,
            '@str@a Zombie Nazastarool attacked me. I managed to slay the|'
        ]), 'naza')).toBe(1);
        expect(flagValue(parseShiloJournal([
            ...base,
            '@str@a Zombie Nazastarool attacked me which I slayed. A skeletal|',
            '@str@Nazastarool appeared after this but I managed to slay this|'
        ]), 'naza')).toBe(2);
        expect(flagValue(parseShiloJournal([
            ...base,
            '@str@The third and final guardian was a ghostly Nazastarool and|',
            '@str@after an epic battle, I defeated it.|'
        ]), 'naza')).toBe(3);
    });

    test('unrecognised text yields nothing rather than a guess', () => {
        expect(parseShiloJournal('some other quest entirely')).toBeUndefined();
    });
});

describe('shilo decide — terminal cases', () => {
    test('a complete journal in the open is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('stage 15 is done even before the journal colour catches up', () => {
        expect(decide(snapshot({ stage: SV_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('completing inside the tomb still climbs out first', () => {
        const step = decide(snapshot({ journal: 'complete', tile: at(2929, 9525) }));
        expect(step.kind).toBe('custom');
        expect(name(step)).toContain('exit');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a missing stage waits rather than guessing', () => {
        expect(decide(snapshot({ stage: undefined })).kind).toBe('wait');
    });

    test('an unknown location waits rather than acting on a guess', () => {
        expect(decide(snapshot({ stage: SV_STAGE.STARTED, tile: null })).kind).toBe('wait');
    });
});

describe('shilo decide — provisioning', () => {
    test('on the mainland with an empty bank, it parks honestly rather than crossing', () => {
        const step = decide(snapshot({
            journal: 'notStarted',
            stage: SV_STAGE.NOT_STARTED,
            tile: MAINLAND
        }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('gp');
    });

    test('on the mainland it fills the purse before the crossing', () => {
        const step = decide(snapshot({
            journal: 'notStarted',
            stage: SV_STAGE.NOT_STARTED,
            tile: MAINLAND,
            bankIds: new Map([[SV_ITEM.COINS.id, 2_000_000]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('on the mainland with coins but no bones, it fetches the bones', () => {
        const step = decide(snapshot({
            journal: 'notStarted',
            stage: SV_STAGE.NOT_STARTED,
            tile: MAINLAND,
            invIds: new Map([[SV_ITEM.COINS.id, 5000]])
        }));
        expect(name(step)).toContain('bones');
    });

    test('once on Karamja it never walks back for supplies', () => {
        const step = decide(snapshot({
            journal: 'notStarted',
            stage: SV_STAGE.NOT_STARTED,
            tile: KARAMJA
        }));
        expect(name(step)).toContain('Mosol Rei');
    });
});

describe('shilo decide — the opening', () => {
    test('not started asks Mosol Rei for the belt', () => {
        expect(name(decide(snapshot({
            journal: 'notStarted',
            stage: SV_STAGE.NOT_STARTED,
            invIds: PROVISIONED
        })))).toContain('Mosol Rei');
    });

    test('holding the belt shows it to Trufitus instead', () => {
        expect(name(decide(snapshot({
            journal: 'notStarted',
            stage: SV_STAGE.NOT_STARTED,
            invIds: carrying([SV_ITEM.WAMPUM_BELT.id, 1])
        })))).toContain('Trufitus');
    });

    test('a belt left in the bank is withdrawn, not asked for again', () => {
        const step = decide(snapshot({
            journal: 'notStarted',
            stage: SV_STAGE.NOT_STARTED,
            invIds: PROVISIONED,
            bankIds: new Map([[SV_ITEM.WAMPUM_BELT.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });
});

describe('shilo decide — the mound', () => {
    test('an empty pack buys the whole outstanding kit in one Jiminua trip', () => {
        const step = decide(snapshot({ progress: progress(SV_STAGE.STARTED), invIds: PROVISIONED }));
        expect(step.kind).toBe('custom');
        // Everything the rest of the quest needs from a shop, not one item per crossing.
        for (const want of ['Spade', 'Candle', 'Tinderbox', 'Rope', 'Chisel', 'Bronze bar', 'Hammer']) {
            expect(name(step)).toContain(want);
        }
    });

    const KIT: [number, number][] = [
        [SV_ITEM.SPADE.id, 1], [SV_ITEM.CANDLE.id, 1], [SV_ITEM.TINDERBOX.id, 1],
        [SV_ITEM.ROPE.id, 1], [SV_ITEM.CHISEL.id, 1], [SV_ITEM.BRONZE_BAR.id, 1], [SV_ITEM.HAMMER.id, 1]
    ];

    test('with the kit it digs', () => {
        const step = decide(snapshot({ progress: progress(SV_STAGE.STARTED), invIds: carrying(...KIT) }));
        expect(name(step)).toContain('dig');
    });

    test('the light source is bought unlit and lit with a tinderbox', () => {
        const noCandle = decide(snapshot({ progress: progress(SV_STAGE.DUG_MOUND), invIds: PROVISIONED }));
        expect(name(noCandle)).toContain('Candle');
        expect(name(noCandle)).toContain('Tinderbox');

        const both = decide(snapshot({ progress: progress(SV_STAGE.DUG_MOUND), invIds: carrying(...KIT) }));
        expect(name(both)).toBe('light the candle');

        const lit = decide(snapshot({
            progress: progress(SV_STAGE.DUG_MOUND),
            invIds: carrying(...KIT, [SV_ITEM.LIT_CANDLE.id, 1])
        }));
        expect(name(lit)).toContain('fissure');
    });

    test('the rope is bought before the fissure is tied', () => {
        expect(name(decide(snapshot({ progress: progress(SV_STAGE.LIT_MOUND), invIds: PROVISIONED }))))
            .toContain('Rope');
        expect(name(decide(snapshot({
            progress: progress(SV_STAGE.LIT_MOUND),
            invIds: carrying(...KIT)
        })))).toContain('rope');
    });

    test('roped, it climbs in', () => {
        expect(name(decide(snapshot({ progress: progress(SV_STAGE.ROPED_MOUND), invIds: PROVISIONED }))))
            .toContain('climb down the fissure');
    });
});

describe('shilo decide — Ah Za Rhoon and the crafts', () => {
    const middle = (flags: string[], ids: [number, number][] = [], tile = KARAMJA) =>
        decide(snapshot({ progress: progress(SV_STAGE.ENTERED_AH_ZA_RHOON, flags), invIds: carrying(...ids), tile }));

    test('the tattered scroll is fetched, then read', () => {
        expect(name(middle([]))).toContain('tattered scroll');
        expect(name(middle([], [[SV_ITEM.TATTERED_SCROLL.id, 1]]))).toBe('read the tattered scroll');
    });

    test('the crumpled scroll follows, then read', () => {
        expect(name(middle(['read-tattered']))).toContain('old sacks');
        expect(name(middle(['read-tattered'], [[SV_ITEM.CRUMPLED_SCROLL.id, 1]]))).toBe('read the crumpled scroll');
    });

    test('the gallows corpse is buried on the sacred ground', () => {
        const both = ['read-tattered', 'read-crumpled'];
        expect(name(middle(both))).toContain('gallows');
        expect(name(middle(both, [[SV_ITEM.ZADIMUS_CORPSE.id, 1]]))).toContain('bury Zadimus');
    });

    test('with the shard in hand it goes for the Bervirius dolmen', () => {
        const step = middle(['read-tattered', 'read-crumpled'], [[SV_ITEM.BONE_SHARD.id, 1]]);
        expect(name(step)).toContain("Bervirius' tomb");
    });

    test('inside the caves it climbs out before any of the mainland crafts', () => {
        const step = middle(['read-tattered', 'read-crumpled', 'pommel-taken'], [], at(2898, 9401));
        expect(name(step)).toContain('climb out of Ah Za Rhoon');
    });

    test('after the pommel it searches the carved doors for the lock', () => {
        const step = middle(['read-tattered', 'read-crumpled', 'pommel-taken'], [[SV_ITEM.SWORD_POMMEL.id, 1]]);
        expect(name(step)).toContain('carved doors');
    });

    test('the key comes before the necklace, and both need a chisel', () => {
        const flags = ['read-tattered', 'read-crumpled', 'pommel-taken', 'found-door'];
        // One trip: the chisel cuts both, and the bar and hammer are the wire.
        const noChisel = middle(flags, [[SV_ITEM.BONE_SHARD.id, 1], [SV_ITEM.SWORD_POMMEL.id, 1]]);
        for (const want of ['Chisel', 'Bronze bar', 'Hammer']) {
            expect(name(noChisel)).toContain(want);
        }

        const CRAFT: [number, number][] = [
            [SV_ITEM.CHISEL.id, 1], [SV_ITEM.BRONZE_BAR.id, 1], [SV_ITEM.HAMMER.id, 1]
        ];
        const key = middle(flags, [...CRAFT, [SV_ITEM.BONE_SHARD.id, 1], [SV_ITEM.SWORD_POMMEL.id, 1]]);
        expect(name(key)).toContain('bone shard into a key');

        const beads = middle(flags, [...CRAFT, [SV_ITEM.BONE_KEY.id, 1], [SV_ITEM.SWORD_POMMEL.id, 1]]);
        expect(name(beads)).toContain('ivory pommel');
    });

    test('the necklace needs bronze wire, which is smithed rather than bought', () => {
        const flags = ['read-tattered', 'read-crumpled', 'pommel-taken', 'found-door'];
        const noBar = middle(flags, [
            [SV_ITEM.CHISEL.id, 1], [SV_ITEM.BONE_KEY.id, 1], [SV_ITEM.BONE_BEADS.id, 1]
        ]);
        expect(name(noBar)).toContain('Bronze bar');
        expect(name(noBar)).toContain('Hammer');

        const bar = middle(flags, [
            [SV_ITEM.CHISEL.id, 1], [SV_ITEM.BONE_KEY.id, 1], [SV_ITEM.BONE_BEADS.id, 1],
            [SV_ITEM.BRONZE_BAR.id, 1], [SV_ITEM.HAMMER.id, 1]
        ]);
        expect(name(bar)).toContain('smith the bronze bar');
    });

    test('with the key and the beads it unlocks the carved doors', () => {
        const step = middle(
            ['read-tattered', 'read-crumpled', 'pommel-taken', 'found-door'],
            [[SV_ITEM.BONE_KEY.id, 1], [SV_ITEM.DEAD_BEADS.id, 1]]
        );
        expect(name(step)).toContain('unlock the carved doors');
    });
});

describe('shilo decide — the tomb', () => {
    const tomb = (ids: [number, number][], tile = KARAMJA, wornIds: number[] = [], flags: string[] = []) =>
        decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_RASH_TOMB, flags),
            invIds: carrying(...ids),
            wornIds: new Set(wornIds),
            tile
        }));

    test('the beads go on before the tomb is entered', () => {
        const step = tomb([[SV_ITEM.BONE_KEY.id, 1], [SV_ITEM.DEAD_BEADS.id, 1]]);
        expect(step.kind).toBe('equip');
        expect(step.kind === 'equip' && step.item).toBe('Beads of the dead');
    });

    test('wearing them, it stocks food and enters', () => {
        const food = tomb([[SV_ITEM.BONE_KEY.id, 1]], KARAMJA, [SV_ITEM.DEAD_BEADS.id]);
        expect(food.kind === 'buy' && food.item).toBe('Bread');

        const inv = new Map([...PROVISIONED, [SV_ITEM.BONE_KEY.id, 1]]);
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_RASH_TOMB),
            invIds: inv,
            inv: new Map([['bread', 8]]),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: KARAMJA
        }));
        expect(name(step)).toContain("enter Rashiliyia's tomb");
    });

    test('in the entry corridor it opens the ancient gate', () => {
        const step = tomb([[SV_ITEM.BONE_KEY.id, 1]], at(2929, 9525), [SV_ITEM.DEAD_BEADS.id]);
        expect(name(step)).toContain('ancient gate');
    });

    test('on the ledge past the gate it climbs down, never re-opens the gate', () => {
        const step = tomb([[SV_ITEM.BONE_KEY.id, 1]], at(2929, 9515), [SV_ITEM.DEAD_BEADS.id]);
        expect(name(step)).toContain('climb down');
    });

    test('in the chamber it feeds the door one bone at a time', () => {
        const step = tomb([[SV_ITEM.BONE_KEY.id, 1]], at(2892, 9482), [SV_ITEM.DEAD_BEADS.id]);
        expect(name(step)).toContain('place a bone');
    });

    test('short of bones inside the tomb, it leaves rather than looping at the door', () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_RASH_TOMB),
            invIds: new Map([[SV_ITEM.COINS.id, 5000], [SV_ITEM.BONE_KEY.id, 1]]),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: at(2892, 9479)
        }));
        expect(name(step)).toContain('leave the tomb chamber');
    });

    test('all three placed, it waits — the third bone opens the doors itself', () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_RASH_TOMB, ['bones-placed:3']),
            invIds: new Map([[SV_ITEM.COINS.id, 5000], [SV_ITEM.BONE_KEY.id, 1]]),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: at(2892, 9482)
        }));
        expect(step.kind).toBe('wait');
    });

    test('pushed south of the doors, the dolmen step crosses back on its own', () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying(),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: at(2892, 9480)
        }));
        expect(name(step)).toContain('tomb dolmen');
    });
});

describe('shilo decide — the boss and the ending', () => {
    test('in the chamber it works the dolmen, which summons or yields', () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying(),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: at(2892, 9487)
        }));
        expect(name(step)).toContain('tomb dolmen');
    });

    test('in the entry corridor it passes the gate; on the ledge it climbs down', () => {
        const gate = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying(),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: at(2929, 9525)
        }));
        expect(name(gate)).toContain('ancient gate');

        const ledge = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying(),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: at(2929, 9515)
        }));
        expect(name(ledge)).toContain('climb down');
    });

    test('holding the remains it climbs out and delivers them to Bervirius', () => {
        const inside = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying([SV_ITEM.RASH_CORPSE.id, 1]),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: at(2892, 9487)
        }));
        expect(name(inside)).toContain('leave the tomb chamber');

        const outside = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying([SV_ITEM.RASH_CORPSE.id, 1]),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: KARAMJA
        }));
        expect(name(outside)).toContain("Bervirius' dolmen");
    });

    test('remains left in the bank are withdrawn rather than re-fought', () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying(),
            bankIds: new Map([[SV_ITEM.RASH_CORPSE.id, 1]]),
            tile: KARAMJA
        }));
        expect(step.kind).toBe('withdraw');
    });
});

describe('shilo module', () => {
    test('it owns its inventory — Karamja has no bank until this quest opens one', () => {
        expect(shilo.ownsInventory).toBe(true);
    });

    test('it banks at Ardougne West, the nearest bank to the Brimhaven ship', () => {
        expect(shilo.bank?.x).toBe(2616);
        expect(shilo.bank?.z).toBe(3332);
    });

    test('the record carries the Jungle Potion prerequisite the engine enforces', () => {
        expect(shilo.record.requirements.quests).toEqual(['junglepotion']);
    });

    test('the record names no mustHave items — the module buys its own kit', () => {
        expect(shilo.record.items).toEqual([]);
    });

    test('the engine names that differ from the wiki are recorded exactly', () => {
        expect(SV_ITEM.RASH_CORPSE.name).toBe('Rashiliya corpse');
        expect(SV_ITEM.DEAD_BEADS.name).toBe('Beads of the dead');
    });
});

describe('shilo decide — recovery', () => {
    test('past the carved doors it never re-cuts a lost bone key', () => {
        // The doors stay unlocked, and the tomb exit refuses to open for anyone
        // still carrying the key — so a replacement would be a wasted trip.
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_RASH_TOMB),
            invIds: carrying([SV_ITEM.CHISEL.id, 1]),
            wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
            tile: KARAMJA
        }));
        expect(name(step)).not.toContain('bone shard');
        expect(name(step)).not.toContain('gallows');
    });

    test('before the carved doors a lost key is re-cut', () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.ENTERED_AH_ZA_RHOON, [
                'read-tattered', 'read-crumpled', 'pommel-taken', 'found-door'
            ]),
            invIds: carrying([SV_ITEM.CHISEL.id, 1], [SV_ITEM.BRONZE_BAR.id, 1], [SV_ITEM.HAMMER.id, 1]),
            tile: KARAMJA
        }));
        expect(name(step)).toContain('gallows');
    });
});

describe('shilo decide — pockets a step enters itself', () => {
    test("standing in Bervirius' tomb it searches the dolmen, it does not climb out", () => {
        // searchBerviriusDolmen crawls in on its own; escaping unconditionally would
        // climb straight back out of the tomb it just entered, forever.
        const step = decide(snapshot({
            progress: progress(SV_STAGE.ENTERED_AH_ZA_RHOON, ['read-tattered', 'read-crumpled']),
            invIds: carrying([SV_ITEM.BONE_SHARD.id, 1]),
            tile: at(2765, 9370)
        }));
        expect(name(step)).toContain('search the dolmen');
    });

    test("delivering the remains works from inside Bervirius' tomb too", () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying([SV_ITEM.RASH_CORPSE.id, 1]),
            tile: at(2765, 9370)
        }));
        expect(name(step)).toContain('lay the remains');
    });

    test('from any other pocket it still escapes first', () => {
        const step = decide(snapshot({
            progress: progress(SV_STAGE.UNLOCKED_TOMBDOOR),
            invIds: carrying([SV_ITEM.RASH_CORPSE.id, 1]),
            tile: at(2892, 9487)
        }));
        expect(name(step)).toContain('leave the tomb chamber');
    });
});

describe('shilo decide — a half-stocked bakery', () => {
    const readyForTomb = (bread: number) => decide(snapshot({
        progress: progress(SV_STAGE.UNLOCKED_RASH_TOMB),
        invIds: carrying([SV_ITEM.BONE_KEY.id, 1]),
        inv: new Map([['bread', bread]]),
        wornIds: new Set([SV_ITEM.DEAD_BEADS.id]),
        tile: KARAMJA
    }));

    test('an empty pack buys food before the tomb', () => {
        expect(readyForTomb(0).kind).toBe('buy');
    });

    test('four loaves are enough to go in — Jiminua bakes ten at a time', () => {
        expect(name(readyForTomb(4))).toContain("enter Rashiliyia's tomb");
    });
});

describe('inDolmenRoom', () => {
    test('the corridor east of the skeletal doors is not the dolmen room', () => {
        // It runs up to z=9511 on the *southern* side, so a plain z test would put
        // the foot of the climbing rocks behind the doors.
        expect(inDolmenRoom(at(2928, 9511))).toBe(false);
        expect(inDolmenRoom(at(2892, 9479))).toBe(false);
        expect(inDolmenRoom(at(2892, 9480))).toBe(false);
    });

    test('the room itself, from the door landing to the dolmen', () => {
        expect(inDolmenRoom(at(2892, 9481))).toBe(true);
        expect(inDolmenRoom(at(2891, 9487))).toBe(true);
        expect(inDolmenRoom(at(2892, 9482))).toBe(true);
    });

    test('a null tile is never in the room', () => {
        expect(inDolmenRoom(null)).toBe(false);
        expect(inDolmenRoom(undefined)).toBe(false);
    });
});

describe('shilo eligibility', () => {
    test('Shilo Village is blocked until Jungle Potion is complete', () => {
        // The engine enforces this twice — Mosol Rei will not hand over the belt and
        // Trufitus will not take it — so the queue must not offer Shilo first.
        const maxed = new Map(['crafting', 'agility', 'smithing', 'mining'].map(s => [s, 99]));
        const player = { questPoints: 20, skillLevels: maxed, completedQuests: new Set<string>() };
        const items = { counts: new Map<string, number>() };

        const blocked = evaluate(shilo.record, player, items, 'notStarted');
        expect(blocked.status).toBe('BLOCKED');
        expect(blocked.reasons.join(' ')).toContain('junglepotion');

        const ready = evaluate(shilo.record, { ...player, completedQuests: new Set(['junglepotion']) }, items, 'notStarted');
        expect(ready.status).toBe('READY');
    });
});
