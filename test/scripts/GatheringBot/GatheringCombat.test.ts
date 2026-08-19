import { afterEach, describe, expect, test } from 'bun:test';

import { reader, type PlayerSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Game, PLAYER_FACE_BASE } from '#/bot/api/game/Game.js';
import { MINING_LOCATIONS } from '#/bot/data/miningLocations.js';
import { Player } from '#/bot/api/model/Player.js';
import type GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import {
    gatheringCombatPolicy,
    incomingPlayerAttacker,
    wildernessMinerAt,
    wildernessMinerStanceNeeded
} from '#/bot/scripts/GatheringBot/GatheringBotLogic.js';
import { MaintainWildernessMinerStance } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';

const originalSelfSlot = reader.selfSlot;
const originalAutoRetaliateOn = Game.autoRetaliateOn;
const originalSetAutoRetaliate = Game.setAutoRetaliate;

afterEach(() => {
    reader.selfSlot = originalSelfSlot;
    Game.autoRetaliateOn = originalAutoRetaliateOn;
    Game.setAutoRetaliate = originalSetAutoRetaliate;
});

function snapshot(faceEntity: number, inCombat = true): PlayerSnapshot {
    return {
        index: 12,
        name: 'Incoming player',
        tile: { x: 3019, z: 3590, level: 0 },
        distance: 1,
        inCombat,
        faceEntity
    };
}

describe('live incoming-player combat signal', () => {
    test('Player.targetsMe uses the loaded player face target and clears live', () => {
        reader.selfSlot = () => 7;
        const snap = snapshot(PLAYER_FACE_BASE + 7);
        const player = new Player(snap);

        expect(player.targetsMe()).toBe(true);
        expect(incomingPlayerAttacker([player])).toBe(true);

        snap.faceEntity = PLAYER_FACE_BASE + 8;
        expect(player.targetsMe()).toBe(false);
        expect(incomingPlayerAttacker([player])).toBe(false);

        snap.faceEntity = PLAYER_FACE_BASE + 7;
        snap.inCombat = false;
        expect(player.targetsMe()).toBe(true);
        // The attacker need not receive a hitmark. FleeCombat separately gates
        // this face-target signal on the victim's local Game.inCombat() state.
        expect(incomingPlayerAttacker([player])).toBe(true);

        snap.faceEntity = -1;
        expect(incomingPlayerAttacker([player])).toBe(false);
    });

    test('ignores idle players and an empty loaded-player list', () => {
        reader.selfSlot = () => 7;
        expect(incomingPlayerAttacker([])).toBe(false);
        expect(incomingPlayerAttacker([new Player(snapshot(-1, false))])).toBe(false);
    });
});

describe('Wilderness Miner combat ownership', () => {
    const catalog = [
        'Lava Maze Runite Mine',
        'Wilderness Hobgoblin Mine',
        'Wilderness Skeleton Mine'
    ];

    test('all three catalog Wilderness camps use the canonical override', () => {
        for (const name of catalog) {
            const location = MINING_LOCATIONS.find(candidate => candidate.name === name);
            expect(location).toBeDefined();
            expect(wildernessMinerAt({ isMiner: true, tile: location?.spot ?? null })).toBe(true);
        }
    });

    test('the catalog Edgeville Dungeon Mine is excluded', () => {
        const location = MINING_LOCATIONS.find(
            candidate => candidate.name === 'Edgeville Dungeon Mine'
        );
        expect(location).toBeDefined();
        expect(wildernessMinerAt({ isMiner: true, tile: location?.spot ?? null })).toBe(false);
    });

    test('NPC combat stays with Gather; a live player attacker switches to Flee', () => {
        const common = {
            isMiner: true,
            tile: { x: 3018, z: 3590, level: 0 },
            autoLocation: false,
            tickManipAllowCombat: false
        };
        expect(
            gatheringCombatPolicy({ ...common, incomingPlayerAttacker: false })
        ).toEqual({
            mode: 'wilderness-miner-npc',
            allowGather: true,
            flee: false
        });
        expect(
            gatheringCombatPolicy({ ...common, incomingPlayerAttacker: true })
        ).toEqual({
            mode: 'wilderness-miner-player',
            allowGather: false,
            flee: true
        });
    });
});

describe('Wilderness Miner stance maintenance', () => {
    test('activates on entry and again after a relog restores Auto Retaliate', () => {
        const common = {
            isMiner: true,
            tickManipAllowCombat: false
        };
        expect(
            wildernessMinerStanceNeeded({
                ...common,
                tile: { x: 3094, z: 3493, level: 0 },
                autoRetaliateOn: true
            })
        ).toBe(false);
        expect(
            wildernessMinerStanceNeeded({
                ...common,
                tile: { x: 3018, z: 3590, level: 0 },
                autoRetaliateOn: true
            })
        ).toBe(true);
        expect(
            wildernessMinerStanceNeeded({
                ...common,
                tile: { x: 3018, z: 3590, level: 0 },
                autoRetaliateOn: false
            })
        ).toBe(false);
        // A relog restores the varp to ON, so the same live state becomes actionable again.
        expect(
            wildernessMinerStanceNeeded({
                ...common,
                tile: { x: 3018, z: 3590, level: 0 },
                autoRetaliateOn: true
            })
        ).toBe(true);
    });

    test('never overrides an explicit tick-manip combat stance', () => {
        expect(
            wildernessMinerStanceNeeded({
                isMiner: true,
                tile: { x: 3018, z: 3590, level: 0 },
                tickManipAllowCombat: true,
                autoRetaliateOn: true
            })
        ).toBe(false);
    });

    test('also restores the Desert Mining Camp stance after relogin', () => {
        expect(wildernessMinerStanceNeeded({
            isMiner: true,
            tile: { x: 3323, z: 9458, level: 0 },
            tickManipAllowCombat: false,
            autoRetaliateOn: true,
            desertCampMiner: true
        })).toBe(true);
    });

    test('the maintenance task sends one OFF toggle per restored stance', async () => {
        let retaliateOn = true;
        const toggles: boolean[] = [];
        Game.autoRetaliateOn = () => retaliateOn;
        Game.setAutoRetaliate = enabled => {
            toggles.push(enabled);
            retaliateOn = enabled;
            return true;
        };
        const bot = {
            wildernessMinerStanceNeeded: () => retaliateOn,
            setStatus: () => {},
            log: () => {}
        } as unknown as GatheringBot;
        const task = new MaintainWildernessMinerStance(bot);

        expect(task.validate()).toBe(true);
        await task.execute();
        expect(toggles).toEqual([false]);
        expect(task.validate()).toBe(false);

        retaliateOn = true;
        expect(task.validate()).toBe(true);
        await task.execute();
        expect(toggles).toEqual([false, false]);
    });
});
