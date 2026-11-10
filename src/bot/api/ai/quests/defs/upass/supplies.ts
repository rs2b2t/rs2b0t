import { Equipment } from '../../../../equipment/Equipment.js';
import { gearOf } from '../../../../loadout/loadoutPlan.js';
import { QuestLoadout } from '../../gear.js';
import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { ITEM_DB } from '../../../../../data/itemdb.js';
import { UP_ITEM, UP_TILE, banked, carried, held, type UpassItem } from './areas.js';


/** The fire arrow is built from bronze arrows; a stack covers every missed shot. */
export const ARROW_TARGET = 50;
// Why: the grid crossing and the orb corridor alone cost 8 lobsters, and the traps below are timer damage you walk into. Koftik, the paladins and Nilhoof give a dozen food between them, but as separate stacks that each take a slot, so the float covers the trapped stretches.
// Why: food is not stackable, so each lobster is a slot. 14 is the tested ceiling: the orb sweep (6 kit + railing + 4 orbs) and Kardia's chest (doll, book, 2 potions) both still fit, while 16 leaves the pack one slot short at the chest.
export const FOOD_TARGET = 16;
// Why: Kamen's meal is the only food inside the pass, so a fight that runs the pack down to six items breaks off and walks there instead of tanking to a death; the coin float pays for eight meals.
export const FOOD_RETREAT = 6;
export const FOOD_RESTOCKS = 8;
/** Coins to carry for Kamen's paid meal: 75gp for meat pie, stew and bread, eight meals. */
export const COIN_FLOAT = 600;
// Why: a bank that has run down after several deaths still leaves a viable run; stopping for the last 8 lobsters strands a pack that can finish the demons.
export const FOOD_FLOOR = 8;

// Why: upass_bridge.rs2 gates the rope shot on oc_category = weapon_bow, which is 13 items. A crossbow is weapon_crossbow, fires bolts and must not qualify.

/** Ranged level needed to wield each weapon_bow obj; the quest only guarantees 25. */
const BOW_RANGED: Readonly<Record<string, number>> = {
    shortbow: 1,
    longbow: 1,
    oak_shortbow: 5,
    oak_longbow: 5,
    willow_shortbow: 20,
    willow_longbow: 20,
    maple_shortbow: 30,
    maple_longbow: 30,
    ogre_bow: 30,
    yew_shortbow: 40,
    yew_longbow: 40,
    magic_shortbow: 50,
    magic_longbow: 50
};

/** Every obj in the weapon_bow category, by id. */
export const BOW_IDS: ReadonlySet<number> = new Set(
    ITEM_DB.filter(i => i.obj in BOW_RANGED).map(i => i.id)
);

const BOW_LEVEL: ReadonlyMap<number, number> = new Map(
    ITEM_DB.filter(i => i.obj in BOW_RANGED).map(i => [i.id, BOW_RANGED[i.obj] ?? Number.POSITIVE_INFINITY])
);

/** Ranged level a bow needs; an unknown bow is treated as unusable. */
export function bowLevel(id: number): number {
    return BOW_LEVEL.get(id) ?? Number.POSITIVE_INFINITY;
}

const NAME_BY_ID: ReadonlyMap<number, string> = new Map(ITEM_DB.map(i => [i.id, i.name]));
const ID_BY_NAME: ReadonlyMap<string, number> = new Map(ITEM_DB.map(i => [i.name.toLowerCase(), i.id]));

