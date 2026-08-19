import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import Tile from '../../../../../geometry/Tile.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { talkChoosingBy } from '../../exec/primitives.js';
import { QuestFood } from '../../food.js';
import { COMBAT_FOODS, TENZING_BOOTS, TENZING_DONE_RULES } from '../trollstronghold/areas.js';
import { plannedGear, wearAll } from '../trollstronghold/index.js';
import {
    CHICKEN_NPC_ID,
    ER_ITEM,
    ER_TILE,
    LIQUORS,
    banked,
    questBank,
    committed,
    held,
    worn,
    type EadgarItem,
    type EadgarZone
} from './areas.js';

export const BOOT_COST = 12;
/** Covers every purchase this quest makes several times over. */
export const COIN_FLOAT = 1000;
// Why: the float is drawn once and spent down — topping it back up after every 5gp price walks the
// character to a bank between the pineapple, the vodka and the knife.

/** Below this the purse is refilled to {@link COIN_FLOAT}. */
export const COIN_FLOOR = 200;
export const FOOD_TARGET = 10;
// Why: the scarecrow is sixteen slots of grain and chicken, so the float shrinks to make room — but only while that load is still being gathered.
// Why: holding it down across stages 60 and 70 sent the character up the thrower gauntlet on four lobsters and it died three times.

/** Food carried while the scarecrow load is still being gathered. */
export const SCARECROW_FOOD_TARGET = 6;
/** Below this the pack is spent and the module walks back down for more. */
export const FOOD_FLOOR = 2;

const PRICE = {
    PINEAPPLE: 5,
    LIQUOR: 20,
    KNIFE: 20,
    PESTLE: 20,
    TINDERBOX: 10,
    AXE: 100,
    VIAL: 10
} as const;

// Why: nobody in this game is called 'Shop keeper' — Shop.open matches the display name of the
// NPC that owns the stock.
export const HECKEL = { npc: 'Heckel Funch', anchor: ER_TILE.HECKEL };
export const GULLUCK = { npc: 'Gulluck', anchor: ER_TILE.GULLUCK };
export const AEMAD = { npc: 'Aemad', anchor: ER_TILE.AEMAD };
export const JATIX = { npc: 'Jatix', anchor: ER_TILE.JATIX };
export const WISTAN = { npc: 'Wistan', anchor: ER_TILE.WISTAN };

export function foodNames(): string[] {
    const configured = QuestFood.name?.trim();
    const names = [configured, ...COMBAT_FOODS].filter((n): n is string => Boolean(n));
    return [...new Map(names.map(n => [n.toLowerCase(), n])).values()];
}

export function foodHeld(snap: QuestSnapshot): number {
    return foodNames().reduce((total, name) => total + (snap.inv.get(name.toLowerCase()) ?? 0), 0);
}

export const scanBank = (snap: QuestSnapshot): QuestStep => ({ kind: 'scanBank', bank: questBank(snap) });

export const withdraw = (snap: QuestSnapshot, items: { name: string; qty: number; id: number }[]): QuestStep =>
    ({ kind: 'withdraw', items, bank: questBank(snap) });

const take = (snap: QuestSnapshot, item: EadgarItem, qty = 1): QuestStep =>
    withdraw(snap, [{ name: item.name, id: item.id, qty }]);

/** Bank first; null when the bank cannot help either. */
function fromBank(snap: QuestSnapshot, item: EadgarItem, qty: number): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    const stock = banked(snap, item);
    return stock > 0 ? take(snap, item, Math.min(qty - held(snap, item), stock)) : null;
}

function buy(item: EadgarItem, qty: number, shop: { npc: string; anchor: Tile }, unitGp: number): QuestStep {
    return { kind: 'buy', item: item.name, qty, shop, estGp: qty * unitGp };
}

/** Bank, then the shop counter. Null once the pack holds enough. */
function source(
    snap: QuestSnapshot,
    item: EadgarItem,
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    if (held(snap, item) >= qty) {
        return null;
    }
    return fromBank(snap, item, qty) ?? buy(item, qty - held(snap, item), shop, unitGp);
}

