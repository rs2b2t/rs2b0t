import { describe, expect, test } from 'bun:test';
import { AP_RANGE, ESCAPE_TELES, legFor, LEDGE, POST_ROCK, RAFT_STAND, ROCK_TILE, ROPE_THROW_STAND, THROW_ZONE, WASHED_OUT } from '#/bot/scripts/FireGiantLogic.js';

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

// the landing tile satisfies the engine's inzone check but sits 13 tiles from the
// rock, past the aplocu range, and the rock is across water — the server answers
// "I can't reach that!" and the player never moves. The throw stand must satisfy
// BOTH the zone check and op reachability.
describe('ROPE_THROW_STAND', () => {
    test('is inside the engine throw zone', () => {
        expect(ROPE_THROW_STAND.x).toBeGreaterThanOrEqual(THROW_ZONE.minX);
        expect(ROPE_THROW_STAND.x).toBeLessThanOrEqual(THROW_ZONE.maxX);
        expect(ROPE_THROW_STAND.z).toBeGreaterThanOrEqual(THROW_ZONE.minZ);
        expect(ROPE_THROW_STAND.z).toBeLessThanOrEqual(THROW_ZONE.maxZ);
    });
    test('is north of the rock — the engine refuses coordz(you) <= coordz(rock)', () => {
        expect(ROPE_THROW_STAND.z).toBeGreaterThan(ROCK_TILE.z);
    });
    test('is within aplocu range of the rock', () => {
        const d = Math.max(Math.abs(ROPE_THROW_STAND.x - ROCK_TILE.x), Math.abs(ROPE_THROW_STAND.z - ROCK_TILE.z));
        expect(d).toBeLessThanOrEqual(AP_RANGE);
    });
    test('the raft landing is NOT a legal throw stand — it is out of ap range', () => {
        const d = Math.max(Math.abs(2512 - ROCK_TILE.x), Math.abs(3481 - ROCK_TILE.z));
        expect(d).toBeGreaterThan(AP_RANGE);
    });
    test('standing on it still resolves to the AtLanding leg', () => {
        expect(legFor({ x: ROPE_THROW_STAND.x, z: ROPE_THROW_STAND.z, level: 0 })).toBe('AtLanding');
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

describe('registry', () => {
    test('FireGiant registers under Combat with its settings schema', async () => {
        const { ScriptRegistry } = await import('#/bot/runtime/ScriptRegistry.js');
        await import('#/bot/scripts/index.js');
        const entry = ScriptRegistry.get('FireGiant');
        expect(entry?.category).toBe('Combat');
        expect(entry?.settingsSchema?.escapeTele?.default).toBe('Camelot');
        expect(entry?.settingsSchema?.combatStyle?.options).toEqual(['melee', 'mage', 'range']);
    });
});
