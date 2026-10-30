import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { Bank } from '../../api/bank/Bank.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Quests } from '../../api/ui/questlog/Quests.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { driveDialog } from '../../api/ai/quests/exec/primitives.js';
import Tile from '../../geometry/Tile.js';
import { levelerTravelZones } from './travel.js';

const SHED = new Tile(3201, 3169, 0);
const GATE = new Tile(3237, 9558, 0);
const SHOP = new Tile(3252, 9572, 0);
const LADDER = new Tile(3253, 9592, 0);
const BANK = new Tile(3153, 9576, 0);
const TELEPORT_RUNES = [{ name: 'Law rune', count: 1 }, { name: 'Air rune', count: 3 }, { name: 'Fire rune', count: 1 }];

export function inZanaris(tile: WorldTile | null): boolean {
    return tile !== null && tile.level === 0 && tile.x >= 3150 && tile.x <= 3300 && tile.z >= 9450 && tile.z <= 9700;
}

export function inDragonMarket(tile: WorldTile | null): boolean {
    return inZanaris(tile) && tile!.x >= 3238;
}

export interface ZanarisPort {
    tile(): WorldTile | null;
    complete(): boolean;
    held(name: string): number;
    wearingStaff(): boolean;
    equipStaff(): Promise<boolean>;
    prepareExit(): Promise<boolean>;
    teleport(): Promise<boolean>;
    walk(tile: WorldTile): Promise<boolean>;
    interact(id: number, action: string): Promise<boolean>;
    dialog(prefer: string[]): Promise<boolean>;
    wait(condition: () => boolean): Promise<boolean>;
}

export async function openZanarisBank(log: (message: string) => void): Promise<boolean> {
    if (Quests.status('Lost City') !== 'complete') return false;
    if (Bank.isOpen()) return Bank.waitReady();
    if (!(await Traversal.walkResilient(BANK, { radius: 3, timeoutMs: 120000, avoidZones: levelerTravelZones(), log }))) return false;
    return await Bank.openNpcAccess({ name: 'Banker', op: 'Bank' }, log) && await Bank.waitReady();
}

export async function cutTravelDiamond(): Promise<boolean> {
    if (Inventory.count('Diamond') > 0) return true;
    if (Skills.level('crafting') < 43) return false;
    const chisel = Inventory.items().find(item => item.name === 'Chisel' && !item.noted);
    const uncut = Inventory.items().find(item => item.name === 'Uncut diamond' && !item.noted);
    return !!chisel && !!uncut && await chisel.useOn(uncut) && await Execution.delayUntil(() => Inventory.count('Diamond') > 0, 5000);
}

export function gameZanarisPort(log: (message: string) => void): ZanarisPort {
    return {
        tile: () => Game.tile(),
        complete: () => Quests.status('Lost City') === 'complete',
        held: name => Inventory.count(name),
        wearingStaff: () => Equipment.items().some(item => item.name === 'Dramen staff'),
        equipStaff: () => Equipment.equip('Dramen staff'),
        prepareExit: async () => {
            if (!(await openZanarisBank(log))) return false;
            await Bank.setNoteMode(false);
            await Bank.depositInventory();
            if (!(await Execution.delayUntil(() => Inventory.used() === 0, 4000))) return false;
            const teleport = Skills.level('magic') >= 25 && TELEPORT_RUNES.every(item => Inventory.count(item.name) + Bank.count(item.name) >= item.count);
            const needs = teleport ? TELEPORT_RUNES : Bank.count('Diamond') + Inventory.count('Diamond') > 0
                ? [{ name: 'Diamond', count: 1 }]
                : Skills.level('crafting') >= 43 ? [{ name: 'Chisel', count: 1 }, { name: 'Uncut diamond', count: 1 }] : [];
            if (!needs.length) { log('Cannot leave Zanaris: need a Diamond or Varrock teleport runes and Magic 25'); return false; }
            for (const need of needs) {
                const missing = need.count - Inventory.count(need.name);
                if (missing > 0 && !(await Bank.withdrawX(need.name, missing))) { log(`Cannot leave Zanaris: missing ${need.name}`); return false; }
            }
            if (!(await Bank.close())) return false;
            return teleport || await cutTravelDiamond();
        },
        teleport: async () => Skills.level('magic') >= 25 && TELEPORT_RUNES.every(item => Inventory.count(item.name) >= item.count) && await Game.teleport('Varrock'),
        walk: tile => Traversal.walkResilient(Tile.from(tile), { radius: 0, attempts: 2, timeoutMs: 120000, avoidZones: levelerTravelZones(), log }),
        interact: async (id, action) => {
            const loc = Locs.query().where(loc => loc.id === id).action(action).within(5).nearest();
            return !!loc && await loc.interact(action);
        },
        dialog: prefer => driveDialog(prefer, log),
        wait: condition => Execution.delayUntil(condition, 15000)
    };
}

async function enterMarket(port: ZanarisPort): Promise<boolean> {
    if (inDragonMarket(port.tile())) return true;
    if (!port.complete() || port.held('Diamond') < 1 || !(await port.walk(GATE))) return false;
    if (!(await port.interact(2411, 'Open')) || !(await port.dialog(['Okay...']))) return false;
    return port.wait(() => inDragonMarket(port.tile()));
}

export async function enterDragonShop(port: ZanarisPort): Promise<boolean> {
    if (!port.complete()) return false;
    if (!inZanaris(port.tile())) {
        if (!port.wearingStaff() && (port.held('Dramen staff') < 1 || !(await port.equipStaff()))) return false;
        if (!(await port.walk(SHED)) || !(await port.interact(2406, 'Open')) || !(await port.wait(() => inZanaris(port.tile())))) return false;
    }
    return await enterMarket(port) && await port.walk(SHOP);
}

export async function leaveZanaris(port: ZanarisPort): Promise<boolean> {
    if (!inZanaris(port.tile())) return true;
    if (!inDragonMarket(port.tile()) && port.held('Diamond') < 1 && !(await port.prepareExit())) return false;
    if (await port.teleport()) return port.wait(() => !inZanaris(port.tile()));
    if (!(await enterMarket(port)) || !(await port.walk(LADDER)) || !(await port.interact(2410, 'Climb-up'))) return false;
    if (!(await port.dialog(["Yes, I'm ready to leave."]))) return false;
    return port.wait(() => !inZanaris(port.tile()));
}
