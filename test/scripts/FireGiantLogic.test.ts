import { describe, expect, test } from 'bun:test';
import { ESCAPE_TELES, legFor, LEDGE, POST_ROCK, RAFT_STAND, WASHED_OUT } from '#/bot/scripts/FireGiantLogic.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

describe('legFor', () => {
    test('anywhere underground is InDungeon', () => {
        expect(legFor(at(2575, 9861))).toBe('InDungeon');
        expect(legFor(at(2568, 9893))).toBe('InDungeon');
    });
    test('the exact ledge tile is AtLedge', () => {
        expect(legFor(at(LEDGE.x, LEDGE.z))).toBe('AtLedge');
    });
    test('the post-rock landing and the tree stand are both PastRock', () => {
        expect(legFor(at(POST_ROCK.x, POST_ROCK.z))).toBe('PastRock');
        expect(legFor(at(2512, 3466))).toBe('PastRock');
    });
    test('the engine throw zone is AtLanding, inclusive at every edge', () => {
        expect(legFor(at(2512, 3481))).toBe('AtLanding');
        expect(legFor(at(2510, 3476))).toBe('AtLanding');
        expect(legFor(at(2514, 3481))).toBe('AtLanding');
        expect(legFor(at(2509, 3478))).not.toBe('AtLanding');
        expect(legFor(at(2512, 3482))).not.toBe('AtLanding');
    });
    test('the shared failure coord is WashedOut', () => {
        expect(legFor(at(WASHED_OUT.x, WASHED_OUT.z))).toBe('WashedOut');
        expect(legFor(at(WASHED_OUT.x + 4, WASHED_OUT.z - 4))).toBe('WashedOut');
    });
    test('near the raft is AtRaft', () => {
        expect(legFor(at(RAFT_STAND.x, RAFT_STAND.z))).toBe('AtRaft');
        expect(legFor(at(RAFT_STAND.x + 3, RAFT_STAND.z + 3))).toBe('AtRaft');
    });
    test('everything else, and an unknown position, is Surface', () => {
        expect(legFor(at(2725, 3491))).toBe('Surface');
        expect(legFor(null)).toBe('Surface');
    });
    test('AtLedge wins over PastRock even though the ledge is close to the rock', () => {
        expect(legFor(at(2511, 3463))).toBe('AtLedge');
    });
});

describe('ESCAPE_TELES', () => {
    test('every entry carries a component, a level, runes, and a paired bank', () => {
        for (const [key, tele] of Object.entries(ESCAPE_TELES)) {
            expect(tele.name).toBe(key);
            expect(tele.com).toBeGreaterThan(0);
            expect(tele.level).toBeGreaterThan(0);
            expect(tele.runes.length).toBeGreaterThan(0);
            expect(tele.bank.level).toBe(0);
        }
    });
    test('Camelot is the documented default pairing', () => {
        expect(ESCAPE_TELES.Camelot.com).toBe(1174);
        expect(ESCAPE_TELES.Camelot.level).toBe(45);
        expect(ESCAPE_TELES.Camelot.bank.x).toBe(2725);
        expect(ESCAPE_TELES.Camelot.bank.z).toBe(3491);
    });
    test('Ardougne costs 2 law and 2 water', () => {
        const runes = Object.fromEntries(ESCAPE_TELES.Ardougne.runes.map(r => [r.rune, r.count]));
        expect(runes['Law rune']).toBe(2);
        expect(runes['Water rune']).toBe(2);
    });
});
