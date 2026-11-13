import { describe, expect, test } from 'bun:test';
import { KEY_CHESTS, SHADE_TIERS, chestForKey, keyTier, reserveKey, spendableKeys } from '#/bot/scripts/ShadesOfMortton/data.js';

describe('shade access keys', () => {
    test('preserves the only highest tier key and spends every lower key', () => {
        const counts = new Map([[3450, 3], [3460, 2], [3469, 1]]);
        expect(reserveKey(counts)).toBe(3469);
        expect(spendableKeys(counts)).toEqual([{ id: 3450, count: 3 }, { id: 3460, count: 2 }]);
        expect(counts.get(3469)).toBe(1);
    });
    test('spends duplicates but keeps one deterministic highest tier key', () => {
        expect(spendableKeys(new Map([[3468, 2], [3465, 1]])))
            .toEqual([{ id: 3465, count: 1 }, { id: 3468, count: 1 }]);
        expect(reserveKey(new Map([[3468, 2], [3465, 1]]))).toBe(3468);
    });
    test('ignores absent keys and unrelated inventory', () => {
        expect(reserveKey(new Map([[3469, 0], [995, 1000]]))).toBeNull();
        expect(spendableKeys(new Map([[995, 1000]]))).toEqual([]);
        expect(keyTier(995)).toBe(-1);
        expect(keyTier(3450)).toBe(0);
        expect(keyTier(3469)).toBe(3);
    });
    test('matches every chest by both metal and trim', () => {
        expect(KEY_CHESTS).toHaveLength(20);
        expect(new Set(KEY_CHESTS.map(k => k.chestId)).size).toBe(20);
        expect(chestForKey(3450)?.chestId).toBe(4111);
        expect(chestForKey(3451)?.chestId).toBe(4112);
        expect(chestForKey(3465)?.chestId).toBe(4126);
        expect(chestForKey(3469)?.chestId).toBe(4130);
        expect(chestForKey(3470)).toBeNull();
    });
    test('shade progression requires bronze, steel, black and silver in order', () => {
        expect(SHADE_TIERS.map(t => [t.name, t.remains, t.shadow, t.shade, t.accessTier])).toEqual([
            ['Loar', 3396, 1240, 1241, -1], ['Phrin', 3398, 1243, 1244, 0],
            ['Riyl', 3400, 1245, 1246, 1], ['Asyn', 3402, 1247, 1248, 2],
            ['Fiyr', 3404, 1249, 1250, 3]
        ]);
    });
});

const { catacombPath, CATACOMB_DOORS, CHEST_ROOMS } = await import('#/bot/scripts/ShadesOfMortton/route.js');

describe('catacomb door routes', () => {
    test('a silver key traverses the steel door into the main hall and silver door into Fiyr', () => {
        const route = catacombPath(15, 0, new Map([[3469, 1]]));
        expect(route?.map(step => step.door.id)).toEqual([4107, 4109]);
        expect(route?.map(step => [step.stand.x, step.stand.z, step.land.x, step.land.z])).toEqual([
            [3493, 9712, 3493, 9711], [3467, 9696, 3466, 9696]
        ]);
    });
    test('bronze access cannot enter the steel area but exit needs no key', () => {
        expect(catacombPath(15, 10, new Map([[3450, 1]]))).toBeNull();
        expect(catacombPath(0, 15, new Map())?.map(step => step.door.id)).toEqual([4109, 4107]);
    });
    test('chest rooms match the exact trim even in separate silver chambers', () => {
        expect(CHEST_ROOMS.get(3450)?.area).toBe(16);
        expect(CHEST_ROOMS.get(3465)?.area).toBe(1);
        expect(CHEST_ROOMS.get(3467)?.area).toBe(2);
        expect(CHEST_ROOMS.get(3468)?.area).toBe(3);
        expect(CHEST_ROOMS.get(3469)?.area).toBe(4);
        expect(CATACOMB_DOORS).toHaveLength(25);
    });
});

