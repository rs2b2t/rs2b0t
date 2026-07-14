import { describe, expect, test } from 'bun:test';

import { decodeCoord } from '../../tools/nav/stairsParse.js';
import { buildClueDb, parseClueObjs, parseEnum, parseTalkMappings } from '../../tools/clues/cluesParse.js';

// Fixtures cut from rs2b2t-content game_trail configs + an NPC handler script.

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

// The progress call lives in a [label,...] block reached from the [opnpc1,ned]
// handler — the real ned.rs2 shape. The nearest preceding opnpc block names the
// npc. Also includes an [opnpcu,ned] block (non-digit op) that must be ignored.
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

// Duel-arena shape: several single-line [opnpcN,npc] headers precede the block
// that actually carries the progress call. Only the last one before the call wins.
const DUEL_SCRIPT = `
[opnpc1,duel_crowdmale1] @duel_arena_spectator_dialogue;
[opnpc1,duel_crowdfemale3]
if(inv_total(inv, trail_clue_easy_vague029) > 0) {
    ~progress_clue_easy(trail_clue_easy_vague029, "You've found another clue!");
    return;
}
@duel_arena_spectator_dialogue;
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
            // map dig clues carry desc= (generic item text), not param=trail_desc
            desc: undefined
        });
        expect(objs['trail_clue_easy_simple001'].loc).toBe('^true');
        expect(objs['trail_clue_easy_simple001'].coord).toBe('1_50_50_9_18');
        // talk clue: only a desc, no coord/loc/casket
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
