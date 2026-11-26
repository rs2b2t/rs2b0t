import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type LocSnapshot, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SM_ID, SM_LOC_ID, SM_NPC, SM_TILE, SM_VARP } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';
import { Temple } from '#/bot/scripts/ShadesOfMortton/temple.js';

afterEach(() => mock.restore());

const item = (id: number, slot = 0, count = 1): InvItemSnapshot => ({ id, slot, count, comId: 3214, name: '', ops: [] });
const razmire = (name: string): NpcSnapshot => ({
    id: 1259, index: 7, anim: -1, tile: SM_TILE.RAZMIRE, name, ops: ['Talk-to', null, 'Trade-General-Store', 'Trade-Builders-Store'],
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
    const continued: string[] = [];
    state.onContinue = () => {
        continued.push(state.pages[0]);
        if (state.pages.length === 2) state.pack[0].id = SM_ID.SERUM_PERM2;
    };
    expect(await temple['applyPermanent']()).toBe(true);
    expect(continued).toEqual(['Well done, this serum is really working.', 'Razmire gives you gold coins.']);
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

function localFixture() {
    const f = fixture();
    const { state, supply } = f;
    state.pack = [item(995, 0, 10000), item(1514, 1, 50), item(590, 2), item(2347, 3)];
    state.locs = [{ id: SM_LOC_ID.ALTAR_LIT, typecode: 2, tile: SM_TILE.TEMPLE_INSIDE, name: 'Flaming Fire altar', ops: [], distance: 1 }];
    const bank = spyOn(supply, 'bank').mockRejectedValue(new Error('Local oil must preserve the expedition pack'));
    spyOn(supply, 'combine').mockResolvedValue(true);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Modals, 'closeIfOpen').mockResolvedValue(undefined);
    spyOn(Shop, 'isOpen').mockReturnValue(true);
    spyOn(Shop, 'close').mockResolvedValue(undefined);
    spyOn(Input, 'interactNpc').mockReturnValue(true);
    const purchases: [string, number][] = [];
    spyOn(Shop, 'buy').mockImplementation(async (name, qty) => {
        purchases.push([name, qty]);
        const id = name === 'Olive oil(3)' ? SM_ID.OLIVE_OIL3
            : name === 'Plank' ? SM_ID.PLANK : name === 'Limestone brick' ? SM_ID.LIMESTONE_BRICK : SM_ID.SWAMP_PASTE;
        const count = id === SM_ID.SWAMP_PASTE ? 1 : qty;
        for (let i = 0; i < count; i++) state.pack.push(item(id, state.pack.length, id === SM_ID.SWAMP_PASTE ? qty : 1));
        return qty;
    });
    spyOn(Input, 'useItemOnLoc').mockImplementation((id, slot) => {
        const vial = state.pack.find(i => i.id === id && i.slot === slot);
        if (!vial) return false;
        vial.id += 8;
        return true;
    });
    return { ...f, bank, purchases };
}

test('local oil purchases only the missing doses while preserving expedition supplies', async () => {
    const { state, temple, bank, purchases } = localFixture();
    state.pack.push(item(SM_ID.SACRED_OIL4, 4));
    expect(await temple.localOil(8)).toBe(true);
    expect(purchases).toEqual([['Olive oil(3)', 2]]);
    expect(Inventory.countById(1514)).toBe(50);
    expect(Inventory.countById(SM_ID.SACRED_OIL3)).toBe(2);
    expect(bank).not.toHaveBeenCalled();
});

test('local oil accepts existing sufficient doses without bank or temple errands', async () => {
    const { state, temple, supply, bank, purchases } = localFixture();
    state.pack.push(item(SM_ID.SACRED_OIL4, 4));
    expect(await temple.localOil(4)).toBe(true);
    expect(supply.walk).not.toHaveBeenCalled();
    expect(purchases).toEqual([]);
    expect(bank).not.toHaveBeenCalled();
});

test('local oil reserves three slots and does not claim an insufficient partial batch', async () => {
    const { state, temple, purchases } = localFixture();
    while (state.pack.length < 24) state.pack.push(item(8000 + state.pack.length, state.pack.length));
    expect(await temple.localOil(8)).toBe(false);
    expect(purchases).toEqual([['Olive oil(3)', 1]]);
    expect(Inventory.free()).toBe(3);
});

test('local repairs buy at most two material sets and leave room for oil and unnoting', async () => {
    const { state, temple, purchases } = localFixture();
    state.vars.set(SM_VARP.TEMPLE_RESOURCES, 0);
    state.vars.set(SM_VARP.TEMPLE_SANCTITY, 0);
    state.locs.push({ id: SM_LOC_ID.WALL_DONE, typecode: 0, tile: SM_TILE.TEMPLE_INSIDE, name: 'Temple wall', ops: ['Reinforce'], distance: 1 });
    spyOn(Input, 'interactLoc').mockImplementation(() => {
        state.pack = state.pack.filter(i => i.id !== SM_ID.PLANK && i.id !== SM_ID.LIMESTONE_BRICK);
        state.vars.set(SM_VARP.TEMPLE_SANCTITY, 55);
        state.vars.set(SM_VARP.TEMPLE_RESOURCES, 10);
        return true;
    });
    expect(await temple.localOil(4)).toBe(true);
    expect(purchases).toEqual([['Swamp paste', 12], ['Plank', 2], ['Limestone brick', 2], ['Olive oil(3)', 2]]);
    expect(Inventory.free()).toBeGreaterThanOrEqual(3);
});

test('an event during local sanctification stops the batch without another pour', async () => {
    const { state, temple } = localFixture();
    const pour = spyOn(Input, 'useItemOnLoc').mockImplementation((id, slot) => {
        state.pack.find(i => i.id === id && i.slot === slot)!.id += 8;
        state.event = true;
        return true;
    });
    expect(await temple.localOil(8)).toBe(false);
    expect(pour).toHaveBeenCalledTimes(1);
});

test('local oil clears empty vials before buying and after combining', async () => {
    const { state, supply, temple, purchases } = localFixture();
    while (state.pack.length < 28) state.pack.push({ ...item(229, state.pack.length), ops: ['Drop'] });
    spyOn(Input, 'heldOp').mockImplementation((id, slot) => {
        state.pack = state.pack.filter(i => i.slot !== slot || i.id !== id);
        return true;
    });
    spyOn(supply, 'combine').mockImplementation(async () => {
        state.pack.push({ ...item(229, 27), ops: ['Drop'] });
        return true;
    });
    expect(await temple.localOil(4)).toBe(true);
    expect(purchases).toEqual([['Olive oil(3)', 2]]);
    expect(Inventory.countById(229)).toBe(0);
});

test('local oil tops up after sanctifying carried partial bottles', async () => {
    const { state, temple, purchases } = localFixture();
    state.pack.push(item(SM_ID.SACRED_OIL3, 4), item(SM_ID.OLIVE_OIL3, 5));
    expect(await temple.localOil(8)).toBe(true);
    expect(purchases).toEqual([['Olive oil(3)', 1]]);
    expect(Inventory.countById(SM_ID.SACRED_OIL3)).toBe(3);
});

test('local sanctification stops retrying when accepted altar input never changes oil', async () => {
    const { state, temple, purchases } = localFixture();
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    const pour = spyOn(Input, 'useItemOnLoc').mockReturnValue(true);
    expect(await temple.localOil(4)).toBe(false);
    expect(pour.mock.calls.length).toBeLessThanOrEqual(16);
    expect(Inventory.countById(SM_ID.SACRED_OIL3)).toBe(0);
    expect(purchases).toEqual([]);
});

test('local oil uses a lit altar at ten sanctity without requiring rebuilt walls', async () => {
    const { state, temple, supply, purchases } = localFixture();
    state.vars.set(SM_VARP.TEMPLE_SANCTITY, 10);
    state.vars.set(SM_VARP.TEMPLE_REPAIRED, 30);
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    expect(await temple.localOil(4)).toBe(true);
    expect(purchases).toEqual([]);
    expect(supply.walk).not.toHaveBeenCalledWith(SM_TILE.RAZMIRE);
});

test('local oil buys its bottles before the first temple visit', async () => {
    const { temple, supply } = localFixture();
    const boughtBeforeArrival: number[] = [];
    spyOn(supply, 'walk').mockImplementation(async tile => {
        if (tile === SM_TILE.TEMPLE_INSIDE) boughtBeforeArrival.push(Inventory.countById(SM_ID.OLIVE_OIL3));
        return true;
    });
    expect(await temple.localOil(4)).toBe(true);
    expect(boughtBeforeArrival[0]).toBe(2);
});

test('local repairs use the remaining three percent resource pool and stop at the batch sanctity', async () => {
    const { state, temple, purchases } = localFixture();
    state.vars.set(SM_VARP.TEMPLE_RESOURCES, 3);
    state.vars.set(SM_VARP.TEMPLE_SANCTITY, 9);
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4), item(SM_ID.OLIVE_OIL4, 5));
    state.locs.push({ id: SM_LOC_ID.WALL_DONE, typecode: 0, tile: SM_TILE.TEMPLE_INSIDE, name: 'Temple wall', ops: ['Reinforce'], distance: 1 });
    const repair = spyOn(Input, 'interactLoc').mockImplementation(() => {
        state.vars.set(SM_VARP.TEMPLE_SANCTITY, 14);
        return true;
    });
    expect(await temple.localOil(8)).toBe(true);
    expect(purchases).toEqual([]);
    expect(repair).toHaveBeenCalledTimes(1);
});