const { afterEach, mock, spyOn } = await import('bun:test');
const { reader } = await import('#/bot/adapter/ClientAdapter.js');
const { Execution } = await import('#/bot/api/execution/Execution.js');
const { EventSignal } = await import('#/bot/api/execution/EventSignal.js');
const { Game } = await import('#/bot/api/game/Game.js');
const { Skills } = await import('#/bot/api/skills/Skills.js');
const { Input } = await import('#/bot/input/Input.js');
const { ChatDialog } = await import('#/bot/api/ui/dialogue/ChatDialog.js');
const { Traversal } = await import('#/bot/api/walking/Traversal.js');
const { Reachability } = await import('#/bot/event/webwalk/geometry/Reachability.js');
const { MorttonRoute } = await import('#/bot/scripts/ShadesOfMortton/route.js');
const { Minigame, pyrePillar } = await import('#/bot/scripts/ShadesOfMortton/minigame.js');
import type { GroundItemSnapshot, InvItemSnapshot, LocSnapshot, NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';

afterEach(() => mock.restore());

function fixture() {
    const state = {
        pack: [] as InvItemSnapshot[], npcs: [] as NpcSnapshot[], locs: [] as LocSnapshot[], ground: [] as GroundItemSnapshot[],
        tick: 0, xp: 0, event: false, tile: { x: 3504, z: 3275, level: 0 }, pages: 0
    };
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'npcs').mockImplementation(() => state.npcs);
    spyOn(reader, 'locs').mockImplementation(() => state.locs);
    spyOn(reader, 'groundItems').mockImplementation(() => state.ground);
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x, lz: z }));
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'tick').mockImplementation(() => state.tick);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'setAutoRetaliate').mockReturnValue(true);
    spyOn(Skills, 'xp').mockImplementation(() => state.xp);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { state.tick += n; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(MorttonRoute.prototype, 'area').mockResolvedValue(true);
    spyOn(MorttonRoute.prototype, 'local').mockResolvedValue(true);
    spyOn(MorttonRoute.prototype, 'exit').mockResolvedValue(true);
    spyOn(ChatDialog, 'canContinue').mockImplementation(() => state.pages > 0);
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => state.pages > 0);
    return state;
}
const item = (id: number, count = 1): InvItemSnapshot => ({ id, count, slot: id, comId: 3214, name: '', ops: [] });
const pyre = (id: number): LocSnapshot => ({ id, typecode: 2, tile: { x: 3504, z: 3275, level: 0 }, name: 'Funeral Pyre', ops: ['Light'], distance: 1 });

test('hunt only completes after remains enter inventory, including a same-index shade morph', async () => {
    const state = fixture();
    state.npcs = [{ id: 1240, index: 7, anim: -1, tile: state.tile, name: 'Loar Shadow', ops: [null, 'Attack'], distance: 1, level: 40, size: 1, inCombat: false, health: 0, totalHealth: 0, faceEntity: -1 }];
    let attacks = 0;
    spyOn(Input, 'interactNpc').mockImplementation(() => {
        if (++attacks === 1) state.npcs[0] = { ...state.npcs[0], id: 1241, name: 'Loar Shade' };
        else {
            state.npcs = [];
            state.ground = [{ id: 3396, count: 1, tile: state.tile, name: 'Loar remains', ops: ['Take'], distance: 1 }];
        }
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3396)); state.ground = []; return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.hunt(0, 1)).toBe(true);
    expect(game.stats.kills).toBe(1);
    expect(attacks).toBe(2);
    expect(state.pack.find(i => i.id === 3396)?.count).toBe(1);
});

test('a vanished target without collected remains is not a completed hunt', async () => {
    const state = fixture();
    state.npcs = [{ id: 1240, index: 7, anim: -1, tile: state.tile, name: 'Loar Shadow', ops: [null, 'Attack'], distance: 1, level: 40, size: 1, inCombat: false, health: 0, totalHealth: 0, faceEntity: -1 }];
    spyOn(Input, 'interactNpc').mockImplementation(() => { state.npcs = []; return true; });
    expect(await new Minigame(() => {}, async () => true).hunt(0, 1)).toBe(false);
});

test('failed food upkeep exits without attacking', async () => {
    fixture();
    let exits = 0;
    spyOn(MorttonRoute.prototype, 'exit').mockImplementation(async () => { exits++; return true; });
    expect(await new Minigame(() => {}, async () => false).hunt(4, 1)).toBe(false);
    expect(exits).toBe(1);
});

