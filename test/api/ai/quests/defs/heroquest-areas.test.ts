import { describe, expect, test } from 'bun:test';

import {
    HERO_TILE,
    inBrimhavenHq,
    inDeepDungeon,
    inGarden,
    inKitchen,
    inMansion,
    inSideRoom,
    inStoreCorridor,
    inTreasureRoom,
    inVelrakCell,
    inWestWing,
    inYard,
    onEntrana
} from '#/bot/api/ai/quests/defs/heroquest/areas.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';

const at = (x: number, z: number, level = 0): WorldTile => ({ x, z, level } as WorldTile);

// Why: every box is a flood of the collision pack — the Brimhaven mansion is six sealed pockets and a
// distance test calls the two sides of one wall the same place.
const POCKETS = [
    { name: 'kitchen', test: inKitchen, seed: at(2789, 3191), size: 26 },
    { name: 'garden', test: inGarden, seed: at(2784, 3194), size: 42 },
    { name: 'yard', test: inYard, seed: at(2781, 3196), size: 9 },
    { name: 'sideroom', test: inSideRoom, seed: at(2781, 3197), size: 5 },
    { name: 'mansion', test: inMansion, seed: at(2774, 3192), size: 82 },
    { name: 'treasure', test: inTreasureRoom, seed: at(2765, 3198), size: 17 },
    { name: 'corridor', test: inStoreCorridor, seed: at(2771, 3198), size: 8 }
] as const;

describe("hero's quest Brimhaven pockets", () => {
    for (const pocket of POCKETS) {
        test(`the ${pocket.name} seed is in the ${pocket.name}`, () => {
            expect(pocket.test(pocket.seed)).toBe(true);
        });
    }

    test('no tile belongs to two pockets', () => {
        for (const pocket of POCKETS) {
            const others = POCKETS.filter(p => p !== pocket);
            for (const other of others) {
                expect(other.test(pocket.seed)).toBe(false);
            }
        }
    });

    // Why: the two sides of `pete_sidedoor` are one tile apart and belong to different pockets.
    test('the side door separates the yard from the side room', () => {
        expect(inYard(at(2781, 3196))).toBe(true);
        expect(inSideRoom(at(2781, 3196))).toBe(false);
        expect(inSideRoom(at(2781, 3197))).toBe(true);
        expect(inYard(at(2781, 3197))).toBe(false);
    });

    // Why: `snipable_wall` at (2780,3198) carries blockrange=no — the slit is the only line onto Grip.
    test('the arrow slit is in the side room and the lure tile is in the mansion', () => {
        expect(inSideRoom(HERO_TILE.ARROW_SLIT)).toBe(true);
        expect(inMansion(HERO_TILE.GRIP_LURE as unknown as WorldTile)).toBe(true);
        expect(inSideRoom(HERO_TILE.GRIP_LURE as unknown as WorldTile)).toBe(false);
    });

    test('the west wing is inside what Garv seals, and the treasure room is not', () => {
        expect(inWestWing(at(2762, 3194))).toBe(true);
        expect(inMansion(at(2762, 3194))).toBe(true);
        expect(inTreasureRoom(at(2762, 3194))).toBe(false);
        expect(inMansion(at(2765, 3198))).toBe(false);
    });

    test('each stand tile is in the pocket its loc lives in', () => {
        expect(inMansion(HERO_TILE.CABINET_STAND as unknown as WorldTile)).toBe(true);
        expect(inTreasureRoom(HERO_TILE.CHEST_STAND as unknown as WorldTile)).toBe(true);
        expect(inWestWing(HERO_TILE.TREASURE_DOOR as unknown as WorldTile)).toBe(true);
        expect(inTreasureRoom(HERO_TILE.TREASURE_DOOR_INNER as unknown as WorldTile)).toBe(true);
        expect(inKitchen(HERO_TILE.KITCHEN_PANEL as unknown as WorldTile)).toBe(true);
        expect(inGarden(HERO_TILE.KITCHEN_PANEL_INNER as unknown as WorldTile)).toBe(true);
        expect(inBrimhavenHq(HERO_TILE.GRUBOR_DOOR_INNER as unknown as WorldTile)).toBe(true);
        expect(inBrimhavenHq(HERO_TILE.GRUBOR_DOOR as unknown as WorldTile)).toBe(false);
        expect(inMansion(HERO_TILE.GARV_DOOR_INNER as unknown as WorldTile)).toBe(true);
        expect(inMansion(HERO_TILE.GARV_DOOR as unknown as WorldTile)).toBe(false);
    });

    test('the rendezvous is on the street, outside every pocket', () => {
        const tile = HERO_TILE.RENDEZVOUS as unknown as WorldTile;
        for (const pocket of POCKETS) {
            expect(pocket.test(tile)).toBe(false);
        }
        expect(inBrimhavenHq(tile)).toBe(false);
    });

    test('a null tile is nowhere', () => {
        for (const pocket of POCKETS) {
            expect(pocket.test(null)).toBe(false);
        }
        expect(onEntrana(null)).toBe(false);
    });

    test('Entrana covers the firebird and not Port Sarim', () => {
        expect(onEntrana(HERO_TILE.FIREBIRD as unknown as WorldTile)).toBe(true);
        expect(onEntrana(HERO_TILE.PORT_SARIM_MONK as unknown as WorldTile)).toBe(false);
    });

    test('a first-floor tile is never a ground-floor pocket', () => {
        expect(inMansion(at(2774, 3192, 1))).toBe(false);
        expect(inKitchen(at(2789, 3191, 1))).toBe(false);
    });
});

