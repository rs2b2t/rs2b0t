import { describe, expect, test } from 'bun:test';
import { SPELL_TELEPORTS } from '#/bot/event/webwalk/teleportCatalog.js';
import { KBD_LAIR, KBD_ROUTE, KBD_SITES, SITE_OPTIONS, siteFor } from '#/bot/scripts/JiveKBD/sites.js';
import { KING_BLACK_DRAGON, derive, inputsPresent } from '../../../tools/nav/jive-safespots.js';

describe('KBD_SITES', () => {
    test('the lair is the only entry and every option resolves', () => {
        expect(SITE_OPTIONS).toEqual(['kbd-lair']);
        for (const key of SITE_OPTIONS) {
            expect(siteFor(key).key).toBe(key);
        }
        expect(siteFor('nope').key).toBe('kbd-lair');
        expect(KBD_SITES['kbd-lair']).toBe(KBD_LAIR);
    });

    test('the target is the client display name, lower-case black', () => {
        expect(KBD_LAIR.target).toBe('King black dragon');
    });

    test('the safespots are the two alcove tiles south of the arrival, the lever tile first', () => {
        expect(KBD_LAIR.safespots.map(t => [t.x, t.z, t.level])).toEqual([[2717, 9801, 0], [2716, 9801, 0]]);
        expect([KBD_LAIR.meleeAnchor.x, KBD_LAIR.meleeAnchor.z]).toEqual([2714, 9829]);
    });

    test('no gate, no key, no approach, and the dragon breathes at the tile', () => {
        expect(KBD_LAIR.gate).toBeNull();
        expect(KBD_LAIR.keyItem).toBeNull();
        expect(KBD_LAIR.approach).toEqual([]);
        expect(KBD_LAIR.rangedThreat).toBe(true);
    });

    test('banks at Edgeville and escapes by the Varrock teleport', () => {
        expect([KBD_LAIR.bank.x, KBD_LAIR.bank.z]).toEqual([3094, 3493]);
        expect(KBD_LAIR.walkOut).toEqual(KBD_LAIR.bank);
        expect(KBD_LAIR.escapeTeleportId).toBe('varrock');
        expect(SPELL_TELEPORTS.some(t => t.teleportId === KBD_LAIR.escapeTeleportId)).toBe(true);
    });

    test('inArea is the 42_153 square on level 0 and nothing else', () => {
        expect(KBD_LAIR.inArea({ x: 2717, z: 9802, level: 0 })).toBe(true);
        expect(KBD_LAIR.inArea({ x: 2688, z: 9792, level: 0 })).toBe(true);
        expect(KBD_LAIR.inArea({ x: 2751, z: 9855, level: 0 })).toBe(true);
        expect(KBD_LAIR.inArea({ x: 2687, z: 9802, level: 0 })).toBe(false);
        expect(KBD_LAIR.inArea({ x: 2752, z: 9802, level: 0 })).toBe(false);
        expect(KBD_LAIR.inArea({ x: 2717, z: 9791, level: 0 })).toBe(false);
        expect(KBD_LAIR.inArea({ x: 2717, z: 9856, level: 0 })).toBe(false);
        expect(KBD_LAIR.inArea({ x: 2717, z: 9802, level: 1 })).toBe(false);
        expect(KBD_LAIR.inArea({ x: 3067, z: 10254, level: 0 })).toBe(false);
        expect(KBD_LAIR.inArea(null)).toBe(false);
    });
});

