import { ITEM_DB } from '../../../../../data/itemdb.js';
import { foodForms } from '../../../../combat/food.js';
import { flagValue, hasFlag, type QuestSnapshot, type QuestStep } from '../../engine/types.js';
import { QuestFood } from '../../food.js';
import { CRYSTALS, RELIC_PARTS, WT_ITEM as I, WT_TILE, watchtowerArea, type WatchtowerItem } from './areas.js';

export const WATCHTOWER_FOODS = ['Lobster', 'Swordfish', 'Tuna', 'Trout', 'Salmon', 'Cake'];
export const foodNames = (configured = QuestFood.name): string[] => [...new Map([configured, ...WATCHTOWER_FOODS]
    .filter((name): name is string => Boolean(name?.trim())).map(name => [name.toLowerCase(), name])).values()];
export const edibleNames = (configured = QuestFood.name): string[] => [...new Set(foodNames(configured).flatMap(foodForms))];
export const foodCount = (snap: QuestSnapshot): number => edibleNames().reduce((n, name) => n + (snap.inv.get(name) ?? 0), 0);

export function phaseItems(snap: QuestSnapshot): WatchtowerItem[] {
    const held = (item: WatchtowerItem): number => snap.invIds?.get(item.id) ?? 0;
    const owned = (item: WatchtowerItem): number => held(item) + (snap.bankIds?.get(item.id) ?? 0);
    const stage = snap.stage ?? snap.progress?.stage ?? 0;
    const area = watchtowerArea(snap.tile);
    const caveKit = [I.SKAVID_MAP, I.LIT_CANDLE];
    if (stage === 2 && !owned(I.OGRE_RELIC)) {
        if (!hasFlag(snap.progress, 'helped-og')) return [I.TOBAN_KEY, I.STOLEN_GOLD];
        if (!hasFlag(snap.progress, 'helped-toban')) return [I.DRAGON_BONES];
        if (!hasFlag(snap.progress, 'helped-grew')) return [I.ROPE, I.OGRE_TOOTH];
        return [...RELIC_PARTS, ...(owned(I.JANGERBERRIES) < 2 ? [I.ROPE] : [])];
    }
    if (stage === 2 || stage === 3) return [I.OGRE_RELIC];
    if (stage === 5) return [I.DEATH_RUNE];
    if (stage === 6) return caveKit;
    if (stage === 7) return [...(held(I.NIGHTSHADE) ? [] : caveKit), I.NIGHTSHADE];
    if (stage === 9 || (stage === 10 && (flagValue(snap.progress, 'shamans-left') ?? 6) > 0 && !held(I.MAGIC_OGRE_POTION))) {
        const potion = [I.MAGIC_OGRE_POTION, I.OGRE_POTION, I.GUAM_JANGER_VIAL, I.GUAM_VIAL].find(item => owned(item));
        if (potion === I.MAGIC_OGRE_POTION || potion === I.OGRE_POTION) return [potion];
        return [
            ...(potion ? [potion] : [I.GUAM_LEAF, I.VIAL_WATER]),
            ...(potion === I.GUAM_JANGER_VIAL ? [] : [I.JANGERBERRIES]),
            ...(owned(I.GROUND_BAT_BONES) ? [I.GROUND_BAT_BONES] : [I.BAT_BONES, I.PESTLE])
        ];
    }
    if (stage === 10) {
        const left = flagValue(snap.progress, 'shamans-left') ?? 6;
        if (left > 0 || !owned(I.CRYSTAL3) || !owned(I.CRYSTAL4)) return [
            ...(left > 0 ? [I.MAGIC_OGRE_POTION] : []),
            ...(!owned(I.CRYSTAL4) ? [I.PICKAXE] : []),
            ...(area === 'enclave' ? [] : [...(held(I.NIGHTSHADE) ? [] : caveKit), I.NIGHTSHADE])
        ];
        if (!owned(I.CRYSTAL1)) return [I.ROPE];
        if (!owned(I.CRYSTAL2)) return caveKit;
        return [...CRYSTALS];
    }
    return [];
}

