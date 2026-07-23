import { describe, expect, test } from 'bun:test';

import { buildClueDb, parseChallengeTalk, parseKillForKey, parseTalkMappings } from './cluesParse.js';

describe('parseTalkMappings tier', () => {
    test('matches medium progress calls', () => {
        const src = '[opnpc1,donovan]\n~progress_clue_medium(trail_clue_medium_anagram005, "x");';
        expect(parseTalkMappings(src, 'medium')).toEqual([{ obj: 'trail_clue_medium_anagram005', npc: 'donovan' }]);
    });
    test('easy tier still matches easy calls only', () => {
        const src = '[opnpc1,ned]\n~progress_clue_easy(trail_clue_easy_simple021, "x");';
        expect(parseTalkMappings(src, 'easy')).toEqual([{ obj: 'trail_clue_easy_simple021', npc: 'ned' }]);
    });
    test('medium tier ignores easy progress calls (and vice versa)', () => {
        const src = '[opnpc1,ned]\n~progress_clue_easy(trail_clue_easy_simple021, "x");';
        expect(parseTalkMappings(src, 'medium')).toEqual([]);
    });
});

describe('parseKillForKey', () => {
    test('extracts riddle→npc/key from trail_checkmediumdrop', () => {
        const src = 'if(npc_type = black_heather & inv_total(inv, trail_clue_medium_riddle001) > 0 & ~obj_gettotal(trail_clue_medium_riddle001_key) = 0) {\n    obj_add(npc_coord, trail_clue_medium_riddle001_key, 1, ^lootdrop_duration);\n}';
        expect(parseKillForKey(src)['trail_clue_medium_riddle001']).toEqual({ npc: 'black_heather', keyObj: 'trail_clue_medium_riddle001_key' });
    });
    test('handles npc_name / npc_category forms', () => {
        const src = 'if(compare(npc_name, "Man") = 0 & inv_total(inv, trail_clue_medium_riddle005) > 0) {\n obj_add(npc_coord, trail_clue_medium_riddle005_key, 1, 0);\n}\nif(npc_category = pirate & inv_total(inv, trail_clue_medium_riddle007) > 0) {\n obj_add(npc_coord, trail_clue_medium_riddle007_key, 1, 0);\n}';
        const m = parseKillForKey(src);
        expect(m['trail_clue_medium_riddle005'].npc).toBe('Man');
        expect(m['trail_clue_medium_riddle007'].npc).toBe('pirate');
    });
    test('captures the clue obj, not its _key, as the map key', () => {
        const src = 'if(npc_type = guarddog & inv_total(inv, trail_clue_medium_riddle002) > 0) {\n obj_add(npc_coord, trail_clue_medium_riddle002_key, 1, 0);\n}';
        const m = parseKillForKey(src);
        expect(Object.keys(m)).toEqual(['trail_clue_medium_riddle002']);
        expect(m['trail_clue_medium_riddle002'].keyObj).toBe('trail_clue_medium_riddle002_key');
    });
});

describe('parseChallengeTalk', () => {
    test('attributes a challenge anagram to its gating opnpc when the prompt label precedes it', () => {
        const src = [
            '[label,trail_gnome_ball_ref]',
            'if(inv_total(inv, trail_clue_medium_anagram008_challenge) > 0) {',
            '    @trail_challengenpc_prompt("q", "ok", "no", "mes", trail_clue_medium_anagram008, trail_clue_medium_anagram008_challenge);',
            '}',
            '[opnpc1,gnomereferee]',
            'if(inv_total(inv, trail_clue_medium_anagram008) > 0) {',
            '    @trail_gnome_ball_ref;',
            '}'
        ].join('\n');
        expect(parseChallengeTalk(src)).toEqual([{ obj: 'trail_clue_medium_anagram008', npc: 'gnomereferee' }]);
    });
    test('attributes a challenge anagram whose prompt label follows the opnpc', () => {
        const src = [
            '[opnpc1,cook]',
            'if(inv_total(inv, trail_clue_medium_anagram002) > 0) {',
            '    @trail_cook_challenge;',
            '}',
            '[label,trail_cook_challenge]',
            'if(inv_total(inv, trail_clue_medium_anagram002_challenge) > 0) {',
            '    @trail_challengenpc_prompt("q", "ok", "no", "mes", trail_clue_medium_anagram002, trail_clue_medium_anagram002_challenge);',
            '}'
        ].join('\n');
        expect(parseChallengeTalk(src)).toEqual([{ obj: 'trail_clue_medium_anagram002', npc: 'cook' }]);
    });
    test('ignores files without a challenge scroll (direct-progress anagrams)', () => {
        const src = '[opnpc1,donovan]\nif(inv_total(inv, trail_clue_medium_anagram009) > 0) {\n ~progress_clue_medium(trail_clue_medium_anagram009, "x");\n}';
        expect(parseChallengeTalk(src)).toEqual([]);
    });
});

describe('buildClueDb medium enrichment', () => {
    test('sextant dig row is flagged needsSextant; kill-for-key search row gets keyFrom', () => {
        const { db } = buildClueDb({
            clueNames: ['trail_clue_medium_sextant001', 'trail_clue_medium_riddle001'],
            objs: {
                trail_clue_medium_sextant001: { coord: '0_49_50_24_51', casket: 'trail_clue_medium_sextant001_casket', sextant: 'yes' },
                trail_clue_medium_riddle001: { desc: 'a locked chest in the town chapel' }
            },
            objIds: new Map([
                ['trail_clue_medium_sextant001', 100],
                ['trail_clue_medium_sextant001_casket', 101],
                ['trail_clue_medium_riddle001', 200]
            ]),
            talk: [],
            npcDisplay: new Map(),
            specials: { trail_clue_medium_riddle001: { type: 'search', coord: { x: 3256, z: 3487, level: 0 } } },
            killForKey: { trail_clue_medium_riddle001: { npc: 'Black Heather', keyObj: 'trail_clue_medium_riddle001_key', keyId: 2832 } }
        });

        expect(db[100].type).toBe('dig');
        expect(db[100].needsSextant).toBe(true);

        expect(db[200].type).toBe('search');
        expect(db[200].coord).toEqual({ x: 3256, z: 3487, level: 0 });
        expect(db[200].keyFrom).toEqual({ npc: 'Black Heather', keyObj: 'trail_clue_medium_riddle001_key', keyId: 2832 });
    });

    test('a plain map dig row carries no needsSextant / keyFrom', () => {
        const { db } = buildClueDb({
            clueNames: ['trail_clue_medium_map001'],
            objs: { trail_clue_medium_map001: { coord: '0_48_50_21_27', casket: 'trail_clue_medium_map001_casket' } },
            objIds: new Map([
                ['trail_clue_medium_map001', 300],
                ['trail_clue_medium_map001_casket', 301]
            ]),
            talk: [],
            npcDisplay: new Map()
        });
        expect(db[300].type).toBe('dig');
        expect(db[300].needsSextant).toBeUndefined();
        expect(db[300].keyFrom).toBeUndefined();
    });
});