export const sourcePestle = (snap: QuestSnapshot): QuestStep | null =>
    source(snap, ER_ITEM.PESTLE, 1, JATIX, PRICE.PESTLE);

// Why: the tinderbox is only ever wanted on the mountain, and Burthorpe Supplies is the counter
// the route already passes — Aemad's is four hundred tiles the wrong way.
export const sourceTinderbox = (snap: QuestSnapshot): QuestStep | null =>
    source(snap, ER_ITEM.TINDERBOX, 1, WISTAN, PRICE.TINDERBOX);

export const sourceKnife = (snap: QuestSnapshot): QuestStep | null =>
    source(snap, ER_ITEM.KNIFE, 1, HECKEL, PRICE.KNIFE);

// Why: Gulluck is one ladder above Heckel Funch, so the axe rides the trip the fruit and the
// vodka already pay for.
export const sourceAxe = (snap: QuestSnapshot): QuestStep | null =>
    source(snap, ER_ITEM.AXE, 1, GULLUCK, PRICE.AXE);

/** Any of the four liquors the aviary accepts, bank first. */
export function sourceLiquor(snap: QuestSnapshot): QuestStep | null {
    if (LIQUORS.some(liquor => held(snap, liquor) > 0)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(snap);
    }
    const stocked = LIQUORS.find(liquor => banked(snap, liquor) > 0);
    return stocked ? take(snap, stocked) : buy(ER_ITEM.VODKA, 1, HECKEL, PRICE.LIQUOR);
}

/** The liquor this pass will dip the chunks in. */
export function heldLiquor(snap: QuestSnapshot): EadgarItem | null {
    return LIQUORS.find(liquor => held(snap, liquor) > 0) ?? null;
}

// Loadout

function keepIds(): number[] {
    return Object.values(ER_ITEM).map(item => item.id);
}

function keepNames(snap: QuestSnapshot): string[] {
    return [
        ...Object.values(ER_ITEM).map(item => item.name),
        ...LIQUORS.map(liquor => liquor.name),
        ...foodNames(),
        ...plannedGear(snap)
    ].map(name => name.toLowerCase());
}

