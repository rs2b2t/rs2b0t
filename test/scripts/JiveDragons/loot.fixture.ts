import { spyOn } from 'bun:test';
import { reader, type GroundItemSnapshot, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { scenario } from './scheduler.fixture.js';

const stackable = new Set([892, 995]);
const names = new Map([[379, 'Lobster'], [385, 'Shark'], [892, 'Rune arrow'], [536, 'Dragon bones'], [1747, 'Dragonhide'], [995, 'Coins'], [1617, 'Uncut diamond']]);

export function held(id: number, count = 1): InvItemSnapshot {
    return { id, count, name: names.get(id) ?? 'Other', slot: 0, comId: 1, ops: ['Eat', 'Drop', 'Bury'] };
}

export async function lootScenario(settings: Record<string, string | number | boolean | string[]> = {}, siteId = 'taverley-black', style = 'range') {
    const fixture = await scenario(siteId, style, { buryBones: true, lootBlack: ['Dragonhide', 'Coins'], ...settings });
    const position = Game.tile();
    if (!position) throw new Error('Missing anchor');
    const anchor = Tile.from(position);
    const corpse = new Tile(anchor.x + 3, anchor.z, anchor.level);
    const pack = Array.from({ length: 27 }, () => held(fixture.bot.foodName() === 'Lobster' ? 379 : 385));
    pack.push(held(892, 100));
    const ground: GroundItemSnapshot[] = [];
    const events: { action: string; id: number; tile: Tile }[] = [];
    const world = { here: anchor, pack, ground, events, hp: 99, rejectTake: false, rejectWalk: false, rejectBury: false };
    const drop = (id: number, tile = corpse, count = 1) => {
        const item: GroundItemSnapshot = { id, tile, count, name: names.get(id) ?? 'Other', ops: ['Take'], distance: 0 };
        world.ground.push(item);
        return item;
    };
    for (const method of ['items', 'count', 'isFull'] as const) spyOn(Inventory, method).mockRestore();
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => world.pack.map((item, slot) => ({ ...item, slot })));
    spyOn(reader, 'equipment').mockReturnValue([held(892, 100)]);
    spyOn(reader, 'objCatalog').mockReturnValue([892, 995].map(id => ({ id, name: names.get(id) ?? '', stackable: true, cost: 1, members: false, equippable: false, certlink: -1, certtemplate: -1, stackVariant: false })));
    spyOn(reader, 'groundItems').mockImplementation(() => world.ground.map(item => ({ ...item, distance: world.here.distanceTo(Tile.from(item.tile)) })));
    spyOn(Game, 'tile').mockImplementation(() => ({ x: world.here.x, z: world.here.z, level: world.here.level }));
    spyOn(Skills, 'effective').mockImplementation(() => world.hp);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
        const destination = Tile.from(tile);
        events.push({ action: 'Walk', id: -1, tile: destination });
        if (world.rejectWalk) return false;
        world.here = destination;
        return true;
    });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, action) {
        events.push({ action, id: this.id, tile: world.here });
        const item = world.pack[this.slot];
        if (!item || item.id !== this.id) return false;
        if (action === 'Bury' && world.rejectBury) return false;
        world.pack.splice(this.slot, 1);
        if (action === 'Drop') drop(item.id, world.here);
        if (action === 'Eat') world.hp = 99;
        return true;
    });
    spyOn(GroundItem.prototype, 'interact').mockImplementation(function (this: GroundItem, action) {
        const index = world.ground.findIndex(item => item.id === this.id && Tile.from(item.tile).equals(this.tile()));
        const item = world.ground[index];
        if (!item || world.rejectTake) return false;
        const stack = stackable.has(item.id) ? world.pack.find(entry => entry.id === item.id) : undefined;
        if (world.pack.length === 28 && !stack) return false;
        world.here = this.tile();
        events.push({ action, id: this.id, tile: world.here });
        if (stack) stack.count += item.count;
        else world.pack.push(held(item.id, item.count));
        world.ground.splice(index, 1);
        return true;
    });
    spyOn(fixture.task('BuryBones'), 'validate').mockRestore();
    spyOn(fixture.task('BankRun'), 'execute').mockImplementation(async () => { events.push({ action: 'Bank', id: -1, tile: world.here }); });
    fixture.state.npcs = [];
    const run = async (passes = 10) => {
        for (let i = 0; i < passes; i++) await fixture.bot.loop();
    };
    return { ...fixture, world, anchor, corpse, drop, run };
}
