import { describe, expect, test } from 'bun:test';

import {
    COMBINATION,
    LABEL_OBJ,
    TOTEM_OBJ,
    TOTEM_STAGE,
    decide,
    inMansion,
    parseTribalTotemJournal,
    tribaltotem
} from '#/bot/api/ai/quests/defs/tribaltotem.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const NOT_STARTED =
    '@dbl@I can start this quest by speaking to @dre@Kangai Mau@dbl@ in @dre@the Shrimp & Parrot@dbl@ restaurant in @dre@Brimhaven|'
    + '@dbl@To complete this quest I need:|@dre@Level 21 Thieving';

const PREAMBLE =
    '@str@I agreed to help Kangai Mau on Brimhaven recover the|@str@tribal totem stolen from his village by Lord Handelmort.|';

const SWAPPED =
    '@str@I found a package due for delivery to Lord Handelmort at|@str@the R.P.D.T. depot, and swapped the label for the Wizard|'
    + "@str@Cromperty's experimental teleport block.|";

const STARTED = PREAMBLE + '@dbl@I need to get into @dre@Lord Handelmorts Mansion@dbl@ in @dre@Ardougne';

const CRATE_MARKED = PREAMBLE + SWAPPED + '@dbl@I should get the @dre@R.P.D.T. men@dbl@ to deliver the crate now.';

const CRATE_DELIVERED =
    PREAMBLE + SWAPPED
    + '@str@I got the R.P.D.T. men to deliver the teleport block.|'
    + '@dbl@I should get @dre@Wizard Cromperty@dbl@ to teleport me inside now.';

const INSIDE =
    PREAMBLE + SWAPPED
    + '@str@I got the R.P.D.T. men to deliver the teleport block to Lord|@str@Handelmort and teleported myself inside.|';

const LOCKED_OUT = INSIDE + '@dbl@I need to find the combination for the @dre@security door@dbl@.|';

const COMBO_KNOWN =
    INSIDE
    + '@str@I worked out the combination for the door.|'
    + '@dbl@I should find the @dre@Tribal Totem@dbl@ and return it!';

const CARRYING =
    INSIDE
    + '@str@I worked out the combination for the door.|'
    + '@dbl@I should take the @dre@tribal totem@dbl@ back to @dre@Kangai Mau in Brimhaven@dbl@ and claim my @dre@reward';

const COMPLETE =
    PREAMBLE + SWAPPED
    + '@str@I got the R.P.D.T. men to deliver the teleport block to Lord|@str@Handelmort and teleported myself inside.|'
    + '@str@After bypassing the traps and security inside the|@str@mansion I was able to reclaim the totem, and take it|'
    + '@str@back to Kangai Mau, who rewarded me for all of my help.||@red@QUEST COMPLETE!';

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    combo?: boolean;
    invIds?: number[];
    tile?: { x: number; z: number; level: number } | null;
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
    const progress =
        'progress' in options
            ? options.progress
            : { stage: options.stage ?? TOTEM_STAGE.STARTED, flags: new Set(options.combo === true ? ['combo'] : []) };
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
        bankKnown: true,
        // Why: the mansion legs branch on where the bot is standing, so the default snapshot is inside it.
        tile: options.tile === undefined ? { x: 2638, z: 3321, level: 0 } : options.tile,
        freeSlots: 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

function npcName(step: QuestStep): string | null {
    return step.kind === 'talk' ? step.stop.npc : null;
}

describe('Tribal Totem journal parsing', () => {
    test('reads the not-started page as stage 0', () => {
        expect(parseTribalTotemJournal(NOT_STARTED)?.stage).toBe(TOTEM_STAGE.NOT_STARTED);
    });

    test('reads the mansion hint as started', () => {
        expect(parseTribalTotemJournal(STARTED)?.stage).toBe(TOTEM_STAGE.STARTED);
    });

    test('reads the delivery prompt as the crate being relabelled', () => {
        expect(parseTribalTotemJournal(CRATE_MARKED)?.stage).toBe(TOTEM_STAGE.CRATE_MARKED);
    });

    test('reads the Cromperty prompt as the crate being delivered', () => {
        expect(parseTribalTotemJournal(CRATE_DELIVERED)?.stage).toBe(TOTEM_STAGE.CRATE_DELIVERED);
    });

    // Why: every page repeats the sentences above it, so a parser that tests the oldest line first pins the stage too low.
    test('the crate pages do not read as the teleport page', () => {
        expect(parseTribalTotemJournal(CRATE_DELIVERED)?.stage).not.toBe(TOTEM_STAGE.TELEPORTED);
        expect(parseTribalTotemJournal(CRATE_MARKED)?.stage).not.toBe(TOTEM_STAGE.CRATE_DELIVERED);
    });

    test('reads the teleported page with no combination flag while the door is unsolved', () => {
        const progress = parseTribalTotemJournal(LOCKED_OUT);

        expect(progress?.stage).toBe(TOTEM_STAGE.TELEPORTED);
        expect(progress?.flags.has('combo')).toBe(false);
    });

    test('flags the combination once the page says it was worked out', () => {
        expect(parseTribalTotemJournal(COMBO_KNOWN)?.flags.has('combo')).toBe(true);
        expect(parseTribalTotemJournal(CARRYING)?.flags.has('combo')).toBe(true);
    });

    test('reads the finished page as complete', () => {
        expect(parseTribalTotemJournal(COMPLETE)?.stage).toBe(TOTEM_STAGE.COMPLETE);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseTribalTotemJournal('some other quest entirely')).toBeUndefined();
    });
});

