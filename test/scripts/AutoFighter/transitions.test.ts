import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type NpcSnapshot, type GroundItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Special } from '#/bot/api/combat/Special.js';
import { Input } from '#/bot/input/Input.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import AutoFighter from '#/bot/scripts/AutoFighter/AutoFighter.js';

let bot: AutoFighter;
afterEach(() => { bot?.disposeSubscriptions(); mock.restore(); });
const guard = (index = 2): NpcSnapshot => ({ index, faceEntity: -1, inCombat: false, anim: -1, id: 9, name: 'Guard', level: 21, size: 1,
    tile: { x: 3201, z: 3200, level: 0 }, distance: 1, ops: ['Attack'], health: 10, totalHealth: 20 });

async function scenario(useSpecial = false) {
    const state = { npcs: [guard()], ground: [] as GroundItemSnapshot[], combat: false, now: 10000, event: false, health: 100 };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3200, z: 3200, level: 0 });
    spyOn(Game, 'inCombat').mockImplementation(() => state.combat);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(100);
    spyOn(Skills, 'effective').mockImplementation(() => state.health);
    spyOn(Skills, 'hpFraction').mockImplementation(() => state.health / 100);
    spyOn(reader, 'selfSlot').mockReturnValue(1);
    spyOn(reader, 'selfFaceEntity').mockReturnValue(2);
    spyOn(reader, 'npcs').mockImplementation(() => state.npcs);
    spyOn(reader, 'groundItems').mockImplementation(() => state.ground);
    spyOn(reader, 'inventory').mockReturnValue([]);
    spyOn(reader, 'equipment').mockReturnValue([]);
    spyOn(reader, 'players').mockReturnValue([]);
    spyOn(Sustain, 'set').mockImplementation(() => {});
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(Reachability, 'probeable').mockReturnValue(false);
    spyOn(Reachability, 'walkable').mockReturnValue(true);
    spyOn(Date, 'now').mockImplementation(() => state.now);
    const delays: number[] = [];
    const delay = spyOn(Execution, 'delayTicks').mockImplementation(async ticks => { delays.push(ticks); });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        if (!condition()) state.npcs = [];
        return condition();
    });
    const attack = spyOn(Reach, 'entityOp').mockImplementation(async () => {
        state.combat = true;
        state.npcs[0].health = 0;
        state.ground = [{ id: 995, name: 'Coins', count: 10, ops: ['Take'], tile: guard().tile, distance: 1 }];
        return 'done';
    });
    bot = new AutoFighter();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ target: 'Guard', loot: ['Coins'], foodWithdraw: 0, solveClues: false, useSpecial });
    await bot.onStart();
    const fight = bot['tasks'].find(task => task.constructor.name === 'Fight')!;
    const loot = bot['tasks'].find(task => task.constructor.name === 'LootDrops')!;
    return { state, fight, loot, delays, delay, attack };
}

test('an occupied target is visible in the diagnostics while the fighter waits', async () => {
    const { state, fight } = await scenario();
    state.npcs[0].faceEntity = 32770;
    expect(fight.validate()).toBe(false);
    expect(bot.stallDetails()).toContain('waiting for Guard');
    expect(bot.stallDetails()).toContain('targets another player');
    state.npcs = [];
    expect(bot.stallDetails()).toContain('no matching NPC loaded');
});

test('a confirmed kill releases available loot without waiting for the lingering combat indicator', async () => {
    const { state, fight, loot, delays } = await scenario();
    expect(fight.validate()).toBe(true);
    await fight.execute();
    expect(state.combat).toBe(true);
    expect(loot.validate()).toBe(true);
    expect(delays).toEqual([]);
});

test('a living replacement attacker prevents looting after the previous kill', async () => {
    const { state, fight, loot } = await scenario();
    await fight.execute();
    state.npcs = [{ ...guard(3), faceEntity: 32769, inCombat: true }];
    expect(loot.validate()).toBe(false);
});