test('cremation requires pedestal pickup after the log, remains and lighting transitions', async () => {
    const state = fixture();
    state.pack = [item(3448), item(3404), item(590)];
    state.locs = [pyre(4093)];
    spyOn(Input, 'useItemOnLoc').mockImplementation((id) => {
        state.pack = state.pack.filter(i => i.id !== id);
        state.locs = [pyre(id === 3448 ? 4099 : 4105)];
        return true;
    });
    spyOn(Input, 'interactLoc').mockImplementation(() => {
        state.xp++;
        state.locs = [pyre(4093)];
        state.ground = [{ id: 3465, count: 1, tile: { x: 3503, z: 3275, level: 0 }, name: 'Silver key red', ops: ['Take'], distance: 3 }];
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3465)); state.ground = []; return true; });
    expect(await new Minigame(() => {}, async () => true).cremate(4)).toBe(true);
    expect(state.pack.map(i => i.id)).toEqual([590, 3465]);
});

test('a chest only completes after treasure and paste dialogue pages', async () => {
    const state = fixture();
    state.tile = { x: 3459, z: 9719, level: 0 };
    state.pack = [item(3469, 2)];
    state.locs = [{ id: 4130, typecode: 2, tile: state.tile, name: 'Silver Chest', ops: ['Open'], distance: 1 }];
    spyOn(Input, 'interactLoc').mockImplementation(() => { state.pack[0].count--; state.pack.push(item(3470)); state.pages = 2; return true; });
    spyOn(ChatDialog, 'continue').mockImplementation(async () => { if (--state.pages === 1) state.pack.push(item(1941, 25)); return true; });
    expect(await new Minigame(() => {}, async () => true).openChests()).toBe(true);
    expect(state.pack.find(i => i.id === 3469)?.count).toBe(1);
    expect(state.pack.find(i => i.id === 1941)?.count).toBe(25);
    expect(state.pages).toBe(0);
});


test('interrupted remains placement resumes the owned pyre without consuming another log', async () => {
    const state = fixture();
    state.pack = [item(3448, 2), item(3404), item(590)];
    state.locs = [pyre(4093)];
    let logsUsed = 0;
    spyOn(Input, 'useItemOnLoc').mockImplementation((id) => {
        if (id === 3448) { logsUsed++; state.pack[0].count--; }
        else { state.pack = state.pack.filter(i => i.id !== 3404); state.event = true; }
        state.locs = [pyre(id === 3448 ? 4099 : 4105)];
        return true;
    });
    spyOn(Input, 'interactLoc').mockImplementation(() => {
        state.xp++;
        state.locs = [pyre(4093)];
        state.ground = [{ id: 995, count: 2400, tile: { x: 3503, z: 3275, level: 0 }, name: 'Coins', ops: ['Take'], distance: 3 }];
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(995, 2400)); state.ground = []; return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.cremate(4)).toBe(false);
    expect(game.pending()).toBe(true);
    state.event = false;
    expect(await game.resume()).toBe(true);
    expect(logsUsed).toBe(1);
    expect(game.pending()).toBe(false);
    expect(game.stats.burned).toBe(1);
});

test('failed pedestal pickup leaves a pending funeral and cannot claim a burn', async () => {
    const state = fixture();
    state.pack = [item(3448), item(3404), item(590)];
    state.locs = [pyre(4093)];
    spyOn(Input, 'useItemOnLoc').mockImplementation((id) => {
        state.pack = state.pack.filter(i => i.id !== id);
        state.locs = [pyre(id === 3448 ? 4099 : 4105)];
        return true;
    });
    spyOn(Input, 'interactLoc').mockImplementation(() => { state.xp++; state.locs = [pyre(4093)]; return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.cremate(4)).toBe(false);
    expect(game.pending()).toBe(true);
    expect(game.stats.burned).toBe(0);
});

test('a rejected chest interaction leaves no pending reward chain', async () => {
    const state = fixture();
    state.tile = { x: 3459, z: 9719, level: 0 };
    state.pack = [item(3469, 2)];
    state.locs = [{ id: 4130, typecode: 2, tile: state.tile, name: 'Silver Chest', ops: ['Open'], distance: 1 }];
    spyOn(Input, 'interactLoc').mockReturnValue(false);
    const game = new Minigame(() => {}, async () => true);
    expect(await game.openChests()).toBe(false);
    expect(game.pending()).toBe(false);
});

test('lighting interrupted after experience resumes reward collection without relighting', async () => {
    const state = fixture();
    state.pack = [item(3448), item(3404), item(590)];
    state.locs = [pyre(4093)];
    spyOn(Input, 'useItemOnLoc').mockImplementation((id) => {
        state.pack = state.pack.filter(i => i.id !== id);
        state.locs = [pyre(id === 3448 ? 4099 : 4105)];
        return true;
    });
    let lights = 0;
    spyOn(Input, 'interactLoc').mockImplementation(() => { lights++; state.xp++; state.event = true; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => !state.event && condition());
    const game = new Minigame(() => {}, async () => true);
    expect(await game.cremate(4)).toBe(false);
    state.event = false;
    state.ground = [{ id: 3465, count: 1, tile: { x: 3503, z: 3275, level: 0 }, name: 'Silver key red', ops: ['Take'], distance: 3 }];
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3465)); state.ground = []; return true; });
    expect(await game.resume()).toBe(true);
    expect(lights).toBe(1);
});

