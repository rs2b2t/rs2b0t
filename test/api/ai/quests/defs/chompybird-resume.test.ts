import { describe, expect, test } from 'bun:test';

import { CB_ID, CB_STAGE } from '#/bot/api/ai/quests/defs/chompybird/areas.js';
import { CookState } from '#/bot/api/ai/quests/defs/chompybird/cook.js';
import { ChestState } from '#/bot/api/ai/quests/defs/chompybird/hunt.js';
import { decide } from '#/bot/api/ai/quests/defs/chompybird/index.js';

import { snap } from './chompybird.fixture.js';

// Why: the quest is killed and restarted from any point, so every reachable (stage, pack) pair has to
// name a next move rather than a wait, a wait with nothing to resolve it parks the queue after fifteen ticks.

const STAGES = [
    CB_STAGE.NOT_STARTED, CB_STAGE.STARTED, CB_STAGE.GIVEN_ARROWS, CB_STAGE.KIDS_PLAY_WITH_TOAD,
    CB_STAGE.REMOVED_ROCK, CB_STAGE.SHOWN_TOAD, CB_STAGE.DROPPED_TOAD, CB_STAGE.CHOMPY_SPAWNED,
    CB_STAGE.RANTZ_MISSED, CB_STAGE.GOT_BOW, CB_STAGE.KILLED_CHOMPY, CB_STAGE.TOLD_TO_COOK,
    CB_STAGE.CHOMPY_COOKED
];

const PACKS: readonly { name: string; invIds: [number, number][] }[] = [
    { name: 'nothing but the loadout', invIds: [] },
    { name: 'knife and chisel', invIds: [[CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1]] },
    { name: 'a log part-way to a shaft', invIds: [[CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1], [CB_ID.ACHEY_LOGS, 2]] },
    { name: 'six shafts and no tips', invIds: [[CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1], [CB_ID.SHAFT, 6]] },
    { name: 'flighted arrows waiting on tips', invIds: [[CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1], [CB_ID.FLIGHTED, 6]] },
    { name: 'a full quiver', invIds: [[CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1], [CB_ID.ARROW, 12]] },
    { name: 'bellows and bait', invIds: [[CB_ID.BELLOWS1, 1], [CB_ID.TOAD, 2]] },
    { name: 'bow, arrows and bellows', invIds: [[CB_ID.BOW, 1], [CB_ID.ARROW, 6], [CB_ID.BELLOWS3, 1]] },
    { name: 'a plucked chompy', invIds: [[CB_ID.RAW_CHOMPY, 1], [CB_ID.BOW, 1], [CB_ID.ARROW, 4]] },
    { name: 'a seasoned chompy', invIds: [[CB_ID.SEASONED_CHOMPY, 1]] },
    {
        name: 'every seasoning and a bird',
        invIds: [
            [CB_ID.RAW_CHOMPY, 1], [CB_ID.POTATO, 1], [CB_ID.ONION, 1], [CB_ID.CABBAGE, 1],
            [CB_ID.TOMATO, 1], [CB_ID.EQUA, 1], [CB_ID.DOOGLE, 1]
        ]
    }
];

/** An established account: the bank holds every tool this quest can fall back on. */
function resumeSnapshot(stage: number, invIds: [number, number][]) {
    return snap({
        stage,
        invIds,
        worn: ['rune scimitar', 'rune chainbody', 'rune platelegs', 'rune full helm', 'rune kiteshield'],
        bank: [['coins', 2_000_000], ['bronze axe', 1], ['lobster', 40]],
        bankIds: [[CB_ID.FEATHER, 500], [CB_ID.KNIFE, 1], [CB_ID.CHISEL, 1], [CB_ID.BELLOWS_EMPTY, 1]],
        freeSlots: 18
    });
}

describe('big chompy bird hunting resumes from anywhere', () => {
    for (const chestRefused of [false, true]) {
        for (const kidsAsked of [false, true]) {
            for (const stage of STAGES) {
                for (const pack of PACKS) {
                    test(`stage ${stage}, ${pack.name}, chest ${chestRefused ? 'refused' : 'untried'}, kids ${kidsAsked ? 'asked' : 'unasked'}`, () => {
                        ChestState.refused = chestRefused;
                        CookState.kidsAsked = kidsAsked;
                        const step = decide(resumeSnapshot(stage, pack.invIds));
                        expect(step.kind).not.toBe('wait');
                        expect(step.kind).not.toBe('done');
                    });
                }
            }
        }
    }
});
