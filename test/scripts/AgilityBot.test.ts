import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Execution } from '#/bot/api/Execution.js';
import { Game } from '#/bot/api/Game.js';
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { Skills } from '#/bot/api/hud/Skills.js';
import { Locs } from '#/bot/api/queries/Locs.js';
import Tile from '#/bot/api/Tile.js';
import { Traversal } from '#/bot/api/Traversal.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import AgilityBot, { atGnomeCourse, GNOME_COURSE_RADIUS, GNOME_COURSE_START } from '#/bot/scripts/AgilityBot.js';

const COURSE = 'Log balance,Obstacle net,Tree branch,Balancing rope,Tree branch,Obstacle net,Obstacle pipe';

const original = {
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil,
    ingame: Game.ingame,
    tile: Game.tile,
    canContinue: ChatDialog.canContinue,
    agilityXp: Skills.xp,
    locQuery: Locs.query,
    walkResilient: Traversal.walkResilient
};

let playerTile: Tile;
let locQueries: number;
let walks: Tile[];

function bot(): AgilityBot {
    const instance = new AgilityBot();
    instance.settings = new SettingsBag({ obstacles: COURSE, searchRadius: 20 });
    return instance;
}

beforeEach(() => {
    playerTile = new Tile(3222, 3218, 0);
    locQueries = 0;
    walks = [];

    Game.ingame = () => true;
    Game.tile = () => playerTile;
    ChatDialog.canContinue = () => false;
    Skills.xp = () => 0;
    Execution.delayUntil = async condition => condition();
    Execution.delayTicks = async () => {};
    Traversal.walkResilient = async destination => {
        const tile = Tile.from(destination);
        walks.push(tile);
        playerTile = tile;
        return true;
    };
    Locs.query = (() => {
        locQueries++;
        const query = {
            where: () => query,
            nearest: () => null
        };
        return query;
    }) as unknown as typeof Locs.query;
});

afterEach(() => {
    Execution.delayTicks = original.delayTicks;
    Execution.delayUntil = original.delayUntil;
    Game.ingame = original.ingame;
    Game.tile = original.tile;
    ChatDialog.canContinue = original.canContinue;
    Skills.xp = original.agilityXp;
    Locs.query = original.locQuery;
    Traversal.walkResilient = original.walkResilient;
});

describe('GnomeCourse travel', () => {
    test('recognises the whole course on every obstacle plane', () => {
        expect(atGnomeCourse(GNOME_COURSE_START)).toBe(true);
        expect(atGnomeCourse(new Tile(2487, 3426, 0))).toBe(true);
        expect(atGnomeCourse(new Tile(2478, 3420, 2))).toBe(true);
        expect(atGnomeCourse(new Tile(GNOME_COURSE_START.x + GNOME_COURSE_RADIUS + 1, GNOME_COURSE_START.z, 0))).toBe(false);
        expect(atGnomeCourse(new Tile(3222, 3218, 0))).toBe(false);
    });

    test('web-walks before searching for obstacles, then stays at the course', async () => {
        const instance = bot();
        await instance.onStart();

        await instance.loop();
        expect(walks).toEqual([GNOME_COURSE_START]);
        expect(locQueries).toBe(0);

        await instance.loop();
        expect(walks).toEqual([GNOME_COURSE_START]);
        expect(locQueries).toBeGreaterThan(0);
    });

    test('starts obstacle search without a redundant walk when already inside', async () => {
        playerTile = new Tile(2487, 3426, 0);
        const instance = bot();
        await instance.onStart();

        await instance.loop();

        expect(walks).toEqual([]);
        expect(locQueries).toBeGreaterThan(0);
    });
});
