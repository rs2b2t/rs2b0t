import Tile from '../../../../../geometry/Tile.js';
import { gpShort } from '../../engine/provisioning.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { RG_ITEM, RG_TILE, banked, carried, type RegicideItem } from './areas.js';

// Why: Tirannwn has one shop and no bank, and the way back out is either the Arandar palisade or the Underground Pass walked end to end — so everything the forest consumes is bought and drawn in Ardougne, one leg's walk from the bank, before the quest ever leaves the mainland.

/** Aemad's Adventuring Supplies, twenty tiles from the Ardougne bank. */
export const ARDOUGNE_STORE = { npc: 'Aemad', anchor: new Tile(2613, 3293, 0) };
/** Jatix's Herblore Shop in Taverley — the nearest pestle and mortar to Ardougne. */
export const TAVERLEY_HERBLORE = { npc: 'Jatix', anchor: new Tile(2899, 3428, 0) };
/** Hickton's Archery Emporium in Catherby — Aemad's sells the arrows but no bow to fire them from. */
export const CATHERBY_ARCHERY = { npc: 'Hickton', anchor: new Tile(2825, 3442, 0) };
/** The coal trucks site north-east of Ardougne. */
export const COAL_ROCKS = new Tile(2581, 3480, 0);
/** The range beside the Ardougne bank, for the rabbit the lazy guard wants. */
export const ARDOUGNE_RANGE = new Tile(2648, 3298, 0);

// Why: the float is sized by the bridge, not by the fights. `make_clotharrow` tests `inv_itemspace` for the cloth arrow BEFORE it deletes the damp cloth, and `light_firearrow` tests the same gate again, so the kit plus Koftik's cloth has to leave a slot spare or the run parks on "You don't have space to do that." Twelve was measured too tight live — the pass is walked twice and the second walk carries the bomb.
export const FOOD_TARGET = 11;
/** Four balls of wool weave one strip of cloth, and the loom takes them in one go. */
export const WOOL_TARGET = 4;
/** Three ropes: the swing spends one per attempt, and the walk back in takes it a second time. */
export const ROPE_TARGET = 3;
/** Arrows stack, so the float is free — one is spent per shot at the bridge stay rope, hit or miss. */
export const ARROW_TARGET = 50;
/** Food carried through the coal run and the walk to Rimmington, where there is no bank. */
export const STILL_FOOD = 4;
// Why: twelve, which is two clean distillations at six apiece. Eighteen was three, and coal does not stack — with the bomb chain and the food alongside it the pack ran out of room at four, and the mining step kept swinging at a full inventory.
export const COAL_TARGET = 12;
/** Two barrels of tar, so a still that resets does not send the run back across the Underground Pass. */
export const BARREL_TARGET = 2;

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: RG_TILE.ARDOUGNE_BANK };
}

export function withdraw(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: RG_TILE.ARDOUGNE_BANK };
}