describe('Tribal Totem mansion boxes', () => {
    test('the teleport landing, the stairs room and the upper floor are inside', () => {
        expect(inMansion({ x: 2638, z: 3321, level: 0 })).toBe(true);
        expect(inMansion({ x: 2631, z: 3325, level: 0 })).toBe(true);
        expect(inMansion({ x: 2638, z: 3323, level: 1 })).toBe(true);
    });

    // Why: the porch is south of the inner door and open to the garden, so a bot standing in it needs teleporting rather than a walk to the stairs.
    test('the porch, the garden alcoves and the garden are outside', () => {
        expect(inMansion({ x: 2635, z: 3321, level: 0 })).toBe(false);
        expect(inMansion({ x: 2629, z: 3320, level: 0 })).toBe(false);
        expect(inMansion({ x: 2640, z: 3320, level: 0 })).toBe(false);
        expect(inMansion({ x: 2637, z: 3312, level: 0 })).toBe(false);
    });

    test('a missing tile reads as outside', () => {
        expect(inMansion(null)).toBe(false);
        expect(inMansion(undefined)).toBe(false);
    });
});

describe('Tribal Totem decide', () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('opens with Kangai Mau when the quest has not started', () => {
        expect(npcName(decide(snap({ journal: 'notStarted' })))).toBe('Kangai Mau');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        expect(decide(snap({ progress: undefined })).kind).toBe('wait');
    });

    test('takes the address label before anything else once started', () => {
        expect(customName(decide(snap({ stage: TOTEM_STAGE.STARTED })))).toBe('take the address label off the mansion crate');
    });

    test('relabels the crate once the label is held', () => {
        const step = decide(snap({ stage: TOTEM_STAGE.STARTED, invIds: [LABEL_OBJ] }));

        expect(customName(step)).toBe("relabel the crate bound for the Wizards' Tower");
    });

    test('asks the R.P.D.T. to deliver once the crate is marked', () => {
        expect(npcName(decide(snap({ stage: TOTEM_STAGE.CRATE_MARKED })))).toBe('RPDT employee');
    });

    test('goes back to Cromperty for the ride in once the crate is delivered', () => {
        expect(npcName(decide(snap({ stage: TOTEM_STAGE.CRATE_DELIVERED })))).toBe('Wizard Cromperty');
    });

    test('works out the combination first when inside with the door unsolved', () => {
        const step = decide(snap({ stage: TOTEM_STAGE.TELEPORTED }));

        expect(customName(step)).toBe('work out the security door combination');
    });

    test('goes for the chest once the combination is known', () => {
        const step = decide(snap({ stage: TOTEM_STAGE.TELEPORTED, combo: true }));

        expect(customName(step)).toBe('take the totem from the mansion chest');
    });

    // Why: nothing walks into the mansion — the inner door only opens outward, so a resume outside it has to be teleported back in.
    test('rides Cromperty back in when the teleported stage finds the bot outside', () => {
        const outside = snap({ stage: TOTEM_STAGE.TELEPORTED, combo: true, tile: { x: 2655, z: 3283, level: 0 } });

        expect(npcName(decide(outside))).toBe('Wizard Cromperty');
    });

    test('carries the totem straight back to Kangai Mau', () => {
        const step = decide(snap({ stage: TOTEM_STAGE.TELEPORTED, combo: true, invIds: [TOTEM_OBJ] }));

        expect(npcName(step)).toBe('Kangai Mau');
    });
});

// Why: the issue asks for a quest that resumes from any point, and `decide()` being pure is what lets that be proved without a client.
describe('Tribal Totem resumability', () => {
    const STAGES = [TOTEM_STAGE.STARTED, TOTEM_STAGE.CRATE_MARKED, TOTEM_STAGE.CRATE_DELIVERED, TOTEM_STAGE.TELEPORTED];
    const TILES = [
        { x: 2638, z: 3321, level: 0 },
        { x: 2638, z: 3323, level: 1 },
        { x: 2655, z: 3283, level: 0 },
        { x: 2791, z: 3182, level: 0 },
        { x: 2640, z: 9719, level: 0 }
    ];

    test('every reachable state names a step rather than waiting', () => {
        const stuck: string[] = [];
        for (const stage of STAGES) {
            for (const combo of [false, true]) {
                for (const held of [[], [LABEL_OBJ], [TOTEM_OBJ]]) {
                    for (const tile of TILES) {
                        const step = decide(snap({ stage, combo, invIds: held, tile }));
                        if (step.kind === 'wait') {
                            stuck.push(`stage ${stage} combo=${combo} held=[${held}] at ${tile.x},${tile.z},${tile.level}: ${step.reason}`);
                        }
                    }
                }
            }
        }

        expect(stuck).toEqual([]);
    });

    test('a bot dumped in the sewers by the stairs trap rides Cromperty back in', () => {
        const sewers = snap({ stage: TOTEM_STAGE.TELEPORTED, combo: true, tile: { x: 2640, z: 9719, level: 0 } });

        expect(npcName(decide(sewers))).toBe('Wizard Cromperty');
    });
});

describe('Tribal Totem module', () => {
    test('needs 21 Thieving and no items', () => {
        expect(tribaltotem.record.items).toEqual([]);
        expect(tribaltotem.record.requirements.skills).toEqual([{ skill: 'thieving', level: 21 }]);
    });

    test('keeps the label, the totem and the ferry fare off the deposit list', () => {
        for (const tool of ['address label', 'totem', 'coins']) {
            expect(tribaltotem.tools).toContain(tool);
        }
    });

    test('banks in Ardougne East, the only bank on either side of the crossing', () => {
        expect(tribaltotem.bank).toEqual(expect.objectContaining({ x: 2655, z: 3283, level: 0 }));
    });

    test('spells the gardener-leaked combination', () => {
        expect(COMBINATION).toBe('KURT');
    });
});
