import type Tile from '../../../../../geometry/Tile.js';
import { Skills } from '../../../../skills/Skills.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { GEM_CUTS, GEM_ROCKS, LQ_BANK, LQ_ID, LQ_ITEM, LQ_SHOP, LQ_SKILLS, LQ_TILE } from './areas.js';
import { mineGem, smeltGoldBar } from './gather.js';
import { MELEE_WEAPONS, bestBanked, packWeapon, wieldedWeapon } from '../../weapons.js';
import { QUEST_ARMOUR, armourChoice, armourHeld, armourWorn } from '../../armour.js';

export interface LqItem {
    id: number;
    name: string;
}

type Shop = { npc: string; anchor: Tile };

// Why: best first, since `foodTopUp` takes the first of these the bank holds and every fight in this quest is one the float has to outlast, Nezikchened three times and three aggressive guardians. The rest are fallbacks in descending heal.
/** What the float is drawn from, in the order it is preferred. */
export const LQ_FOODS = ['Shark', 'Swordfish', 'Lobster', 'Tuna'] as const;

/** Enough to cross the trials, both cave fights and the walk home. */
export const FOOD_CARRY = 14;

// Why: every purchase here is a `buy` step, which tops the pack up to its own `estGp` at the booth, so this is not a shopping budget but fare money (the Brimhaven ferry at 30, Hajedy's cart at 100, and a planner that refuses a route whose fare is not in the pack), and it is small because all of it rides through three fights with a level-187 demon and a death drops it.
/** Fare money for the crossings; every counter purchase funds itself at the booth. */
export const COIN_CARRY = 5_000;

// Why: the trigger is a floor rather than half the float. Half the float sends the run to a booth with thousands still in the pack, and the fares this covers are thirty and a hundred coins, so it is only worth a trip once there is nothing left to pay one with.
/** Coins below which a leg passing a booth restores the float. */
export const COIN_FLOOR = 1_000;

// Why: `calc_shop_value` returns `oc_cost` unchanged while a shop sits at its base stock, the Magic Guild's multipliers are sell 1000 / delta 10, so the divisor and the multiplier cancel, and climbs only as the shelf is emptied.
// Why: so the guild list is two soul runes at 1250, four law at 40, two mind at 3, two earth at 4 and 150 water at 4, which is about 3.8k with the water's own depletion in it. Even bought down to the last soul rune on a shared world it is nearer 5k than 60k, and `estGp` is what the buy step tops the pack up to before it opens the counter.
export const SHOP_GP = {
    JIMINUA: 3000,
    MAGIC_GUILD: 12_000
} as const;

export const PRAYER_POTIONS: readonly LqItem[] = [
    { id: 2434, name: 'Prayer potion(4)' },
    { id: 139, name: 'Prayer potion(3)' },
    { id: 141, name: 'Prayer potion(2)' },
    { id: 143, name: 'Prayer potion(1)' }
];

/** Melee weapons worth wielding against the demon and the three guardians. */
// Why: rune chainbody rather than platebody, the platebody wants Dragon Slayer as well as Defence 40, and the refusal is a bare false with no message.
export const ARMOUR: readonly LqItem[] = [
    { id: 1113, name: 'Rune chainbody' },
    { id: 1079, name: 'Rune platelegs' },
    { id: 1163, name: 'Rune full helm' },
    { id: 1201, name: 'Rune kiteshield' },
    { id: 1704, name: 'Amulet of glory' }
];

export const PICKAXES: readonly LqItem[] = [
    { id: LQ_ID.RUNE_PICKAXE, name: 'Rune pickaxe' },
    { id: LQ_ID.ADAMANT_PICKAXE, name: 'Adamant pickaxe' },
    { id: LQ_ID.MITHRIL_PICKAXE, name: 'Mithril pickaxe' },
    { id: LQ_ID.STEEL_PICKAXE, name: 'Steel pickaxe' },
    { id: LQ_ID.IRON_PICKAXE, name: 'Iron pickaxe' },
    { id: LQ_ID.BRONZE_PICKAXE, name: 'Bronze pickaxe' }
];

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function worn(snap: QuestSnapshot, id: number): boolean {
    return snap.wornIds?.has(id) ?? false;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + (worn(snap, id) ? 1 : 0);
}