export interface PackItem { id: number; name: string | null; count: number; noted?: boolean }
const db = new Map(ITEM_DB.map(item => [item.id, item]));
export function retainWatchtowerLoadout(snap: QuestSnapshot, inventory: PackItem[], configured = QuestFood.name, reserve = 2) {
    const ids = new Map<number, number>();
    for (const item of inventory) if (!item.noted) ids.set(item.id, (ids.get(item.id) ?? 0) + item.count);
    const state = { ...snap, invIds: ids };
    const stage = snap.stage ?? snap.progress?.stage ?? 0;
    const caps = new Map(phaseItems(state).map(item => [item.id, 1]));
    caps.set(I.COINS.id, Infinity);
    if (stage === 6) caps.set(I.GOLD_BAR.id, 1);
    for (const item of [...CRYSTALS, I.WATCHTOWER_SPELL]) caps.set(item.id, 1);
    if (stage <= 3) for (const item of [...RELIC_PARTS, I.OGRE_RELIC, I.OGRE_TOOTH, I.TOBAN_KEY, I.STOLEN_GOLD, I.FINGERNAILS]) caps.set(item.id, 1);
    if (stage <= 9 && !ids.has(I.OGRE_POTION.id) && !ids.has(I.MAGIC_OGRE_POTION.id)) caps.set(I.JANGERBERRIES.id, 2);
    if (stage === 9 || stage === 10) for (const item of [I.OGRE_POTION, I.MAGIC_OGRE_POTION, I.SHAMAN_ROBE]) caps.set(item.id, 1);
    const foods = new Set(edibleNames(configured));
    const names = new Map(inventory.map(item => [item.id, item.name?.toLowerCase()]));
    const occupied = new Set(ITEM_DB.filter(item => item.slot && (snap.wornIds?.has(item.id) || snap.worn.has(item.name.toLowerCase()))).map(item => item.slot));
    const retained = new Map<number, number>();
    let slots = 0;
    for (const [id, count] of ids) {
        if (foods.has(names.get(id) ?? '')) continue;
        const gear = db.get(id);
        const limit = caps.get(id) ?? (gear?.slot && !occupied.has(gear.slot) ? gear.slot === 'quiver' ? Infinity : 1 : 0);
        const qty = Math.min(count, limit);
        if (qty <= 0) continue;
        retained.set(id, qty);
        slots += id === I.COINS.id || gear?.slot === 'quiver' ? 1 : qty;
        if (gear?.slot) occupied.add(gear.slot);
    }
    let food = Math.min(8, Math.max(0, 28 - slots - reserve));
    const keepIds: number[] = [];
    const limits: { id: number; qty: number }[] = [];
    for (const [id, count] of ids) {
        const edible = foods.has(names.get(id) ?? '');
        const qty = edible ? Math.min(count, food) : retained.get(id) ?? 0;
        if (edible) food -= qty;
        if (qty > 0) keepIds.push(id);
        if (qty > 0 && qty < count) limits.push({ id, qty });
    }
    return { keepIds, caps: limits };
}

export function clearSpace(snap: QuestSnapshot, reserve = 2): QuestStep {
    const inventory = [...snap.invIds ?? []].map(([id, count]) => ({ id, count, name: db.get(id)?.name ?? Object.values(I).find(item => item.id === id)?.name ?? null }));
    const plan = retainWatchtowerLoadout(snap, inventory, QuestFood.name, reserve);
    if (plan.keepIds.length < inventory.length || plan.caps.length > 0) return { kind: 'deposit', keep: [], exactKeep: true, ...plan, bank: WT_TILE.YANILLE_BANK };
    return { kind: 'wait', reason: `Watch Tower needs ${reserve} free inventory slots; no surplus supplies to bank` };
}

export function fitSupplies(snap: QuestSnapshot, step: QuestStep): QuestStep {
    const slots = step.kind === 'withdraw' ? step.items.reduce((n, item) => n + (item.id === I.COINS.id ? (snap.invIds?.has(I.COINS.id) ? 0 : 1) : item.qty), 0)
        : step.kind === 'buy' ? step.qty : step.kind === 'grabGround' ? 1 : 0;
    return slots > 0 && slots + 2 > (snap.freeSlots ?? 28) ? clearSpace(snap, slots + 2) : step;
}
