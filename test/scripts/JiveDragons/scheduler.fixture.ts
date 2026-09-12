import { mock, spyOn } from 'bun:test';
import { reader, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { Fight } from '#/bot/scripts/JiveDragons/combat.js';
import { siteFor } from '#/bot/scripts/JiveDragons/sites.js';

export async function scenario(siteId = 'taverley-black', style = 'range', settings: Record<string, string | number | boolean | string[]> = {}) {
    const site = siteFor(siteId);
    const spot = site.safespots[0] ?? site.meleeAnchor;
    const npcs: NpcSnapshot[] = [];
    const state = { now: 10_000, npcs, ground: true, full: false, ammo: 100, takes: 0, drops: 0, walks: 0, attacks: 0 };
    const dragon: NpcSnapshot = {
        index: 17, id: 1, anim: -1, name: site.target, level: 227, size: 3,
        tile: { x: spot.x + 3, z: spot.z, level: spot.level }, distance: 3,
        ops: ['Attack'], inCombat: true, health: 100, totalHealth: 200, faceEntity: -1
    };
    state.npcs = [dragon];
    spyOn(performance, 'now').mockImplementation(() => state.now);
    spyOn(Game, 'tile').mockReturnValue(spot);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(reader, 'npcs').mockImplementation(() => state.npcs);
    spyOn(reader, 'selfFaceEntity').mockReturnValue(-1);
    spyOn(reader, 'selfSlot').mockReturnValue(1);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { state.walks++; return true; });
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Execution, 'delayTicks').mockImplementation(async () => { state.now += 600; });
    const food = new InvItem({ slot: 0, id: 379, name: site.food ?? 'Lobster', count: 1, ops: ['Eat', 'Drop'], comId: 1 });
    spyOn(Inventory, 'items').mockImplementation(() => Array.from({ length: state.full ? 28 : 10 }, () => food));
    spyOn(Inventory, 'isFull').mockImplementation(() => state.full);
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Rune arrow' ? state.ammo : name === 'Lobster' ? 10 : 0);
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { state.drops++; state.full = false; return true; });
    spyOn(reader, 'groundItems').mockImplementation(() => state.ground ? [{ id: style === 'range' ? 892 : 536, name: style === 'range' ? 'Rune arrow' : 'Dragon bones', count: 4, ops: ['Take'], tile: spot, distance: 0 }] : []);
    spyOn(GroundItem.prototype, 'interact').mockImplementation(() => { state.takes++; state.ground = false; return true; });
    spyOn(Npc.prototype, 'interact').mockImplementation(() => { state.attacks++; return true; });
    const bot = new JiveDragons();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ site: siteId, combatStyle: style, ammo: 'Rune arrow', solveClues: false, useSpecial: false, ...settings });
    await bot.onStart();
    Sustain.set(null);
    const tasks = bot['tasks'];
    const fight = tasks.find((task): task is Fight => task instanceof Fight);
    if (!fight) throw new Error('Fight missing from task wiring');
    for (const task of tasks) {
        if (!['FreeSlot', 'LootCorpse', 'BankRun', 'Fight'].includes(task.constructor.name)) spyOn(task, 'validate').mockReturnValue(false);
    }
    const task = (name: string) => {
        const found = tasks.find(entry => entry.constructor.name === name);
        if (!found) throw new Error(`Missing task: ${name}`);
        return found;
    };
    const engage = async () => {
        const combat = dragon.inCombat;
        dragon.inCombat = false;
        const result = await fight['engage'](new Npc(dragon), site.target);
        dragon.inCombat = combat;
        return result;
    };
    return { bot, fight, state, dragon, task, engage };
}

export async function restoreScenario(): Promise<void> {
    const bot = new JiveDragons();
    bot.bindLog(() => {});
    await bot.onStart();
    Sustain.set(null);
    mock.restore();
}