test('the next idle target can be attacked after a confirmed kill with no selected loot', async () => {
    const { state, fight, loot } = await scenario();
    await fight.execute();
    state.ground = [];
    state.npcs = [guard(3)];
    expect(loot.validate()).toBe(false);
    expect(fight.validate()).toBe(true);
});

test.each([0, 6600])('a lingering combat bar and facing an idle replacement do not delay Attack after %i ms', async waitForSpawn => {
    const { state, fight, attack } = await scenario();
    await fight.execute();
    state.ground = [];
    state.now += waitForSpawn;
    state.npcs = [guard(3)];
    spyOn(reader, 'selfFaceEntity').mockReturnValue(3);
    attack.mockRestore();
    const click = spyOn(Input, 'interactNpc').mockImplementation(() => {
        state.npcs[0].health = 0;
        return true;
    });
    expect(fight.validate()).toBe(true);
    await fight.execute();
    expect(click.mock.calls.map(([index]) => index)).toEqual([3]);
});

test('despawn during attack confirmation releases the next target on the same update', async () => {
    const { state, fight, attack } = await scenario();
    attack.mockRestore();
    const click = spyOn(Input, 'interactNpc').mockImplementation(index => {
        state.npcs = index === 2 ? [guard(3)] : [];
        state.combat = true;
        return true;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        expect(condition()).toBe(true);
        return true;
    });
    for (let kill = 0; kill < 2; kill++) {
        expect(fight.validate()).toBe(true);
        await fight.execute();
    }
    expect(click.mock.calls.map(([index]) => index)).toEqual([2, 3]);
    expect(bot['kills']).toBe(2);
});

test('a dead NPC still on screen cannot be selected for another attack', async () => {
    const { state, fight } = await scenario();
    state.npcs[0].health = 0;
    expect(fight.validate()).toBe(false);
});

test('combat without a confirmed kill still blocks loot', async () => {
    const { state, loot } = await scenario();
    state.combat = true;
    state.ground = [{ id: 995, name: 'Coins', count: 10, ops: ['Take'], tile: guard().tile, distance: 1 }];
    expect(loot.validate()).toBe(false);
});

test('visible loot releases a dying NPC without waiting for its model to disappear', async () => {
    const { state, fight, loot } = await scenario();
    const wait = spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        expect(condition()).toBe(true);
        return true;
    });
    wait.mockClear();
    await fight.execute();
    expect(state.npcs[0].health).toBe(0);
    expect(wait).not.toHaveBeenCalled();
    expect(loot.validate()).toBe(true);
});

test('another player targeting us preserves the combat gate after a kill', async () => {
    const { fight, loot } = await scenario();
    await fight.execute();
    spyOn(reader, 'players').mockReturnValue([{ index: 4, name: 'Attacker', inCombat: true, tile: { x: 3201, z: 3200, level: 0 }, distance: 1, combatLevel: 100, faceEntity: 32769 }]);
    expect(loot.validate()).toBe(false);
});

test('a new fight closes the post-kill exception before another attack', async () => {
    const { state, fight, loot } = await scenario();
    await fight.execute();
    state.npcs = [guard(3)];
    bot.beginFight();
    expect(loot.validate()).toBe(false);
});

test('a kill during potion sipping still releases loot on the next task pass', async () => {
    const { state, fight, loot, attack } = await scenario();
    attack.mockImplementation(async () => { state.combat = true; return 'done'; });
    spyOn(bot, 'sipPotions').mockImplementation(async () => {
        state.npcs[0].health = 0;
        state.ground = [{ id: 995, name: 'Coins', count: 10, ops: ['Take'], tile: guard().tile, distance: 1 }];
        return true;
    });
    await fight.execute();
    expect(loot.validate()).toBe(true);
    expect(loot.validate()).toBe(true);
    expect(bot['kills']).toBe(1);
});