test('local oil lights an intact cold altar at ten sanctity without building to twenty five', async () => {
    const { state, temple } = localFixture();
    state.vars.set(SM_VARP.TEMPLE_SANCTITY, 10);
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    state.locs[0].id = SM_LOC_ID.ALTAR_UNLIT;
    state.locs[0].ops = ['Light'];
    const light = spyOn(Input, 'interactLoc').mockImplementation(() => {
        state.locs[0].id = SM_LOC_ID.ALTAR_LIT;
        return true;
    });
    expect(await temple.localOil(4)).toBe(true);
    expect(light).toHaveBeenCalledTimes(1);
});

test('local oil rearms a broken altar despite a complete temple and sufficient sanctity', async () => {
    const { state, temple } = localFixture();
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    state.locs[0].id = SM_LOC_ID.ALTAR_BROKEN;
    state.locs.push({ id: SM_LOC_ID.WALL_DONE, typecode: 0, tile: SM_TILE.TEMPLE_INSIDE, name: 'Temple wall', ops: ['Reinforce'], distance: 1 });
    const repairAndLight = spyOn(Input, 'interactLoc').mockImplementation(() => {
        state.locs[0].id = state.locs[0].id === SM_LOC_ID.ALTAR_BROKEN ? SM_LOC_ID.ALTAR_UNLIT : SM_LOC_ID.ALTAR_LIT;
        state.locs[0].ops = ['Light'];
        return true;
    });
    expect(await temple.localOil(4)).toBe(true);
    expect(repairAndLight).toHaveBeenCalledTimes(2);
});