test('expired funeral rewards clear pending state without claiming a burn', async () => {
    const state = fixture();
    state.pack = [item(3448), item(3404), item(590)];
    state.locs = [pyre(4093)];
    spyOn(Input, 'useItemOnLoc').mockImplementation((id) => {
        state.pack = state.pack.filter(i => i.id !== id);
        state.locs = [pyre(id === 3448 ? 4099 : 4105)];
        return true;
    });
    spyOn(Input, 'interactLoc').mockImplementation(() => { state.xp++; state.locs = [pyre(4093)]; return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.cremate(4)).toBe(false);
    state.tick += 100;
    expect(await game.resume()).toBe(false);
    expect(game.pending()).toBe(false);
    expect(game.stats.burned).toBe(0);
});

test('a chest reserves five reward slots before consuming a key', async () => {
    const state = fixture();
    state.tile = { x: 3459, z: 9719, level: 0 };
    state.pack = [item(3469, 2), ...Array.from({ length: 23 }, (_, i) => item(100 + i))];
    state.locs = [{ id: 4130, typecode: 2, tile: state.tile, name: 'Silver Chest', ops: ['Open'], distance: 1 }];
    let opens = 0;
    spyOn(Input, 'interactLoc').mockImplementation(() => { opens++; return true; });
    expect(await new Minigame(() => {}, async () => true).openChests()).toBe(false);
    expect(opens).toBe(0);
});

test('accepted chest input without key consumption reconciles after its bounded wait', async () => {
    const state = fixture();
    state.tile = { x: 3459, z: 9719, level: 0 };
    state.pack = [item(3469, 2)];
    state.locs = [{ id: 4130, typecode: 2, tile: state.tile, name: 'Silver Chest', ops: ['Open'], distance: 1 }];
    spyOn(Input, 'interactLoc').mockReturnValue(true);
    const game = new Minigame(() => {}, async () => true);
    expect(await game.openChests()).toBe(false);
    expect(game.pending()).toBe(false);
    expect(game.stats.chests).toBe(0);
});

test('a consumed key with abandoned reward dialogue reconciles without claiming loot', async () => {
    const state = fixture();
    state.tile = { x: 3459, z: 9719, level: 0 };
    state.pack = [item(3469, 2)];
    state.locs = [{ id: 4130, typecode: 2, tile: state.tile, name: 'Silver Chest', ops: ['Open'], distance: 1 }];
    spyOn(Input, 'interactLoc').mockImplementation(() => { state.pack[0].count--; state.event = true; return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.openChests()).toBe(false);
    state.event = false;
    expect(await game.resume()).toBe(false);
    expect(game.pending()).toBe(false);
    expect(game.stats.chests).toBe(0);
});

test('escape walking keeps eating while ignoring the false combat-readiness result', async () => {
    const state = fixture();
    mock.restore();
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    let upkeep = 0;
    const route = new MorttonRoute(() => {}, async () => { upkeep++; return false; });
    expect(await route.local(new (await import('#/bot/geometry/Tile.js')).default(state.tile.x, state.tile.z), 0, false)).toBe(true);
    expect(upkeep).toBe(1);
});

test('an interrupted chest resumes both reward pages and preserves the access key', async () => {
    const state = fixture();
    state.tile = { x: 3459, z: 9719, level: 0 };
    state.pack = [item(3469, 2)];
    state.locs = [{ id: 4130, typecode: 2, tile: state.tile, name: 'Silver Chest', ops: ['Open'], distance: 1 }];
    spyOn(Input, 'interactLoc').mockImplementation(() => { state.pack[0].count--; state.pack.push(item(3470)); state.pages = 2; state.event = true; return true; });
    spyOn(ChatDialog, 'continue').mockImplementation(async () => { if (--state.pages === 1) state.pack.push(item(1941, 25)); return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.openChests()).toBe(false);
    expect(game.pending()).toBe(true);
    state.event = false;
    expect(await game.resume()).toBe(true);
    expect(game.pending()).toBe(false);
    expect(game.stats.chests).toBe(1);
    expect(state.pack.find(i => i.id === 3469)?.count).toBe(1);
    expect(state.pages).toBe(0);
});

test('retreat keeps healing through both door crossings after readiness turns false', async () => {
    const state = fixture();
    spyOn(MorttonRoute.prototype, 'area').mockRestore();
    spyOn(MorttonRoute.prototype, 'local').mockRestore();
    spyOn(MorttonRoute.prototype, 'exit').mockRestore();
    const { Reachability } = await import('#/bot/event/webwalk/geometry/Reachability.js');
    const { DirectNavigator } = await import('#/bot/event/webwalk/DirectNavigator.js');
    let area = 0;
    let hp = 25;
    let food = 10;
    state.tile = { x: 3463, z: 9698, level: 0 };
    state.locs = [[4109, 3467, 9696], [4107, 3493, 9712], [4106, 3493, 9726]].map(([id, x, z]) => ({
        id, typecode: 0, tile: { x, z, level: 0 }, name: 'Door', ops: ['Open'], distance: 1
    }));
    spyOn(Reachability, 'canReach').mockImplementation(tile => CATACOMB_DOORS.some(door =>
        door.from === area && door.at.equals(tile) || door.to === area && door.across.equals(tile)));
    spyOn(DirectNavigator, 'walk').mockImplementation(tile => { state.tile = { ...tile }; hp -= 15; return true; });
    let crossed = 0;
    spyOn(Input, 'interactLoc').mockImplementation((x) => {
        crossed++;
        hp -= 15;
        if (x === 3467) { area = 10; state.tile = { x: 3467, z: 9696, level: 0 }; }
        else if (area === 10) { area = 15; state.tile = { x: 3493, z: 9712, level: 0 }; }
        else state.tile = { x: 3485, z: 3322, level: 0 };
        return true;
    });
    const route = new MorttonRoute(() => {}, async () => { if (hp < 60 && food > 0) { food--; hp += 12; } return false; });
    expect(await route.exit()).toBe(true);
    expect(crossed).toBe(3);
    expect(food).toBeLessThan(8);
    expect(hp).toBeGreaterThan(0);
});

test('reward recovery returns to the pedestal after event relocation', async () => {
    const state = fixture();
    state.pack = [item(3448), item(3404), item(590)];
    state.locs = [pyre(4093)];
    spyOn(Input, 'useItemOnLoc').mockImplementation((id) => {
        state.pack = state.pack.filter(i => i.id !== id);
        state.locs = [pyre(id === 3448 ? 4099 : 4105)];
        return true;
    });
    spyOn(Input, 'interactLoc').mockImplementation(() => { state.xp++; state.event = true; return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.cremate(4)).toBe(false);
    state.event = false;
    state.tile = { x: 3200, z: 3200, level: 0 };
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => {
        state.tile = { x: 3504, z: 3275, level: 0 };
        state.ground = [{ id: 3465, count: 1, tile: { x: 3503, z: 3275, level: 0 }, name: 'Silver key red', ops: ['Take'], distance: 3 }];
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3465)); state.ground = []; return true; });
    expect(await game.resume()).toBe(true);
    expect(state.tile.x).toBe(3504);
    expect(game.stats.burned).toBe(1);
});


for (const [direction, rotation, x, z, pillarX, pillarZ] of [
    ['west', 0, 3507, 3276, 3507, 3279],
    ['north', 1, 3508, 3275, 3511, 3275],
    ['east', 2, 3507, 3272, 3507, 3271],
    ['south', 3, 3504, 3275, 3503, 3275]
] as const) {
    test(`engine loc_${direction} rotation ${rotation} uses the server pillar offset`, async () => {
        const { default: Tile } = await import('#/bot/geometry/Tile.js');
        expect(pyrePillar(new Tile(x, z), rotation)).toEqual(new Tile(pillarX, pillarZ));
    });
}

for (const interrupted of [false, true]) {
    test(`prayer level-up continuation releases the queued funeral reward, interrupted=${interrupted}`, async () => {
        const state = fixture();
        state.pack = [item(3448), item(3404), item(590)];
        state.locs = [pyre(4093)];
        spyOn(Input, 'useItemOnLoc').mockImplementation((id) => {
            state.pack = state.pack.filter(i => i.id !== id);
            state.locs = [pyre(id === 3448 ? 4099 : 4105)];
            return true;
        });
        spyOn(Input, 'interactLoc').mockImplementation(() => {
            state.xp++;
            state.pages = 1;
            state.event = interrupted;
            return true;
        });
        let continuations = 0;
        spyOn(ChatDialog, 'continue').mockImplementation(async () => {
            continuations++;
            state.pages = 0;
            state.locs = [pyre(4093)];
            state.ground = [{ id: 3465, count: 1, tile: { x: 3503, z: 3275, level: 0 }, name: 'Silver key red', ops: ['Take'], distance: 1 }];
            return true;
        });
        spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3465)); state.ground = []; return true; });
        const game = new Minigame(() => {}, async () => true);
        expect(await game.cremate(4)).toBe(!interrupted);
        if (interrupted) {
            state.event = false;
            state.tick += 100;
            expect(await game.resume()).toBe(true);
        }
        expect(continuations).toBe(1);
        expect(game.pending()).toBe(false);
        expect(game.stats.burned).toBe(1);
        expect(state.pack.find(i => i.id === 3465)?.count).toBe(1);
    });
}