/** Draw `qty` from the bank, or null when the pack already holds enough or the bank has none. */
export function fromBank(snap: QuestSnapshot, item: RegicideItem, qty: number): QuestStep | null {
    const have = carried(snap, item);
    if (have >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stock = banked(snap, item);
    return stock <= 0 ? null : withdraw([{ name: item.name, id: item.id, qty: Math.min(qty - have, stock) }]);
}

function buyOrWait(snap: QuestSnapshot, step: Extract<QuestStep, { kind: 'buy' }>): QuestStep {
    if (gpShort(snap, step.estGp) > 0) {
        return { kind: 'wait', reason: `need ~${step.estGp} gp for ${step.item}` };
    }
    return step;
}

export interface Supply {
    item: RegicideItem;
    qty: number;
    reason: string;
    /**
     * What the crossing refuses to go on without, when that is less than the float bought for it.
     * Why: the gate is re-asked every cycle and the pass is walked with the pack in hand, so a gate keyed on the full float blocks the moment anything is spent — the guide-rope shot costs an arrow, the rock swing a rope, a trap a shark, and the run parked at the bridge's west foot on "have 49" of fifty arrows.
     */
    min?: number;
    /** Where to buy it when neither the pack nor the bank has one. */
    shop?: { npc: string; anchor: Tile };
    estGp?: number;
}

// Why: grouped by where each thing is sold, not by the order the quest reaches it. Aemad stocks five of the nine and the old order asked for them in four separate visits, with Taverley and Catherby in between — the circuit ran Ardougne, Taverley, Ardougne, Catherby, Ardougne and cost about three minutes of walking.
// Why: the bank items last, because the bank is in Ardougne and the pass is entered from West Ardougne, so finishing there is the one ordering that does not walk the loop twice.
export const KIT: readonly Supply[] = [
    {
        item: RG_ITEM.BALL_OF_WOOL,
        qty: WOOL_TARGET,
        reason: 'the loom, which weaves four into the bomb\'s fuse cloth',
        shop: ARDOUGNE_STORE,
        estGp: 60
    },
    {
        item: RG_ITEM.PICKAXE,
        qty: 1,
        reason: 'the limestone quarry on the Arandar pass',
        shop: ARDOUGNE_STORE,
        estGp: 40
    },
    // Why: the way into Tirannwn is the Underground Pass, and the rope swing onto the grid shelf is the one seam of it that is an item-use — `upass_rock_ropeswing` deletes the rope before it rolls agility, so a failed swing costs one. A pack without them stands on the bridge shelf until the watchdog parks it.
    {
        item: RG_ITEM.ROPE,
        qty: ROPE_TARGET,
        reason: "the pass's rope swing, which eats one per attempt",
        min: 1,
        shop: ARDOUGNE_STORE,
        estGp: 120
    },
    {
        item: RG_ITEM.BRONZE_ARROW,
        qty: ARROW_TARGET,
        reason: 'the fire arrow, one spent per shot whether it lands or not',
        min: 1,
        shop: ARDOUGNE_STORE,
        estGp: 600
    },
    {
        item: RG_ITEM.TINDERBOX,
        qty: 1,
        reason: 'lighting the cloth-wrapped arrow',
        shop: ARDOUGNE_STORE,
        estGp: 150
    },
    {
        item: RG_ITEM.PESTLE,
        qty: 1,
        reason: 'grinding the sulphur and the quicklime',
        shop: TAVERLEY_HERBLORE,
        estGp: 60
    },
    // Why: the chasm before the rope swing is crossed by shooting the bridge stay rope, and `upass_bridge` stores nothing — the lever that lowers the bridge again sits on the west bank and only sends the player east. So a completed Underground Pass still leaves the fire arrow to build on every westbound walk.
    {
        item: RG_ITEM.SHORTBOW,
        qty: 1,
        reason: "firing the bridge stay rope; Aemad's stocks no bow",
        shop: CATHERBY_ARCHERY,
        estGp: 150
    },
    // Why: past the well the pass drops into the slave cages, and the only op that leaves that pocket is `upass_mud`, which takes a spade and nothing else. The ledge reads as a second way out and is not one — no tile of the cage pocket stands beside it.
    // Why: and it is drawn, never bought. Four shops in the world stock a spade — Karamja, Shilo, Rellekka and the lighthouse — and not one is on this side of the map, so a `shop` here sends the run to Aemad's to ask for something he has never sold.
    { item: RG_ITEM.SPADE, qty: 1, reason: 'the filled-in tunnel out of the slave cages' },
    { item: RG_ITEM.SHARK, qty: FOOD_TARGET, reason: 'the traps, the soldiers and the elf warriors', min: 1 }
];

export const KEEP_IDS: readonly number[] = Object.values(RG_ITEM).map(item => item.id);

// Why: the walk back in carries the crossings and the food, and nothing that built the bomb. The wool is already cloth, the limestone is already dust, and the pickaxe and the pestle have no rock and no lump left to work — redrawing the full kit for the second crossing is nine slots of dead weight beside a barrel bomb that has to fit too.
const RETURN_IDS = new Set<number>([
    RG_ITEM.SPADE.id, RG_ITEM.ROPE.id, RG_ITEM.SHORTBOW.id,
    RG_ITEM.BRONZE_ARROW.id, RG_ITEM.TINDERBOX.id, RG_ITEM.SHARK.id
]);

/** What the second crossing needs, which is the first crossing minus the recipe. */
export const RETURN_KIT: readonly Supply[] = KIT.filter(supply => RETURN_IDS.has(supply.item.id));

/** The next missing piece of kit, or null once the pack is ready for Tirannwn. */
export function sourceKit(snap: QuestSnapshot, kit: readonly Supply[] = KIT): QuestStep | null {
    for (const supply of kit) {
        if (carried(snap, supply.item) >= supply.qty) {
            continue;
        }
        const drawn = fromBank(snap, supply.item, supply.qty);
        if (drawn) {
            return drawn;
        }
        if (supply.shop && supply.estGp !== undefined) {
            return buyOrWait(snap, {
                kind: 'buy',
                item: supply.item.name,
                qty: supply.qty - carried(snap, supply.item),
                shop: supply.shop,
                estGp: supply.estGp
            });
        }
    }
    return null;
}

/** What the kit is still short of, for an honest stop rather than a silent retry loop. */
export function kitShortfall(snap: QuestSnapshot, kit: readonly Supply[] = KIT): string[] {
    return kit.filter(supply => carried(snap, supply.item) < (supply.min ?? supply.qty)).map(
        supply => `${supply.min ?? supply.qty}x ${supply.item.name} (${supply.reason}), have ${carried(snap, supply.item)}`
    );
}

/** Coal for the still, mined at the trucks rather than bought — no 2004 shop keeps a stock of it. */
export function sourceCoal(snap: QuestSnapshot): QuestStep | null {
    if (carried(snap, RG_ITEM.COAL) >= COAL_TARGET) {
        return null;
    }
    const drawn = fromBank(snap, RG_ITEM.COAL, COAL_TARGET);
    if (drawn) {
        return drawn;
    }
    return { kind: 'mineRock', rock: 'Coal', item: RG_ITEM.COAL.name, qty: COAL_TARGET, anchor: COAL_ROCKS };
}