test('local oil reserves a repair set before buying oil for a broken altar with an empty pool', async () => {
    const { state, temple, purchases } = localFixture();
    state.vars.set(SM_VARP.TEMPLE_RESOURCES, 0);
    while (state.pack.length < 20) state.pack.push(item(8000 + state.pack.length, state.pack.length));
    state.locs[0].id = SM_LOC_ID.ALTAR_BROKEN;
    state.locs.push({ id: SM_LOC_ID.WALL_DONE, typecode: 0, tile: SM_TILE.TEMPLE_INSIDE, name: 'Temple wall', ops: ['Reinforce'], distance: 1 });
    spyOn(Input, 'interactLoc').mockImplementation(() => {
        state.locs[0].id = state.locs[0].id === SM_LOC_ID.ALTAR_BROKEN ? SM_LOC_ID.ALTAR_UNLIT : SM_LOC_ID.ALTAR_LIT;
        state.locs[0].ops = ['Light'];
        state.pack = state.pack.filter(i => i.id !== SM_ID.PLANK && i.id !== SM_ID.LIMESTONE_BRICK);
        state.vars.set(SM_VARP.TEMPLE_RESOURCES, 4);
        return true;
    });
    expect(await temple.localOil(8)).toBe(true);
    expect(purchases[0]).toEqual(['Swamp paste', 6]);
    expect(Inventory.free()).toBeGreaterThanOrEqual(3);
});