const fiyr = (index: number, distance: number, faceEntity = -1): NpcSnapshot => ({
    id: 1250, index, anim: -1, tile: { x: 3463, z: 9698, level: 0 }, name: 'Fiyr Shade', ops: [null, 'Attack'],
    distance, level: 120, size: 1, inCombat: true, health: 110, totalHealth: 110, faceEntity
});

test('hunt chooses the same-tier shade attacking us before a nearer unengaged shade', async () => {
    const state = fixture();
    spyOn(reader, 'selfSlot').mockReturnValue(7);
    state.npcs = [fiyr(10, 1), fiyr(11, 2, 32775)];
    const attacked: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        attacked.push(index);
        if (index === 11) {
            state.npcs = state.npcs.filter(n => n.index !== 11);
            state.ground = [{ id: 3404, count: 1, tile: state.tile, name: 'Fiyr remains', ops: ['Take'], distance: 1 }];
        }
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3404)); state.ground = []; return true; });
    expect(await new Minigame(() => {}, async () => true).hunt(4, 1)).toBe(true);
    expect(attacked).toEqual([11]);
});

test('hunt follows a same-tier attacker takeover while the original shade stays alive', async () => {
    const state = fixture();
    spyOn(reader, 'selfSlot').mockReturnValue(7);
    state.npcs = [fiyr(10, 1), fiyr(11, 2)];
    const attacked: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        attacked.push(index);
        if (index === 10) state.npcs[1].faceEntity = 32775;
        else {
            state.npcs = state.npcs.filter(n => n.index !== 11);
            state.ground = [{ id: 3404, count: 1, tile: state.tile, name: 'Fiyr remains', ops: ['Take'], distance: 1 }];
        }
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3404)); state.ground = []; return true; });
    expect(await new Minigame(() => {}, async () => true).hunt(4, 1)).toBe(true);
    expect(attacked).toEqual([10, 11]);
});

