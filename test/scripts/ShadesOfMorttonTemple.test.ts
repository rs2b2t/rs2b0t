import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type LocSnapshot, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SM_ID, SM_LOC_ID, SM_NPC, SM_TILE, SM_VARP } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Input } from '#/bot/input/Input.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';
import { Temple } from '#/bot/scripts/ShadesOfMortton/temple.js';

afterEach(() => mock.restore());

const item = (id: number, slot = 0, count = 1): InvItemSnapshot => ({ id, slot, count, comId: 3214, name: '', ops: [] });
const razmire = (name: string): NpcSnapshot => ({
    id: 1259, index: 7, anim: -1, tile: SM_TILE.RAZMIRE, name, ops: ['Talk-to', null, 'Trade-General-Store'],
    distance: 1, level: 0, size: 1, inCombat: false, health: 0, totalHealth: 0, faceEntity: -1
});

function fixture() {
    const state = {
        pack: [] as InvItemSnapshot[], npcs: [razmire(SM_NPC.RAZMIRE)], locs: [] as LocSnapshot[],
        tick: 0, pages: [] as string[], event: false, animating: false,
        vars: new Map<number, number>([[SM_VARP.TEMPLE_REPAIRED, 100], [SM_VARP.TEMPLE_RESOURCES, 100], [SM_VARP.TEMPLE_SANCTITY, 55]]),
        onTick: () => {}, onContinue: () => {}
    };
    const supply = new Supplies(() => {});
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'npcs').mockImplementation(() => state.npcs);
    spyOn(reader, 'locs').mockImplementation(() => state.locs);
    spyOn(reader, 'varp').mockImplementation(id => state.vars.get(id) ?? 0);
    spyOn(reader, 'chatModalTexts').mockImplementation(() => state.pages.slice(0, 1));
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x, lz: z }));
    spyOn(Game, 'tile').mockReturnValue(SM_TILE.TEMPLE_INSIDE);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'animating').mockImplementation(() => state.animating);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => {
        for (let i = 0; i < n; i++) { state.tick++; state.onTick(); }
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        for (let i = 0; i < 12; i++) {
            if (condition()) return true;
            await Execution.delayTicks(1);
        }
        return condition();
    });
    spyOn(ChatDialog, 'canContinue').mockImplementation(() => state.pages.length > 0);
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => state.pages.length > 0);
    spyOn(ChatDialog, 'options').mockReturnValue([]);
    spyOn(ChatDialog, 'continue').mockImplementation(async () => { state.onContinue(); state.pages.shift(); return true; });
    spyOn(supply, 'walk').mockResolvedValue(true);
    spyOn(supply, 'combatReady').mockResolvedValue(true);
    return { state, supply, temple: new Temple(supply) };
}

test('permanent cure waits for the delayed reply and consumed dose before succeeding', async () => {
    const { state, temple } = fixture();
    state.pack = [item(SM_ID.SERUM_PERM3)];
    let submitted = false;
    spyOn(Input, 'useItemOnNpc').mockImplementation(() => { submitted = true; return true; });
    state.onTick = () => {
        if (submitted && state.tick === 2) state.pages = ['Well done, this serum is really working.', 'Razmire gives you gold coins.'];
    };
    state.onContinue = () => {
        if (state.pages.length === 2) state.pack[0].id = SM_ID.SERUM_PERM2;
    };
    expect(await temple['applyPermanent']()).toBe(true);
    expect(state.tick).toBeGreaterThanOrEqual(4);
    expect(state.pages).toEqual([]);
    expect(state.pack[0].id).toBe(SM_ID.SERUM_PERM2);
    expect(temple['cured']).toBe(true);
});

test('accepted permanent-serum input without a server reply cannot claim a cure', async () => {
    const { state, temple } = fixture();
    state.pack = [item(SM_ID.SERUM_PERM3)];
    spyOn(Input, 'useItemOnNpc').mockReturnValue(true);
    expect(await temple['applyPermanent']()).toBe(false);
    expect(temple['cured']).toBe(false);
    expect(state.pack[0].id).toBe(SM_ID.SERUM_PERM3);
});

test('unrelated completed dialogue without consuming serum cannot claim a cure', async () => {
    const { state, temple } = fixture();
    state.pack = [item(SM_ID.SERUM_PERM3)];
    spyOn(Input, 'useItemOnNpc').mockImplementation(() => { state.pages = ['Nothing interesting happens.']; return true; });
    expect(await temple['applyPermanent']()).toBe(false);
    expect(temple['cured']).toBe(false);
});

