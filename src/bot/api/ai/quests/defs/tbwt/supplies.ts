import { Equipment } from '../../../../equipment/Equipment.js';
import { foodForms } from '../../../../combat/food.js';
import { ITEM_DB } from '../../../../../data/itemdb.js';
import { armourChoice, armourWorn } from '../../armour.js';
import { QuestFood } from '../../food.js';
import { flagValue, hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import {
    AGILITY_DOSES,
    ARROW_TARGET,
    COIN_TARGET,
    onKaramja,
    TB_ARMOUR_SLOTS,
    TB_ARROWS,
    TB_BOWS,
    TB_ID,
    TB_LUBUFU,
    TB_NAME,
    TB_NPC,
    TB_POTIONS,
    TB_SPEARS,
    TB_TAMAYU,
    TB_TILE,
    TB_TINSAY
} from './areas.js';
import { TB_FLAG } from './journal.js';
import { foodNames, loadout, retainLoadout } from './loadout.js';
export { foodNames } from './loadout.js';

export const heldId = (snap: QuestSnapshot, id: number): number => snap.invIds?.get(id) ?? 0;
export const bankedId = (snap: QuestSnapshot, id: number): number => snap.bankIds?.get(id) ?? 0;
export const held = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
export const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
export const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

export const lubufuStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.LUBUFU) ?? TB_LUBUFU.UNKNOWN;
export const tinsayStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.TINSAY) ?? TB_TINSAY.UNKNOWN;
export const tamayuStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.TAMAYU) ?? TB_TAMAYU.UNKNOWN;
export const tiadecheStage = (snap: QuestSnapshot): number => flagValue(snap.progress, TB_FLAG.TIADECHE) ?? 0;

export function foodHeld(snap: QuestSnapshot): number {
    return [...new Set(foodNames().flatMap(foodForms))].reduce((total, name) => total + held(snap, name), 0);
}

interface Supply {
    name: string;
    id: number;
    qty: number;
    /** Jiminua stocks it inside the quest area, so a shortfall is a purchase. */
    fromJiminua?: boolean;
}

const NET: Supply = { name: TB_NAME.NET, id: TB_ID.NET, qty: 1 };
const KNIFE: Supply = { name: TB_NAME.KNIFE, id: TB_ID.KNIFE, qty: 1, fromJiminua: true };
const PESTLE: Supply = { name: TB_NAME.PESTLE, id: TB_ID.PESTLE, qty: 1, fromJiminua: true };
const TINDERBOX: Supply = { name: TB_NAME.TINDERBOX, id: TB_ID.TINDERBOX, qty: 1, fromJiminua: true };
const SEAWEED: Supply = { name: TB_NAME.SEAWEED, id: TB_ID.SEAWEED, qty: 1 };

export function outstandingSupplies(snap: QuestSnapshot): Supply[] {
    const tools = new Set(loadout(snap).tools);
    return [NET, KNIFE, PESTLE, TINDERBOX, SEAWEED].filter(supply => tools.has(supply.id));
}

// Why: a pack holding paste and no shaft still needs a spear.

/** The Karambwan-poisoned spear the pack is carrying, 0 when there is none. */
export function kpSpearHeld(snap: QuestSnapshot): number {
    return TB_SPEARS.find(spear => heldId(snap, spear.kpId) > 0)?.kpId ?? 0;
}

/** The bare spear the paste still has to go on, null when the pack holds none. */
export function bareSpearHeld(snap: QuestSnapshot): typeof TB_SPEARS[number] | null {
    return TB_SPEARS.find(spear => heldId(snap, spear.id) > 0) ?? null;
}

/** True while the Tamayu leg still owes him a spear and the pack holds nothing that becomes one. */
export function spearWanted(snap: QuestSnapshot): boolean {
    return tamayuStage(snap) < TB_TAMAYU.COMPLETE
        && !hasFlag(snap.progress, TB_FLAG.SPEAR)
        && kpSpearHeld(snap) === 0
        && bareSpearHeld(snap) === null;
}

/** Doses of agility potion the pack is carrying, across every bottle size. */
export function dosesHeld(snap: QuestSnapshot): number {
    return TB_POTIONS.reduce((total, potion) => total + heldId(snap, potion.id) * potion.doses, 0);
}

// Why: Only the fourth dose appears in the journal, so fill all four before starting another bottle.

/** True while Tamayu is still short of his 4 doses and the pack has nothing to pour. */
export function dosesWanted(snap: QuestSnapshot): boolean {
    return tamayuStage(snap) < TB_TAMAYU.COMPLETE
        && !hasFlag(snap.progress, TB_FLAG.AGILITY)
        && dosesHeld(snap) === 0;
}