test('temple upkeep can pause local work before spending supplies', async () => {
    const { state, supply, purchases } = localFixture();
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    const temple = new Temple(supply, async () => false);
    expect(await temple.localOil(4)).toBe(false);
    expect(Inventory.countById(SM_ID.OLIVE_OIL4)).toBe(1);
    expect(purchases).toEqual([]);
});

test('local oil rechecks upkeep between vial pours', async () => {
    const { state, supply } = localFixture();
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4), item(SM_ID.OLIVE_OIL4, 5));
    const temple = new Temple(supply, async () => Inventory.countById(SM_ID.SACRED_OIL4) === 0);
    expect(await temple.localOil(8)).toBe(false);
    expect(Inventory.countById(SM_ID.SACRED_OIL4)).toBe(1);
    expect(Inventory.countById(SM_ID.OLIVE_OIL4)).toBe(1);
});

test('shop access brews carried serum ingredients locally instead of returning to bank', async () => {
    const { state, supply, temple } = localFixture();
    state.npcs = [razmire(SM_NPC.RAZMIRE_AFFLICTED)];
    state.pack.push(item(SM_ID.TARROMIN_UNF, 4), item(SM_ID.ASHES, 5));
    spyOn(Input, 'interactNpc').mockImplementation(() => { state.pages = ['Gibberish']; return true; });
    spyOn(Input, 'useItemOnItem').mockImplementation(() => {
        state.pack[4].id = SM_ID.SERUM3;
        state.pack = state.pack.filter(i => i.id !== SM_ID.ASHES);
        return true;
    });
    spyOn(Input, 'useItemOnNpc').mockImplementation(() => {
        state.pack[4].id = SM_ID.SERUM2;
        state.npcs = [razmire(SM_NPC.RAZMIRE)];
        state.pages = ['I feel much better'];
        return true;
    });
    expect(await temple.ensureAccess()).toBe(true);
    expect(Inventory.countById(SM_ID.SERUM2)).toBe(1);
    expect(supply.bank).not.toHaveBeenCalled();
});

test('local oil permanently cures Razmire and returns to the temple before pouring oil', async () => {
    const { state, supply, temple } = localFixture();
    state.pack.push(item(SM_ID.SERUM2, 4), item(SM_ID.OLIVE_OIL4, 5));
    state.vars.set(SM_VARP.TEMPLE_SANCTITY, 35);
    let atShop = false;
    let cures = 0;
    spyOn(supply, 'walk').mockImplementation(async tile => { atShop = tile === SM_TILE.RAZMIRE; return true; });
    spyOn(Input, 'useItemOnLoc').mockImplementation((id, slot) => {
        if (atShop) return false;
        state.pack.find(i => i.slot === slot)!.id = id === SM_ID.SERUM2 ? SM_ID.SERUM_PERM2 : SM_ID.SACRED_OIL4;
        if (id === SM_ID.SERUM2) state.vars.set(SM_VARP.TEMPLE_SANCTITY, 15);
        return true;
    });
    spyOn(Input, 'useItemOnNpc').mockImplementation(() => {
        cures++;
        state.pack[4].id = SM_ID.SERUM_PERM1;
        state.pages = ['Permanent cure'];
        return true;
    });
    expect(await temple.localOil(4)).toBe(true);
    expect(cures).toBe(1);
    expect(Inventory.countById(SM_ID.SACRED_OIL4)).toBe(1);
    state.pack[5].id = SM_ID.OLIVE_OIL4;
    expect(await temple.localOil(4)).toBe(true);
    expect(cures).toBe(1);
});

test('local oil resumes a sanctified serum by applying the permanent cure before oil', async () => {
    const { state, temple } = localFixture();
    state.pack.push(item(SM_ID.SERUM_PERM2, 4), item(SM_ID.OLIVE_OIL4, 5));
    const cure = spyOn(Input, 'useItemOnNpc').mockImplementation(() => {
        state.pack[4].id = SM_ID.SERUM_PERM1;
        state.pages = ['Permanent cure'];
        return true;
    });
    expect(await temple.localOil(4)).toBe(true);
    expect(cure).toHaveBeenCalledTimes(1);
    expect(Inventory.countById(SM_ID.SACRED_OIL4)).toBe(1);
});

