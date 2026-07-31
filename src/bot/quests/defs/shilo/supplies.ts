import { Execution } from '../../../api/Execution.js';
import { Traversal } from '../../../api/Traversal.js';
import { Shop } from '../../../api/hud/Shop.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Locs } from '../../../api/queries/Locs.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { BONE_SPAWNS, SV_ITEM, SV_NPC, SV_TILE, type ShiloItem } from './areas.js';

/**
 * Jiminua stocks rope, spade, chisel, candle, tinderbox, hammer, a bronze bar and
 * food, thirty-five tiles from Trufitus. Karamja has no bank until this quest opens
 * Shilo's, so everything except coins and bones is bought here rather than carried.
 */
export const JIMINUA_SHOP = { npc: SV_NPC.JIMINUA, anchor: SV_TILE.JIMINUA };

// Asking prices run well above obj cost and climb as stock drains; this leaves headroom.
const BREAD_PRICE = 40;

/** Two ship fares, the whole Jiminua kit, and headroom for a second shop trip. */
export const KARAMJA_PURSE = 2000;

export const QUEST_FOOD = 'Bread';

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

export function worn(snap: QuestSnapshot, id: number): boolean {
    return snap.wornIds?.has(id) ?? false;
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: SV_TILE.ARDOUGNE_BANK };
}

export function withdrawFrom(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: SV_TILE.ARDOUGNE_BANK };
}

/**
 * Jiminua is 35 tiles from Trufitus but the mound is 200 the other way, so buying
 * one item per trip costs six crossings of the island. Every tool the rest of the
 * quest still needs is bought in a single visit instead.
 */
export function stockUp(wanted: readonly { item: ShiloItem; qty: number }[]): QuestStep {
    const list = wanted.map(w => `${w.qty}× ${w.item.name}`).join(', ');
    return { kind: 'custom', name: `buy ${list} from Jiminua`, run: log => buyKit(wanted, log) };
}

async function buyKit(wanted: readonly { item: ShiloItem; qty: number }[], log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(SV_TILE.JIMINUA, { radius: 3, attempts: 3, timeoutMs: 240_000, log }))) {
        return false;
    }
    if (!(await Shop.open(JIMINUA_SHOP.npc))) {
        log("could not open Jiminua's shop");
        return false;
    }
    let bought = 0;
    for (const { item, qty } of wanted) {
        const short = qty - carriedId(item.id);
        if (short <= 0) {
            continue;
        }
        if ((await Shop.buy(item.name, short)) > 0) {
            bought++;
        } else {
            log(`Jiminua is out of ${item.name}, or the purse is empty`);
        }
    }
    await Shop.close();
    return bought > 0;
}

function carriedId(id: number): number {
    return Inventory.items().filter(entry => entry.id === id).reduce((sum, entry) => sum + entry.count, 0);
}

/**
 * The engine's `buy` step falls back to a bank trip when short of coin, and there
 * is no bank on Karamja — so the purse is filled at Ardougne before crossing.
 */
export function sourceCoins(snap: QuestSnapshot, want: number): QuestStep | null {
    if (held(snap, SV_ITEM.COINS.id) >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, SV_ITEM.COINS.id);
    if (available <= 0) {
        return { kind: 'wait', reason: `need ${want} gp for the Karamja crossing and Jiminua's shop` };
    }
    return withdrawFrom([{ name: SV_ITEM.COINS.name, id: SV_ITEM.COINS.id, qty: Math.min(want, available) }]);
}

/**
 * The whole outstanding toolkit, judged by what the remaining quest still needs.
 * One `stockUp` step buys all of it in a single visit.
 */
export function kitShortfall(snap: QuestSnapshot, need: readonly ShiloItem[]): { item: ShiloItem; qty: number }[] {
    return need.filter(item => held(snap, item.id) === 0).map(item => ({ item, qty: 1 }));
}

export function sourceTools(snap: QuestSnapshot, need: readonly ShiloItem[]): QuestStep | null {
    const short = kitShortfall(snap, need);
    return short.length === 0 ? null : stockUp(short);
}

export function sourceFood(snap: QuestSnapshot, want: number): QuestStep | null {
    const carried = snap.inv.get(QUEST_FOOD.toLowerCase()) ?? 0;
    if (carried >= want) {
        return null;
    }
    return { kind: 'buy', item: QUEST_FOOD, qty: want - carried, shop: JIMINUA_SHOP, estGp: (want - carried) * BREAD_PRICE };
}

/**
 * Only a lit candle, lit black candle or lit torch satisfies the fissure, and the
 * shop sells the candle unlit — so the tinderbox rides along and lights it.
 */