const firstBow = (ids: Iterable<[number, number]> | undefined, maxRanged = Number.POSITIVE_INFINITY): number | null => {
    for (const [id, n] of ids ?? []) {
        if (n > 0 && BOW_IDS.has(id) && bowLevel(id) <= maxRanged) {
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

/** True once a wieldable bow is worn or carried, which is what the cave mouth waits for. */
export function bowCarried(snap: QuestSnapshot): boolean {
    return bowWorn(snap) || firstBow(snap.invIds, snap.ranged ?? Number.POSITIVE_INFINITY) !== null;
}

// Why: Aemad's counter is 40 tiles from the booth this quest banks at, and Lowe is the only bow counter with a walked stand. Nothing else in the kit has a shop worth the trip.
// Why: Zeke is the weapon fallback after a death, and the Lumbridge respawn is a short walk from his stall in Al Kharid.

const AEMAD = { npc: 'Aemad', anchor: UP_TILE.AEMAD };
const LOWE = { npc: 'Lowe', anchor: UP_TILE.LOWE };
const ZEKE = { npc: 'Zeke', anchor: new Tile(3288, 3190, 0) };
const SCIMITAR_TO_BUY: UpassItem = { id: 1329, name: 'Mithril scimitar' };
const SCIMITAR_GP = 1100;

/** Rope is 18 base against Aemad's 1300 multiplier, a shortbow is 50 flat at Lowe's. Both carry headroom. */
const ROPE_GP = 40;
const BOW_GP = 100;

/** What a bank with no bow is sent to buy. */
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

// Why: the pass has no bank or shop and every trip back out is the dungeon over again, so the kit is drawn in one go before the cave mouth.

/** Everything the pass consumes, in the order the quest reaches it. */
export const KIT: readonly {
    item: UpassItem;
    qty: number;
    reason: string;
    /** Set only where a counter sells it, so a dry bank is not the end of the road. */
    shop?: { npc: string; anchor: Tile };
    unitGp?: number;
}[] = [
    // Why: `upass_rock_ropeswing` deletes the rope before it rolls agility, so a failed swing costs one and drops you in the swamp.
    { item: UP_ITEM.ROPE, qty: 3, reason: 'the rock swing east, which eats one per attempt', shop: AEMAD, unitGp: ROPE_GP },
    { item: UP_ITEM.BRONZE_ARROW, qty: ARROW_TARGET, reason: 'the fire arrow', shop: AEMAD, unitGp: 2 },
    { item: UP_ITEM.TINDERBOX, qty: 1, reason: 'lighting the cloth arrow and burning the tomb', shop: AEMAD, unitGp: 5 },
    // Why: from inside the slave cages the only reachable thing is the mud, `upass_mud` takes a spade and nothing else, and every route south to the unicorn is behind it.
    { item: UP_ITEM.SPADE, qty: 1, reason: 'the filled-in tunnel out of the slave cages' },
    { item: UP_ITEM.BUCKET, qty: 1, reason: "the dwarf brew for Iban's tomb" },
    { item: UP_ITEM.LOBSTER, qty: FOOD_TARGET, reason: 'the demons, Kalrag and the trap falls' }
];

export const KEEP_IDS: readonly number[] = [
    ...Object.values(UP_ITEM).map(item => item.id),
    ...BOW_IDS
];

// Why: the buy step tops the purse up itself, so a buy emitted with no coins walks to a counter it can't pay and retries there; falling through reaches the shortfall stop.

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

/** Withdraw the first wieldable bow the bank holds, else buy one. Null once a usable bow is worn or carried. */
function sourceBow(snap: QuestSnapshot): QuestStep | null {
    if (bowCarried(snap)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stocked = firstBow(snap.bankIds, snap.ranged ?? Number.POSITIVE_INFINITY);
    if (stocked !== null) {
        return withdraw([{ name: NAME_BY_ID.get(stocked) ?? BOW_TO_BUY.name, id: stocked, qty: 1 }]);
    }
    return buyAt(snap, BOW_TO_BUY, 1, LOWE, BOW_GP);
}

/** Draw the melee weapon, or buy the fallback scimitar when the bank has none. */
export function sourceWeapon(snap: QuestSnapshot): QuestStep | null {
    if (meleeCarried(snap)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const name = bestInBank(snap, WEAPON_KINDS);
    if (name !== null) {
        if (heldNamed(snap, name.toLowerCase()) > 0) {
            return wearWeapon(name);
        }
        const id = ID_BY_NAME.get(name.toLowerCase());
        return id === undefined ? null : withdraw([{ name, id, qty: 1 }]);
    }
    // Why: the death respawn is at Lumbridge, beside Zeke, so a lost scimitar is a short walk instead of a cross-map trip to the Ardougne booth.
    return buyAt(snap, SCIMITAR_TO_BUY, 1, ZEKE, SCIMITAR_GP);
}

function wearWeapon(name: string): QuestStep {
    return {
        kind: 'custom',
        name: `wear ${name}`,
        run: async log => {
            if (Equipment.contains(name) || (await Equipment.equip(name))) {
                return true;
            }
            log(`cannot wear ${name}, level or quest requirement; leaving it behind`);
            unwearable.add(name.toLowerCase());
            return true;
        }
    };
}

/** The spade only opens the mud tunnel out of the slave cages; a death after that stage never needs another. */
/** The next missing piece of kit, or null once the pack is ready to go underground. */
export function sourceKit(snap: QuestSnapshot): QuestStep | null {
    // Why: Kamen's paid meal is unlimited and costs no HP, but only if the pack carries the purse; the withdrawal is optional so an account with no coins still enters on the free brew.
    const coins = fromBank(snap, UP_ITEM.COINS, COIN_FLOAT);
    if (coins) {
        return coins;
    }
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

/** What the kit is still short of, for the stop message. */
export function kitShortfall(snap: QuestSnapshot): string[] {
    const short = KIT.filter(({ item, qty }) => carried(snap, item) < (item.id === UP_ITEM.LOBSTER.id ? FOOD_FLOOR : qty))
        .map(({ item, qty, reason }) => `${item.id === UP_ITEM.LOBSTER.id ? FOOD_FLOOR : qty}x ${item.name} (${reason}), have ${carried(snap, item)}`);
    if (!bowCarried(snap)) {
        short.push('a bow (firing the bridge stay rope), have none');
    }
    return short;
}

export function needsEquip(snap: QuestSnapshot, item: UpassItem): boolean {
    return held(snap, item) > 0;
}

// Why: the pass is fought through: 3 paladins at level 62 for their crests, 3 demons for their amulets and Kalrag for the blood. The bow is for one arrow at a rope, so descending in what the fire arrow left on is descending unarmed.

const TIERS = ['dragon', 'rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;

// Why: "Dragon dagger(p)" ends in the poison suffix, so an endsWith test on the kind misses it. Poisoned dagger(p) has no tier word at all.
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

// Why: death keeps the 3 priciest items across worn and pack. The default stops at weapon/body/legs so a rune kiteshield can never push the rune scimitar to 4th and take it off the account; a declared loadout is still taken literally.
const SAFE_GEAR_SLOTS = GEAR_SLOTS.slice(0, 3);

/** Refusals are silent, `equip` returns false, so a re-picked piece would burn the run. */
const unwearable = new Set<string>();

const bankedNamed = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
const heldNamed = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;

const FOOD_NAMES = ['meat pie', 'meat pizza', 'bread', 'stew'] as const;
/** Everything edible the sustain list knows about, so "low" doesn't mean "low on lobsters" while the pack still has pies. */
export function foodInPack(snap: QuestSnapshot): number {
    const lobster = snap.invIds?.get(UP_ITEM.LOBSTER.id) ?? heldNamed(snap, 'lobster');
    return FOOD_NAMES.reduce((sum, name) => sum + heldNamed(snap, name), lobster);
}

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
export function plannedGear(snap: QuestSnapshot, slots: 'all' | 'weapon' = 'all'): string[] {
    if (slots === 'weapon' && meleeArmed(snap)) return [];
    const weapon = QuestLoadout.current?.worn.righthand;
    const declared = slots === 'weapon' ? (weapon ? [weapon] : []) : gearOf(QuestLoadout.current);
    if (declared.length > 0) {
        return declared.filter(name => !unwearable.has(name.toLowerCase()) && !snap.worn.has(name.toLowerCase()));
    }
    const out: string[] = [];
    for (const { slot, kinds } of SAFE_GEAR_SLOTS) {
        if (slots === 'weapon' && slot !== 'weapon') continue;
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

/** Draw and wear the melee kit; refusals are shed. */
export function wearGear(snap: QuestSnapshot, slots: 'all' | 'weapon' = 'all'): QuestStep | null {
    const names = plannedGear(snap, slots);
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

/** True once a melee weapon is on; the bow doesn't count. */
export function meleeArmed(snap: QuestSnapshot): boolean {
    return wearingSlot(snap, WEAPON_KINDS);
}

/** True once a melee weapon is on or in the pack, which is what the cave mouth waits for. */
export function meleeCarried(snap: QuestSnapshot): boolean {
    return meleeArmed(snap) || packWeapon(snap) !== null;
}

function packWeapon(snap: QuestSnapshot, only?: ReadonlySet<string>): string | null {
    return packGear(snap, [{ kinds: WEAPON_KINDS }], only);
}

function packGear(
    snap: QuestSnapshot,
    slots: readonly { kinds: readonly string[] }[],
    only?: ReadonlySet<string>
): string | null {
    for (const { kinds } of slots) {
        if (wearingSlot(snap, kinds)) {
            continue;
        }
        for (const name of snap.inv.keys()) {
            if (only && !only.has(name)) {
                continue;
            }
            if (kinds.some(kind => baseName(name).endsWith(kind)) && !unwearable.has(name)) {
                return name;
            }
        }
    }
    return null;
}

// Why: `armFireArrow` puts the shortbow in the right hand and the melee weapon in the pack, and nothing after the bridge takes it back out. Armour in the pack is the same plus 5 slots the orb sweep needs, so the full set goes on.

// Why: a rune platebody wants Dragon Slayer, and `equip` answers a refusal and a miss the same way, false, so a plain equip step would retry forever. The piece is written off and the step still succeeds.

/** Wear the next piece of melee kit the pack is still carrying, once the bow has had its turn. */
export function drawGear(snap: QuestSnapshot, slots: 'all' | 'weapon' = 'all'): QuestStep | null {
    // Why: a declared loadout is a promise to the player, not a suggestion; wearing the spare kiteshield it left out would quietly undo the keep-3 protection.
    const declared = QuestLoadout.current
        ? new Set(gearOf(QuestLoadout.current).map(name => name.toLowerCase()))
        : undefined;
    const name = slots === 'weapon' ? packWeapon(snap, declared) : packGear(snap, SAFE_GEAR_SLOTS, declared);
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