test('local oil reports depleted shop coins only after failure and clears the reason on a usable batch', async () => {
    const { state, temple } = localFixture();
    state.pack[0].count = 1;
    spyOn(Shop, 'buy').mockResolvedValue(0);
    expect(await temple.localOil(4)).toBe(false);
    expect(temple.resupplyReason).toBe('coins for temple supplies exhausted');
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    expect(await temple.localOil(4)).toBe(true);
    expect(temple.resupplyReason).toBe('');
});

test('an ordinary temple interaction failure does not request resupply', async () => {
    const { state, temple } = localFixture();
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    spyOn(Input, 'useItemOnLoc').mockReturnValue(false);
    expect(await temple.localOil(4)).toBe(false);
    expect(temple.resupplyReason).toBe('');
});

test('low coins do not turn a food upkeep yield into a bank resupply', async () => {
    const { state, supply } = localFixture();
    state.pack[0].count = 1;
    state.pack.push(item(380, 4, 50), item(SM_ID.OLIVE_OIL4, 5));
    const temple = new Temple(supply, async () => false);
    expect(await temple.localOil(4)).toBe(false);
    expect(temple.resupplyReason).toBe('');
    expect(Inventory.countById(380)).toBe(50);
});

test('low coins do not classify a failed altar click as an unaffordable purchase', async () => {
    const { state, temple } = localFixture();
    state.pack[0].count = 1;
    state.pack.push(item(SM_ID.OLIVE_OIL4, 4));
    spyOn(Input, 'useItemOnLoc').mockReturnValue(false);
    expect(await temple.localOil(4)).toBe(false);
    expect(temple.resupplyReason).toBe('');
});

test('a shop stock failure with affordable supplies does not request coin resupply', async () => {
    const { state, temple } = localFixture();
    state.pack[0].count = 1000;
    spyOn(reader, 'chat').mockReturnValue([{ type: 0, username: null, text: "You don't have enough coins." }]);
    spyOn(Shop, 'buy').mockResolvedValue(0);
    expect(await temple.localOil(4)).toBe(false);
    expect(temple.resupplyReason).toBe('');
});

test('a fresh insufficient-coins reply identifies an unaffordable shop order', async () => {
    const { state, temple } = localFixture();
    state.pack[0].count = 5;
    let refused = false;
    spyOn(reader, 'chat').mockImplementation(() => refused ? [{ type: 0, username: null, text: "You don't have enough coins." }] : []);
    spyOn(Shop, 'buy').mockImplementation(async () => { refused = true; return 0; });
    expect(await temple.localOil(4)).toBe(false);
    expect(temple.resupplyReason).toBe('coins for temple supplies exhausted');
});

test.each([false, true])('shop recovery checks nearby ashes before declaring ingredient exhaustion (ashes: %s)', async ashes => {
    const { state, temple, bank } = localFixture();
    state.npcs = [razmire(SM_NPC.RAZMIRE_AFFLICTED)];
    state.pack.push(item(SM_ID.TARROMIN_UNF, 4));
    spyOn(reader, 'groundItems').mockImplementation(() => ashes ? [{ id: SM_ID.ASHES, name: 'Ashes', count: 1, tile: SM_TILE.TOWN, distance: 1, ops: ['Take'] }] : []);
    spyOn(Input, 'interactNpc').mockImplementation(() => { state.pages = ['Gibberish']; return true; });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(SM_ID.ASHES, 5)); return true; });
    spyOn(Input, 'useItemOnItem').mockImplementation(() => {
        state.pack[4].id = SM_ID.SERUM3;
        state.pack = state.pack.filter(i => i.id !== SM_ID.ASHES);
        return true;
    });
    spyOn(Input, 'useItemOnNpc').mockImplementation(() => {
        state.pack[4].id = SM_ID.SERUM2;
        state.npcs = [razmire(SM_NPC.RAZMIRE)];
        state.pages = ['I feel much better'];
        return true;
    });
    expect(await temple.ensureAccess()).toBe(ashes);
    expect(temple.resupplyReason).toBe(ashes ? '' : 'serum ingredients exhausted');
    expect(bank).not.toHaveBeenCalled();
    state.npcs = [razmire(SM_NPC.RAZMIRE)];
    expect(await temple.ensureAccess()).toBe(true);
    expect(temple.resupplyReason).toBe('');
});
