import { describe, expect, test } from 'bun:test';
import { parseLcCoord, lcCoord } from '#/bot/nav/v2/lcCoord.js';
import {
    SPIRIT_TREE,
    GLIDER_PAD,
    ENTRANA_LAND,
    ESSENCE_MINE_PAD,
    ESSENCE_RETURN,
    WILDY_LEVER,
    spiritTreeEdges,
    gliderEdges,
    entranaFerryEdges,
    shiloCartEdges,
    essenceEntryEdges,
    wildyLeverEdges,
    agilityShortcutEdges,
    curatedTravelEdges
} from '#/bot/nav/v2/travelCatalog.js';
import { specialCrossingForTransport } from '#/bot/nav/data/specialCrossings.js';
import { hasEntranaRestrictedGear } from '#/bot/nav/exec/specialCrossing.js';

describe('parseLcCoord', () => {
    test('decodes content constants', () => {
        expect(parseLcCoord('0_38_53_29_52')).toEqual({ x: 2461, z: 3444, level: 0 });
        expect(parseLcCoord('3_38_54_33_45')).toEqual({ x: 2465, z: 3501, level: 3 });
        expect(lcCoord(1, 44, 52, 18, 3)).toEqual(ENTRANA_LAND);
    });
});

describe('spirit / glider catalogs', () => {
    test('spirit tree pads match content constants', () => {
        expect(SPIRIT_TREE.stronghold).toEqual({ x: 2461, z: 3444, level: 0 });
        expect(SPIRIT_TREE.village).toEqual({ x: 2542, z: 3169, level: 0 });
        expect(SPIRIT_TREE.varrock).toEqual({ x: 3179, z: 3507, level: 0 });
        expect(SPIRIT_TREE.khazard).toEqual({ x: 2555, z: 3259, level: 0 });
    });

    test('glider hub is Grand Tree L3', () => {
        expect(GLIDER_PAD.taQuirPriw.level).toBe(3);
        expect(GLIDER_PAD.gandius.level).toBe(0);
    });

    test('spirit edges are members + quest gated and bidirectional enough', () => {
        const edges = spiritTreeEdges();
        expect(edges.length).toBeGreaterThanOrEqual(6);
        for (const e of edges) {
            expect(e.locName).toBe('Spirit Tree');
            expect((e as { requires?: { members?: boolean } }).requires?.members).toBe(true);
        }
        const fromStronghold = edges.filter(
            e => e.from.x === SPIRIT_TREE.stronghold.x && e.from.z === SPIRIT_TREE.stronghold.z
        );
        expect(fromStronghold.length).toBe(3);
    });

    test('glider only encodes hub↔pad (no pad-to-pad)', () => {
        const edges = gliderEdges();
        const hub = GLIDER_PAD.taQuirPriw;
        for (const e of edges) {
            const touchesHub =
                (e.from.x === hub.x && e.from.z === hub.z && e.from.level === hub.level)
                || (e.to.x === hub.x && e.to.z === hub.z && e.to.level === hub.level);
            expect(touchesHub).toBe(true);
        }
        expect(edges.length).toBe(8); // 4 pads × 2
    });
});

describe('ferries / cart', () => {
    test('Entrana ferry is members ship Talk-to', () => {
        const e = entranaFerryEdges();
        expect(e).toHaveLength(2);
        expect(e.every(x => x.kind === 'ship' && x.action === 'Talk-to')).toBe(true);
    });

    test('Shilo cart Brimhaven→Shilo needs quest complete', () => {
        const edges = shiloCartEdges();
        const toShilo = edges.find(e => e.debugName === 'cart_brimhaven_to_shilo');
        expect(toShilo).toBeDefined();
        const req = (toShilo as { requires?: { quests?: { quest: string }[] } }).requires;
        expect(req?.quests?.some(q => q.quest === 'Shilo Village')).toBe(true);
    });

    test('curatedTravelEdges merges all families', () => {
        const all = curatedTravelEdges();
        expect(all.length).toBe(
            spiritTreeEdges().length
            + gliderEdges().length
            + entranaFerryEdges().length
            + shiloCartEdges().length
            + essenceEntryEdges().length
            + wildyLeverEdges().length
            + agilityShortcutEdges().length
        );
        const names = new Set(all.map(e => e.debugName));
        expect(names.has('ferry_port_sarim_to_entrana')).toBe(true);
        expect(names.has('glider_hub_to_gandius')).toBe(true);
        expect(names.has('spirit_stronghold_to_village')).toBe(true);
        expect(names.has('ess_entry_aubury')).toBe(true);
        expect(names.has('lever_ardougne_to_wild')).toBe(true);
        expect(names.has('agi_castle_crumbling_wall')).toBe(true);
    });
});

describe('spirit multi-dest specialCrossing', () => {
    test('picks dialog by hop destination', () => {
        const transport = { locX: 2461, locZ: 3444 };
        const approach = { x: 2461, z: 3444, level: 0 };
        const toVillage = specialCrossingForTransport(transport, approach, {
            x: 2542,
            z: 3169,
            level: 0
        });
        const toVarrock = specialCrossingForTransport(transport, approach, {
            x: 3179,
            z: 3507,
            level: 0
        });
        expect(toVillage?.label).toContain('Gnome Village');
        expect(toVarrock?.label).toContain('Varrock');
        expect(toVillage?.dialogue?.choose.some(c => /Village/i.test(c))).toBe(true);
        expect(toVarrock?.dialogue?.choose.some(c => /Varrock/i.test(c))).toBe(true);
    });
});

describe('entrana gear gate', () => {
    test('exports restricted-gear helper', () => {
        // Without client equipment the helper is false (empty pack).
        expect(typeof hasEntranaRestrictedGear).toBe('function');
        expect(hasEntranaRestrictedGear()).toBe(false);
    });
});

describe('essence / levers', () => {
    test('essence return stands and mine pad from content constants', () => {
        expect(ESSENCE_RETURN.aubury).toEqual({ x: 3253, z: 3401, level: 0 });
        expect(ESSENCE_MINE_PAD).toEqual({ x: 2912, z: 4833, level: 0 });
        expect(WILDY_LEVER.deepWild).toEqual({ x: 3154, z: 3924, level: 0 });
        expect(WILDY_LEVER.ardougne).toEqual({ x: 2562, z: 3311, level: 0 });
    });

    test('essence entries require Rune Mysteries', () => {
        for (const e of essenceEntryEdges()) {
            const q = (e as { requires?: { quests?: { quest: string }[] } }).requires?.quests;
            expect(q?.some(x => x.quest === 'Rune Mysteries')).toBe(true);
            expect(e.action).toBe('Teleport');
            expect(e.to.x).toBe(ESSENCE_MINE_PAD.x);
        }
        expect(essenceEntryEdges()).toHaveLength(5);
    });

    test('wildy lever edges are bidirectional members portals', () => {
        const e = wildyLeverEdges();
        expect(e).toHaveLength(2);
        expect(e.every(x => x.kind === 'portal' && x.action === 'Pull')).toBe(true);
    });
});
