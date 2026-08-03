import { describe, expect, test } from 'bun:test';

import { decodeCoord } from '../../tools/nav/stairsParse.js';
import { buildClueDb, parseClueObjs, parseEnum, parsePuzzleTalk, parseTalkMappings } from '../../tools/clues/cluesParse.js';

const ENUM_FIXTURE = `
[trail_easy_enum]
inputtype=int
outputtype=namedobj
val=0,trail_clue_easy_map001
val=1,trail_clue_easy_simple001
val=2,trail_clue_easy_simple021
val=3,trail_clue_easy_vague003
`;

const OBJ_FIXTURE = `
[trail_clue_easy_map001]
name=Clue scroll
desc=Part of the world map, but where?
cost=1
category=trail_clue_easy
param=trail_coord,0_49_52_41_32
param=trail_casket,trail_clue_easy_map001_casket
tradeable=no

[trail_clue_easy_simple001]
name=Clue scroll
iop1=Read
category=trail_clue_easy
param=trail_desc,Search the chest in the|Duke of Lumbridge's bedroom.
param=trail_coord,1_50_50_9_18
param=trail_loc,^true
tradeable=no

[trail_clue_easy_simple021]
name=Clue scroll
category=trail_clue_easy
param=trail_desc,Speak to Ned to|solve the clue.
tradeable=no

[trail_clue_easy_vague003]
name=Clue scroll
category=trail_clue_easy
param=trail_desc,Search the drawers found upstairs|in East Ardougne's houses.
tradeable=no
`;

const NED_SCRIPT = `
[opnpc1,ned]
if(map_members = ^true & inv_total(inv, trail_clue_easy_simple021) = 1) {
    @trail_ned;
}

[opnpcu,ned]
~displaymessage(^dm_default);

[label,trail_ned]
~chatnpc("<p,happy>Well done!");
~progress_clue_easy(trail_clue_easy_simple021, "Ned has given you another clue!");
`;

const DUEL_SCRIPT = `
[opnpc1,duel_crowdmale1] @duel_arena_spectator_dialogue;
[opnpc1,duel_crowdfemale3]
if(inv_total(inv, trail_clue_easy_vague029) > 0) {
    ~progress_clue_easy(trail_clue_easy_vague029, "You've found another clue!");
    return;
}
@duel_arena_spectator_dialogue;
`;

const HARD_OBJ_FIXTURE = `
[trail_clue_hard_sextant001]
name=Clue scroll
category=trail_clue_hard
param=trail_desc,22 degrees 35 minutes North|19 degrees 18 minutes East
param=trail_sextant,yes
param=trail_casket,trail_clue_hard_sextant001_casket
param=trail_coord,0_47_60_50_44
param=trail_guardian,trail_hard
tradeable=no

[trail_clue_hard_riddle004]
name=Clue scroll
category=trail_clue_hard
param=trail_desc,Speak to the keeper of my trail.
param=trail_casket,trail_clue_hard_riddle004_casket
tradeable=no

[trail_clue_hard_riddle019]
name=Clue scroll
category=trail_clue_hard
param=trail_desc,find me where words of wisdom speak volumes.
tradeable=no
`;

const HARD_ENUM_FIXTURE = `
[trail_hard_enum]
inputtype=int
outputtype=namedobj
val=0,trail_clue_hard_sextant001
val=1,trail_clue_hard_riddle004
val=2,trail_clue_hard_riddle019
`;

const GERRANT_SCRIPT = `
[opnpc1,gerrant]
if(inv_total(inv, trail_clue_hard_riddle004) > 0) {
    ~progress_clue_hard(trail_clue_hard_riddle004, "Gerrant has given you another clue scroll!");
    return;
}
@gerrant_shop;
`;

