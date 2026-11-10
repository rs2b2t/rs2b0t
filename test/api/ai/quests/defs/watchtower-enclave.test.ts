import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { dissolveShamans } from '#/bot/api/ai/quests/defs/watchtower/enclave.js';
import { WT_ITEM, WT_LOC } from '#/bot/api/ai/quests/defs/watchtower/areas.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Loc } from '#/bot/api/locs/Locs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

afterEach(() => { mock.restore(); GameMessages.reset(); });
function fixture() {
    const state = { food: 8, hp: 70, free: 12, npc: true, confirm: true, dialog: false, continued: 0, outside: false, uses: 0 };
    spyOn(Game, 'tile').mockImplementation(() => state.outside ? { x: 2500, z: 3000, level: 0 } : { x: 2588, z: 9410, level: 0 });
    spyOn(Game, 'setAutoRetaliate').mockReturnValue(true);
    spyOn(Inventory, 'items').mockImplementation(() => [
        new InvItem({ id: WT_ITEM.MAGIC_OGRE_POTION.id, count: 1, slot: 0, name: 'Magic ogre potion', ops: [], comId: 3214 }),
        ...Array.from({ length: state.food }, (_, slot) => new InvItem({ id: 379, count: 1, slot: slot + 1, name: 'Lobster', ops: ['Eat'], comId: 3214 }))
    ]);
    spyOn(Inventory, 'free').mockImplementation(() => state.free);
    spyOn(reader, 'npcs').mockImplementation(() => state.npc ? [{ index: 1, id: 1, name: 'Ogre shaman', tile: { x: 2588, z: 9410, level: 0 }, distance: 1, ops: ['Talk-to'], anim: -1, level: 99, size: 1, inCombat: false, health: 70, totalHealth: 70, faceEntity: -1 }] : []);
    spyOn(reader, 'locs').mockReturnValue([{ id: WT_LOC.ENCLAVE_CAVE, typecode: 0, name: 'Cave', tile: { x: 2598, z: 9467, level: 0 }, distance: 1, ops: ['Enter'] }]);
    spyOn(Loc.prototype, 'interact').mockImplementation(async () => { state.outside = true; return true; });
    spyOn(InvItem.prototype, 'useOn').mockImplementation(async () => {
        state.uses++;
        if (state.confirm) { GameMessages.record('The ogre dissolves into spirit form.'); state.dialog = true; }
        return true;
    });
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Skills, 'effective').mockImplementation(() => state.hp);
    spyOn(Sustain, 'run').mockResolvedValue();
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Execution, 'noteProgress').mockImplementation(() => {});
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => state.dialog);
    spyOn(ChatDialog, 'canContinue').mockImplementation(() => state.dialog);
    spyOn(ChatDialog, 'continue').mockImplementation(async () => { state.continued++; state.dialog = false; return true; });
    return state;
}

test('walking all shaman spots without finding one is a failed step', async () => {
    const state = fixture(); state.npc = false;
    expect(await dissolveShamans(() => {})).toBe(false);
    expect(state.uses).toBe(0);
});
test('sending a potion click without a dissolution is not progress', async () => {
    const state = fixture(); state.confirm = false;
    GameMessages.record('The ogre dissolves into spirit form.');
    expect(await dissolveShamans(() => {})).toBe(false);
    expect(Execution.noteProgress).not.toHaveBeenCalled();
});
test('a verified kill finishes the dialogue and yields after one shaman', async () => {
    const state = fixture();
    expect(await dissolveShamans(() => {})).toBe(true);
    expect(state.uses).toBe(1);
    expect(state.continued).toBe(1);
    expect(Execution.noteProgress).toHaveBeenCalledTimes(1);
    expect(Game.setAutoRetaliate).toHaveBeenCalledWith(false);
});
test.each(['food', 'hp', 'free'] as const)('low %s retreats without another potion attempt', async key => {
    const state = fixture(); state[key] = 1;
    expect(await dissolveShamans(() => {})).toBe(false);
    expect(state.outside).toBe(true);
    expect(state.uses).toBe(0);
});
test('an interruption aborts before walking or using supplies', async () => {
    const state = fixture(); spyOn(EventSignal, 'pending').mockReturnValue(true);
    expect(await dissolveShamans(() => {})).toBe(false);
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
    expect(state.uses).toBe(0);
});
