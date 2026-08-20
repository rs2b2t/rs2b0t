import { Equipment } from '../../../../equipment/Equipment.js';
import { gearOf } from '../../../../loadout/loadoutPlan.js';
import { QuestLoadout } from '../../gear.js';
import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { ITEM_DB } from '../../../../../data/itemdb.js';
import { UP_ITEM, UP_TILE, banked, carried, held, type UpassItem } from './areas.js';
import { FOOD_FLOAT } from '../../food.js';

/** Bronze arrows are what the fire arrow is built from, a stack covers every missed shot. */
export const ARROW_TARGET = 50;
// Why: the grid crossing and the orb corridor alone cost eight lobsters on the first clean run, and the traps below are timer-driven damage the module walks into rather than fights. The pass hands out food of its own, Koftik, the paladins and Nilhoof between them give a dozen, but those arrive as separate stacks that each take a slot, so the float is what has to cover the trapped stretches.
export const FOOD_TARGET = FOOD_FLOAT;

// Why: upass_bridge.rs2 gates the rope shot on oc_category = weapon_bow, which is thirteen items, not the
// one id the kit used to name. A crossbow is weapon_crossbow, fires bolts and must not qualify.

/** Every obj in the weapon_bow category, by id. */
export const BOW_IDS: ReadonlySet<number> = new Set(
    ITEM_DB.filter(i => /^(?:[a-z]+_)?(?:short|long)bow$|^ogre_bow$/.test(i.obj)).map(i => i.id)
);

const NAME_BY_ID: ReadonlyMap<number, string> = new Map(ITEM_DB.map(i => [i.id, i.name]));

const firstBow = (ids: Iterable<[number, number]> | undefined): number | null => {
    for (const [id, n] of ids ?? []) {
        if (n > 0 && BOW_IDS.has(id)) {
            return id;
        }
    }
    return null;
};

/** True once a bow is in the right hand, which is what `upass_bridge` reads. */
export function bowWorn(snap: QuestSnapshot): boolean {
    for (const id of snap.wornIds ?? []) {
        if (BOW_IDS.has(id)) {
            return true;
        }
    }
    return false;
}

/** True once a bow is worn or carried, which is what the cave mouth waits for. */
export function bowCarried(snap: QuestSnapshot): boolean {
    return bowWorn(snap) || firstBow(snap.invIds) !== null;
}

// Why: Aemad's counter is forty tiles from the booth this quest already banks at, and Lowe is the only bow
// counter this repo has a walked stand for. Nothing else in the kit has a shop worth the trip.

const AEMAD = { npc: 'Aemad', anchor: UP_TILE.AEMAD };
const LOWE = { npc: 'Lowe', anchor: UP_TILE.LOWE };

/** Rope is 18 base against Aemad's 1300 multiplier, a shortbow is 50 flat at Lowe's. Both carry headroom. */
const ROPE_GP = 40;
const BOW_GP = 100;

/** The plain shortbow is what a bank with no bow at all is sent to buy. */
const BOW_TO_BUY = UP_ITEM.SHORTBOW;

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: UP_TILE.ARDOUGNE_BANK };
}

export function withdraw(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: UP_TILE.ARDOUGNE_BANK };
}