test('hunt collects verified remains from auto-retaliation while the captured index remains visible', async () => {
    const state = fixture();
    state.npcs = [fiyr(10, 1)];
    spyOn(Input, 'interactNpc').mockImplementation(() => {
        state.ground = [{ id: 3404, count: 1, tile: state.tile, name: 'Fiyr remains', ops: ['Take'], distance: 1 }];
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3404)); state.ground = []; return true; });
    const game = new Minigame(() => {}, async () => true);
    expect(await game.hunt(4, 1)).toBe(true);
    expect(state.npcs[0].index).toBe(10);
    expect(game.stats.kills).toBe(1);
});

test('hunt still excludes a closer shade targeting another player', async () => {
    const state = fixture();
    spyOn(reader, 'selfSlot').mockReturnValue(7);
    state.npcs = [fiyr(10, 1, 32776), fiyr(11, 2, 32775)];
    const attacked: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        attacked.push(index);
        state.npcs = state.npcs.filter(n => n.index !== 11);
        state.ground = [{ id: 3404, count: 1, tile: state.tile, name: 'Fiyr remains', ops: ['Take'], distance: 1 }];
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3404)); state.ground = []; return true; });
    expect(await new Minigame(() => {}, async () => true).hunt(4, 1)).toBe(true);
    expect(attacked).toEqual([11]);
});