export function heldName(snap: QuestSnapshot, name: string): number {
    return snap.inv.get(name.toLowerCase()) ?? 0;
}

export function bankedName(snap: QuestSnapshot, name: string): number {
    return snap.bank?.get(name.toLowerCase()) ?? 0;
}

export function scanBank(bank?: Tile): QuestStep {
    return { kind: 'scanBank', bank };
}

export function withdraw(items: { name: string; qty: number; id?: number }[], bank?: Tile): QuestStep {
    return { kind: 'withdraw', items, bank };
}

// Why: every quest item this list forgets is deposited on the next bank trip and has to be re-earned, so it denies rather than allows.
export const KEEP_IDS: readonly number[] = [
    LQ_ID.MAP, LQ_ID.MAP_COMPLETE, LQ_ID.BULLROARER, LQ_ID.GOLD_BOWL_SKETCH,
    LQ_ID.GOLD_BOWL, LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.GOLD_BOWL_WATER, LQ_ID.GOLD_BOWL_PURE,
    LQ_ID.GOLD_BOWL_BLESSED_WATER, LQ_ID.GOLD_BOWL_BLESSED_PURE, LQ_ID.HOLLOW_REED,
    LQ_ID.BOOK_OF_BINDING, LQ_ID.YOMMI_SEEDS, LQ_ID.YOMMI_SEEDS_GERM,
    LQ_ID.SNAKEWEED_MIXTURE, LQ_ID.ARDRIGAL_MIXTURE, LQ_ID.BRAVERY_POTION,
    LQ_ID.SNAKE_WEED, LQ_ID.ARDRIGAL, LQ_ID.UNID_SNAKE_WEED, LQ_ID.UNID_ARDRIGAL,
    LQ_ID.CRYSTAL_CHUNK, LQ_ID.CRYSTAL_HUNK, LQ_ID.CRYSTAL_LUMP,
    LQ_ID.HEART_CRYSTAL, LQ_ID.HEART_CRYSTAL_GLOW,
    LQ_ID.DEATH_DAGGER, LQ_ID.DEATH_DAGGER_DONE, LQ_ID.HOLY_FORCE,
    LQ_ID.TOTEM_POLE, LQ_ID.GILDED_TOTEM,
    LQ_ID.MACHETE, LQ_ID.RUNE_AXE, LQ_ID.LOCKPICK, LQ_ID.UNPOWERED_ORB,
    LQ_ID.PAPYRUS, LQ_ID.CHARCOAL, LQ_ID.GOLD_BAR, LQ_ID.HAMMER, LQ_ID.KNIFE,
    // Why: the vial of water is kit and the empty one is what drinking the bravery potion leaves behind, the quest never fills one, since Jiminua's sells the filled vial the recipe wants.
    LQ_ID.ROPE, LQ_ID.CHISEL, LQ_ID.VIAL_WATER,
    LQ_ID.SOUL_RUNE, LQ_ID.MIND_RUNE, LQ_ID.EARTH_RUNE, LQ_ID.LAW_RUNE,
    LQ_ID.WATER_RUNE, LQ_ID.COSMIC_RUNE, LQ_ID.AIR_RUNE, LQ_ID.FIRE_RUNE, LQ_ID.DEATH_RUNE,
    ...GEM_ROCKS.map(g => g.id),
    ...GEM_CUTS.map(g => g.uncut),
    ...PICKAXES.map(p => p.id),
    ...MELEE_WEAPONS.map(w => w.id),
    ...ARMOUR.map(a => a.id),
    ...QUEST_ARMOUR.map(a => a.id),
    ...PRAYER_POTIONS.map(p => p.id),
    LQ_ID.COINS
];

// Why: the trials hand back three lumps of rock and the pack is already full to its last slot, so a top-up decided with no room fails its withdraw for ever.

/** Ids the deposit keeps by name rather than by id, so they do not read as junk. */
const FOOD_IDS: readonly number[] = [LQ_ID.SHARK, LQ_ID.SWORDFISH, LQ_ID.LOBSTER, LQ_ID.TUNA];

