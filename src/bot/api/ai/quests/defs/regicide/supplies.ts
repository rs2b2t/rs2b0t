import Tile from '../../../../../geometry/Tile.js';
import { gpShort } from '../../engine/provisioning.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { RG_ITEM, RG_TILE, banked, carried, type RegicideItem } from './areas.js';
import { FOOD_FLOAT } from '../../food.js';

// Why: Tirannwn has one shop and no bank, and the way out is the Arandar palisade or the Underground Pass walked end to end, so everything the forest consumes is bought and drawn in Ardougne before the quest leaves the mainland.

/** Aemad's Adventuring Supplies, 20 tiles from the Ardougne bank. */
export const ARDOUGNE_STORE = { npc: 'Aemad', anchor: new Tile(2613, 3293, 0) };
/** Jatix's Herblore Shop in Taverley, the nearest pestle and mortar to Ardougne. */
export const TAVERLEY_HERBLORE = { npc: 'Jatix', anchor: new Tile(2899, 3428, 0) };
/** Hickton's Archery Emporium in Catherby; Aemad's sells the arrows but no bow to fire them from. */
export const CATHERBY_ARCHERY = { npc: 'Hickton', anchor: new Tile(2825, 3442, 0) };
/** The coal trucks site north-east of Ardougne. */
export const COAL_ROCKS = new Tile(2581, 3480, 0);
/** The range beside the Ardougne bank, for the rabbit the lazy guard wants. */
export const ARDOUGNE_RANGE = new Tile(2648, 3298, 0);

// Why: Making and lighting the cloth arrow each requires a free slot; 12 food left too little room once the bomb was added.
export const FOOD_TARGET = FOOD_FLOAT;
/** 4 balls of wool weave one strip of cloth, and the loom takes them in one go. */
export const WOOL_TARGET = 4;
/** 3 ropes: the swing spends one per attempt, and the walk back in takes it a second time. */
export const ROPE_TARGET = 3;
/** Arrows stack, so the float is free; one is spent per shot at the bridge stay rope, hit or miss. */
export const ARROW_TARGET = 50;
/** Food carried through the coal run and the walk to Rimmington, where there is no bank. */
export const STILL_FOOD = 4;
// Why: 12 is 2 clean distillations at 6 apiece. 18 was 3, and coal doesn't stack, so with the bomb chain and the food alongside it the pack ran out of room and the mining step kept swinging at a full inventory.
export const COAL_TARGET = 12;
/** Two barrels of tar, allowing one distillation retry without another pass crossing. */
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
     * Why: the gate is re-asked every cycle and the pass is walked with the pack in hand, so a gate keyed on the full float blocks as soon as anything is spent: the guide-rope shot costs an arrow, the rock swing a rope, a trap a shark, and the run parks on "have 49" of 50 arrows.
     */
    min?: number;
    /** Where to buy it when neither the pack nor the bank has one. */
    shop?: { npc: string; anchor: Tile };
    estGp?: number;
}

// Why: grouped by where each thing is sold. Aemad stocks 5 of the 9, and by quest order they take 4 separate visits with Taverley and Catherby in between: Ardougne, Taverley, Ardougne, Catherby, Ardougne, about 3 minutes of walking.
// Why: the bank items last, because the bank is in Ardougne and the pass is entered from West Ardougne, so finishing there is the one ordering that walks the loop once.
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
    // Why: the way into Tirannwn is the Underground Pass, whose rope swing onto the grid shelf is its one item-use seam: `upass_rock_ropeswing` deletes the rope before it rolls agility, so a failed swing costs one and a pack without them stands on the bridge shelf until the watchdog parks it.
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
    // Why: the chasm before the rope swing is crossed by shooting the bridge stay rope, `upass_bridge` stores nothing, and the lever that lowers the bridge again sits on the west bank and only sends you east. So a completed Underground Pass still leaves the fire arrow to build on every westbound walk.
    {
        item: RG_ITEM.SHORTBOW,
        qty: 1,
        reason: "firing the bridge stay rope; Aemad's stocks no bow",
        shop: CATHERBY_ARCHERY,
        estGp: 150
    },
    // Why: past the well the pass drops into the slave cages, and the only op that leaves that pocket is `upass_mud`, which takes a spade and nothing else. The ledge reads as a second way out, but no tile of the cage pocket stands beside it.
    // Why: drawn, never bought: the 4 shops that stock a spade are Karamja, Shilo, Rellekka and the lighthouse, none of them on this side of the map, so a `shop` here sends the run to Aemad's for something he's never sold.
    { item: RG_ITEM.SPADE, qty: 1, reason: 'the filled-in tunnel out of the slave cages' },
    { item: RG_ITEM.SHARK, qty: FOOD_TARGET, reason: 'the traps, the soldiers and the elf warriors', min: 1 }
];

export const KEEP_IDS: readonly number[] = Object.values(RG_ITEM).map(item => item.id);

// Why: the walk back in carries the crossings and the food and nothing that built the bomb: the wool is already cloth, the limestone already dust, and the pickaxe and pestle have no rock or lump left to work. The full kit would be 9 slots of dead weight beside a barrel bomb that has to fit too.
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

/** What the kit is still short of, for the stop message. */
export function kitShortfall(snap: QuestSnapshot, kit: readonly Supply[] = KIT): string[] {
    return kit.filter(supply => carried(snap, supply.item) < (supply.min ?? supply.qty)).map(
        supply => `${supply.min ?? supply.qty}x ${supply.item.name} (${supply.reason}), have ${carried(snap, supply.item)}`
    );
}

/** Coal for the still, mined at the trucks; no 2004 shop keeps a stock of it. */
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