async function buyBoots(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ER_ITEM.CLIMBING_BOOTS.name)) {
        return true;
    }
    if (Inventory.count(ER_ITEM.COINS.name) < BOOT_COST) {
        log(`need ${BOOT_COST} coins for Climbing boots`);
        return false;
    }
    // One, not four: Tenzing is inside his hut and a wider radius is satisfied on the doorstep.
    if (!(await Traversal.walkResilient(ER_TILE.TENZING, { radius: 1, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const before = Inventory.count(ER_ITEM.CLIMBING_BOOTS.name);
    await talkChoosingBy(TENZING_BOOTS.npc, TENZING_DONE_RULES, TENZING_BOOTS.prefer, log);
    return Execution.delayUntil(() => Inventory.count(ER_ITEM.CLIMBING_BOOTS.name) > before, 8000);
}

// Why: this runs on every decide() tick while the character is still off the mountain, so each
// branch has to be idempotent — a step that does not change the snapshot spins here forever.

/** The loadout in one pure pass; null once the pack is ready to travel. */
export function prepare(snap: QuestSnapshot, zone: EadgarZone, foodWant = FOOD_TARGET): QuestStep | null {
    const bootsReady = held(snap, ER_ITEM.CLIMBING_BOOTS) > 0 || worn(snap, ER_ITEM.CLIMBING_BOOTS);
    // Past the stile a bank trip means climbing back down the secret way. Only a spent pack or
    // missing boots is worth that; anything less rides on.
    if (committed(zone) && bootsReady && foodHeld(snap) >= FOOD_FLOOR) {
        if (!worn(snap, ER_ITEM.CLIMBING_BOOTS)) {
            return wearAll([ER_ITEM.CLIMBING_BOOTS.name]);
        }
        const carried = plannedGear(snap).filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0);
        return carried.length > 0 ? wearAll(carried) : null;
    }

    if (!snap.bankKnown) {
        return scanBank(snap);
    }

    const keep = keepNames(snap);
    if ([...snap.inv.keys()].some(name => !keep.includes(name))) {
        return { kind: 'deposit', keep, keepIds: keepIds(), exactKeep: true, bank: questBank(snap) };
    }

    const fromVault: { name: string; qty: number; id: number }[] = [];
    if (held(snap, ER_ITEM.COINS) < COIN_FLOOR && banked(snap, ER_ITEM.COINS) > 0) {
        fromVault.push({
            name: ER_ITEM.COINS.name,
            id: ER_ITEM.COINS.id,
            qty: Math.min(COIN_FLOAT - held(snap, ER_ITEM.COINS), banked(snap, ER_ITEM.COINS))
        });
    }
    if (!bootsReady && banked(snap, ER_ITEM.CLIMBING_BOOTS) > 0) {
        fromVault.push({ name: ER_ITEM.CLIMBING_BOOTS.name, id: ER_ITEM.CLIMBING_BOOTS.id, qty: 1 });
    }
    // A loadout names what the player wants, not what the bank has; anything missing is skipped
    // rather than waited on, as this quest fights nothing it cannot walk away from.
    for (const name of plannedGear(snap)) {
        const inPack = snap.inv.get(name.toLowerCase()) ?? 0;
        if (inPack === 0 && (snap.bank?.get(name.toLowerCase()) ?? 0) > 0) {
            fromVault.push({ name, qty: 1, id: -1 });
        }
    }
    const have = foodHeld(snap);
    if (have < foodWant) {
        for (const name of foodNames()) {
            const stock = snap.bank?.get(name.toLowerCase()) ?? 0;
            if (stock > 0) {
                fromVault.push({ name, qty: Math.min(foodWant - have, stock), id: -1 });
                break;
            }
        }
    }
    if (fromVault.length > 0) {
        // Why: only the ranarr vial needs an exact id; food is matched by display name.
        return { kind: 'withdraw', bank: questBank(snap), items: fromVault.map(item => (item.id < 0 ? { name: item.name, qty: item.qty } : item)) };
    }

    const toWear = plannedGear(snap).filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0);
    if (toWear.length > 0) {
        return wearAll(toWear);
    }
    if (!bootsReady) {
        if (held(snap, ER_ITEM.COINS) < BOOT_COST) {
            return { kind: 'wait', reason: `need ${BOOT_COST} gp for Climbing boots — the bank has none` };
        }
        return { kind: 'custom', name: 'buy Climbing boots from Tenzing (12gp)', run: buyBoots };
    }
    if (!worn(snap, ER_ITEM.CLIMBING_BOOTS)) {
        return wearAll([ER_ITEM.CLIMBING_BOOTS.name]);
    }
    if (foodHeld(snap) === 0) {
        return { kind: 'wait', reason: `no food in the bank (tried ${foodNames().join(', ')})` };
    }
    return null;
}

// Gathering

async function takeGround(name: string, log: (m: string) => void): Promise<boolean> {
    const drop = GroundItems.query().name(name).within(12).nearest();
    if (!drop) {
        return false;
    }
    log(`taking ${name}`);
    return (await drop.interact('Take')) && Execution.delayUntil(() => Inventory.contains(name), 8000);
}

// Why: logs are wanted twice — with the chickens and the grain in Ardougne, and again beside the
// Falador bank for the drying fire — and one anchor makes the other trip five hundred tiles longer.
function nearestTrees(): Tile {
    const here = Game.tile();
    if (!here) {
        return ER_TILE.TREES;
    }
    return ER_TILE.TREES.distanceTo(here) <= ER_TILE.TREES_FALADOR.distanceTo(here)
        ? ER_TILE.TREES
        : ER_TILE.TREES_FALADOR;
}

/** Chop until the pack holds `qty` logs. */
async function chopLogs(qty: number, log: (m: string) => void): Promise<boolean> {
    const trees = nearestTrees();
    for (let attempt = 0; attempt < 40; attempt++) {
        if (Inventory.count(ER_ITEM.LOGS.name) >= qty) {
            return true;
        }
        const here = Game.tile();
        if (!here || trees.distanceTo(here) > 12) {
            if (!(await Traversal.walkResilient(trees, { radius: 6, attempts: 3, timeoutMs: 180_000, log }))) {
                return false;
            }
        }
        const tree = Locs.query().name('Tree').action('Chop down').within(10).nearest();
        if (!tree) {
            await Execution.delayTicks(2);
            continue;
        }
        const before = Inventory.count(ER_ITEM.LOGS.name);
        if (await tree.interact('Chop down')) {
            await Execution.delayUntil(() => Inventory.count(ER_ITEM.LOGS.name) > before, 30_000);
        }
    }
    log(`could not cut ${qty} logs`);
    return false;
}

// Why: a chicken is a level-1 drop, not a fight — arming a protection prayer for one burns a bar
// the stronghold walk still needs, so this is a plain attack-and-loot loop.

/** Kill chickens at the Ardougne farm until the pack holds `qty` raw chicken. */
async function huntChickens(qty: number, log: (m: string) => void): Promise<boolean> {
    for (let attempt = 0; attempt < 60; attempt++) {
        if (Inventory.count(ER_ITEM.RAW_CHICKEN.name) >= qty) {
            return true;
        }
        if (await takeGround(ER_ITEM.RAW_CHICKEN.name, log)) {
            continue;
        }
        const here = Game.tile();
        if (!here || ER_TILE.CHICKENS.distanceTo(here) > 10) {
            if (!(await Traversal.walkResilient(ER_TILE.CHICKENS, { radius: 5, attempts: 3, timeoutMs: 180_000, log }))) {
                return false;
            }
            continue;
        }
        if (Game.inCombat()) {
            await Execution.delayUntil(() => !Game.inCombat(), 60_000);
            continue;
        }
        const target = Npcs.query()
            .where(n => n.id === CHICKEN_NPC_ID && !n.inCombat && !n.targetsAnotherPlayer())
            .action('Attack')
            .within(12)
            .nearest();
        if (!target) {
            await Execution.delayTicks(3);
            continue;
        }
        Game.setCombatStyle('strength');
        if (!(await target.interact('Attack'))) {
            continue;
        }
        await Execution.delayUntil(
            () => GroundItems.query().name(ER_ITEM.RAW_CHICKEN.name).within(12).nearest() !== null || !target.valid(),
            60_000
        );
    }
    log(`could not gather ${qty} raw chicken`);
    return false;
}

/** Bank, then the trees north of the Ardougne bank. Null once the pack holds enough. */
export function sourceLogs(snap: QuestSnapshot, qty: number): QuestStep | null {
    if (held(snap, ER_ITEM.LOGS) >= qty) {
        return null;
    }
    return fromBank(snap, ER_ITEM.LOGS, qty)
        ?? sourceAxe(snap)
        ?? { kind: 'custom', name: `chop ${qty} logs`, run: log => chopLogs(qty, log) };
}

/** Bank, then the Ardougne farm. Null once the pack holds enough. */
export function sourceChickens(snap: QuestSnapshot, qty: number): QuestStep | null {
    if (held(snap, ER_ITEM.RAW_CHICKEN) >= qty) {
        return null;
    }
    return fromBank(snap, ER_ITEM.RAW_CHICKEN, qty)
        ?? { kind: 'custom', name: `kill chickens for ${qty} raw chicken`, run: log => huntChickens(qty, log) };
}

// Why: the field behind the stile is the closest wheat to the zoo, the trees and the chicken farm,
// which is where the rest of the scarecrow comes from.

/** Bank, then the Ardougne wheat field, one sheaf per pass. */
export function sourceGrain(snap: QuestSnapshot, qty: number): QuestStep | null {
    if (held(snap, ER_ITEM.GRAIN) >= qty) {
        return null;
    }
    return fromBank(snap, ER_ITEM.GRAIN, qty)
        ?? { kind: 'pickLoc', loc: 'Wheat', op: 'Pick', item: ER_ITEM.GRAIN.name, anchor: ER_TILE.WHEAT };
}
