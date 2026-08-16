import { Equipment } from '../../../../equipment/Equipment.js';
import { QuestFood } from '../../food.js';
import { flagValue, hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import {
    ARROW_TARGET,
    COIN_TARGET,
    FOOD_TARGET,
    onKaramja,
    TB_GEAR,
    TB_ID,
    TB_LUBUFU,
    TB_NAME,
    TB_NPC,
    TB_TAMAYU,
    TB_TILE,
    TB_TINSAY
} from './areas.js';
import { TB_FLAG } from './journal.js';

export const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;
export const bankedId = (snap: QuestSnapshot, id: number): number => snap.bankIds?.get(id) ?? 0;
export const held = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
export const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
export const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

export const lubufuStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.LUBUFU) ?? TB_LUBUFU.UNKNOWN;
export const tinsayStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.TINSAY) ?? TB_TINSAY.UNKNOWN;
export const tamayuStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.TAMAYU) ?? TB_TAMAYU.UNKNOWN;
export const tiadecheStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.TIADECHE) ?? 0;

/** Food this quest will carry, the script's chosen food first. */
export function foodNames(): string[] {
    const chosen = QuestFood.name?.trim();
    const names = [chosen, 'Lobster', 'Swordfish', 'Tuna', 'Trout', 'Salmon'].filter((n): n is string => Boolean(n));
    return [...new Map(names.map(n => [n.toLowerCase(), n])).values()];
}

export function foodHeld(snap: QuestSnapshot): number {
    return foodNames().reduce((total, name) => total + held(snap, name), 0);
}

interface Supply {
    name: string;
    id: number;
    qty: number;
    /** Jiminua stocks it inside the quest area, so a shortfall is a purchase rather than a ferry crossing. */
    fromJiminua?: boolean;
}

const NET: Supply = { name: TB_NAME.NET, id: TB_ID.NET, qty: 1 };
const KNIFE: Supply = { name: TB_NAME.KNIFE, id: TB_ID.KNIFE, qty: 1, fromJiminua: true };
const PESTLE: Supply = { name: TB_NAME.PESTLE, id: TB_ID.PESTLE, qty: 1, fromJiminua: true };
const TINDERBOX: Supply = { name: TB_NAME.TINDERBOX, id: TB_ID.TINDERBOX, qty: 1, fromJiminua: true };
const SEAWEED: Supply = { name: TB_NAME.SEAWEED, id: TB_ID.SEAWEED, qty: 1 };
const IRON_SPEAR: Supply = { name: TB_NAME.IRON_SPEAR, id: TB_ID.IRON_SPEAR, qty: 1 };
const AGILITY: Supply = { name: TB_NAME.AGILITY_POTION_4, id: TB_ID.AGILITY_POTION_4, qty: 1 };

// Why: a supply drops off the list the moment its leg is behind us, so the quest never crosses back to Ardougne for a knife it has already used.

/** Everything the legs still ahead of the bot consume. */
export function outstandingSupplies(snap: QuestSnapshot): Supply[] {
    const lubufu = lubufuStage(snap);
    const tinsay = tinsayStage(snap);
    const tamayu = tamayuStage(snap);
    const out: Supply[] = [];
    // Karambwanji bait Lubufu, load the vessel for Tiadeche, and grind into Tinsay's marinade.
    if (lubufu < TB_LUBUFU.COMPLETE || tinsay < TB_TINSAY.COMPLETE) {
        out.push(NET);
    }
    if (tinsay < TB_TINSAY.GIVEN_RUM) {
        out.push(KNIFE);
    }
    if (tamayu < TB_TAMAYU.COMPLETE || tinsay < TB_TINSAY.COMPLETE) {
        out.push(PESTLE);
    }
    if (tinsay < TB_TINSAY.COMPLETE) {
        out.push(TINDERBOX);
    }
    // The sandwich consumes it, and the stage only advances when Tinsay eats — so a made sandwich retires the need.
    if (tinsay < TB_TINSAY.GIVEN_SANDWICH && heldId(snap, TB_ID.SANDWICH) === 0) {
        out.push(SEAWEED);
    }
    if (tamayu < TB_TAMAYU.COMPLETE) {
        // Why: the paste is half the spear, not the spear — a pack holding paste and no shaft still needs one.
        const spearDone = hasFlag(snap.progress, TB_FLAG.SPEAR) || heldId(snap, TB_ID.SPEAR_KP) > 0;
        if (!spearDone) {
            out.push(IRON_SPEAR);
        }
        if (!hasFlag(snap.progress, TB_FLAG.AGILITY)) {
            out.push(AGILITY);
        }
    }
    return out;
}

/** Kept by id, so all three "Karambwan vessel"s and all three "Karamjan rum"s survive a deposit. */
export const TB_KEEP_IDS: readonly number[] = Object.values(TB_ID);

const scanBank: QuestStep = { kind: 'scanBank', bank: TB_TILE.ARDOUGNE_BANK };

function keepNames(): string[] {
    return [...TB_GEAR, ...foodNames()].map(n => n.toLowerCase());
}

function wearAll(names: readonly string[]): QuestStep {
    return {
        kind: 'custom',
        name: `wear ${names.join(', ')}`,
        run: async log => {
            for (const name of names) {
                if (!(await Equipment.equip(name))) {
                    log(`cannot wear ${name} — not in the pack, or the server refused it`);
                    return false;
                }
            }
            return true;
        }
    };
}