// Why: a slot is bought with the worst food held, not the best, the opposite order to the float, since the point is to keep the heal that has to outlast the demon.
/** The food to eat for a slot, worst first. */
export const FOOD_FOR_SLOT: readonly { id: number; name: string }[] = [
    { id: LQ_ID.TUNA, name: LQ_ITEM.TUNA },
    { id: LQ_ID.LOBSTER, name: LQ_ITEM.LOBSTER },
    { id: LQ_ID.SWORDFISH, name: LQ_ITEM.SWORDFISH },
    { id: LQ_ID.SHARK, name: LQ_ITEM.SHARK }
];

/** Everything in the pack this quest has no use for, random-event gifts included. */
export function junkIds(snap: QuestSnapshot): number[] {
    return [...(snap.invIds ?? new Map<number, number>()).keys()]
        .filter(id => !KEEP_IDS.includes(id) && !FOOD_IDS.includes(id));
}

/** Something in the pack a deposit would take. */
export function junkHeld(snap: QuestSnapshot): boolean {
    return junkIds(snap).length > 0;
}

// Why: the rock rolls opal 60/128 and diamond 4/128, so the wait for the last gem buries the pack in uncut opals that the keep list is protecting.
// Why: the deposit keeps them by id, so a bank trip would take none of them, the surplus is a drop, not a deposit, and it is junk only once its own cut gem is in hand.

/** Everything the drop may shed where the character stands, spare uncut gems included. */
export function ditchIds(snap: QuestSnapshot): number[] {
    const spare = GEM_CUTS.filter(gem => held(snap, gem.uncut) > 0 && owned(snap, gem.cut) > 0).map(gem => gem.uncut);
    return [...junkIds(snap), ...spare];
}

export function deposit(bank?: Tile): QuestStep {
    return { kind: 'deposit', keep: [...LQ_FOODS], keepIds: KEEP_IDS, bank };
}

// Why: `null` covers both "already carried" and "the bank cannot help", and the caller decides whether that is a shop trip or a park.

/** Withdraw a shortfall when the bank has it. */
// Why: every booth shows the same contents, so a withdrawal is owed to the nearest one and never to a named one. The tile is threaded this far for the buy leg, which does want the counter's own bank for its coins, and pinning a withdrawal to it sailed a run from Karamja to Yanille for runes Shilo's teller was holding.
export function fromBank(snap: QuestSnapshot, item: LqItem, qty = 1): QuestStep | null {
    const short = qty - owned(snap, item.id);
    if (short <= 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, item.id);
    return inBank > 0 ? withdraw([{ name: item.name, id: item.id, qty: Math.min(short, inBank) }]) : null;
}

/** Bank first, then the counter that stocks it. */
// Why: `stock` is what the counter is asked for, `qty` is what the leg needs, the magic gate eats a cast on every descent and the Magic Guild is in Yanille, so buying one descent's worth walks the sea and the hill again for the next one. Runes stack, so a run's worth costs the same slot as one.

export function source(snap: QuestSnapshot, item: LqItem, qty: number, shop: Shop, estGp: number, bank?: Tile, stock = qty): QuestStep | null {
    const have = owned(snap, item.id);
    if (have >= qty) {
        return null;
    }
    return fromBank(snap, item, qty)
        ?? { kind: 'buy', item: item.name, qty: Math.max(stock, qty) - have, shop, estGp, bank };
}

/** Bank only, nothing in the game sells this. */
export function bankOnly(snap: QuestSnapshot, item: LqItem, qty: number): QuestStep | null {
    if (owned(snap, item.id) >= qty) {
        return null;
    }
    return fromBank(snap, item, qty)
        ?? { kind: 'wait', reason: `no ${item.name} in the pack or the bank, and no shop stocks one` };
}