const EXAMINER_SCRIPT = `
[opnpc1,examiner]
if(inv_total(inv, trail_clue_hard_riddle019) > 0) {
    if(~obj_gettotal(trail_clue_hard_riddle019_puzzlebox) > 0) {
        if(~trail_puzzle_complete(trail_clue_hard_riddle019_puzzlebox) = true) {
            inv_del(inv, trail_clue_hard_riddle019_puzzlebox, 1);
            ~progress_clue_hard(trail_clue_hard_riddle019, "The examiner has given you another clue scroll!");
            return;
        }
        return;
    }
    ~give_trail_puzzle(trail_clue_hard_riddle019_puzzlebox, "<p,neutral>Hi! Please complete this.", "The examiner has given you a puzzle box!");
    return;
}
`;

describe('parseEnum', () => {
    test('maps enum vals to obj names indexed by val', () => {
        const names = parseEnum(ENUM_FIXTURE);
        expect(names).toEqual([
            'trail_clue_easy_map001',
            'trail_clue_easy_simple001',
            'trail_clue_easy_simple021',
            'trail_clue_easy_vague003'
        ]);
    });
});

describe('parseClueObjs', () => {
    test('extracts trail_coord/trail_loc/trail_casket/trail_desc per block', () => {
        const objs = parseClueObjs(OBJ_FIXTURE);
        expect(objs['trail_clue_easy_map001']).toEqual({
            coord: '0_49_52_41_32',
            casket: 'trail_clue_easy_map001_casket',
            loc: undefined,
            desc: undefined
        });
        expect(objs['trail_clue_easy_simple001'].loc).toBe('^true');
        expect(objs['trail_clue_easy_simple001'].coord).toBe('1_50_50_9_18');
        expect(objs['trail_clue_easy_simple021']).toEqual({
            coord: undefined,
            loc: undefined,
            casket: undefined,
            desc: 'Speak to Ned to|solve the clue.'
        });
    });
});

describe('parseTalkMappings', () => {
    test('attributes a progress call in a label to the nearest opnpc npc', () => {
        expect(parseTalkMappings(NED_SCRIPT)).toEqual([{ obj: 'trail_clue_easy_simple021', npc: 'ned' }]);
    });
    test('picks the last opnpc header before the call among single-line headers', () => {
        expect(parseTalkMappings(DUEL_SCRIPT)).toEqual([{ obj: 'trail_clue_easy_vague029', npc: 'duel_crowdfemale3' }]);
    });
});

describe('parsePuzzleTalk', () => {
    test('pairs a give_trail_puzzle call with its clue and the enclosing npc', () => {
        expect(parsePuzzleTalk(EXAMINER_SCRIPT)).toEqual([
            { obj: 'trail_clue_hard_riddle019', npc: 'examiner', puzzleObj: 'trail_clue_hard_riddle019_puzzlebox' }
        ]);
    });

    test('ignores scripts with no puzzle hand-over', () => {
        expect(parsePuzzleTalk(GERRANT_SCRIPT)).toEqual([]);
    });
});

describe('parseTalkMappings — hard tier', () => {
    test('reads progress_clue_hard call sites', () => {
        expect(parseTalkMappings(GERRANT_SCRIPT, 'hard')).toEqual([{ obj: 'trail_clue_hard_riddle004', npc: 'gerrant' }]);
    });
});

