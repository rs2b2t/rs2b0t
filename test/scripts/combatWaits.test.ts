import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import HillGiant from '#/bot/scripts/HillGiant/HillGiant.js';
import BrimhavenMossGiants from '#/bot/scripts/BrimhavenMossGiants/BrimhavenMossGiants.js';
import { ArmAutocast } from '#/bot/scripts/BrimhavenMossGiants/combat.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';

afterEach(() => mock.restore());

for (const attachedAt of [0, 1, 4]) {
    test(`autocast opens the chooser when the staff tab attaches at tick ${attachedAt}`, async () => {
        let tick = 0;
        let panel = 328;
        let mode = 0;
        const clicks: number[] = [];
        spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
        spyOn(Execution, 'delayUntilTicks').mockImplementation(async (ready, n) => {
            for (let i = 0; !ready() && i < n; i++) tick++;
            return ready();
        });
        spyOn(Execution, 'delayUntil').mockImplementation(async ready => ready());
        spyOn(Game, 'openSideTab').mockResolvedValue(true);
        spyOn(reader, 'sideTabInterface').mockImplementation(() => tick >= attachedAt ? panel : -1);
        spyOn(reader, 'varp').mockImplementation(() => mode);
        spyOn(actions, 'ifButton').mockImplementation(id => {
            clicks.push(tick);
            if (id === 353) panel = 1829;
            else mode = id === 349 ? 3 : 2;
            return true;
        });
        const bot = new BrimhavenMossGiants();
        bot.bindLog(() => {});
        await new ArmAutocast(bot).execute();
        expect(clicks).toEqual(attachedAt <= 3 ? Array(3).fill(attachedAt) : []);
        expect(tick).toBe(Math.min(attachedAt, 3));
    });
}

test('HillGiant releases the fight task as soon as the tracked giant despawns', async () => {
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    const wait = spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(reader, 'npcs').mockReturnValue([]);
    const bot = new HillGiant();
    bot.bindLog(() => {});
    try {
        await bot.onStart();
        const fight = bot['tasks'].find(t => t.constructor.name === 'Fight')!;
        Object.assign(fight, { targetIdx: 7 });
        const kill = spyOn(bot, 'countKill');
        await fight.execute();
        expect(kill).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    } finally {
        bot.disposeSubscriptions();
    }
});

for (const visibleAt of [0, 1, 3]) {
    test(`uses the cell door when it appears at tick ${visibleAt}`, async () => {
        const { leaveCell } = await import('#/bot/api/combat/hunting/supply.js');
        const { default: JiveKBD } = await import('#/bot/scripts/JiveKBD/JiveKBD.js');
        const { Input } = await import('#/bot/input/Input.js');
        let tick = 0;
        const clicks: number[] = [];
        let tile = { x: 2931, z: 9689, level: 0 };
        spyOn(Game, 'tile').mockImplementation(() => tile);
        spyOn(reader, 'toLocal').mockReturnValue({ lx: 2, lz: 2 });
        spyOn(reader, 'locs').mockImplementation(() => tick < visibleAt ? [] : [{
            id: 2631, typecode: 2, tile, name: 'Door', ops: ['Open'], distance: 1
        }]);
        spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
        spyOn(Input, 'interactLoc').mockImplementation(() => {
            clicks.push(tick);
            tile = { ...tile, z: 9690 };
            return true;
        });
        const bot = new JiveKBD();
        bot.bindLog(() => {});
        expect(await leaveCell(bot)).toBe(visibleAt <= 2);
        expect(clicks).toEqual(visibleAt <= 2 ? [visibleAt] : []);
        expect(tick).toBe(Math.min(visibleAt, 2));
    });
}

test('opens the next dungeon gate as soon as the first gate changes', async () => {
    const { default: ChaosDruidKiller } = await import('#/bot/scripts/ChaosDruidKiller/ChaosDruidKiller.js');
    const { Input } = await import('#/bot/input/Input.js');
    let tick = 0;
    const tile = { x: 3131, z: 9911, level: 0 };
    spyOn(reader, 'locs').mockImplementation(() => tick < 1 ? [{ id: 42, typecode: 2, tile, name: 'Gate', ops: ['Open'], distance: 1 }] : []);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 2, lz: 2 });
    const click = spyOn(Input, 'interactLoc').mockReturnValue(true);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (ready, max) => {
        for (let i = 0; !ready() && i < max; i++) tick++;
        return ready();
    });
    const bot = new ChaosDruidKiller();
    bot.bindLog(() => {});
    await bot['openNearestGate']();
    expect(click).toHaveBeenCalledTimes(1);
    expect(tick).toBe(1);
});