export function coinTopUp(snap: QuestSnapshot, want = COIN_CARRY, bank?: Tile): QuestStep | null {
    const have = heldName(snap, LQ_ITEM.COINS);
    if (have >= Math.min(COIN_FLOOR, want)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const inBank = bankedName(snap, LQ_ITEM.COINS);
    return inBank > 0 ? withdraw([{ name: LQ_ITEM.COINS, id: LQ_ID.COINS, qty: Math.min(want - have, inBank) }], bank) : null;
}

export function heldFood(snap: QuestSnapshot): number {
    return LQ_FOODS.reduce((sum, f) => sum + heldName(snap, f), 0);
}

export function foodTopUp(snap: QuestSnapshot, want = FOOD_CARRY, bank?: Tile): QuestStep | null {
    if (heldFood(snap) >= Math.ceil(want / 2)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const food = LQ_FOODS.find(f => bankedName(snap, f) > 0);
    if (!food) {
        return null;
    }
    // Why: a float the pack cannot hold is a withdraw that fills the last slot and asks again, after a death the kit comes back at once and ten lobsters have nowhere to go, so the ask is what fits rather than what was wanted.
    const room = Math.max(0, snap.freeSlots ?? 28);
    const take = Math.min(want - heldFood(snap), bankedName(snap, food), room);
    return take > 0 ? withdraw([{ name: food, qty: take }], bank) : null;
}

// Why: Nezikchened is level 187 with 150 hitpoints and casts from range, and Protect from Melee is the only thing that makes him survivable at 70, so the points have to outlast the fight rather than the walk to it.

/** Withdraw prayer potions up to `want` doses' worth of flasks. */
/** Prayer doses in the pack. */
export function potsHeld(snap: QuestSnapshot): number {
    return PRAYER_POTIONS.reduce((sum, pot) => sum + held(snap, pot.id), 0);
}

/** Prayer doses the bank could still hand over. */
export function potsBanked(snap: QuestSnapshot): number {
    return PRAYER_POTIONS.reduce((sum, pot) => sum + banked(snap, pot.id), 0);
}

export function potionTopUp(snap: QuestSnapshot, want: number, bank?: Tile): QuestStep | null {
    if (want <= 0) {
        return null;
    }
    const have = PRAYER_POTIONS.reduce((sum, pot) => sum + held(snap, pot.id), 0);
    if (have >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const pot = PRAYER_POTIONS.find(p => banked(snap, p.id) > 0);
    if (!pot) {
        return null;
    }
    return withdraw([{ name: pot.name, id: pot.id, qty: Math.min(want - have, banked(snap, pot.id)) }], bank);
}

/** Equip the best melee weapon and armour the bank can dress us in, or null. */
export function dressForCombat(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    // Why: the weapon is whatever tier the Attack level reaches and the account owns, so it is resolved rather than named.
    if (!wieldedWeapon(snap)) {
        const inPack = packWeapon(snap);
        if (inPack) {
            return { kind: 'equip', item: inPack.name };
        }
        if (!snap.bankKnown) {
            return scanBank(bank);
        }
        const fromTheBank = bestBanked(snap);
        if (fromTheBank) {
            return withdraw([{ name: fromTheBank.name, id: fromTheBank.id, qty: 1 }], bank);
        }
    }
    for (const slot of ['torso', 'legs', 'hat', 'lefthand'] as const) {
        const piece = armourChoice(snap, slot);
        if (piece && armourWorn(snap, piece)) {
            continue;
        }
        if (piece && armourHeld(snap, piece)) {
            return { kind: 'equip', item: piece.name };
        }
        if (!snap.bankKnown) {
            return scanBank(bank);
        }
        if (piece) {
            return withdraw([{ name: piece.name, id: piece.id, qty: 1 }], bank);
        }
        return { kind: 'wait', reason: `no usable ${slot} armour in the pack or bank` };
    }
    if (armourChoice(snap, 'front')) {
        return null;
    }
    const glory = { id: 1704, name: 'Amulet of glory' };
    if (held(snap, glory.id) > 0) {
        return { kind: 'equip', item: glory.name };
    }
    if (snap.bankKnown && banked(snap, glory.id) > 0) {
        return withdraw([{ ...glory, qty: 1 }], bank);
    }
    return null;
}

export function hasPickaxe(snap: QuestSnapshot): boolean {
    return PICKAXES.some(p => owned(snap, p.id) > 0);
}

/** Bank first, then Obli's bronze pickaxe, mining 52 is met by anything. */
export function sourcePickaxe(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    if (hasPickaxe(snap)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const inBank = PICKAXES.find(p => banked(snap, p.id) > 0);
    if (inBank) {
        return withdraw([{ name: inBank.name, id: inBank.id, qty: 1 }], bank);
    }
    return { kind: 'buy', item: 'Bronze pickaxe', qty: 1, shop: LQ_SHOP.JIMINUA, estGp: SHOP_GP.JIMINUA, bank };
}

// Why: no machete on this list. Radimus keeps a free one in the cupboard and counts the bank when he decides whether to hand it over, so provisioning one is a purchase that also breaks the step that would have got it for nothing.
/** Jiminua's counter in Tai Bwo Wannai stocks everything on this list. */
export const JIMINUA_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.PAPYRUS, name: LQ_ITEM.PAPYRUS }, qty: 8 },
    { item: { id: LQ_ID.CHARCOAL, name: LQ_ITEM.CHARCOAL }, qty: 8 },
    { item: { id: LQ_ID.KNIFE, name: LQ_ITEM.KNIFE }, qty: 1 },
    { item: { id: LQ_ID.ROPE, name: LQ_ITEM.ROPE }, qty: 1 },
    { item: { id: LQ_ID.HAMMER, name: LQ_ITEM.HAMMER }, qty: 1 },
    { item: { id: LQ_ID.CHISEL, name: LQ_ITEM.CHISEL }, qty: 1 },
    { item: { id: LQ_ID.VIAL_WATER, name: LQ_ITEM.VIAL_WATER }, qty: 1 }
];

// Why: the wall keeps its five in `%legends_bits`, so they are spent once and never again, but a death on the way down drops them, and the replacement is another trip to Yanille for the only soul rune in the game. A spare set stacks into the same slots.

/** The five the marked wall swallows, in the one order it accepts, from the Magic Guild counter. */
export const RUNE_KIT: readonly { item: LqItem; qty: number; stock?: number }[] = [
    { item: { id: LQ_ID.SOUL_RUNE, name: LQ_ITEM.SOUL_RUNE }, qty: 1, stock: 2 },
    { item: { id: LQ_ID.MIND_RUNE, name: LQ_ITEM.MIND_RUNE }, qty: 1, stock: 2 },
    { item: { id: LQ_ID.EARTH_RUNE, name: LQ_ITEM.EARTH_RUNE }, qty: 1, stock: 2 },
    { item: { id: LQ_ID.LAW_RUNE, name: LQ_ITEM.LAW_RUNE }, qty: 2, stock: 4 }
];

// Why: the magic gate eats an orb and a cast every time it is crossed downwards, while everything else in the trials is spent once and stays spent, so the two kits are asked for separately.
// Why: the Magic Guild counter is in Yanille, which from Karamja is the ship, the walk and the bank, so the descent's cast is bought a run's worth at a time, a rune stack is one slot whatever the count, which makes every later descent a check rather than a crossing.

/** How many descents one shopping trip is stocked for. */
const DESCENTS_STOCKED = 5;

/** The counter half of one charge-water-orb cast, which is what the magic gate is. */
export const ORB_RUNE_KIT: readonly { item: LqItem; qty: number; stock?: number }[] = [
    { item: { id: LQ_ID.WATER_RUNE, name: LQ_ITEM.WATER_RUNE }, qty: 30, stock: 30 * DESCENTS_STOCKED }
];

/** Nothing in the game sells this, and the Yommi tree takes no lesser axe. */
export const BANK_ONLY_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.RUNE_AXE, name: LQ_ITEM.RUNE_AXE }, qty: 1 }
];