/** Draw `qty` of `item` from the bank, or null when the pack already holds enough. */
export function fromBank(snap: QuestSnapshot, item: UpassItem, qty: number): QuestStep | null {
    const have = carried(snap, item);
    if (have >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stock = banked(snap, item);
    if (stock <= 0) {
        return null;
    }
    return withdraw([{ name: item.name, id: item.id, qty: Math.min(qty - have, stock) }]);
}

// Why: the pass has no bank and no shop, and every trip back out is the dungeon over again, so the
// kit is drawn in one go before the cave mouth rather than fetched when each obstacle asks for it.

/** Everything the pass consumes, in the order the quest reaches it. */
export const KIT: readonly {
    item: UpassItem;
    qty: number;
    reason: string;
    /** Set only where a counter sells it, so a dry bank is not the end of the road. */
    shop?: { npc: string; anchor: Tile };
    unitGp?: number;
}[] = [
    // Why: `upass_rock_ropeswing` deletes the rope before it rolls agility, so a failed swing costs one and
    // drops the player into the swamp, one rope is a single point of failure on a roll that is not certain.
    { item: UP_ITEM.ROPE, qty: 3, reason: 'the rock swing east, which eats one per attempt', shop: AEMAD, unitGp: ROPE_GP },
    { item: UP_ITEM.BRONZE_ARROW, qty: ARROW_TARGET, reason: 'the fire arrow' },
    { item: UP_ITEM.TINDERBOX, qty: 1, reason: 'lighting the cloth arrow and burning the tomb' },
    // Why: a probe of the second cavern from inside the slave cages reaches one thing and no other, the mud.
    // `upass_mud` takes a spade and nothing else, and every route south to the unicorn is behind it.
    { item: UP_ITEM.SPADE, qty: 1, reason: 'the filled-in tunnel out of the slave cages' },
    { item: UP_ITEM.BUCKET, qty: 1, reason: "the dwarf brew for Iban's tomb" },
    { item: UP_ITEM.LOBSTER, qty: FOOD_TARGET, reason: 'the demons, Kalrag and the trap falls' }
];

export const KEEP_IDS: readonly number[] = [
    ...Object.values(UP_ITEM).map(item => item.id),
    ...BOW_IDS
];

// Why: the buy step tops the purse up itself against the bank it is handed, so the only thing to decide
// here is whether there are coins at all. A buy emitted with none walks to a counter it cannot pay and
// fails there, which the engine retries; falling through instead reaches the shortfall stop that says so.

/** True when pack and bank between them cover the asking price. */
function canAfford(snap: QuestSnapshot, gp: number): boolean {
    return held(snap, UP_ITEM.COINS) + banked(snap, UP_ITEM.COINS) >= gp;
}

/** Buy the shortfall. Null when nothing is missing, or when there are no coins to pay with. */
function buyAt(
    snap: QuestSnapshot,
    item: UpassItem,
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    const missing = qty - carried(snap, item);
    const gp = missing * unitGp;
    if (missing <= 0 || !canAfford(snap, gp)) {
        return null;
    }
    return { kind: 'buy', item: item.name, qty: missing, shop, estGp: gp, bank: UP_TILE.ARDOUGNE_BANK };
}

/** Withdraw whichever bow the bank holds, else buy one. Null once a bow is worn or carried. */
function sourceBow(snap: QuestSnapshot): QuestStep | null {
    if (bowCarried(snap)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stocked = firstBow(snap.bankIds);
    if (stocked !== null) {
        return withdraw([{ name: NAME_BY_ID.get(stocked) ?? BOW_TO_BUY.name, id: stocked, qty: 1 }]);
    }
    return buyAt(snap, BOW_TO_BUY, 1, LOWE, BOW_GP);
}

/** The next missing piece of kit, or null once the pack is ready to go underground. */
export function sourceKit(snap: QuestSnapshot): QuestStep | null {
    for (const { item, qty, shop, unitGp } of KIT) {
        const step = fromBank(snap, item, qty);
        if (step) {
            return step;
        }
        if (shop && unitGp !== undefined) {
            const bought = buyAt(snap, item, qty, shop, unitGp);
            if (bought) {
                return bought;
            }
        }
    }
    return sourceBow(snap);
}

/** What the kit is still short of, for an honest stop rather than a silent retry loop. */
export function kitShortfall(snap: QuestSnapshot): string[] {
    const short = KIT.filter(({ item, qty }) => carried(snap, item) < qty)
        .map(({ item, qty, reason }) => `${qty}x ${item.name} (${reason}), have ${carried(snap, item)}`);
    if (!bowCarried(snap)) {
        short.push('a bow (firing the bridge stay rope), have none');
    }
    return short;
}

export function needsEquip(snap: QuestSnapshot, item: UpassItem): boolean {
    return held(snap, item) > 0;
}

// Why: the pass is not walked past, it is fought through, three paladins at level 62 for their crests, three demons for their amulets and Kalrag for the blood, and the bow in the kit is there for one arrow at a rope. Descending in what the fire arrow left on is descending unarmed.

const TIERS = ['dragon', 'rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;

// Why: daggers come poisoned, and "Dragon dagger(p)" ends in the suffix rather than in the kind, so the
// endsWith test missed it even with dagger on the list. Poisoned dagger(p) has no tier word at all.
const POISON = /\(p\+*\)$/;
const POISONS = ['', '(p)', '(p+)', '(p++)'] as const;

const baseName = (name: string): string => name.replace(POISON, '').trimEnd();

const GEAR_SLOTS: readonly { slot: string; kinds: readonly string[] }[] = [
    { slot: 'weapon', kinds: ['scimitar', 'longsword', 'battleaxe', 'sword', 'mace', 'dagger'] },
    { slot: 'body', kinds: ['platebody', 'chainbody'] },
    { slot: 'legs', kinds: ['platelegs', 'plateskirt'] },
    { slot: 'helm', kinds: ['full helm', 'med helm'] },
    { slot: 'shield', kinds: ['kiteshield', 'sq shield'] }
];

/** Refusals are silent, `equip` returns false, so a re-picked piece would burn the run. */
const unwearable = new Set<string>();

const bankedNamed = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
const heldNamed = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;

function wearingSlot(snap: QuestSnapshot, kinds: readonly string[]): boolean {
    for (const name of snap.worn) {
        if (kinds.some(kind => baseName(name).endsWith(kind))) {
            return true;
        }
    }
    return false;
}

function bestInBank(snap: QuestSnapshot, kinds: readonly string[]): string | null {
    for (const tier of TIERS) {
        for (const kind of kinds) {
            for (const poison of POISONS) {
                const name = `${tier} ${kind}${poison}`;
                if (unwearable.has(name)) {
                    continue;
                }
                if (bankedNamed(snap, name) > 0 || heldNamed(snap, name) > 0) {
                    return name[0]!.toUpperCase() + name.slice(1);
                }
            }
        }
    }
    return null;
}

/** A declared loadout is taken literally; declaring nothing takes the best tier the bank holds. */
export function plannedGear(snap: QuestSnapshot): string[] {
    const declared = gearOf(QuestLoadout.current);
    if (declared.length > 0) {
        return declared.filter(name => !unwearable.has(name.toLowerCase()) && !snap.worn.has(name.toLowerCase()));
    }
    const out: string[] = [];
    for (const { kinds } of GEAR_SLOTS) {
        if (wearingSlot(snap, kinds)) {
            continue;
        }
        const pick = bestInBank(snap, kinds);
        if (pick) {
            out.push(pick);
        }
    }
    return out;
}

/** Draw and wear the melee kit; refusals are shed rather than retried. */
export function wearGear(snap: QuestSnapshot): QuestStep | null {
    const names = plannedGear(snap);
    if (names.length === 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const toDraw = names.filter(name => heldNamed(snap, name) === 0 && bankedNamed(snap, name) > 0);
    if (toDraw.length > 0) {
        return {
            kind: 'withdraw',
            bank: UP_TILE.ARDOUGNE_BANK,
            items: toDraw.map(name => ({ name, qty: 1 }))
        };
    }
    return {
        kind: 'custom',
        name: `wear ${names.join(', ')}`,
        run: async log => {
            for (const name of names) {
                if (Equipment.contains(name) || (await Equipment.equip(name))) {
                    continue;
                }
                log(`cannot wear ${name}, level or quest requirement; leaving it behind`);
                unwearable.add(name.toLowerCase());
            }
            return true;
        }
    };
}

const WEAPON_KINDS = GEAR_SLOTS[0]!.kinds;

/** True once a melee weapon is on, the bow does not count, it is there for one arrow at one rope. */
export function meleeArmed(snap: QuestSnapshot): boolean {
    return wearingSlot(snap, WEAPON_KINDS);
}

/** True once a melee weapon is on or in the pack, which is what the cave mouth waits for. */
export function meleeCarried(snap: QuestSnapshot): boolean {
    return meleeArmed(snap) || packWeapon(snap) !== null;
}

function packWeapon(snap: QuestSnapshot): string | null {
    return packGear(snap, [{ kinds: WEAPON_KINDS }]);
}

function packGear(snap: QuestSnapshot, slots: readonly { kinds: readonly string[] }[]): string | null {
    for (const { kinds } of slots) {
        if (wearingSlot(snap, kinds)) {
            continue;
        }
        for (const name of snap.inv.keys()) {
            if (kinds.some(kind => baseName(name).endsWith(kind)) && !unwearable.has(name)) {
                return name;
            }
        }
    }
    return null;
}

// Why: `armFireArrow` puts the shortbow in the right hand and the melee weapon in the pack, and nothing after the bridge takes it back out, the paladins were being fought bare-handed. Armour in the pack is the same problem plus five slots the orb sweep needs, so the full set goes on rather than only the weapon.

// Why: a rune platebody wants Dragon Slayer, and `equip` answers a refusal the same way it answers a miss, with false, so a plain equip step retried one forever. A refusal is shed instead: the piece is written off, the step still succeeds, and the next cycle moves on to the rest of the set.

/** Wear the next piece of melee kit the pack is still carrying, once the bow has had its turn. */
export function drawGear(snap: QuestSnapshot): QuestStep | null {
    const name = packGear(snap, GEAR_SLOTS);
    if (name === null) {
        return null;
    }
    return {
        kind: 'custom',
        name: `wear ${name}`,
        run: async log => {
            if (Equipment.contains(name) || (await Equipment.equip(name))) {
                return true;
            }
            log(`cannot wear ${name}, level or quest requirement; carrying it and moving on`);
            unwearable.add(name);
            return true;
        }
    };
}