test('a moss giant that disappears before the combat bar appears releases the loot phase', async () => {
    const { Fight } = await import('#/bot/scripts/BrimhavenMossGiants/attack.js');
    const { Skills } = await import('#/bot/api/skills/Skills.js');
    const { Input } = await import('#/bot/input/Input.js');
    const { FIELD_TILE } = await import('#/bot/scripts/BrimhavenMossGiants/config.js');
    let alive = true;
    spyOn(Game, 'tile').mockReturnValue(FIELD_TILE);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Skills, 'hpFraction').mockReturnValue(1);
    spyOn(reader, 'inventory').mockReturnValue([]);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(reader, 'npcs').mockImplementation(() => alive ? [{
        index: 7, id: 112, anim: -1, name: 'Moss giant', level: 42, size: 2, tile: FIELD_TILE,
        distance: 1, ops: ['Attack'], inCombat: false, health: 1, totalHealth: 60, faceEntity: -1
    }] : []);
    spyOn(Input, 'interactNpc').mockImplementation(() => { alive = false; return true; });
    const observations: boolean[] = [];
    spyOn(Execution, 'delayUntil').mockImplementation(async ready => {
        const result = ready();
        observations.push(result);
        return result;
    });
    const bot = new BrimhavenMossGiants();
    bot.bindLog(() => {});
    await new Fight(bot).execute();
    expect(observations).toEqual([true]);
    expect(bot.kills()).toBe(1);
});

test('takes a respawned brass key on its first visible tick', async () => {
    const { KEY_SPAWN } = await import('#/bot/scripts/HillGiant/HillGiantLogic.js');
    const { Input } = await import('#/bot/input/Input.js');
    let tick = 0;
    let taken = false;
    const bot = new HillGiant();
    bot.bindLog(() => {});
    spyOn(Game, 'tile').mockReturnValue(KEY_SPAWN);
    spyOn(bot, 'hasBrassKey').mockImplementation(() => taken);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 2, lz: 2 });
    spyOn(reader, 'groundItems').mockImplementation(() => tick < 1 ? [] : [{
        id: 983, name: 'Brass key', tile: KEY_SPAWN, ops: ['Take'], distance: 0, count: 1
    }]);
    spyOn(Input, 'takeObj').mockImplementation(() => { taken = true; return true; });
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
    spyOn(Execution, 'delayUntil').mockImplementation(async ready => ready());
    expect(await bot.goGetKey()).toBe(true);
    expect(tick).toBe(1);
});

test('the giant fight rechecks a live target every server tick', async () => {
    const { Fight } = await import('#/bot/scripts/BrimhavenMossGiants/attack.js');
    const { Skills } = await import('#/bot/api/skills/Skills.js');
    const { FIELD_TILE } = await import('#/bot/scripts/BrimhavenMossGiants/config.js');
    let tick = 0;
    spyOn(EventSignal, 'pending').mockImplementation(() => tick >= 1);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
    spyOn(Game, 'tile').mockReturnValue(FIELD_TILE);
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(Skills, 'hpFraction').mockReturnValue(1);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(reader, 'inventory').mockReturnValue([]);
    spyOn(reader, 'npcs').mockReturnValue([{
        index: 7, id: 112, anim: -1, name: 'Moss giant', level: 42, size: 2, tile: FIELD_TILE,
        distance: 1, ops: ['Attack'], inCombat: true, health: 10, totalHealth: 60, faceEntity: -1
    }]);
    await new Fight(new BrimhavenMossGiants()).execute();
    expect(tick).toBe(1);
});

test('a healthy RockCrab reset starts the return walk as soon as it reaches the reset tile', async () => {
    const { default: RockCrab } = await import('#/bot/scripts/RockCrab/RockCrab.js');
    const { Skills } = await import('#/bot/api/skills/Skills.js');
    const { Traversal } = await import('#/bot/api/walking/Traversal.js');
    const bot = new RockCrab();
    bot.bindLog(() => {});
    let tick = 0;
    const walks: number[] = [];
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Skills, 'hpFraction').mockReturnValue(1);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { walks.push(tick); return true; });
    try {
        await bot.onStart();
        await bot['tasks'].find(t => t.constructor.name === 'ResetAggro')!.execute();
        expect(walks).toEqual([0, 0]);
    } finally { bot.disposeSubscriptions(); }
});