test('melee adjacency cannot cross a closed wall in the local collision probe', async () => {
    const { canReachLocal } = await import('#/bot/event/webwalk/geometry/localReach.js');
    const { CollisionFlag } = await import('#/client/dash3d/CollisionFlag.js');
    const flags = (x: number, z: number) => z !== 1 || x < 0 || x > 1 ? CollisionFlag.SQ_BLOCKED
        : x === 0 ? CollisionFlag.W_E : CollisionFlag.W_W;
    expect(canReachLocal(flags, { lx: 1, lz: 1 }, { lx: 0, lz: 1 }, { maxSteps: 2048, adjacentOk: true })).toBe(false);
});

test('hunt rejects an adjacent shadow behind a wall even when it faces us', async () => {
    const state = fixture();
    spyOn(reader, 'selfSlot').mockReturnValue(7);
    state.npcs = [
        { ...fiyr(10, 1, 32775), id: 1249, tile: { x: 3460, z: 9702, level: 0 } },
        { ...fiyr(11, 3), tile: { x: 3464, z: 9699, level: 0 } }
    ];
    spyOn(Reachability, 'canReach').mockImplementation(tile => tile.x !== 3460);
    const attacked: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        attacked.push(index);
        if (index === 11) {
            state.npcs = state.npcs.filter(n => n.index !== 11);
            state.ground = [{ id: 3404, count: 1, tile: state.tile, name: 'Fiyr remains', ops: ['Take'], distance: 1 }];
        }
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3404)); state.ground = []; return true; });
    expect(await new Minigame(() => {}, async () => true).hunt(4, 1)).toBe(true);
    expect(attacked).toEqual([11]);
});

test('hunt replaces a retained attacker that moves behind a closed door', async () => {
    const state = fixture();
    spyOn(reader, 'selfSlot').mockReturnValue(7);
    state.npcs = [fiyr(10, 1, 32775), { ...fiyr(11, 3), tile: { x: 3464, z: 9699, level: 0 } }];
    spyOn(Reachability, 'canReach').mockImplementation(tile => tile.x !== 3460);
    const attacked: number[] = [];
    spyOn(Input, 'interactNpc').mockImplementation(index => {
        attacked.push(index);
        if (index === 10) state.npcs[0].tile = { x: 3460, z: 9702, level: 0 };
        else {
            state.npcs = state.npcs.filter(n => n.index !== 11);
            state.ground = [{ id: 3404, count: 1, tile: state.tile, name: 'Fiyr remains', ops: ['Take'], distance: 1 }];
        }
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3404)); state.ground = []; return true; });
    expect(await new Minigame(() => {}, async () => true).hunt(4, 1)).toBe(true);
    expect(attacked).toEqual([10, 11]);
});

test('hunt waits for a reachable respawn instead of returning after one remain', async () => {
    const state = fixture();
    state.npcs = [fiyr(10, 1)];
    let attacks = 0;
    spyOn(Input, 'interactNpc').mockImplementation(() => {
        attacks++;
        state.npcs = [];
        state.ground = [{ id: 3404, count: 1, tile: state.tile, name: 'Fiyr remains', ops: ['Take'], distance: 1 }];
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation(() => { state.pack.push(item(3404)); state.ground = []; return true; });
    spyOn(Execution, 'delayTicks').mockImplementation(async n => {
        state.tick += n;
        if (attacks === 1 && state.tick > 1) state.npcs = [fiyr(11, 1)];
    });
    expect(await new Minigame(() => {}, async () => true).hunt(4, 2)).toBe(true);
    expect(attacks).toBe(2);
    expect(state.pack.filter(i => i.id === 3404)).toHaveLength(2);
});