describe('KBD_ROUTE', () => {
    test('the ladder is the Lava Maze one, climbed from beside it', () => {
        expect([KBD_ROUTE.ladder.tile.x, KBD_ROUTE.ladder.tile.z, KBD_ROUTE.ladder.locId, KBD_ROUTE.ladder.op, KBD_ROUTE.ladder.radius]).toEqual([3017, 3849, 1765, 'Climb-down', 1]);
        expect([KBD_ROUTE.dungeonArrival.x, KBD_ROUTE.dungeonArrival.z]).toEqual([3069, 10255]);
    });

    test('both levers are pulled from their own tile, a straight wall decoration being legal from underfoot alone', () => {
        expect([KBD_ROUTE.lever.tile.x, KBD_ROUTE.lever.tile.z, KBD_ROUTE.lever.locId, KBD_ROUTE.lever.op, KBD_ROUTE.lever.radius]).toEqual([3067, 10253, 1816, 'Pull', 0]);
        expect([KBD_ROUTE.outLever.tile.x, KBD_ROUTE.outLever.tile.z, KBD_ROUTE.outLever.locId, KBD_ROUTE.outLever.op, KBD_ROUTE.outLever.radius]).toEqual([2717, 9801, 1817, 'Pull', 0]);
    });

    test('each teleport lands on the tile north of the other lever, and the out-lever sits on the first safespot', () => {
        expect([KBD_ROUTE.lairArrival.x, KBD_ROUTE.lairArrival.z]).toEqual([2717, 9802]);
        expect([KBD_ROUTE.dungeonReturn.x, KBD_ROUTE.dungeonReturn.z]).toEqual([3067, 10254]);
        expect(KBD_ROUTE.outLever.tile).toEqual(KBD_LAIR.safespots[0]!);
    });

    test('the ladder up stands beside the dungeon arrival and lands on the surface', () => {
        expect([KBD_ROUTE.upLadder.tile.x, KBD_ROUTE.upLadder.tile.z, KBD_ROUTE.upLadder.locId, KBD_ROUTE.upLadder.op, KBD_ROUTE.upLadder.radius]).toEqual([3069, 10256, 1766, 'Climb-up', 1]);
        expect(KBD_ROUTE.upLadder.tile.distanceTo(KBD_ROUTE.dungeonArrival)).toBe(1);
        expect([KBD_ROUTE.surface.x, KBD_ROUTE.surface.z]).toEqual([3016, 3849]);
    });

    test('inDungeon is the 47_160 square and excludes the lair and the surface', () => {
        expect(KBD_ROUTE.inDungeon(KBD_ROUTE.dungeonArrival)).toBe(true);
        expect(KBD_ROUTE.inDungeon(KBD_ROUTE.lever.tile)).toBe(true);
        expect(KBD_ROUTE.inDungeon({ x: 3008, z: 10240, level: 0 })).toBe(true);
        expect(KBD_ROUTE.inDungeon({ x: 3071, z: 10303, level: 0 })).toBe(true);
        expect(KBD_ROUTE.inDungeon(KBD_ROUTE.lairArrival)).toBe(false);
        expect(KBD_ROUTE.inDungeon(KBD_ROUTE.ladder.tile)).toBe(false);
        expect(KBD_ROUTE.inDungeon(null)).toBe(false);
        expect(KBD_LAIR.inArea(KBD_ROUTE.dungeonArrival)).toBe(false);
    });

    test('every tile sits on level 0', () => {
        const tiles = [KBD_ROUTE.ladder.tile, KBD_ROUTE.dungeonArrival, KBD_ROUTE.lever.tile, KBD_ROUTE.lairArrival, KBD_ROUTE.outLever.tile, KBD_ROUTE.dungeonReturn, KBD_ROUTE.upLadder.tile, KBD_ROUTE.surface, ...KBD_LAIR.safespots, KBD_LAIR.bank];
        expect(tiles.every(t => t.level === 0)).toBe(true);
    });
});

// Why: the derivation needs out/collision.lcnav.gz and the rs2b2t-content maps, and CI carries neither.
describe.skipIf(!inputsPresent(KING_BLACK_DRAGON))('the checked-in KBD derivation (pack-gated)', () => {
    test('the alcove tiles are the two derived safespots nearest the arrival and the anchor is the derived one', () => {
        const derived = derive(KING_BLACK_DRAGON);
        expect([derived.anchor.x, derived.anchor.z]).toEqual([KBD_LAIR.meleeAnchor.x, KBD_LAIR.meleeAnchor.z]);
        expect(derived.safespots.map(s => [s.x, s.z])).toEqual([[2714, 9830], [2716, 9801], [2717, 9801]]);
        expect(derived.spawns.filter(s => s.adult).map(s => [s.x, s.z])).toEqual([[2716, 9817]]);
        expect(derived.spawns.filter(s => !s.adult)).toHaveLength(9);
    }, 60_000);

    test('the area holds every tile the run stands on and the derivation reaches them all from the arrival', () => {
        const derived = derive(KING_BLACK_DRAGON);
        for (const t of [...KBD_LAIR.safespots, KBD_LAIR.meleeAnchor, KBD_ROUTE.lairArrival, KBD_ROUTE.outLever.tile]) {
            expect(derived.reachable.has(`${t.x},${t.z}`)).toBe(true);
            expect(KBD_LAIR.inArea(t)).toBe(true);
        }
        for (const k of derived.outside) {
            const [x, z] = k.split(',').map(Number);
            expect(KBD_LAIR.inArea({ x: x!, z: z!, level: 0 })).toBe(false);
        }
    }, 60_000);
});
