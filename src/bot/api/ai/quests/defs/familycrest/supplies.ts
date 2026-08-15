import { Skills } from '../../../../skills/Skills.js';
import { Traversal } from '../../../../walking/Traversal.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { ANTIPOISON_IDS, DUEL_RING_IDS, FC_BANK, FC_ID, FC_ITEM, FC_SHOP, PICKAXES } from './areas.js';
import type Tile from '../../../../../geometry/Tile.js';

export interface FcItem {
    id: number;
    name: string;
}

/** Server gates from the quest journal. */
export const FC_OFFICIAL_SKILLS = {
    mining: 40,
    crafting: 40,
    smithing: 40,
    magic: 59
} as const;

// Why: combat is no server gate here, but two fights are unavoidable — the hellhounds (lvl 122) guarding the perfect-gold rocks aggro at any combat level a 2004 account can reach.
// Why: Chronozon (lvl 170, att 173 / str 172) is in the wilderness, where the not-too-strong check does not apply.
// Why: only max stats have been through a headed run so far, so lower this once a realistic profile clears (docs/QUESTS.md polish goal).
const FC_PROVEN_COMBAT_FLOOR = {
    attack: 99,
    strength: 99,
    defence: 99,
    hitpoints: 99
} as const;

/** Foods deliberately disjoint from Caleb's five fish, so Sustain cannot eat the quest. */
export const FC_FOODS = ['Shark', 'Lobster', 'Trout', 'Herring'] as const;
export const FOOD_WITHDRAW = 10;

/** One cast of each blast, times a generous allowance for splashes on def 173. */
const RUNE_BUY = {
    air: 600,
    water: 200,
    earth: 200,
    fire: 250,
    death: 60
} as const;

// Why: a `buy` step withdraws this much when the pack is under it, so each estimate has to stay well below the leg's coin float or every purchase walks back to a bank.

// Per-purchase coin estimates.
export const RUNE_GP = 25_000;
export const MOULD_GP = 1000;
export const RUBY_GP = 12_000;
export const ANTIPOISON_GP = 2000;

export const CALEB_FISH: readonly FcItem[] = [
    { id: FC_ID.SWORDFISH, name: FC_ITEM.SWORDFISH },
    { id: FC_ID.BASS, name: FC_ITEM.BASS },
    { id: FC_ID.TUNA, name: FC_ITEM.TUNA },
    { id: FC_ID.SALMON, name: FC_ITEM.SALMON },
    { id: FC_ID.SHRIMP, name: FC_ITEM.SHRIMP }
];

export const BLAST_RUNES: readonly { item: FcItem; qty: number }[] = [
    { item: { id: FC_ID.AIR_RUNE, name: FC_ITEM.AIR_RUNE }, qty: RUNE_BUY.air },
    { item: { id: FC_ID.WATER_RUNE, name: FC_ITEM.WATER_RUNE }, qty: RUNE_BUY.water },
    { item: { id: FC_ID.EARTH_RUNE, name: FC_ITEM.EARTH_RUNE }, qty: RUNE_BUY.earth },
    { item: { id: FC_ID.FIRE_RUNE, name: FC_ITEM.FIRE_RUNE }, qty: RUNE_BUY.fire },
    { item: { id: FC_ID.DEATH_RUNE, name: FC_ITEM.DEATH_RUNE }, qty: RUNE_BUY.death }
];

// Why: this is reference and test material rather than a provisioning threshold, as the teleport kit alone clears it and left the fight with six Fire Blasts and no way to finish.

// One cast of every blast.
export const BLAST_MINIMUM: readonly { item: FcItem; qty: number }[] = [
    { item: { id: FC_ID.AIR_RUNE, name: FC_ITEM.AIR_RUNE }, qty: 13 },
    { item: { id: FC_ID.WATER_RUNE, name: FC_ITEM.WATER_RUNE }, qty: 3 },
    { item: { id: FC_ID.EARTH_RUNE, name: FC_ITEM.EARTH_RUNE }, qty: 4 },
    { item: { id: FC_ID.FIRE_RUNE, name: FC_ITEM.FIRE_RUNE }, qty: 5 },
    { item: { id: FC_ID.DEATH_RUNE, name: FC_ITEM.DEATH_RUNE }, qty: 4 }
];