// Why: the outer gate shuts behind whoever picked it and the three boulders drop back down behind whoever mined them, so the descent is paid for again in full every time it is made.

// Why: the cosmic runes sit here rather than with the water ones they are cast alongside. The Magic Guild counter stocks fire, water, air, earth, mind, body, soul, nature, chaos, blood, law and death and no cosmic at all, the only shop in the game that sells one is the Mage Arena's, which is deep Wilderness and behind a setting. Asked for at a counter that cannot sell it, the leg buys nothing and says nothing.

/** The lockpick, the orb and the cast's cosmic runes, all spent on every descent, none stocked by a counter. */
export const DESCENT_KIT: readonly { item: LqItem; qty: number }[] = [
    { item: { id: LQ_ID.LOCKPICK, name: LQ_ITEM.LOCKPICK }, qty: 1 },
    { item: { id: LQ_ID.UNPOWERED_ORB, name: LQ_ITEM.UNPOWERED_ORB }, qty: 1 },
    { item: { id: LQ_ID.COSMIC_RUNE, name: LQ_ITEM.COSMIC_RUNE }, qty: 3 }
];

export function sourceFrom(
    snap: QuestSnapshot,
    kit: readonly { item: LqItem; qty: number; stock?: number }[],
    shop: Shop,
    estGp: number,
    bank?: Tile
): QuestStep | null {
    for (const want of kit) {
        const step = source(snap, want.item, want.qty, shop, estGp, bank, want.stock);
        if (step) {
            return step;
        }
    }
    return null;
}

