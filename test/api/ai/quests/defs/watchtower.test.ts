import { describe, expect, test } from 'bun:test';
import { CRYSTALS, WT_ITEM, WT_NPC, watchtowerArea } from '#/bot/api/ai/quests/defs/watchtower/areas.js';
import { WATCHTOWER_STAGE, parseWatchtowerJournal } from '#/bot/api/ai/quests/defs/watchtower/journal.js';
import { flagValue, hasFlag } from '#/bot/api/ai/quests/engine/types.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { decide, watchtower } from '#/bot/api/ai/quests/defs/watchtower/index.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

describe('watchtowerArea', () => {
    test('classifies each sealed pocket by a tile inside it', () => {
        expect(watchtowerArea(at(2544, 3112, 2))).toBe('towerFloor');
        expect(watchtowerArea(at(2513, 3084))).toBe('grewIsland');
        expect(watchtowerArea(at(2576, 3027))).toBe('tobanCamp');
        expect(watchtowerArea(at(2526, 3018))).toBe('lowerCity');
        expect(watchtowerArea(at(2541, 3029))).toBe('cityGuard');
        expect(watchtowerArea(at(2504, 9441))).toBe('skavidCaves');
        expect(watchtowerArea(at(2588, 9410))).toBe('enclave');
        expect(watchtowerArea(at(2928, 4715, 2))).toBe('mirrorTower');
    });

    test('the city-guard pocket is not swallowed by the lower city', () => {
        expect(watchtowerArea(at(2530, 3029))).toBe('cityGuard');
        expect(watchtowerArea(at(2531, 3026))).toBe('lowerCity');
    });

    test('the tower floor is level 2 only — the ground below it is Yanille', () => {
        expect(watchtowerArea(at(2544, 3112, 0))).toBe('yanille');
        expect(watchtowerArea(at(2544, 3112, 1))).toBe('yanille');
    });

    test('everything else on the surface is yanille', () => {
        expect(watchtowerArea(at(2612, 3092))).toBe('yanille');
        expect(watchtowerArea(at(2544, 3134))).toBe('yanille');
        expect(watchtowerArea(at(2505, 3023))).toBe('yanille');
        expect(watchtowerArea(at(2506, 3116))).toBe('yanille');
    });

    test('a null tile is unknown, never a default area', () => {
        expect(watchtowerArea(null)).toBe('unknown');
        expect(watchtowerArea(undefined)).toBe('unknown');
    });
});

describe('watchtower items', () => {
    test('all four crystals share one display name, so ids are the only safe key', () => {
        expect(new Set(CRYSTALS.map(c => c.name)).size).toBe(1);
        expect(new Set(CRYSTALS.map(c => c.id)).size).toBe(4);
    });

    test('the engine names that differ from the wiki are recorded exactly', () => {
        expect(WT_ITEM.FINGERNAILS.name).toBe('Finger nails');
        expect(WT_ITEM.STOLEN_GOLD.name).toBe('Gold');
        expect(WT_ITEM.OGRE_POTION.name).toBe('Potion');
        expect(WT_ITEM.GUAM_VIAL.name).toBe('Unfinished potion');
        expect(WT_ITEM.GUAM_JANGER_VIAL.name).toBe('Vial');
    });
});

