import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import type Tile from '../../../../../geometry/Tile.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { gearOf, weaponOf } from '../../../../loadout/loadoutPlan.js';
import { openDialogue } from '../../exec/primitives.js';
import { driveUntil } from '../../exec/prompts.js';
import { QuestFood } from '../../food.js';
import { QuestLoadout } from '../../gear.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { FT_ID, FT_TILE } from './areas.js';

export const heldCount = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
export const held = (snap: QuestSnapshot, name: string): boolean => heldCount(snap, name) > 0;
export const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
export const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
export const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;
const bankedId = (snap: QuestSnapshot, id: number): number => snap.bankIds?.get(id) ?? 0;

const COMBAT_FOODS = ['Lobster', 'Swordfish', 'Tuna', 'Salmon', 'Trout'] as const;

export function foodNames(): string[] {
    const configured = QuestFood.name?.trim();
    const names = [configured, ...COMBAT_FOODS].filter((n): n is string => Boolean(n));
    return [...new Map(names.map(n => [n.toLowerCase(), n])).values()];
}

function foodHeld(snap: QuestSnapshot): number {
    return foodNames().reduce((total, name) => total + heldCount(snap, name), 0);
}

function foodInBank(snap: QuestSnapshot): string | null {
    return foodNames().find(name => banked(snap, name) > 0) ?? null;
}

const FOOD_TARGET = 8;

export const scanBank = (): QuestStep => ({ kind: 'scanBank', bank: FT_TILE.SEERS_BANK });

const withdrawStep = (items: { name: string; qty: number; id?: number }[]): QuestStep =>
    ({ kind: 'withdraw', items, bank: FT_TILE.SEERS_BANK });

interface Want {
    name: string;
    qty: number;
    id?: number;
}

/**
 * Top the pack up from the Seers' Village bank.
 * Returns null when everything asked for is already carried, or the bank has none of it.
 */
export function fromBank(snap: QuestSnapshot, wants: readonly Want[]): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank();
    }
    const missing = wants
        .filter(w => (w.id === undefined ? heldCount(snap, w.name) : heldId(snap, w.id)) < w.qty)
        .filter(w => (w.id === undefined ? banked(snap, w.name) : bankedId(snap, w.id)) > 0)
        .map(w => ({ name: w.name, qty: w.qty, id: w.id }));
    return missing.length > 0 ? withdrawStep(missing) : null;
}

// Why: the two tools the quest cannot buy anywhere near Rellekka both have a permanent ground spawn inside the town's own map squares.

/** Bank first, then the spawn north-east of Rellekka. */
export function gatherKnife(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, 'Knife')) {
        return null;
    }
    return fromBank(snap, [{ name: 'Knife', qty: 1 }])
        ?? { kind: 'grabGround', item: 'Knife', anchor: FT_TILE.KNIFE_SPAWN };
}

export function gatherAxe(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, 'Bronze axe') || worn(snap, 'Bronze axe') || anyAxe(snap)) {
        return null;
    }
    return fromBank(snap, [{ name: 'Bronze axe', qty: 1 }])
        ?? { kind: 'grabGround', item: 'Bronze axe', anchor: FT_TILE.AXE_SPAWN };
}

const AXES = ['bronze axe', 'iron axe', 'steel axe', 'black axe', 'mithril axe', 'adamant axe', 'rune axe'];

function anyAxe(snap: QuestSnapshot): boolean {
    return AXES.some(name => snap.inv.has(name) || snap.worn.has(name));
}

/** Arhein's Catherby stall is the closest tinderbox to Rellekka. */
export function gatherTinderbox(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, 'Tinderbox')) {
        return null;
    }
    return fromBank(snap, [{ name: 'Tinderbox', qty: 1 }])
        ?? { kind: 'buy', item: 'Tinderbox', qty: 1, shop: { npc: 'Arhein', anchor: FT_TILE.ARHEIN }, estGp: 200 };
}

// Why: no shop within two kingdoms of Rellekka carries a raw shark with stock, and Fishing 76 is well past what the quest asks for.

/** Bank first, then Rufus in Canifis — the only restocking raw shark in the game. */
export function gatherShark(snap: QuestSnapshot): QuestStep | null {
    if (heldId(snap, FT_ID.RAW_SHARK) > 0) {
        return null;
    }
    return fromBank(snap, [{ name: 'Raw shark', qty: 1, id: FT_ID.RAW_SHARK }])
        ?? { kind: 'buy', item: 'Raw shark', qty: 1, shop: { npc: 'Rufus', anchor: FT_TILE.RUFUS }, estGp: 4000 };
}

// Why: the bank is a fifty-second walk from Rellekka, and the quest spends coin in five places — a lump costs one trip where exact change costs five.
const COIN_LUMP = 20_000;