// Why: the deep dungeon and the rest of Taverley's interleave across x 2881-2923, so the predicate is a
// four-box cover of the flood rather than one rectangle over the pair.
describe("hero's quest Taverley pockets", () => {
    test('the deep gate separates the corridor from the lava eels', () => {
        expect(inDeepDungeon(HERO_TILE.DEEP_GATE_INNER as unknown as WorldTile)).toBe(true);
        expect(inDeepDungeon(HERO_TILE.DEEP_GATE as unknown as WorldTile)).toBe(false);
        expect(inDeepDungeon(HERO_TILE.LAVA_FISH as unknown as WorldTile)).toBe(true);
    });

    test('the cell door separates the jail from the corridor the Jailer patrols', () => {
        expect(inVelrakCell(HERO_TILE.JAIL_DOOR_INNER as unknown as WorldTile)).toBe(true);
        expect(inVelrakCell(HERO_TILE.VELRAK as unknown as WorldTile)).toBe(true);
        expect(inVelrakCell(HERO_TILE.JAIL_DOOR as unknown as WorldTile)).toBe(false);
        expect(inVelrakCell(HERO_TILE.JAILER as unknown as WorldTile)).toBe(false);
    });

    // Why: the chaos druid camp and the dungeon ladder are both in the main component; a predicate that
    // claimed either would strand the herb grind behind a gate it never crossed.
    test('the ladder, the druids and the jail are all outside the deep dungeon', () => {
        expect(inDeepDungeon(HERO_TILE.TAVERLEY_DUNGEON as unknown as WorldTile)).toBe(false);
        expect(inDeepDungeon(HERO_TILE.CHAOS_DRUIDS as unknown as WorldTile)).toBe(false);
        expect(inDeepDungeon(HERO_TILE.JAILER as unknown as WorldTile)).toBe(false);
        expect(inDeepDungeon(HERO_TILE.VELRAK as unknown as WorldTile)).toBe(false);
    });

    test('a null tile and a first-floor tile are in neither', () => {
        expect(inDeepDungeon(null)).toBe(false);
        expect(inVelrakCell(null)).toBe(false);
        expect(inDeepDungeon(at(2923, 9803, 1))).toBe(false);
        expect(inVelrakCell(at(2931, 9689, 1))).toBe(false);
    });
});