describe('parseWatchtowerJournal', () => {
    test('not started', () => {
        const p = parseWatchtowerJournal('@dbl@I can start this quest by speaking to the @dre@Watchtower wizard');
        expect(p?.stage).toBe(WATCHTOWER_STAGE.NOT_STARTED);
    });

    test('started, before and after the fingernails are found', () => {
        expect(parseWatchtowerJournal([
            '@dbl@I accepted the challenge of finding the lost @dre@crystals.',
            '@dbl@I need to @dre@find evidence@dbl@ of what has happened.'
        ])?.stage).toBe(WATCHTOWER_STAGE.STARTED);
        expect(parseWatchtowerJournal([
            '@dbl@I accepted the challenge of finding the lost @dre@crystals.',
            '@dbl@I found some @dre@fingernails@dbl@ as evidence.'
        ])?.stage).toBe(WATCHTOWER_STAGE.STARTED);
    });

    test('the tribal block reports which tribes are helped', () => {
        const p = parseWatchtowerJournal([
            '@str@I found some fingernails as evidence.',
            '|@dbl@Now I need to @dre@deal with the tribal ogres.||',
            "@str@I returned Og's stolen gold.",
            "@dbl@Grew wants me to give him @dre@one of Gorad's teeth.",
            '@dbl@Toban wants the @dre@bones of an adult dragon.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.GIVEN_FINGERNAILS);
        expect(hasFlag(p, 'helped-og')).toBe(true);
        expect(hasFlag(p, 'spoken-og')).toBe(true);
        expect(hasFlag(p, 'spoken-grew')).toBe(true);
        expect(hasFlag(p, 'helped-grew')).toBe(false);
        expect(hasFlag(p, 'spoken-toban')).toBe(true);
        expect(hasFlag(p, 'helped-toban')).toBe(false);
    });

    test('newest entry wins: the riddle line outranks the tribal block', () => {
        const p = parseWatchtowerJournal([
            '@str@I found some fingernails as evidence.',
            '|@dbl@Now I need to @dre@deal with the tribal ogres.||',
            "@str@I returned Og's stolen gold.",
            '@dbl@Some guards gave me a @dre@puzzle to solve.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.GIVEN_RIDDLE);
    });

    test('the map block reports whether the map is carried and which words are known', () => {
        const p = parseWatchtowerJournal([
            '|@str@I was given a map by the guard.|',
            '@dbl@I have it with me now, so I can navigate the skavid caves.|',
            '|@dbl@I have been taught a few words of the skavid language:|',
            "|@dre@'Cur bidith' - 'Ig'|",
            "|@dre@'Gor cur' - 'Ar'|"
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.SOLVED_RIDDLE);
        expect(hasFlag(p, 'has-map')).toBe(true);
        expect(hasFlag(p, 'learning-skavid')).toBe(true);
        expect(hasFlag(p, 'learned-ig')).toBe(true);
        expect(hasFlag(p, 'learned-ar')).toBe(true);
        expect(hasFlag(p, 'learned-cur')).toBe(false);
        expect(hasFlag(p, 'learned-nod')).toBe(false);
    });

    test('a map left in the bank is reported as not carried', () => {
        const p = parseWatchtowerJournal([
            '|@str@I was given a map by the guard.|',
            '@dbl@I do not have the map with me now, so I cannot navigate the caves.|'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.SOLVED_RIDDLE);
        expect(hasFlag(p, 'has-map')).toBe(false);
    });

    test('the potion block counts the shamans still standing', () => {
        const p = parseWatchtowerJournal([
            '|@str@I have made the ogre potion.|',
            '@str@I gave the potion to the wizard.|',
            '@str@He infused it into a magic ogre potion.|',
            '@str@I need to defeat the ogre shamans.|',
            '|@dbl@Now I need to @dre@kill 4 ogre shaman(s).|'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.MADE_POTION);
        expect(flagValue(p, 'shamans-left')).toBe(4);
    });

    test('all shamans dead reports zero left, and the mined rock', () => {
        const p = parseWatchtowerJournal([
            '|@str@I have made the ogre potion.|',
            '@str@He infused it into a magic ogre potion.|',
            '|@str@I killed all the ogre shamans.||',
            '@dbl@I have @dre@mined the sacred rock@dbl@ and have taken the last @dre@crystal.|'
        ]);
        expect(flagValue(p, 'shamans-left')).toBe(0);
        expect(hasFlag(p, 'mined-rock')).toBe(true);
    });

    test('stage 11 is reported once the crystals are handed over', () => {
        const p = parseWatchtowerJournal([
            '|@str@I need to return all the crystals to the Watchtower wizard.|',
            '|@dbl@I have taken the crystals to the Watchtower wizard. Now I need to throw the @dre@lever@dbl@ to @dre@activate the shield@dbl@.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS);
    });

    test('complete', () => {
        const p = parseWatchtowerJournal(['@str@My task here is done.|', '|@dre@QUEST COMPLETE!|']);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.COMPLETE);
    });

    test('unrecognised journal text yields undefined, never a default stage', () => {
        expect(parseWatchtowerJournal(['something else entirely'])).toBeUndefined();
    });
});

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
        tile: o.tile === undefined ? { x: 2612, z: 3092, level: 0 } : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

describe('watchtower decide — terminal cases', () => {
    test('a complete journal is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('stage 13 is done even before the journal colour catches up', () => {
        expect(decide(snapshot({ stage: WATCHTOWER_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a missing stage waits rather than guessing', () => {
        expect(decide(snapshot({ stage: undefined })).kind).toBe('wait');
    });

    test('an unknown location waits rather than acting on a guess', () => {
        expect(decide(snapshot({ stage: 2, tile: null })).kind).toBe('wait');
    });

    test('the module owns its inventory and reads progress, not a bare stage', () => {
        expect(watchtower.ownsInventory).toBe(true);
        expect(watchtower.readProgress).toBeDefined();
        expect(watchtower.record.id).toBe('itwatchtower');
        expect(watchtower.record.name).toBe('Watch Tower');
    });

    test('the record demands exactly the four bank-supplied items', () => {
        expect(watchtower.record.items.map(i => i.name).sort())
            .toEqual(['Bat bones', 'Dragon bones', 'Gold bar', 'Guam leaf']);
        expect(watchtower.record.items.every(i => i.kind === 'mustHave')).toBe(true);
    });
});

describe('watchtower decide — the tower', () => {
    test('stage 0 goes to the wizard', () => {
        const step = decide(snapshot({ stage: WATCHTOWER_STAGE.NOT_STARTED }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/wizard/i);
    });

    test('stage 1 without fingernails searches the bush', () => {
        const step = decide(snapshot({ stage: WATCHTOWER_STAGE.STARTED }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/bush|evidence/i);
    });

    test('stage 1 holding fingernails hands them in', () => {
        const step = decide(snapshot({
            stage: WATCHTOWER_STAGE.STARTED,
            invIds: new Map([[WT_ITEM.FINGERNAILS.id, 1]])
        }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/fingernails|finger nails/i);
    });

    test('stranded on the wizard floor at stage 1 without evidence, it climbs down', () => {
        const step = decide(snapshot({
            stage: WATCHTOWER_STAGE.STARTED,
            tile: { x: 2544, z: 3112, level: 2 }
        }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/down/i);
    });
});

const P = (stage: number, ...flags: string[]) => ({ stage, flags: new Set(flags) });

describe('watchtower decide — the tribes', () => {
    test('stage 2 with nothing done talks to Og first', () => {
        const step = decide(snapshot({ progress: P(2) }));
        expect(step.kind === 'custom' && step.name).toMatch(/og/i);
    });

    test('holding the key, it goes for the chest', () => {
        const step = decide(snapshot({
            progress: P(2, 'spoken-og'),
            invIds: new Map([[WT_ITEM.TOBAN_KEY.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/chest|gold/i);
    });

    test('holding the stolen gold, it returns to Og', () => {
        const step = decide(snapshot({
            progress: P(2, 'spoken-og'),
            invIds: new Map([[WT_ITEM.STOLEN_GOLD.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/og/i);
    });

    test('Toban is next once Og is helped, and is spoken to before he wants bones', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og'),
            bankIds: new Map([[WT_ITEM.DRAGON_BONES.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/toban/i);
    });

    test('once Toban has asked, the banked dragon bones are withdrawn', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'spoken-toban'),
            bankIds: new Map([[WT_ITEM.DRAGON_BONES.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('with no dragon bones anywhere it parks naming the item', () => {
        const step = decide(snapshot({ progress: P(2, 'helped-og', 'spoken-toban') }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toMatch(/dragon bones/i);
    });

    test('Grew is spoken to before Gorad is attacked', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban'),
            invIds: new Map([[WT_ITEM.ROPE.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/grew/i);
    });

    test('once Grew has asked for the tooth, it goes for Gorad', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban', 'spoken-grew')
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/gorad|tooth/i);
    });

    test('holding the tooth, it returns to Grew', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban', 'spoken-grew'),
            invIds: new Map([[WT_ITEM.OGRE_TOOTH.id, 1], [WT_ITEM.ROPE.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/grew/i);
    });

    test('it withdraws rope before swinging to Grew', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban'),
            bankIds: new Map([[WT_ITEM.ROPE.id, 5]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('already on the island, no rope is needed', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban'),
            tile: { x: 2513, z: 3084, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/grew/i);
    });

    test('it picks jangerberries once the tribes are done', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban', 'helped-grew'),
            tile: { x: 2513, z: 3084, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/jangerberr/i);
    });

    test('holding a relic part with every tribe helped, it takes it to the wizard', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban', 'helped-grew'),
            invIds: new Map([[WT_ITEM.RELIC_PART1.id, 1], [WT_ITEM.JANGERBERRIES.id, 2]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/relic part/i);
    });

    test('with the tribes done and no parts left it parks rather than looping', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban', 'helped-grew'),
            invIds: new Map([[WT_ITEM.JANGERBERRIES.id, 2]])
        }));
        expect(step.kind).toBe('wait');
    });
});

describe('watchtower decide — the relic gate', () => {
    test('stage 3 holding the relic shows it to the north-west guard', () => {
        const step = decide(snapshot({
            progress: P(3),
            invIds: new Map([[WT_ITEM.OGRE_RELIC.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/guard/i);
    });

    test('stage 3 with the relic banked withdraws it', () => {
        const step = decide(snapshot({
            progress: P(3),
            bankIds: new Map([[WT_ITEM.OGRE_RELIC.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('stage 3 with no relic anywhere asks the wizard for a copy', () => {
        const step = decide(snapshot({ progress: P(3) }));
        expect(step.kind === 'custom' && step.name).toMatch(/wizard|another|copy/i);
    });
});

describe('watchtower decide — into the city guard pocket', () => {
    test('stage 4 with no rock cake steals one', () => {
        const step = decide(snapshot({ progress: P(4, 'market-asked') }));
        expect(step.kind === 'custom' && step.name).toMatch(/rock cake|steal/i);
    });

    test('stage 4 holding the cake gives it to the battlement guard', () => {
        const step = decide(snapshot({
            progress: P(4, 'market-asked'),
            invIds: new Map([[WT_ITEM.ROCK_CAKE.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/battlement|guard/i);
    });

    test('with the market paid and coins in hand, it heads for the chasm', () => {
        const step = decide(snapshot({
            progress: P(4, 'market-paid'),
            tile: { x: 2526, z: 3018, level: 0 },
            invIds: new Map([[WT_ITEM.COINS.id, 500]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/chasm|jump|guard/i);
    });

    test('short of the toll inside the lower city, it climbs out toward the bank', () => {
        const step = decide(snapshot({
            progress: P(4, 'market-paid'),
            tile: { x: 2526, z: 3018, level: 0 },
            invIds: new Map(),
            bankIds: new Map([[WT_ITEM.COINS.id, 100000]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/battlement/i);
    });

    test('short of the toll on the mainland, it withdraws it', () => {
        const step = decide(snapshot({
            progress: P(4, 'market-paid'),
            invIds: new Map(),
            bankIds: new Map([[WT_ITEM.COINS.id, 100000]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('already in the pocket, it asks the guard for passage', () => {
        const step = decide(snapshot({
            progress: P(4, 'market-paid'),
            tile: { x: 2541, z: 3029, level: 0 },
            invIds: new Map([[WT_ITEM.COINS.id, 500]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/riddle|passage|guard/i);
    });

    test('stage 5 holding a death rune answers the riddle', () => {
        const step = decide(snapshot({
            progress: P(5),
            tile: { x: 2541, z: 3029, level: 0 },
            invIds: new Map([[WT_ITEM.DEATH_RUNE.id, 1], [WT_ITEM.COINS.id, 500]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/riddle|rune/i);
    });

    test('stage 5 without a death rune buys one', () => {
        const step = decide(snapshot({
            progress: P(5),
            invIds: new Map([[WT_ITEM.COINS.id, 5000]])
        }));
        expect(step.kind).toBe('buy');
    });
});

describe('watchtower decide — never act from the wrong pocket', () => {
    test('holding the stolen gold inside Toban camp, it leaves before seeking Og', () => {
        const step = decide(snapshot({
            progress: P(2, 'spoken-og'),
            invIds: new Map([[WT_ITEM.STOLEN_GOLD.id, 1]]),
            tile: { x: 2576, z: 3027, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/leave Toban/i);
    });

    test('stranded on Grew island with nothing left to do there, it swings out first', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban', 'helped-grew'),
            invIds: new Map([[WT_ITEM.RELIC_PART2.id, 1], [WT_ITEM.JANGERBERRIES.id, 2]]),
            tile: { x: 2513, z: 3084, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/swing back/i);
    });

    test('no stage leaves the bot parked merely because it woke in a pocket', () => {
        const POCKETS: [string, { x: number; z: number; level: number }][] = [
            ['grewIsland', { x: 2513, z: 3084, level: 0 }],
            ['tobanCamp', { x: 2576, z: 3027, level: 0 }],
            ['cityGuard', { x: 2541, z: 3029, level: 0 }],
            ['skavidCaves', { x: 2504, z: 9441, level: 0 }],
            ['enclave', { x: 2588, z: 9410, level: 0 }],
            ['towerFloor', { x: 2544, z: 3112, level: 2 }],
            ['lowerCity', { x: 2526, z: 3018, level: 0 }]
        ];
        for (const stage of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
            for (const [name, tile] of POCKETS) {
                const step = decide(snapshot({ progress: P(stage), tile, bankKnown: true }));
                expect(`${stage}/${name}=${step.kind}`).not.toContain('=wait');
            }
        }
    });
});

describe('watchtower decide — jangerberries without a wasted rope', () => {
    const tribesDone = ['helped-og', 'helped-toban', 'helped-grew'];

    test('standing on the island short of berries, it picks them before leaving', () => {
        const step = decide(snapshot({
            progress: P(2, ...tribesDone),
            invIds: new Map([[WT_ITEM.RELIC_PART2.id, 1]]),
            tile: { x: 2513, z: 3084, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/jangerberr/i);
    });

    test('off the island, relic parts are delivered before a berry trip', () => {
        const step = decide(snapshot({
            progress: P(2, ...tribesDone),
            invIds: new Map([[WT_ITEM.RELIC_PART2.id, 1], [WT_ITEM.ROPE.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/relic part/i);
    });

    test('on the island with berries already, it leaves instead of loitering', () => {
        const step = decide(snapshot({
            progress: P(2, ...tribesDone),
            invIds: new Map([[WT_ITEM.JANGERBERRIES.id, 2], [WT_ITEM.RELIC_PART2.id, 1]]),
            tile: { x: 2513, z: 3084, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/swing back/i);
    });
});

describe('watchtower decide — wizard steps stay on the wizard floor', () => {
    test('a relic part is handed over without climbing down first', () => {
        const step = decide(snapshot({
            progress: P(2, 'helped-og', 'helped-toban', 'helped-grew'),
            invIds: new Map([[WT_ITEM.RELIC_PART2.id, 1], [WT_ITEM.JANGERBERRIES.id, 2]]),
            tile: { x: 2544, z: 3112, level: 2 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/give Relic part/i);
    });

    test('the lever is pulled from the wizard floor, not after a climb down', () => {
        const step = decide(snapshot({
            progress: P(11),
            tile: { x: 2544, z: 3112, level: 2 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/lever/i);
    });

    test('a wizard step still escapes a genuinely wrong pocket', () => {
        const step = decide(snapshot({
            progress: P(11),
            tile: { x: 2576, z: 3027, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/leave Toban/i);
    });
});

describe('watchtower decide — stage 3 hides inside stage 2', () => {
    const tribesDone = ['helped-og', 'helped-toban', 'helped-grew'];

    test('the journal cannot tell 2 from 3, so owning the relic decides it', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.GIVEN_FINGERNAILS, ...tribesDone),
            invIds: new Map([[WT_ITEM.OGRE_RELIC.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/north-west ogre guard/i);
    });

    test('a relic sitting in the bank also counts, and is withdrawn', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.GIVEN_FINGERNAILS, ...tribesDone),
            bankIds: new Map([[WT_ITEM.OGRE_RELIC.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('without a relic it is still the tribal stage', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.GIVEN_FINGERNAILS, 'helped-og', 'helped-toban'),
            invIds: new Map([[WT_ITEM.ROPE.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/grew/i);
    });
});

describe('watchtower npc names', () => {
    test('only the four language talkers are plain Skavid', () => {
        expect(WT_NPC.SKAVID).toBe('Skavid');
        expect(WT_NPC.SCARED_SKAVID).toBe('Scared skavid');
        expect(WT_NPC.MAD_SKAVID).toBe('Mad skavid');
    });

    test('all four ogre guards share one name, so they are told apart by where we stand', () => {
        expect(WT_NPC.OGRE_GUARD).toBe('Ogre guard');
        expect(WT_NPC.CITY_GUARD).toBe('City guard');
        expect(WT_NPC.ENCLAVE_GUARD).toBe('Enclave guard');
    });
});

describe('watchtower decide — banking never starts from a sealed pocket', () => {
    test('stage 5 inside the city-guard pocket jumps out before checking the bank', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.GIVEN_RIDDLE),
            tile: { x: 2541, z: 3029, level: 0 },
            bankKnown: false
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/jump back/i);
    });

    test('stage 5 outside may go to the bank', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.GIVEN_RIDDLE),
            bankKnown: false
        }));
        expect(step.kind).toBe('scanBank');
    });

    test('stage 6 in a cave leaves before withdrawing a light source', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.SOLVED_RIDDLE, 'has-map'),
            invIds: new Map([[WT_ITEM.SKAVID_MAP.id, 1]]),
            tile: { x: 2504, z: 9441, level: 0 },
            bankIds: new Map([[WT_ITEM.LIT_CANDLE.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/leave the skavid cave/i);
    });
});

describe('parseWatchtowerJournal — colour tags leave a space before punctuation', () => {
    test('stage 9 with the brewed potion is not mistaken for stage 8', () => {
        const p = parseWatchtowerJournal([
            '|@str@I need to defeat the ogre shamans and find the other|',
            '@str@crystals.|',
            '@str@I tried to defeat the shamans, but they are protected|',
            '@str@by powerful magics!|',
            '|@dbl@I have made the @dre@ogre potion@dbl@. I need to get it enchanted by the Watchtower wizard.|'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.LEARNED_POTION);
    });

    test('stage 9 before brewing also reads as 9, not 8', () => {
        const p = parseWatchtowerJournal([
            '|@str@I need to defeat the ogre shamans and find the other|',
            '@str@crystals.|',
            '@dbl@I need to make the @dre@potion@dbl@ that will @dre@defeat the ogre @dre@shamans@dbl@.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.LEARNED_POTION);
    });

    test('stage 8 itself still reads as 8', () => {
        const p = parseWatchtowerJournal([
            '@str@I used some cave nightshade to distract the guard.|',
            '@dbl@I need to @dre@defeat the ogre shamans@dbl@ and @dre@find the other crystals.|'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.FED_NIGHTSHADE);
    });
});

describe('watchtower decide — a cave trip needs the map and a light', () => {
    test('stage 10 fetching nightshade without the map re-asks the city guard', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:6'),
            inv: new Map([['tuna', 10]]),
            invIds: new Map([[WT_ITEM.MAGIC_OGRE_POTION.id, 1], [WT_ITEM.LIT_CANDLE.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/skavid map/i);
    });

    test('with the map banked it is withdrawn rather than re-asked', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:6'),
            inv: new Map([['tuna', 10]]),
            invIds: new Map([[WT_ITEM.MAGIC_OGRE_POTION.id, 1], [WT_ITEM.LIT_CANDLE.id, 1]]),
            bankIds: new Map([[WT_ITEM.SKAVID_MAP.id, 1]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('with map and light in hand it goes for the nightshade', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:6'),
            inv: new Map([['tuna', 10]]),
            invIds: new Map([
                [WT_ITEM.MAGIC_OGRE_POTION.id, 1],
                [WT_ITEM.SKAVID_MAP.id, 1],
                [WT_ITEM.LIT_CANDLE.id, 1]
            ])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/nightshade/i);
    });
});

describe('watchtower decide — the enclave is never entered without food', () => {
    test('stage 10 with no food withdraws some before going in', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:6'),
            invIds: new Map([[WT_ITEM.MAGIC_OGRE_POTION.id, 1], [WT_ITEM.NIGHTSHADE.id, 1]]),
            bank: new Map([['tuna', 100]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('with no food anywhere it parks naming the problem', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:6'),
            invIds: new Map([[WT_ITEM.MAGIC_OGRE_POTION.id, 1], [WT_ITEM.NIGHTSHADE.id, 1]])
        }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toMatch(/food/i);
    });
});

describe('watchtower decide — holding all four crystals', () => {
    const allFour = new Map([
        [WT_ITEM.CRYSTAL1.id, 1], [WT_ITEM.CRYSTAL2.id, 1],
        [WT_ITEM.CRYSTAL3.id, 1], [WT_ITEM.CRYSTAL4.id, 1]
    ]);

    test('goes straight to the wizard without a bank trip', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:0'),
            inv: new Map([['tuna', 10]]),
            invIds: allFour,
            bankKnown: false
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/crystals to the wizard/i);
    });

    test('a missing crystal still consults the bank first', () => {
        const partial = new Map(allFour);
        partial.delete(WT_ITEM.CRYSTAL2.id);
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:0'),
            inv: new Map([['tuna', 10]]),
            invIds: partial,
            bankKnown: false
        }));
        expect(step.kind).toBe('scanBank');
    });
});

describe('watchtower decide — food is only demanded for trips that re-enter', () => {
    const allFour = new Map([
        [WT_ITEM.CRYSTAL1.id, 1], [WT_ITEM.CRYSTAL2.id, 1],
        [WT_ITEM.CRYSTAL3.id, 1], [WT_ITEM.CRYSTAL4.id, 1]
    ]);

    test('carrying every crystal with no food, it still reaches the wizard', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:0'),
            invIds: allFour
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/crystals to the wizard/i);
    });

    test('but a trip back in without food still parks', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:6'),
            invIds: new Map([[WT_ITEM.MAGIC_OGRE_POTION.id, 1], [WT_ITEM.NIGHTSHADE.id, 1]])
        }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toMatch(/food/i);
    });
});

describe('watchtower decide — the mirror tower means done', () => {
    test('standing in region 45_73 with the scroll, it reads it', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS),
            tile: { x: 2928, z: 4715, level: 2 },
            invIds: new Map([[WT_ITEM.WATCHTOWER_SPELL.id, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/scroll/i);
    });

    test('without the scroll it climbs down rather than retrying the lever', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS),
            tile: { x: 2928, z: 4715, level: 2 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/climb down/i);
    });
});

describe('watchtower decide — the Rock of Dalgroth needs a pickaxe', () => {
    const mining = (over: Partial<QuestSnapshot> = {}) => decide(snapshot({
        progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:0'),
        inv: new Map([['tuna', 10]]),
        invIds: new Map([[WT_ITEM.NIGHTSHADE.id, 1], [WT_ITEM.SKAVID_MAP.id, 1], [WT_ITEM.LIT_CANDLE.id, 1]]),
        ...over
    }));

    test('with no pickaxe anywhere it buys one rather than mining bare-handed', () => {
        const step = mining();
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe(WT_ITEM.PICKAXE.name);
    });

    test('a banked pickaxe is withdrawn instead of bought', () => {
        const step = mining({ bankIds: new Map([[WT_ITEM.PICKAXE.id, 1]]) });
        expect(step.kind).toBe('withdraw');
    });

    test('standing in the enclave with no pickaxe it leaves to get one', () => {
        const step = mining({ tile: { x: 2589, z: 9450, level: 0 } });
        expect(step.kind === 'custom' && step.name).toMatch(/leave the shaman enclave/i);
    });

    test('the pickaxe is carried in with the shaman trip, not fetched after', () => {
        const step = decide(snapshot({
            progress: P(WATCHTOWER_STAGE.MADE_POTION, 'shamans-left:6'),
            inv: new Map([['tuna', 10]]),
            invIds: new Map([[WT_ITEM.MAGIC_OGRE_POTION.id, 1], [WT_ITEM.NIGHTSHADE.id, 1]])
        }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe(WT_ITEM.PICKAXE.name);
    });

    test('with a pickaxe carried it goes and mines', () => {
        const step = mining({
            invIds: new Map([
                [WT_ITEM.NIGHTSHADE.id, 1],
                [WT_ITEM.SKAVID_MAP.id, 1],
                [WT_ITEM.LIT_CANDLE.id, 1],
                [WT_ITEM.PICKAXE.id, 1]
            ])
        });
        expect(step.kind === 'custom' && step.name).toMatch(/Rock of Dalgroth/i);
    });
});