export function gatherCoins(snap: QuestSnapshot, need: number): QuestStep | null {
    if (heldCount(snap, 'Coins') >= need) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, 'Coins');
    if (available + heldCount(snap, 'Coins') < need) {
        return { kind: 'wait', reason: `need ${need} gp and the bank cannot cover it` };
    }
    return withdrawStep([{ name: 'Coins', qty: Math.min(available, Math.max(need, COIN_LUMP)) }]);
}

const TIERS = ['rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;

// Why: the Draugen's melee defences are all 100, so the tier matters and the damage type does not.
// Why: chainbody leads the body slot because rune platebody also wants Dragon Slayer, and `Equipment.equip` refuses it silently.
const GEAR_SLOTS: readonly (readonly string[])[] = [
    ['2h sword', 'longsword', 'scimitar', 'battleaxe', 'warhammer', 'mace', 'sword'],
    ['chainbody', 'platebody'],
    ['platelegs', 'plateskirt'],
    ['full helm', 'med helm'],
    ['kiteshield', 'sq shield']
];

function wearingSlot(snap: QuestSnapshot, kinds: readonly string[]): boolean {
    for (const name of snap.worn) {
        if (kinds.some(kind => name.endsWith(kind))) {
            return true;
        }
    }
    return false;
}

function bestInBank(snap: QuestSnapshot, kinds: readonly string[]): string | null {
    for (const tier of TIERS) {
        for (const kind of kinds) {
            const name = `${tier} ${kind}`;
            if (banked(snap, name) > 0 || held(snap, name)) {
                return name[0]!.toUpperCase() + name.slice(1);
            }
        }
    }
    return null;
}

/** The declared loadout, or the best the bank holds when nothing is declared. */
export function plannedGear(snap: QuestSnapshot): string[] {
    const declared = gearOf(QuestLoadout.current);
    const names = declared.length > 0
        ? declared
        : GEAR_SLOTS.filter(kinds => !wearingSlot(snap, kinds))
            .map(kinds => bestInBank(snap, kinds))
            .filter((name): name is string => name !== null);
    return names.filter(name => !worn(snap, name));
}

export function wearAll(names: readonly string[]): QuestStep {
    return {
        kind: 'custom',
        name: `wear ${names.join(', ')}`,
        run: async log => {
            for (const name of names) {
                if (Equipment.contains(name) || (await Equipment.equip(name))) {
                    continue;
                }
                log(`cannot wear ${name} — banking it and moving on`);
            }
            return true;
        }
    };
}

/**
 * Dress and feed for the Draugen. Returns null once the kit is on.
 * Missing armour is survivable; a missing weapon is not.
 */
export function combatKit(snap: QuestSnapshot): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank();
    }
    const food = foodInBank(snap);
    if (foodHeld(snap) < FOOD_TARGET && food !== null) {
        return withdrawStep([{ name: food, qty: FOOD_TARGET - foodHeld(snap) }]);
    }
    const wanted = plannedGear(snap).filter(name => banked(snap, name) > 0 || held(snap, name));
    const toWithdraw = wanted.filter(name => !held(snap, name));
    if (toWithdraw.length > 0) {
        return withdrawStep(toWithdraw.map(name => ({ name, qty: 1 })));
    }
    const toWear = wanted.filter(name => held(snap, name));
    if (toWear.length > 0) {
        return wearAll(toWear);
    }
    const weapon = weaponOf(QuestLoadout.current);
    if (snap.worn.size === 0 && weapon === null) {
        return { kind: 'wait', reason: 'no loadout gear and nothing worn — the Draugen hits back' };
    }
    return null;
}

const WALK = { radius: 2, attempts: 4, timeoutMs: 300_000 } as const;

export async function walkTo(tile: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === tile.level && tile.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(tile, { ...WALK, radius, log });
}

// Why: a conversation opened on the tick the walk lands sometimes drives to nothing, and one re-open costs a second where the engine's own retry costs the step's budget again.

/** Walk to an NPC and keep re-opening the conversation until the goal lands. */
export async function talkUntil(
    npc: string,
    near: Tile,
    prefer: readonly string[],
    expect: () => boolean,
    log: (m: string) => void,
    ms = 60_000
): Promise<boolean> {
    if (!(await walkTo(near, 2, log))) {
        return false;
    }
    const deadline = performance.now() + ms;
    while (performance.now() < deadline && !expect()) {
        await Execution.delayTicks(2);
        if (!(await openDialogue(npc, log))) {
            continue;
        }
        await driveUntil(expect, [...prefer], log, Math.min(30_000, deadline - performance.now()));
    }
    return expect();
}

/** Use a held item on another held item and wait for the product id to land. */
export function combine(itemId: number, targetId: number, productId: number, label: string): QuestStep {
    return {
        kind: 'custom',
        name: label,
        run: async log => {
            const item = Inventory.items().find(i => i.id === itemId);
            const target = Inventory.items().find(i => i.id === targetId);
            if (!item || !target) {
                log(`${label}: missing ${!item ? itemId : targetId} in the pack`);
                return false;
            }
            const before = Inventory.countById(productId);
            if (!(await item.useOn(target))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.countById(productId) > before, 10_000);
        }
    };
}