export function sourceBankOnly(snap: QuestSnapshot, kit: readonly { item: LqItem; qty: number }[]): QuestStep | null {
    for (const want of kit) {
        const step = bankOnly(snap, want.item, want.qty);
        if (step) {
            return step;
        }
    }
    return null;
}

// Why: only the Falador and Al Kharid gem counters sell a cut gem at all, they hold one apiece, and neither ever stocks opal, jade or red topaz.
// Why: the only rocks that drop all seven are north of Shilo Village, reached by Hajedy's cart out of Brimhaven, so the chain is mine-then-cut with the bank in front of it.

/** The next rung of the seven-gem chain, or null once all seven are carried. */
export function sourceGems(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    const missing = GEM_ROCKS.filter(gem => owned(snap, gem.id) === 0);
    if (missing.length === 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const fromTheBank = missing.find(gem => banked(snap, gem.id) > 0);
    if (fromTheBank) {
        return withdraw([{ name: fromTheBank.name, id: fromTheBank.id, qty: 1 }], bank);
    }
    const cut = GEM_CUTS.find(gem => owned(snap, gem.cut) === 0 && (held(snap, gem.uncut) > 0 || banked(snap, gem.uncut) > 0));
    if (cut) {
        const rough = fromBank(snap, { id: cut.uncut, name: cut.uncutName }, 1);
        if (rough) {
            return rough;
        }
        const chisel = source(snap, { id: LQ_ID.CHISEL, name: LQ_ITEM.CHISEL }, 1, LQ_SHOP.JIMINUA, SHOP_GP.JIMINUA, bank);
        if (chisel) {
            return chisel;
        }
        return { kind: 'useOn', item: LQ_ITEM.CHISEL, targetKind: 'item', target: cut.uncutName, anchor: bank ?? LQ_BANK.ARDOUGNE, product: cut.name };
    }
    const pickaxe = sourcePickaxe(snap, bank);
    if (pickaxe) {
        return pickaxe;
    }
    return { kind: 'custom', name: `mine a gem (${missing.length} of seven still missing)`, run: mineGem };
}

// Why: Drogo's is the only gold-bar counter and its baseline stock is zero, so the honest chain is mine at Brimhaven and smelt at the Shilo furnace next to the booth.

/** The next rung of the two-gold-bar chain, or null once both are carried. */
export function sourceGoldBars(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    const bars = { id: LQ_ID.GOLD_BAR, name: LQ_ITEM.GOLD_BAR };
    if (owned(snap, bars.id) >= 2) {
        return null;
    }
    const fromTheBank = fromBank(snap, bars, 2);
    if (fromTheBank) {
        return fromTheBank;
    }
    if (heldName(snap, 'Gold ore') > 0) {
        return { kind: 'custom', name: 'smelt a gold bar at the Ardougne furnace', run: smeltGoldBar };
    }
    const pickaxe = sourcePickaxe(snap, bank);
    if (pickaxe) {
        return pickaxe;
    }
    return { kind: 'mineRock', rock: 'Gold', item: 'Gold ore', qty: 1, anchor: LQ_TILE.GOLD_ROCKS };
}

// Why: every counter this quest uses is a sea crossing or a kingdom away from the next thing it needs, Jiminua's is on Karamja, the Magic Guild is upstairs in Yanille, and sourcing per leg alternated between them and the bank across the length of stage 8. Bought once, banked once, every later leg is a withdraw.
// Why: the check is against `qty` and the purchase is against `stock`, the same split `source` makes, so a pack that already holds a descent's worth is not sent shopping for four more.

/** Each counter this quest ever buys from, in one visit apiece, banked before the next. */
const COUNTERS: readonly {
    shop: Shop;
    estGp: number;
    bank: Tile;
    kit: readonly { item: LqItem; qty: number; stock?: number }[];
}[] = [
    { shop: LQ_SHOP.MAGIC_GUILD, estGp: SHOP_GP.MAGIC_GUILD, bank: LQ_BANK.YANILLE, kit: [...RUNE_KIT, ...ORB_RUNE_KIT] },
    { shop: LQ_SHOP.JIMINUA, estGp: SHOP_GP.JIMINUA, bank: LQ_BANK.SHILO, kit: JIMINUA_KIT }
];

// Why: a shared counter with `allstock=no` can be bought out, and a shopping list that parks on one empty shelf blocks a run the per-leg sourcing could still finish. The give-up is the engine's own no-progress count.
const PROVISION_GIVE_UP = 3;

/** Coins and food ride along; everything a counter sold goes into the bank. */
function provisionDeposit(bank: Tile): QuestStep {
    return { kind: 'deposit', keep: [...LQ_FOODS], keepIds: [LQ_ID.COINS], bank };
}

/** Stock the bank from every counter before the quest touches the field, or null once it is stocked. */
export function provision(snap: QuestSnapshot): QuestStep | null {
    if (snap.noProgress >= PROVISION_GIVE_UP) {
        return null;
    }
    for (const counter of COUNTERS) {
        const short = counter.kit.find(want => owned(snap, want.item.id) + banked(snap, want.item.id) < want.qty);
        if (short) {
            if (!snap.bankKnown) {
                return scanBank(counter.bank);
            }
            const have = owned(snap, short.item.id) + banked(snap, short.item.id);
            const target = Math.max(short.stock ?? short.qty, short.qty);
            return { kind: 'buy', item: short.item.name, qty: target - have, shop: counter.shop, estGp: counter.estGp, bank: counter.bank };
        }
        // Why: banked at this counter's own booth rather than carried to the next, as the two lists together are more slots than the pack has.
        if (counter.kit.some(want => held(snap, want.item.id) > 0)) {
            return provisionDeposit(counter.bank);
        }
    }
    return null;
}

export function warnLegendsReadiness(): string | null {
    const missing = Object.entries(LQ_SKILLS)
        .map(([skill, need]) => ({ skill, need, have: Skills.level(skill) }))
        .filter(entry => entry.have < entry.need)
        .map(entry => `${entry.skill} ${entry.have}/${entry.need}`);
    if (missing.length > 0) {
        return `official skill reqs not met (${missing.join(', ')}), the trials and the Yommi tree both refuse below them`;
    }
    const combat = (['attack', 'strength', 'defence', 'hitpoints', 'prayer'] as const)
        .map(skill => ({ skill, have: Skills.level(skill) }))
        .filter(entry => entry.have < LQ_PROVEN_COMBAT_FLOOR)
        .map(entry => `${entry.skill} ${entry.have}/${LQ_PROVEN_COMBAT_FLOOR}`);
    if (combat.length === 0) {
        return null;
    }
    return `combat below the only proven profile (${combat.join(', ')}; headed PASS at 70s). `
        + 'Nezikchened is a level-187 demon fought three times and the three Viyeldi guardians follow him, expect death risk.';
}

/** The profile a headed end-to-end run has cleared. */
export const LQ_PROVEN_COMBAT_FLOOR = 70;

// Why: Shilo Village banks Karamja, which is the island's difference, Ardougne West is the Brimhaven ship and a walk each way, and the gold, the gems, Jiminua's counter and the jungle are all on this side of that crossing.
export const LEG_BANK = {
    /** Ardougne West is the nearest booth to the Legends Guild gate. */
    guild: LQ_BANK.ARDOUGNE,
    /** Every Karamja leg, at Shilo's teller rather than across the sea. */
    karamja: LQ_BANK.SHILO,
    /** The Magic Guild counter is upstairs in Yanille, sixty tiles from its booth. */
    runes: LQ_BANK.YANILLE
} as const;