test('a kill after yielding to eat still releases loot once the target disappears', async () => {
    const { state, fight, loot, attack } = await scenario();
    attack.mockImplementation(async () => { state.combat = true; state.health = 10; return 'done'; });
    await fight.execute();
    state.health = 100;
    state.npcs = [];
    state.ground = [{ id: 995, name: 'Coins', count: 10, ops: ['Take'], tile: guard().tile, distance: 1 }];
    expect(loot.validate()).toBe(true);
});

test('auto-retaliation kills release loot even when the attack task did not start the fight', async () => {
    const { state, loot } = await scenario();
    state.combat = true;
    state.npcs[0].faceEntity = 32769;
    state.npcs[0].inCombat = true;
    expect(loot.validate()).toBe(false);
    state.npcs[0].health = 0;
    state.ground = [{ id: 995, name: 'Coins', count: 10, ops: ['Take'], tile: guard().tile, distance: 1 }];
    expect(loot.validate()).toBe(true);
    expect(bot['kills']).toBe(1);
});

test('the lingering combat flag cannot suppress the actual attack on the next target', async () => {
    const { Input } = await import('#/bot/input/Input.js');
    const { state, fight, attack, delay } = await scenario();
    await fight.execute();
    state.npcs = [guard(3)];
    state.ground = [];
    attack.mockRestore();
    const clicks: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        clicks.push(index);
        state.npcs[0].faceEntity = 32769;
        state.npcs[0].inCombat = true;
        state.event = true;
        return true;
    });
    delay.mockImplementation(async () => { state.event = true; });
    expect(fight.validate()).toBe(true);
    await fight.execute();
    expect(clicks).toEqual([3]);
});

test('a dead target with no visible drop releases the next living target immediately', async () => {
    const { state, fight, attack } = await scenario();
    attack.mockImplementation(async () => { state.combat = true; state.npcs[0].health = 0; return 'done'; });
    const wait = spyOn(Execution, 'delayUntil').mockResolvedValue(false);
    wait.mockClear();
    await fight.execute();
    expect(wait).not.toHaveBeenCalled();
    state.npcs.push(guard(3));
    expect(fight.validate()).toBe(true);
});

test('a one-hit kill finishes attack confirmation even when the NPC never retaliates', async () => {
    const { Input } = await import('#/bot/input/Input.js');
    const { state, fight, attack, delays } = await scenario();
    attack.mockRestore();
    spyOn(Input, 'interactNpc').mockImplementation(() => {
        state.combat = true;
        state.npcs[0].health = 0;
        state.npcs[0].inCombat = true;
        return true;
    });
    await fight.execute();
    expect(bot['kills']).toBe(1);
    expect(delays).toEqual([]);
});

test('the task runner schedules the next decision on the next frame after a kill', async () => {
    await scenario();
    spyOn(Game, 'autoRetaliateOn').mockReturnValue(true);
    spyOn(Game, 'hasCombatStyle').mockReturnValue(true);
    expect(await bot.loop()).toBe(0);
    expect(bot['kills']).toBe(1);
});

test('stall recovery sends Attack even when the NPC is already attacking us', async () => {
    const { Input } = await import('#/bot/input/Input.js');
    const { state, fight, attack, delay } = await scenario();
    bot.resumeAttack = false;
    state.combat = true;
    state.npcs[0].faceEntity = 32769;
    state.npcs[0].inCombat = true;
    state.now += 121_000;
    attack.mockRestore();
    const clicks: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => { clicks.push(index); return true; });
    delay.mockImplementation(async () => { state.event = true; });
    expect(fight.validate()).toBe(true);
    await fight.execute();
    expect(clicks).toEqual([2]);
});

test('ongoing retaliation XP prevents a false stall recovery', async () => {
    const { state, fight } = await scenario();
    bot.resumeAttack = false;
    state.combat = true;
    state.npcs[0].faceEntity = 32769;
    state.npcs[0].inCombat = true;
    state.now += 121_000;
    spyOn(Skills, 'xp').mockReturnValue(20);
    expect(fight.validate()).toBe(false);
});