/** The cheapest spear the bank holds that Tamayu will take, bare ones before poisoned ones. */
export function spearInBank(snap: QuestSnapshot): { name: string; id: number } | null {
    const bare = TB_SPEARS.find(spear => bankedId(snap, spear.id) > 0);
    if (bare) {
        return { name: bare.name, id: bare.id };
    }
    const done = TB_SPEARS.find(spear => bankedId(snap, spear.kpId) > 0);
    return done ? { name: done.kpName, id: done.kpId } : null;
}

/** Bottles to draw for Tamayu's 4 doses, fullest first. Empty when the bank holds no agility potion. */
export function potionsInBank(snap: QuestSnapshot): { name: string; qty: number; id: number }[] {
    const lines: { name: string; qty: number; id: number }[] = [];
    let doses = 0;
    for (const potion of TB_POTIONS) {
        const stocked = bankedId(snap, potion.id);
        const take = Math.min(stocked, Math.ceil((AGILITY_DOSES - doses) / potion.doses));
        if (take > 0) {
            lines.push({ name: potion.name, qty: take, id: potion.id });
            doses += take * potion.doses;
        }
        if (doses >= AGILITY_DOSES) {
            break;
        }
    }
    return lines;
}

/** The bow this run draws: what is worn or carried, else the best one the bank holds and the account can wield. */
export function bowChoice(snap: QuestSnapshot): string | null {
    const usable = TB_BOWS.filter(bow => (snap.ranged ?? 99) >= bow.ranged);
    return usable.find(bow => worn(snap, bow.name) || held(snap, bow.name) > 0)?.name
        ?? usable.find(bow => banked(snap, bow.name) > 0)?.name
        ?? null;
}

/** The arrows this run fires: what is worn or carried, else the first the bank holds. */
export function arrowChoice(snap: QuestSnapshot): string | null {
    return TB_ARROWS.find(name => worn(snap, name) || held(snap, name) > 0)
        ?? TB_ARROWS.find(name => banked(snap, name) > 0)
        ?? null;
}

const scanBank: QuestStep = { kind: 'scanBank', bank: TB_TILE.ARDOUGNE_BANK };

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

// Why: `buy` walks back to a bank whenever the pack holds less than `estGp`, so the estimate stays under the float; none of these 3 costs more than 100.
const buyAtJiminua = (item: string, qty: number): QuestStep => ({
    kind: 'buy',
    item,
    qty,
    shop: { npc: TB_NPC.JIMINUA, anchor: TB_TILE.JIMINUA },
    estGp: 150
});

function clearSpace(snap: QuestSnapshot, removeFood = false): QuestStep | null {
    if (heldId(snap, TB_ID.RUM) > 0) return { kind: 'wait', reason: 'make and deliver the Karamjan rum before leaving the island to bank' };
    const names = new Map<number, string>([
        ...ITEM_DB.map(item => [item.id, item.name] as [number, string]),
        ...[NET, KNIFE, PESTLE, TINDERBOX, SEAWEED].map(item => [item.id, item.name] as [number, string])
    ]);
    const inventory = [...snap.invIds ?? []].map(([id, count]) => ({ id, count, name: names.get(id) ?? null }));
    for (const [name, count] of snap.inv) {
        const id = ITEM_DB.find(item => item.name.toLowerCase() === name)?.id;
        if (id !== undefined && !inventory.some(item => item.id === id)) inventory.push({ id, count, name });
    }
    const retained = retainLoadout(snap, inventory, QuestFood.name);
    const foods = new Set(foodNames().flatMap(foodForms));
    const keepIds = retained.keepIds.filter(id => !removeFood || !foods.has(names.get(id)?.toLowerCase() ?? ''));
    const caps = retained.caps.filter(cap => keepIds.includes(cap.id));
    const expendable = inventory.some(item => !keepIds.includes(item.id)) || caps.length > 0;
    return expendable ? { kind: 'deposit', keep: [], keepIds, caps, bank: TB_TILE.ARDOUGNE_BANK, exactKeep: true } : null;
}

// Why: this runs on every decide() tick, so each branch is idempotent and falls silent as soon as the pack is right.

/**
 * The pack and the worn kit, bank first. Null once nothing is outstanding.
 * @see docs/reference/quest-module-shape.md
 */