/** Melee weapons worth wielding for the hellhounds and for finishing Chronozon. */
export const WEAPONS: readonly FcItem[] = [
    { id: 1333, name: 'Rune scimitar' },
    { id: 1331, name: 'Adamant scimitar' },
    { id: 1329, name: 'Mithril scimitar' },
    { id: 1325, name: 'Steel scimitar' },
    { id: 1327, name: 'Iron scimitar' },
    { id: 1321, name: 'Bronze scimitar' }
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

export function heldName(snap: QuestSnapshot, name: string): number {
    return snap.inv.get(name.toLowerCase()) ?? 0;
}

export function bankedName(snap: QuestSnapshot, name: string): number {
    return snap.bank?.get(name.toLowerCase()) ?? 0;
}

export function heldAntipoison(snap: QuestSnapshot): number {
    return ANTIPOISON_IDS.reduce((sum, id) => sum + held(snap, id), 0);
}

export function bankedAntipoison(snap: QuestSnapshot): FcItem | null {
    for (const id of ANTIPOISON_IDS) {
        if (banked(snap, id) > 0) {
            return { id, name: `Antipoison(${id === FC_ID.ANTIPOISON_4 ? 4 : id === FC_ID.ANTIPOISON_3 ? 3 : id === FC_ID.ANTIPOISON_2 ? 2 : 1})` };
        }
    }
    return null;
}

export function hasPickaxe(snap: QuestSnapshot): boolean {
    return PICKAXES.some(p => held(snap, p.id) > 0 || worn(snap, p.id));
}

export function bestBankPickaxe(snap: QuestSnapshot): FcItem | null {
    return PICKAXES.find(p => banked(snap, p.id) > 0) ?? null;
}

export function hasWeapon(snap: QuestSnapshot): boolean {
    return WEAPONS.some(w => held(snap, w.id) > 0 || worn(snap, w.id));
}

export function bestBankWeapon(snap: QuestSnapshot): FcItem | null {
    return WEAPONS.find(w => banked(snap, w.id) > 0) ?? null;
}

// Why: `hasWeapon` is happy with a scimitar in the pack, so the withdraw satisfies it and the equip step never fires — hence a separate check against `worn`.
// Why: null comes back both when a weapon is already wielded and when none exists anywhere, as Chronozon dies to the blasts, so an unarmed fight is slow rather than impossible and stalling the quest over it would be worse.

/** Equip a melee weapon when one is held or banked, or null. */
export function wieldWeapon(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    if (WEAPONS.some(w => worn(snap, w.id))) {
        return null;
    }
    const inPack = WEAPONS.find(w => held(snap, w.id) > 0);
    if (inPack) {
        return { kind: 'equip', item: inPack.name };
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const fromTheBank = bestBankWeapon(snap);
    return fromTheBank ? fromBank(snap, fromTheBank, 1, bank) : null;
}

// Why: air covers Camelot (5) and the strike component of the others, and law is the limiting rune at one or two a hop.
// Why: the quest takes roughly ten hops, so these quantities are generous rather than exact — nothing else consumes them and unused runes come home.

// Runes the standard-spellbook hops need, and how many to carry.
export const TELEPORT_KIT: readonly { item: FcItem; qty: number }[] = [
    { item: { id: FC_ID.LAW_RUNE, name: FC_ITEM.LAW_RUNE }, qty: 30 },
    { item: { id: FC_ID.AIR_RUNE, name: FC_ITEM.AIR_RUNE }, qty: 150 },
    { item: { id: FC_ID.FIRE_RUNE, name: FC_ITEM.FIRE_RUNE }, qty: 30 },
    { item: { id: FC_ID.WATER_RUNE, name: FC_ITEM.WATER_RUNE }, qty: 30 }
];

/** Aubury's rune stock — everything in the kit except law. */
const AUBURY_STOCKS: ReadonlySet<number> = new Set([FC_ID.AIR_RUNE, FC_ID.FIRE_RUNE, FC_ID.WATER_RUNE]);

/** Global `navTeleports`; the nav layer consults the same setting per walk. */
const navTeleportsOn = (): boolean => Traversal.teleportsEnabled();

function heldDuelRing(snap: QuestSnapshot): number {
    return DUEL_RING_IDS.reduce((sum, id) => sum + held(snap, id), 0);
}

// Why: A* only injects a teleport the live inventory can afford, and nothing else in this quest ever puts a law rune in the pack — this is the gap between the navigator being able to plan a Camelot hop and it doing so.
// Why: it costs one bank trip at the start and saves several minutes of walking, as Camelot lands 71 tiles from Caleb against a 379-cost walk and the duel ring lands 73 from the Al Kharid furnace against roughly 600 from Witchaven.
// Why: it never blocks — no runes banked means the quest walks, as before.

/** Carry the teleport kit when nav teleports are on and the bank can pay for it. */
export function teleportKitTopUp(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    return navTeleportsOn() ? teleportKitPlan(snap, bank) : null;
}

/** {@link teleportKitTopUp} without the settings read, so it is testable. */
export function teleportKitPlan(snap: QuestSnapshot, bank?: Tile): QuestStep | null {
    // Why: both halves are tested up front, as keying the "already carrying it" check on one item at a time went wrong twice — on law alone it stopped before fetching the air every spell needs, and on the runes alone it stopped before the ring.
    const runesShort = TELEPORT_KIT.some(want => held(snap, want.item.id) < Math.ceil(want.qty / 3));
    const ringShort = heldDuelRing(snap) === 0;
    if (!runesShort && !ringShort) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }

    // Why: law runes are Magic Guild and Mage Arena stock only, so a bank without them is the normal case rather than a fault, and the spell hops stay off.
    if (runesShort && banked(snap, TELEPORT_KIT[0]!.item.id) > 0) {
        for (const want of TELEPORT_KIT) {
            const step = fromBank(snap, want.item, want.qty, bank);
            if (step) {
                return step;
            }
            // Why: Aubury stocks air, fire and water and stands twenty tiles from the Varrock East booth this trip already visits, so only the law runes have to come from the bank.
            // Why: he does not sell law.
            if (held(snap, want.item.id) < Math.ceil(want.qty / 3) && AUBURY_STOCKS.has(want.item.id)) {
                return { kind: 'buy', item: want.item.name, qty: want.qty, shop: FC_SHOP.AUBURY, estGp: RUNE_GP };
            }
        }
    }

    // Independent of the runes: the ring reaches Al Kharid, which no spell on
    // this book can (Ardougne teleport needs Plague City).
    if (ringShort) {
        const ring = DUEL_RING_IDS.find(id => banked(snap, id) > 0);
        if (ring !== undefined) {
            return withdraw([{ name: 'Ring of dueling', id: ring, qty: 1 }], bank);
        }
    }
    return null;
}

function bestBankFood(snap: QuestSnapshot): string | null {
    return FC_FOODS.find(f => bankedName(snap, f) > 0) ?? null;
}

export function heldFood(snap: QuestSnapshot): number {
    return FC_FOODS.reduce((sum, f) => sum + heldName(snap, f), 0);
}

export function scanBank(bank?: Tile): QuestStep {
    return { kind: 'scanBank', bank };
}

export function withdraw(items: { name: string; qty: number; id?: number }[], bank?: Tile): QuestStep {
    return { kind: 'withdraw', items, bank };
}

// Why: `null` covers both "already carried" and "the bank cannot help", and the caller decides whether that is a shop trip or a park.

/** Withdraw a shortfall when the bank has it. */
export function fromBank(snap: QuestSnapshot, item: FcItem, qty = 1, bank?: Tile): QuestStep | null {
    const short = qty - held(snap, item.id);
    if (short <= 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const inBank = banked(snap, item.id);
    return inBank > 0
        ? withdraw([{ name: item.name, id: item.id, qty: Math.min(short, inBank) }], bank)
        : null;
}

export function buy(item: FcItem, qty: number, shop: { npc: string; anchor: Tile }, estGp: number): QuestStep {
    return { kind: 'buy', item: item.name, qty, shop, estGp };
}

/** Every deposit anywhere in this quest keeps the fragments; losing one costs a re-fetch. */
export const CREST_KEEP_IDS: readonly number[] = [
    FC_ID.CREST_FROM_CALEB,
    FC_ID.CREST_FROM_AVAN,
    FC_ID.CREST_FROM_CHRONOZON,
    FC_ID.FAMILY_CREST
];

export function deposit(keep: string[], bank?: Tile): QuestStep {
    return { kind: 'deposit', keep, keepIds: CREST_KEEP_IDS, bank };
}

/** Coin float carried for tolls, ship fares and shop trips. */
const COIN_CARRY = 100_000;

export function coinTopUp(snap: QuestSnapshot, want = COIN_CARRY, bank?: Tile): QuestStep | null {
    const have = heldName(snap, FC_ITEM.COINS);
    if (have >= want / 2) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const inBank = bankedName(snap, FC_ITEM.COINS);
    if (inBank <= 0) {
        return null;
    }
    return withdraw([{ name: FC_ITEM.COINS, id: FC_ID.COINS, qty: Math.min(want - have, inBank) }], bank);
}

export function foodTopUp(snap: QuestSnapshot, want = FOOD_WITHDRAW, bank?: Tile): QuestStep | null {
    if (heldFood(snap) >= Math.ceil(want / 2)) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank(bank);
    }
    const food = bestBankFood(snap);
    if (!food) {
        return null;
    }
    const take = Math.min(want - heldFood(snap), bankedName(snap, food));
    return take > 0 ? withdraw([{ name: food, qty: take }], bank) : null;
}

/** Bank stand nearest each leg — this quest is spread over four kingdoms. */
export const LEG_BANK = {
    start: FC_BANK.VARROCK_EAST,
    caleb: FC_BANK.CATHERBY,
    alkharid: FC_BANK.AL_KHARID,
    /** The mine is at Witchaven, but the furnace, moulds and Avan are all here. */
    gold: FC_BANK.AL_KHARID,
    /** Nearest bank to the Witchaven ladder, for the kit the mine itself needs. */
    mine: FC_BANK.ARDOUGNE_EAST,
    boot: FC_BANK.FALADOR_EAST,
    // Why: Aubury's rune shop is 19 tiles from the Varrock East booth and 160 from Edgeville's, and the Jolly Boar Inn is closer to Varrock East too.
    // Why: the dungeon walk starts from wherever the last withdraw left us either way.
    chronozon: FC_BANK.VARROCK_EAST
} as const;

export const SHOP = FC_SHOP;

export function warnFamilyCrestReadiness(): string | null {
    const have = {
        mining: Skills.level('mining'),
        crafting: Skills.level('crafting'),
        smithing: Skills.level('smithing'),
        magic: Skills.level('magic'),
        attack: Skills.level('attack'),
        strength: Skills.level('strength'),
        defence: Skills.level('defence'),
        hitpoints: Skills.level('hitpoints')
    };

    const missing: string[] = [];
    for (const [skill, need] of Object.entries(FC_OFFICIAL_SKILLS)) {
        const n = have[skill as keyof typeof have] ?? 1;
        if (n < need) {
            missing.push(`${skill} ${n}/${need}`);
        }
    }
    if (missing.length > 0) {
        return `official skill reqs not met (${missing.join(', ')}) — Fire Blast and the perfect-gold jewellery will both refuse`;
    }

    const floor = FC_PROVEN_COMBAT_FLOOR;
    const short = (['attack', 'strength', 'defence', 'hitpoints'] as const)
        .filter(s => have[s] < floor[s])
        .map(s => `${s} ${have[s]}/${floor[s]}`);
    if (short.length === 0) {
        return null;
    }
    return `combat below the only proven profile (${short.join(', ')}; headed PASS at max). `
        + 'Hellhounds guard the gold rocks and Chronozon is a lvl-170 wilderness demon — expect death risk.';
}