// Why: `buy` walks back to a bank whenever the pack holds less than `estGp`, so the estimate stays
// under the float this module already carries — none of these three costs more than a hundred.
const buyAtJiminua = (item: string, qty: number): QuestStep => ({
    kind: 'buy',
    item,
    qty,
    shop: { npc: TB_NPC.JIMINUA, anchor: TB_TILE.JIMINUA },
    estGp: 150
});

/** Below this the pack cannot hold a fishing trip, so a bank visit deposits first. */
const DEPOSIT_BELOW_FREE = 6;

// Why: this runs on every decide() tick, so each branch is idempotent and falls silent as soon as the pack is right.

/**
 * The pack and the worn kit, bank first. Null once nothing is outstanding.
 * @see docs/reference/quest-module-shape.md
 */
export function prepare(snap: QuestSnapshot): QuestStep | null {
    const missing = outstandingSupplies(snap).filter(s => heldId(snap, s.id) < s.qty);
    const gearMissing = TB_GEAR.filter(name => !worn(snap, name));
    // Why: only an outstanding purchase justifies a crossing for coin; the ferry's own 30gp fare is covered by the float this withdraws.
    const buying = tinsayStage(snap) < TB_TINSAY.GIVEN_RUM || missing.some(s => s.fromJiminua);
    const coinsLow = buying && held(snap, TB_NAME.COINS) < 100;
    const starving = foodHeld(snap) === 0;

    if (missing.length === 0 && gearMissing.length === 0 && !coinsLow && !starving) {
        return null;
    }

    // Wearing what is already in the pack never needs a bank.
    const carried = gearMissing.filter(name => held(snap, name) > 0);
    if (carried.length > 0) {
        return wearAll(carried);
    }

    if (!snap.bankKnown) {
        return scanBank;
    }

    // Jiminua's counter is inside the quest area; only the ferry is worth avoiding.
    if (onKaramja(snap.tile) && !coinsLow && !starving && gearMissing.length === 0) {
        const shopped = missing.find(s => s.fromJiminua && bankedId(snap, s.id) === 0);
        if (shopped) {
            return buyAtJiminua(shopped.name, shopped.qty);
        }
    }

    if ((snap.freeSlots ?? 28) < DEPOSIT_BELOW_FREE) {
        return { kind: 'deposit', keep: keepNames(), keepIds: TB_KEEP_IDS, bank: TB_TILE.ARDOUGNE_BANK, exactKeep: true };
    }

    const fromBank: { name: string; qty: number; id?: number }[] = [];
    const unavailable: string[] = [];
    for (const s of missing) {
        const stocked = bankedId(snap, s.id);
        if (stocked > 0) {
            fromBank.push({ name: s.name, qty: Math.min(s.qty - heldId(snap, s.id), stocked), id: s.id });
        } else if (!s.fromJiminua) {
            unavailable.push(s.name);
        }
    }
    for (const name of gearMissing) {
        if (banked(snap, name) > 0) {
            fromBank.push({ name, qty: name === TB_NAME.ARROWS ? ARROW_TARGET : 1 });
        } else {
            unavailable.push(name);
        }
    }
    if (coinsLow && banked(snap, TB_NAME.COINS) > 0) {
        fromBank.push({ name: TB_NAME.COINS, qty: COIN_TARGET });
    }
    if (foodHeld(snap) < FOOD_TARGET) {
        const stocked = foodNames().find(name => banked(snap, name) > 0);
        if (stocked) {
            fromBank.push({ name: stocked, qty: FOOD_TARGET - foodHeld(snap) });
        } else if (starving) {
            unavailable.push('any combat food');
        }
    }
    if (fromBank.length > 0) {
        return { kind: 'withdraw', items: fromBank, bank: TB_TILE.ARDOUGNE_BANK };
    }
    if (unavailable.length > 0) {
        return { kind: 'wait', reason: `bank has none of: ${unavailable.join(', ')}` };
    }
    // What is left is a Jiminua line and the bank does not stock it.
    const shopped = missing.find(s => s.fromJiminua);
    return shopped ? buyAtJiminua(shopped.name, shopped.qty) : null;
}

/** Advisory floors — none of these is a server gate on the quest journal itself. */
export const TB_PROVEN = {
    /** The profile a headed run has finished on, end to end. */
    skills: 70,
    /** `light_jogre_bones_inv` refuses below this, and the only furnace on Karamja is behind Shilo Village. */
    firemaking: 30,
    /** The marinade and the poorly cooked Karambwan both need it. */
    cooking: 30,
    /** Not required: Tiadeche hands over the one raw Karambwan the spear needs. */
    karambwanFishing: 65
} as const;

export function readiness(levelOf: (skill: string) => number): string | null {
    const short: string[] = [];
    if (levelOf('firemaking') < TB_PROVEN.firemaking) {
        short.push(`Firemaking ${levelOf('firemaking')} < ${TB_PROVEN.firemaking} — Jogre bones cannot be burnt`);
    }
    if (levelOf('cooking') < TB_PROVEN.cooking) {
        short.push(`Cooking ${levelOf('cooking')} < ${TB_PROVEN.cooking} — the marinade cannot be cooked`);
    }
    if (short.length === 0) {
        return null;
    }
    return `proven at ${TB_PROVEN.skills} across the board; ${short.join('; ')}`;
}
