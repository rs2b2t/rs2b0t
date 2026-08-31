import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { SETTINGS as MINER_SETTINGS } from '#/bot/scripts/WestFaladorMiner/WestFaladorMiner.js';
import {
    ANCHOR,
    FALADOR_WEST_BANK,
    HANDLE_BANK,
    HANDLE_POWERMINE,
    MINE_RADIUS,
    ORE_COAL,
    ORE_IRON,
    WALL_AGILITY_NEED,
    WALL_EAST,
    WALL_PIN,
    WALL_WEST,
    bestUsablePickDef,
    canUsePick,
    canUseWallShortcut,
    canWieldPick,
    eastOfWall,
    fmtElapsed,
    fmtXph,
    inMineRadius,
    isBankLoot,
    isBestPickName,
    isCrumblingWall,
    isDropJunk,
    isOreItemName,
    isPickaxeName,
    locMatchesOre,
    oreLine,
    parseRockChat,
    pickDefByName,
    pickRank,
    shouldDropWhenPowermining,
    wallClimbOp,
    wallShortcutStatus,
    wantedOres,
    westOfWall
} from '#/bot/scripts/WestFaladorMiner/WestFaladorMinerLogic.js';

function loc(name: string, x: number, z: number, actions: string[]) {
    return {
        name,
        actions: () => actions,
        tile: () => new Tile(x, z, 0)
    };
}

describe('West Falador mine pins', () => {
    test('pins the mine, broken wall, and Falador west bank', () => {
        expect(ANCHOR).toEqual(new Tile(2907, 3359, 0));
        expect(MINE_RADIUS).toBe(30);
        expect(WALL_PIN).toEqual(new Tile(2935, 3355, 0));
        expect(WALL_WEST).toEqual(new Tile(2934, 3355, 0));
        expect(WALL_EAST).toEqual(new Tile(2936, 3355, 0));
        expect(FALADOR_WEST_BANK).toEqual(new Tile(2946, 3368, 0));
        expect(WALL_AGILITY_NEED).toBe(5);
    });

    test('the mine leash covers the camp and not the bank', () => {
        expect(inMineRadius(ANCHOR)).toBe(true);
        expect(inMineRadius(new Tile(2907 + MINE_RADIUS, 3359, 0))).toBe(true);
        expect(inMineRadius(new Tile(2907 + MINE_RADIUS + 1, 3359, 0))).toBe(false);
        expect(inMineRadius(FALADOR_WEST_BANK)).toBe(false);
    });
});

describe('broken wall needs Agility 5', () => {
    test('Climb-over is gated at Agility 5', () => {
        expect(canUseWallShortcut(4)).toBe(false);
        expect(canUseWallShortcut(5)).toBe(true);
        expect(canUseWallShortcut(99)).toBe(true);
        expect(wallShortcutStatus(4)).toContain('OFF');
        expect(wallShortcutStatus(4)).toContain('need Agility 5');
        expect(wallShortcutStatus(5)).toContain('ON');
    });

    test('west of the wall is the mine side; east is Falador', () => {
        expect(westOfWall(ANCHOR)).toBe(true);
        expect(westOfWall(WALL_WEST)).toBe(true);
        expect(westOfWall(WALL_EAST)).toBe(false);
        expect(westOfWall(FALADOR_WEST_BANK)).toBe(false);
        expect(eastOfWall(FALADOR_WEST_BANK)).toBe(true);
        expect(eastOfWall(WALL_EAST)).toBe(true);
        expect(eastOfWall(ANCHOR)).toBe(false);
        expect(eastOfWall(new Tile(2936, 3355, 1))).toBe(false);
    });

    test('matches the crumbling / broken wall at the pin and ignores distant walls', () => {
        const wall = loc('Crumbling wall', 2935, 3355, ['Climb-over', 'Examine']);
        expect(wallClimbOp(wall)).toBe('Climb-over');
        expect(isCrumblingWall(wall)).toBe(true);

        const broken = loc('Broken wall', 2935, 3355, ['Climb-over']);
        expect(isCrumblingWall(broken)).toBe(true);

        const far = loc('Crumbling wall', 2907, 3359, ['Climb-over']);
        expect(isCrumblingWall(far)).toBe(false);

        const shut = loc('Crumbling wall', 2935, 3355, ['Examine']);
        expect(isCrumblingWall(shut)).toBe(false);
    });
});