export function sourceLitCandle(snap: QuestSnapshot, need: readonly ShiloItem[] = []): QuestStep | null {
    if (held(snap, SV_ITEM.LIT_CANDLE.id) > 0) {
        return null;
    }
    const short = kitShortfall(snap, [...need, SV_ITEM.CANDLE, SV_ITEM.TINDERBOX]);
    if (short.length > 0) {
        return stockUp(short);
    }
    return { kind: 'custom', name: 'light the candle', run: lightCandle };
}

export async function lightCandle(log: (m: string) => void): Promise<boolean> {
    const candle = Inventory.items().find(item => item.id === SV_ITEM.CANDLE.id);
    const tinderbox = Inventory.items().find(item => item.id === SV_ITEM.TINDERBOX.id);
    if (!candle || !tinderbox) {
        log('no candle or tinderbox to light with');
        return false;
    }
    if (!(await candle.useOn(tinderbox))) {
        return false;
    }
    return Execution.delayUntil(
        () => Inventory.items().some(item => item.id === SV_ITEM.LIT_CANDLE.id),
        6000
    );
}

/**
 * Nothing sells bronze wire. Smithing 4 turns a Jiminua bar into one at the Tai Bwo
 * Wannai anvil, which is why the quest asks for the level at all.
 */
export function sourceBronzeWire(snap: QuestSnapshot, need: readonly ShiloItem[] = []): QuestStep | null {
    if (held(snap, SV_ITEM.BRONZE_WIRE.id) > 0) {
        return null;
    }
    const short = kitShortfall(snap, [...need, SV_ITEM.BRONZE_BAR, SV_ITEM.HAMMER]);
    if (short.length > 0) {
        return stockUp(short);
    }
    return { kind: 'custom', name: 'smith the bronze bar into wire', run: smithBronzeWire };
}

export async function smithBronzeWire(log: (m: string) => void): Promise<boolean> {
    if (Inventory.items().some(item => item.id === SV_ITEM.BRONZE_WIRE.id)) {
        return true;
    }
    if (!(await Traversal.walkResilient(SV_TILE.ANVIL, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const bar = Inventory.items().find(item => item.id === SV_ITEM.BRONZE_BAR.id);
    const anvil = Locs.query().name('Anvil').within(8).nearest();
    if (!bar || !anvil) {
        log('no bronze bar in the pack, or no anvil in range at Tai Bwo Wannai');
        return false;
    }
    if (!(await bar.useOn(anvil))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isMainMakePanel(), 8000))) {
        log('the anvil panel never opened');
        return false;
    }
    if (!(await ChatDialog.makeFromPanel('Bronze wire'))) {
        log(`no 'Bronze wire' on the anvil panel: ${ChatDialog.mainMakeProducts().join(', ')}`);
        return false;
    }
    return Execution.delayUntil(
        () => Inventory.items().some(item => item.id === SV_ITEM.BRONZE_WIRE.id),
        12_000
    );
}

/**
 * No shop sells bones and every NPC this quest kills has `death_drop=null`, so the
 * three for the tomb door come from the bank or from the Khazard battlefield spawns.
 */
export function sourceBones(snap: QuestSnapshot, want: number): QuestStep | null {
    const carried = held(snap, SV_ITEM.BONES.id);
    if (carried >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, SV_ITEM.BONES.id);
    if (inBank > 0) {
        return withdrawFrom([{ name: SV_ITEM.BONES.name, id: SV_ITEM.BONES.id, qty: Math.min(want - carried, inBank) }]);
    }
    return { kind: 'custom', name: `pick up ${want - carried} bones on the battlefield`, run: log => gatherBones(want, log) };
}

export async function gatherBones(want: number, log: (m: string) => void): Promise<boolean> {
    const carried = (): number => Inventory.items().filter(item => item.id === SV_ITEM.BONES.id).reduce((n, i) => n + i.count, 0);
    for (const spawn of BONE_SPAWNS) {
        if (carried() >= want) {
            return true;
        }
        if (!(await Traversal.walkResilient(spawn, { radius: 3, attempts: 2, timeoutMs: 120_000, log }))) {
            continue;
        }
        // Each battlefield tile respawns one pile, so take every pile in range
        // before walking to the next.
        while (carried() < want) {
            const before = carried();
            const pile = GroundItems.query().name(SV_ITEM.BONES.name).within(6).nearest();
            if (!pile || !(await pile.interact('Take'))) {
                break;
            }
            if (!(await Execution.delayUntil(() => carried() > before, 5000))) {
                break;
            }
        }
    }
    return carried() >= want;
}
