import { Execution } from '../../../../execution/Execution.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { DORIC_PICKAXES } from '../doric.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { isUnderground } from '../../exec/primitives.js';
import { driveUntil, useOnLoc } from '../../exec/prompts.js';
import { GENERAL_STORE, KS_ID, KS_NAME, KS_TILE, WYDIN } from './areas.js';

const COINS_ID = 995;

// Why: the float is a threshold rather than a target, as `buy` withdraws `estGp` when the pack is short, so topping up to an exact balance sends the bot back to a booth after every item bought.
export const COIN_FLOAT = 1000;
export const COIN_LOW = 200;

/** Comfortably over any price here, comfortably under the float. */
const SHOP_GP = 30;

/** All four fields are required: a defaulted low-water mark is a branch that never fires. */
export interface FoodWant {
    name: string;
    held: number;
    target: number;
    low: number;
}

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

function withdraw(items: { name: string; qty: number; id?: number }[]): QuestStep {
    return { kind: 'withdraw', items };
}

// Why: no bank is pinned, as the quest runs across Falador, Varrock, Port Sarim and Rimmington.
// Why: bank contents are global and only the walk differs, so naming one booth costs a kingdom-crossing on every leg that touches it.
const scanBank: QuestStep = { kind: 'scanBank' };

// Why: `ownsInventory` opts this quest out of the engine's coin and food withdrawal, so the module draws both itself.
// Why: food is only ever asked for above ground, as preparation has to stop at the door or a top-up mid-dungeon walks the bot back out of it.

/** The module's own coin and food withdrawal, or null when the pack is ready. */
export function kit(snap: QuestSnapshot, food?: FoodWant | null): QuestStep | null {
    const underground = snap.tile ? isUnderground(snap.tile) : false;
    const items: { name: string; qty: number; id?: number }[] = [];
    if (heldId(snap, COINS_ID) < COIN_LOW) {
        items.push({ name: 'Coins', qty: COIN_FLOAT, id: COINS_ID });
    }
    if (food && !underground && food.held < food.low) {
        items.push({ name: food.name, qty: food.target - food.held });
    }
    if (items.length === 0) {
        return null;
    }
    return snap.bankKnown ? withdraw(items) : scanBank;
}

/** The palace-kitchen sink, two tiles from the pie-dish spawn. */
async function fillBucket(log: (m: string) => void): Promise<boolean> {
    return useOnLoc(
        KS_ID.BUCKET,
        { name: 'Sink', near: KS_TILE.KITCHEN_SINK },
        [],
        () => Inventory.countById(KS_ID.BUCKET_OF_WATER) > 0,
        log
    );
}

async function mixDough(log: (m: string) => void): Promise<boolean> {
    const flour = Inventory.first(KS_NAME.POT_OF_FLOUR);
    const water = Inventory.first(KS_NAME.BUCKET_OF_WATER);
    if (!flour || !water) {
        log('no flour or water in the pack to mix');
        return false;
    }
    if (!(await flour.useOn(water))) {
        return false;
    }
    // dough_interface offers bread / pastry / pizza / pitta; only pastry makes a shell.
    return driveUntil(
        () => Inventory.countById(KS_ID.PASTRY_DOUGH) > 0,
        ['Pastry dough'],
        log
    );
}

// Why: the Range carries no ops at all — cooking is `[oplocu,_cooking_oven]`, a use-on, the same shape as filling the bucket.
// Why: a fire will not do, as cooking_generic_redberry_pie answers "You need a proper oven to cook that."

/** Bake the redberry pie on a range. */
async function cookPie(log: (m: string) => void): Promise<boolean> {
    return useOnLoc(
        KS_ID.UNCOOKED_PIE,
        { name: 'Range', near: KS_TILE.RANGE },
        [],
        () => Inventory.countById(KS_ID.REDBERRY_PIE) > 0
            || Inventory.countById(KS_ID.BURNT_PIE) > 0,
        log
    );
}