describe('ore and loot rules', () => {
    test('classifies ore, dwarf junk, pickaxes, and bank loot', () => {
        expect(isOreItemName('Coal')).toBe(true);
        expect(isOreItemName('Iron ore')).toBe(true);
        expect(isOreItemName('Copper ore')).toBe(true);
        expect(isOreItemName('Tin ore')).toBe(true);
        expect(isDropJunk('Beer')).toBe(true);
        expect(isDropJunk('Kebab')).toBe(true);
        expect(isDropJunk('Beer keg')).toBe(false);
        expect(isPickaxeName('Rune pickaxe')).toBe(true);
        expect(isBankLoot('Uncut sapphire')).toBe(true);
        expect(isBankLoot('Casket')).toBe(true);
        expect(isBankLoot('Coal')).toBe(false);
        expect(isBankLoot('Rune pickaxe')).toBe(false);
        expect(isBankLoot('Beer')).toBe(false);
        expect(shouldDropWhenPowermining('Coal')).toBe(true);
        expect(shouldDropWhenPowermining('Uncut sapphire')).toBe(false);
    });

    test('prefers Coal over Iron and filters by Mining level', () => {
        expect(oreLine([ORE_COAL, ORE_IRON])).toBe('Coal+Iron');
        expect(wantedOres([ORE_COAL, ORE_IRON], 14).map(o => o.id)).toEqual([]);
        expect(wantedOres([ORE_COAL, ORE_IRON], 15).map(o => o.id)).toEqual(['iron']);
        expect(wantedOres([ORE_COAL, ORE_IRON], 30).map(o => o.id)).toEqual(['coal', 'iron']);
    });

    test('names a coal loc and ignores a tin loc for the coal tick', () => {
        const coal = loc('Rocks', 2907, 3359, ['Mine', 'Prospect']);
        expect(locMatchesOre({ ...coal, name: 'Coal rocks' }, ORE_COAL)).toBe(true);
        expect(locMatchesOre({ ...coal, name: 'Tin rocks' }, ORE_COAL)).toBe(false);
    });

    test('parses prospect chat', () => {
        expect(parseRockChat('This rock contains Coal.')).toBe('coal');
        expect(parseRockChat('This rock contains iron.')).toBe('iron');
        expect(parseRockChat('There is no ore left in this rock.')).toBe('empty');
        expect(parseRockChat('You examine the rock for ores...')).toBeNull();
        expect(parseRockChat('This rock contains mithril.')).toBe('other');
    });
});

describe('pickaxes', () => {
    test('picks the best Mining-usable pick and gates wield on Attack', () => {
        const rune = pickDefByName('Rune pickaxe');
        const steel = pickDefByName('Steel pickaxe');
        expect(rune?.mining).toBe(41);
        expect(canUsePick(rune, 40)).toBe(false);
        expect(canUsePick(rune, 41)).toBe(true);
        expect(canWieldPick(rune, 39)).toBe(false);
        expect(canWieldPick(rune, 40)).toBe(true);
        expect(pickRank(rune)).toBeLessThan(pickRank(steel));
        expect(isBestPickName('Runite pickaxe', rune)).toBe(true);
        expect(bestUsablePickDef(20, d => d.name === 'Mithril pickaxe' || d.name === 'Steel pickaxe')?.name).toBe('Steel pickaxe');
        expect(bestUsablePickDef(21, d => d.name === 'Mithril pickaxe' || d.name === 'Steel pickaxe')?.name).toBe('Mithril pickaxe');
    });
});

describe('panel settings', () => {
    test('puts the Agility 5 broken-wall requirement first and in Handling help', () => {
        expect(Object.keys(MINER_SETTINGS)[0]).toBe('brokenWall');
        expect(MINER_SETTINGS.brokenWall).toMatchObject({
            type: 'string',
            default: 'Agility 5 required',
            options: ['Agility 5 required'],
            group: 'Requirements'
        });
        expect(MINER_SETTINGS.brokenWall.label).toMatch(/broken wall/i);
        expect(MINER_SETTINGS.brokenWall.help).toMatch(/Agility 5/i);
        expect(MINER_SETTINGS.handling.help).toMatch(/Agility 5/i);
        expect(MINER_SETTINGS.handling).toMatchObject({
            type: 'string',
            default: HANDLE_BANK,
            options: [HANDLE_POWERMINE, HANDLE_BANK]
        });
        expect(MINER_SETTINGS.mineCoal).toMatchObject({ type: 'boolean', default: true });
        expect(MINER_SETTINGS.mineIron).toMatchObject({ type: 'boolean', default: true });
        expect(MINER_SETTINGS.mineCopper).toMatchObject({ type: 'boolean', default: false });
        expect(MINER_SETTINGS.mineTin).toMatchObject({ type: 'boolean', default: false });
    });
});

describe('overlay helpers', () => {
    test('formats rates', () => {
        expect(fmtElapsed(65_000)).toBe('1:05');
        expect(fmtXph(12_340)).toBe('12.3k');
        expect(fmtXph(120_000)).toBe('120k');
    });
});