test('already permanent dialogue acknowledges access without consuming another dose', async () => {
    const { state, temple } = fixture();
    state.pack = [item(SM_ID.SERUM_PERM3)];
    spyOn(Input, 'useItemOnNpc').mockImplementation(() => {
        state.pages = ["You've already used the permanent serum on me, you don't need to use that any more."];
        return true;
    });
    expect(await temple['applyPermanent']()).toBe(true);
    expect(state.pack[0].id).toBe(SM_ID.SERUM_PERM3);
});

test('a permanently cured afflicted model wakes by talking without serum', async () => {
    const { state, temple } = fixture();
    state.npcs = [razmire(SM_NPC.RAZMIRE_AFFLICTED)];
    let submitted = false;
    const talk = spyOn(Input, 'interactNpc').mockImplementation(() => { submitted = true; return true; });
    const dose = spyOn(Input, 'useItemOnNpc').mockReturnValue(false);
    state.onTick = () => {
        if (submitted && state.tick === 2) {
            state.npcs = [razmire(SM_NPC.RAZMIRE)];
            state.pages = ["Ah, it's you, how's it going?"];
        }
    };
    expect(await temple['wake']()).toBe(true);
    expect(talk).toHaveBeenCalledTimes(1);
    expect(dose).not.toHaveBeenCalled();
    expect(state.pages).toEqual([]);
});

test('gibberish from an uncured villager without serum cannot claim shop access', async () => {
    const { state, temple } = fixture();
    state.npcs = [razmire(SM_NPC.RAZMIRE_AFFLICTED)];
    spyOn(Input, 'interactNpc').mockImplementation(() => { state.pages = ['gurghl', "This person doesn't make any sense at all."]; return true; });
    expect(await temple['wake']()).toBe(false);
    expect(temple['cured']).toBe(false);
});

test('repair switches to the remaining broken wall while the completed wall still animates', async () => {
    const { state, temple } = fixture();
    state.vars.set(SM_VARP.TEMPLE_REPAIRED, 90);
    state.locs = [3505, 3507].map(x => ({
        id: SM_LOC_ID.WALL_BASE, typecode: 0, tile: { x, z: 3315, level: 0 }, name: 'Temple wall', ops: ['Repair'], distance: x - 3504
    }));
    const repaired: number[] = [];
    spyOn(Input, 'interactLoc').mockImplementation(x => {
        repaired.push(x);
        const wall = state.locs.find(loc => loc.tile.x === x)!;
        wall.id = SM_LOC_ID.WALL_DONE;
        wall.ops = ['Reinforce'];
        state.animating = true;
        if (repaired.length === 2) state.vars.set(SM_VARP.TEMPLE_REPAIRED, 100);
        return true;
    });
    expect(await temple['build'](55)).toBe(true);
    expect(repaired).toEqual([3505, 3507]);
});

test('oil sanctifies banked bottles without opening a shop', async () => {
    const { state, supply, temple } = fixture();
    const stock = new Map([[995, 10000], [SM_ID.OLIVE_OIL3, 2]]);
    const withdrawn: [number, number][] = [];
    spyOn(supply, 'bank').mockResolvedValue(true);
    spyOn(supply, 'loadTools').mockResolvedValue(true);
    spyOn(supply, 'loadFood').mockResolvedValue(true);
    spyOn(Bank, 'countById').mockImplementation(id => stock.get(id) ?? 0);
    spyOn(Bank, 'close').mockResolvedValue(true);
    spyOn(supply, 'take').mockImplementation(async (id, qty) => {
        withdrawn.push([id, qty]);
        if (id === 995 && qty) state.pack.push(item(id, state.pack.length, qty));
        else for (let i = 0; i < qty; i++) state.pack.push(item(id, state.pack.length));
        return true;
    });
    spyOn(supply, 'combine').mockResolvedValue(true);
    state.locs = [{ id: SM_LOC_ID.ALTAR_LIT, typecode: 2, tile: SM_TILE.TEMPLE_INSIDE, name: 'Flaming Fire altar', ops: [], distance: 1 }];
    const trades = spyOn(Input, 'interactNpc').mockReturnValue(false);
    const pours = spyOn(Input, 'useItemOnLoc').mockImplementation((id, slot) => {
        const vial = state.pack.find(i => i.id === id && i.slot === slot);
        if (!vial) return false;
        vial.id = SM_ID.SACRED_OIL3;
        return true;
    });
    expect(await temple.oil()).toBe(true);
    expect(withdrawn).toContainEqual([SM_ID.OLIVE_OIL3, 2]);
    expect(trades).not.toHaveBeenCalled();
    expect(pours).toHaveBeenCalledTimes(2);
    expect(state.pack.filter(i => i.id === SM_ID.SACRED_OIL3)).toHaveLength(2);
});