async function emptyBurntPie(log: (m: string) => void): Promise<boolean> {
    const burnt = Inventory.first(KS_NAME.BURNT_PIE);
    if (!burnt) {
        return true;
    }
    log('the pie burnt — recovering the dish');
    if (!(await burnt.interact('Empty Dish'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.countById(KS_ID.PIE_DISH) > 0, 8000);
}

const buy = (item: string, shop: { npc: string; anchor: typeof KS_TILE.WYDIN }): QuestStep =>
    ({ kind: 'buy', item, qty: 1, shop, estGp: SHOP_GP });

/** The only non-members source is the Varrock palace kitchen ground spawn. */
export const pieDish = (snap: QuestSnapshot): QuestStep =>
    bankedId(snap, KS_ID.PIE_DISH) > 0
        ? withdraw([{ name: KS_NAME.PIE_DISH, qty: 1, id: KS_ID.PIE_DISH }])
        : { kind: 'grabGround', item: KS_NAME.PIE_DISH, anchor: KS_TILE.PIE_DISH_SPAWN, waitIfMissing: true };

const combine = (item: string, target: string, product: string): QuestStep =>
    ({ kind: 'useOn', item, targetKind: 'item', target, anchor: KS_TILE.WYDIN, product });

// Why: the chain is read backwards from the pie, so a part-built chain resumes at the right rung.
// Why: nothing in the game sells a redberry pie and there is no ground spawn, so it has to be baked.

/** The next rung of the redberry-pie chain. */
export function pie(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, KS_ID.REDBERRY_PIE) > 0) {
        return { kind: 'wait', reason: 'redberry pie already held' };
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    if (bankedId(snap, KS_ID.REDBERRY_PIE) > 0) {
        return withdraw([{ name: KS_NAME.REDBERRY_PIE, qty: 1, id: KS_ID.REDBERRY_PIE }]);
    }
    // A burn holds the dish hostage inside the ruined pie; emptying it is a
    // free op, where re-deriving would walk all the way back to Varrock.
    if (heldId(snap, KS_ID.BURNT_PIE) > 0) {
        return { kind: 'custom', name: 'empty the burnt dish', run: emptyBurntPie };
    }
    if (heldId(snap, KS_ID.UNCOOKED_PIE) > 0) {
        return { kind: 'custom', name: 'cook the redberry pie', run: cookPie };
    }
    if (heldId(snap, KS_ID.PIE_SHELL) > 0) {
        return heldId(snap, KS_ID.REDBERRIES) > 0
            ? combine(KS_NAME.REDBERRIES, KS_NAME.PIE_SHELL, KS_NAME.UNCOOKED_PIE)
            : buy(KS_NAME.REDBERRIES, WYDIN);
    }
    if (heldId(snap, KS_ID.PASTRY_DOUGH) > 0) {
        return heldId(snap, KS_ID.PIE_DISH) > 0
            ? combine(KS_NAME.PASTRY_DOUGH, KS_NAME.PIE_DISH, KS_NAME.PIE_SHELL)
            : pieDish(snap);
    }
    // Why: everything water-side is a Varrock errand and everything else a Port Sarim one, so the bucket and the sink come first and the town is left once.
    // Why: buying the bucket in Port Sarim's reach instead cost a 360-tile round trip back to Falador between the berries and the range.
    if (heldId(snap, KS_ID.BUCKET_OF_WATER) === 0) {
        return heldId(snap, KS_ID.BUCKET) > 0
            ? { kind: 'custom', name: 'fill the bucket', run: fillBucket }
            : buy(KS_NAME.BUCKET, GENERAL_STORE);
    }
    if (heldId(snap, KS_ID.PIE_DISH) === 0) {
        return pieDish(snap);
    }
    if (heldId(snap, KS_ID.POT_OF_FLOUR) === 0) {
        return buy(KS_NAME.POT_OF_FLOUR, WYDIN);
    }
    if (heldId(snap, KS_ID.REDBERRIES) === 0) {
        return buy(KS_NAME.REDBERRIES, WYDIN);
    }
    return { kind: 'custom', name: 'mix pastry dough', run: mixDough };
}

// Why: smelting.rs2 loses half of every batch — "The ore is too impure and you fail to refine it."
// Why: eight ore leaves a 9-in-256 chance of not clearing two bars, and a short batch is a no-op as the loop re-derives from the bar count.
export const ORE_PER_TRIP = 8;

type Pickaxe = (typeof DORIC_PICKAXES)[number];

const pickHeld = (snap: QuestSnapshot, p: Pickaxe): boolean =>
    heldId(snap, p.id) > 0 || (snap.wornIds?.has(p.id) ?? false);

/** Best-first, so the strongest pickaxe the level allows wins. */
function bestPick(level: number, has: (p: Pickaxe) => boolean): Pickaxe | null {
    return DORIC_PICKAXES.find(p => level >= p.level && has(p)) ?? null;
}

export function pickaxeAt(snap: QuestSnapshot, miningLevel: number): QuestStep | null {
    if (bestPick(miningLevel, p => pickHeld(snap, p))) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    const banked = bestPick(miningLevel, p => bankedId(snap, p.id) > 0);
    if (banked) {
        return withdraw([{ name: banked.name, qty: 1, id: banked.id }]);
    }
    return { kind: 'grabGround', item: 'Bronze pickaxe', anchor: KS_TILE.PICKAXE_SPAWN, waitIfMissing: true };
}

async function smeltIron(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(KS_TILE.FURNACE, { radius: 2, attempts: 4, timeoutMs: 300_000, log }))) {
        return false;
    }
    const before = Inventory.countById(KS_ID.IRON_BAR);
    const furnace = Locs.query().name('Furnace').action('Smelt').within(8).nearest();
    if (!furnace || !(await furnace.interact('Smelt'))) {
        log('the Falador furnace did not answer');
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 8000))) {
        log('the smelting menu never opened');
        return false;
    }
    if (!(await ChatDialog.makeX('Iron', ORE_PER_TRIP))) {
        log(`no 'Iron' in the smelt menu: [${ChatDialog.makeProducts().join(', ')}]`);
        return false;
    }
    await Execution.delayUntil(() => Inventory.countById(KS_ID.IRON_ORE) === 0, 120_000);
    return Inventory.countById(KS_ID.IRON_BAR) > before;
}