test.each([true, false])('after two kills the next aggressor gets Attack immediately (first click accepted: %s)', async accepted => {
    const { state, fight, attack, delay } = await scenario();
    for (const index of [2, 3]) {
        state.npcs = [guard(index)];
        expect(fight.validate()).toBe(true);
        await fight.execute();
        state.ground = [];
    }
    state.npcs = [{ ...guard(4), faceEntity: 32769, inCombat: true }];
    attack.mockRestore();
    const started = state.now;
    const clicks: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        expect(index).toBe(4);
        clicks.push(state.now - started);
        if (accepted || clicks.length === 2) spyOn(reader, 'selfFaceEntity').mockReturnValue(index);
        return true;
    });
    delay.mockImplementation(async () => {
        state.now += 600;
        if (state.now - started >= 3000) state.event = true;
    });
    await fight.execute();
    expect(clicks).toEqual(accepted ? [0] : [0, 600]);
    expect(fight.validate()).toBe(false);
});

test('a fresh run takes over an existing fight without waiting for stall recovery', async () => {
    const { Input } = await import('#/bot/input/Input.js');
    const { state, fight, attack, delay } = await scenario();
    state.combat = true;
    state.npcs[0].faceEntity = 32769;
    state.npcs[0].inCombat = true;
    attack.mockRestore();
    const clicks: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => { clicks.push(index); return true; });
    delay.mockImplementation(async () => { state.event = true; });
    expect(fight.validate()).toBe(true);
    await fight.execute();
    expect(clicks).toEqual([2]);
    state.event = false;
    expect(fight.validate()).toBe(false);
});

test.each([true, false])('attacks the next aggressive NPC immediately with a Dragon longsword (already armed: %s)', async alreadyArmed => {
    const { state, fight, attack, delay } = await scenario(true);
    await fight.execute();
    state.ground = [];
    state.npcs = [{ ...guard(3), faceEntity: 32769, inCombat: true }];
    attack.mockRestore();
    spyOn(Game, 'autoRetaliateOn').mockReturnValue(true);
    spyOn(Game, 'hasCombatStyle').mockReturnValue(true);
    spyOn(Special, 'wielded').mockReturnValue('Dragon longsword');
    spyOn(Special, 'energy').mockReturnValue(300);
    let armed = alreadyArmed;
    spyOn(Special, 'armed').mockImplementation(() => armed);
    const actions: string[] = [];
    spyOn(Special, 'arm').mockImplementation(async () => { actions.push('arm'); armed = true; return true; });
    spyOn(Input, 'interactNpc').mockImplementation(index => { actions.push('attack ' + index); return true; });
    delay.mockImplementation(async () => { state.event = true; });
    await bot.loop();
    expect(actions).toEqual(alreadyArmed ? ['attack 3'] : ['attack 3', 'arm']);
});

test('a kill during special confirmation hands the armed attack to the next aggressor', async () => {
    const { state, fight, attack } = await scenario(true);
    spyOn(Game, 'autoRetaliateOn').mockReturnValue(true);
    spyOn(Game, 'hasCombatStyle').mockReturnValue(true);
    spyOn(Special, 'wielded').mockReturnValue('Dragon longsword');
    spyOn(Special, 'energy').mockReturnValue(250);
    let armed = false;
    spyOn(Special, 'armed').mockImplementation(() => armed);
    const arm = spyOn(Special, 'arm').mockImplementation(async () => {
        armed = true;
        state.npcs = [{ ...guard(3), faceEntity: 32769, inCombat: true }];
        return true;
    });
    attack.mockImplementation(async () => {
        state.combat = true;
        state.npcs[0].faceEntity = 32769;
        state.npcs[0].inCombat = true;
        return 'done';
    });
    await fight.execute();
    expect(bot['kills']).toBe(1);
    attack.mockRestore();
    const click = spyOn(Input, 'interactNpc').mockImplementation(() => { state.event = true; return true; });
    await bot.loop();
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.calls[0][0]).toBe(3);
    expect(arm).toHaveBeenCalledTimes(1);
});