export function prepare(snap: QuestSnapshot): QuestStep | null {
    const plan = loadout(snap);
    if (plan.deliverCatch || plan.compact) return null;
    const missing = outstandingSupplies(snap).filter(s => heldId(snap, s.id) < s.qty);
    const bow = bowChoice(snap);
    const arrows = arrowChoice(snap);
    const kit = [bow, arrows].filter((n): n is string => Boolean(n));
    const armour = TB_ARMOUR_SLOTS.map(slot => ({ slot, piece: armourChoice(snap, slot) }));
    const armourMissing = armour.filter(entry => !entry.piece);
    const gearMissing = [...kit.filter(name => !worn(snap, name)),
        ...armour.flatMap(({ piece }) => piece && !armourWorn(snap, piece) ? [piece.name] : [])];
    // Why: only an outstanding purchase justifies a crossing for coin; the ferry's own 30gp fare is covered by the float this withdraws.
    const buying = plan.phase === 'rum' || missing.some(s => s.fromJiminua);
    const coinsLow = held(snap, TB_NAME.COINS) < (buying ? 100 : 60);
    const starving = foodHeld(snap) === 0;
    const wantSpear = plan.spear && spearWanted(snap);
    const wantDoses = plan.potions && dosesWanted(snap);

    const carried = gearMissing.filter(name => held(snap, name) > 0);
    if (carried.length > 0) return wearAll(carried);
    const food = foodHeld(snap);
    if (food > plan.food || (snap.freeSlots ?? 28) < plan.minFree) {
        const space = clearSpace(snap) ?? clearSpace(snap, true);
        if (space) return space;
        return { kind: 'wait', reason: `${plan.phase} needs ${plan.minFree} free inventory slots` };
    }

    if (missing.length === 0 && gearMissing.length === 0 && armourMissing.length === 0 && kit.length === 2 && !coinsLow && !starving
        && !wantSpear && !wantDoses) {
        return null;
    }

    if (!snap.bankKnown) {
        return scanBank;
    }

    // Jiminua's counter is inside the quest area; only the ferry is worth avoiding.
    if (onKaramja(snap.tile) && !coinsLow && !starving && gearMissing.length === 0
        && armourMissing.length === 0 && kit.length === 2) {
        const shopped = missing.find(s => s.fromJiminua && bankedId(snap, s.id) === 0);
        if (shopped) {
            return buyAtJiminua(shopped.name, shopped.qty);
        }
    }

    const fromBank: { name: string; qty: number; id?: number }[] = [];
    const unavailable: string[] = armourMissing.map(({ slot }) => `usable ${slot} armour`);
    for (const s of missing) {
        const stocked = bankedId(snap, s.id);
        if (stocked > 0) {
            fromBank.push({ name: s.name, qty: Math.min(s.qty - heldId(snap, s.id), stocked), id: s.id });
        } else if (!s.fromJiminua) {
            unavailable.push(s.name);
        }
    }
    if (!bow) {
        unavailable.push(`any bow this account can draw at Ranged ${snap.ranged ?? '?'}`);
    }
    if (!arrows) {
        unavailable.push('any arrows');
    }
    for (const name of gearMissing) {
        if (banked(snap, name) > 0) {
            fromBank.push({ name, qty: name === arrows ? ARROW_TARGET : 1 });
        } else {
            unavailable.push(name);
        }
    }
    // Why: Jogres drop spears and their patch is on the route, so an empty bank isn't a dead end.
    if (wantSpear) {
        const stocked = spearInBank(snap);
        if (stocked) {
            fromBank.push({ name: stocked.name, qty: 1, id: stocked.id });
        }
    }
    if (wantDoses) {
        const bottles = potionsInBank(snap);
        if (bottles.length > 0) {
            fromBank.push(...bottles);
        } else {
            unavailable.push('an agility potion, any dose');
        }
    }
    if (coinsLow && banked(snap, TB_NAME.COINS) > 0) {
        fromBank.push({ name: TB_NAME.COINS, qty: COIN_TARGET });
    }
    const suppliesSlots = fromBank.reduce((total, item) => {
        const stackable = item.name === TB_NAME.COINS || TB_ARROWS.includes(item.name);
        return total + (stackable ? (held(snap, item.name) > 0 ? 0 : 1) : item.qty);
    }, 0);
    if (suppliesSlots + plan.minFree > (snap.freeSlots ?? 28)) {
        return clearSpace(snap) ?? clearSpace(snap, true) ?? { kind: 'wait', reason: `${plan.phase} needs room for supplies and ${plan.minFree} free slots` };
    }
    const foodCapacity = Math.max(0, (snap.freeSlots ?? 28) - suppliesSlots - plan.minFree);
    if (food < plan.food) {
        const stocked = foodNames().flatMap(name => [name, ...foodForms(name).filter(form => form !== name.toLowerCase())])
            .find(name => banked(snap, name) > 0);
        if (stocked && foodCapacity > 0) {
            fromBank.push({ name: stocked, qty: Math.min(plan.food - food, foodCapacity, banked(snap, stocked)) });
        } else if (stocked && starving && fromBank.length === 0) {
            return clearSpace(snap) ?? { kind: 'wait', reason: 'no room for combat food and Karambwan catches' };
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

/** Advisory floors, none of these is a server gate on the quest journal itself. */
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