/**
 * Nothing sells iron bars — Drogo's Mining Emporium stocks zero and the only
 * ground spawn is deep in the Wilderness — so they are smelted.
 */
export function ironBarsAt(snap: QuestSnapshot, miningLevel: number): QuestStep {
    const held = heldId(snap, KS_ID.IRON_BAR);
    if (held >= 2) {
        return { kind: 'wait', reason: 'two iron bars already held' };
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    const banked = bankedId(snap, KS_ID.IRON_BAR);
    if (banked > 0) {
        return withdraw([{ name: KS_NAME.IRON_BAR, qty: Math.min(2 - held, banked), id: KS_ID.IRON_BAR }]);
    }
    // Why: `mineRock` ignores its qty and mines one ore per invocation, so the batch is counted here.
    // Why: smelting on the first ore would walk the 130 tiles between Rimmington and the furnace eight times over.
    if (heldId(snap, KS_ID.IRON_ORE) >= ORE_PER_TRIP) {
        return { kind: 'custom', name: 'smelt iron bars', run: smeltIron };
    }
    return pickaxeAt(snap, miningLevel)
        ?? { kind: 'mineRock', rock: 'Iron', item: KS_NAME.IRON_ORE, qty: ORE_PER_TRIP, anchor: KS_TILE.IRON_ROCKS };
}

export const pickaxe = (snap: QuestSnapshot): QuestStep | null => pickaxeAt(snap, Skills.level('mining'));