describe('buildClueDb — hard tier', () => {
    const objIds = new Map<string, number>([
        ['trail_clue_hard_sextant001', 3520],
        ['trail_clue_hard_sextant001_casket', 3521],
        ['trail_clue_hard_riddle004', 3530],
        ['trail_clue_hard_riddle004_casket', 3531],
        ['trail_clue_hard_riddle019', 3540],
        ['trail_clue_hard_riddle019_puzzlebox', 3541]
    ]);
    const built = buildClueDb({
        clueNames: parseEnum(HARD_ENUM_FIXTURE),
        objs: parseClueObjs(HARD_OBJ_FIXTURE),
        objIds,
        talk: [...parseTalkMappings(GERRANT_SCRIPT, 'hard'), ...parseTalkMappings(EXAMINER_SCRIPT, 'hard')],
        npcDisplay: new Map([
            ['gerrant', 'Gerrant'],
            ['examiner', 'Examiner']
        ]),
        puzzles: parsePuzzleTalk(EXAMINER_SCRIPT),
        guardians: { trail_clue_hard_sextant001: 'Zamorak Wizard' }
    });

    test('a guarded sextant dig carries needsSextant and the guardian name', () => {
        expect(built.db[3520]).toEqual({
            obj: 'trail_clue_hard_sextant001',
            id: 3520,
            type: 'dig',
            coord: decodeCoord('0_47_60_50_44'),
            casketObj: 'trail_clue_hard_sextant001_casket',
            casketId: 3521,
            needsSextant: true,
            guardian: 'Zamorak Wizard'
        });
    });

    // riddle004 has a trail_casket param but no trail_coord: it is a talk clue,
    // and classifying on the casket alone would make it an un-diggable dig.
    test('a casket param without a coord stays a talk clue', () => {
        expect(built.db[3530]).toEqual({
            obj: 'trail_clue_hard_riddle004',
            id: 3530,
            type: 'talk',
            npc: 'Gerrant'
        });
    });

    test('a puzzle-box talk carries the puzzle obj and id', () => {
        expect(built.db[3540]).toEqual({
            obj: 'trail_clue_hard_riddle019',
            id: 3540,
            type: 'talk',
            npc: 'Examiner',
            puzzle: { obj: 'trail_clue_hard_riddle019_puzzlebox', id: 3541 }
        });
    });
});

describe('buildClueDb', () => {
    const objIds = new Map<string, number>([
        ['trail_clue_easy_map001', 2694],
        ['trail_clue_easy_map001_casket', 2714],
        ['trail_clue_easy_simple001', 2677],
        ['trail_clue_easy_simple021', 2697],
        ['trail_clue_easy_vague003', 2711]
    ]);
    const built = buildClueDb({
        clueNames: parseEnum(ENUM_FIXTURE),
        objs: parseClueObjs(OBJ_FIXTURE),
        objIds,
        talk: parseTalkMappings(NED_SCRIPT),
        npcDisplay: new Map([['ned', 'Ned']]),
        specials: { trail_clue_easy_vague003: { type: 'search', coord: decodeCoord('1_40_51_14_62') } }
    });

    test('dig row carries coord + casketObj + casketId, and populates caskets', () => {
        expect(built.db[2694]).toEqual({
            obj: 'trail_clue_easy_map001',
            id: 2694,
            type: 'dig',
            coord: decodeCoord('0_49_52_41_32'),
            casketObj: 'trail_clue_easy_map001_casket',
            casketId: 2714
        });
        expect(built.caskets[2714]).toBe('trail_clue_easy_map001_casket');
    });

    test('search row (trail_loc=^true) carries a decoded coord', () => {
        expect(built.db[2677]).toEqual({
            obj: 'trail_clue_easy_simple001',
            id: 2677,
            type: 'search',
            coord: decodeCoord('1_50_50_9_18')
        });
    });

    test('talk row resolves the npc debugname to a display name', () => {
        expect(built.db[2697]).toEqual({
            obj: 'trail_clue_easy_simple021',
            id: 2697,
            type: 'talk',
            npc: 'Ned'
        });
    });

    test('vague003 is hard-cased to a search-loc at the drawers coord', () => {
        expect(built.db[2711]).toEqual({
            obj: 'trail_clue_easy_vague003',
            id: 2711,
            type: 'search',
            coord: decodeCoord('1_40_51_14_62')
        });
    });

    test('keys the db by obj id', () => {
        expect(Object.keys(built.db).map(Number).sort((a, b) => a - b)).toEqual([2677, 2694, 2697, 2711]);
    });
});
