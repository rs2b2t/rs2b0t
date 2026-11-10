import { ITEM_DB } from '../../../../../data/itemdb.js';
import { foodForms } from '../../../../combat/food.js';
import { QuestFood } from '../../food.js';
import { flagValue, hasFlag, type QuestSnapshot } from '../../engine/types.js';
import { FOOD_TARGET, KARAMBWAN_BAIT, TB_ID, TB_LUBUFU, TB_MAIN, TB_POTIONS, TB_SPEARS, TB_TAMAYU, TB_TIADECHE, TB_TINSAY } from './areas.js';
import { TB_FLAG } from './journal.js';

export const TB_FOODS = ['Lobster', 'Swordfish', 'Tuna', 'Trout', 'Salmon', 'Cake'];
export function foodNames(configured = QuestFood.name): string[] {
    const forbidden = new Set(['banana', 'sliced banana', 'raw karambwan', 'karambwan', 'poorly cooked karambwan']);
    return [...new Map([configured, ...TB_FOODS].filter((name): name is string => Boolean(name?.trim()) && !forbidden.has(name!.trim().toLowerCase()))
        .map(name => [name.trim().toLowerCase(), name.trim()])).values()];
}
export const foodFormsForQuest = (configured = QuestFood.name): string[] => [...new Set(foodNames(configured).flatMap(foodForms))];

export function loadout(snap: QuestSnapshot) {
    const stage = (flag: string): number => flagValue(snap.progress, flag) ?? 0;
    const held = (id: number): number => snap.invIds?.get(id) ?? 0;
    const lubufu = stage(TB_FLAG.LUBUFU);
    const tiadeche = stage(TB_FLAG.TIADECHE);
    const tamayu = stage(TB_FLAG.TAMAYU);
    const tinsay = stage(TB_FLAG.TINSAY);
    const phase = (snap.progress?.stage ?? snap.stage ?? 0) >= TB_MAIN.ALL_BROTHERS ? 'reward'
        : lubufu < TB_LUBUFU.COMPLETE ? 'lubufu'
            : tiadeche < TB_TIADECHE.REQUEST_MANUAL ? 'tiadeche'
                : tamayu < TB_TAMAYU.COMPLETE ? 'tamayu'
                    : tinsay < TB_TINSAY.GIVEN_RUM ? 'rum'
                        : tinsay < TB_TINSAY.GIVEN_SANDWICH ? 'sandwich'
                            : tinsay < TB_TINSAY.COMPLETE ? 'bones' : 'manual';
    const spear = phase === 'tamayu' && !hasFlag(snap.progress, TB_FLAG.SPEAR);
    const potions = phase === 'tamayu' && !hasFlag(snap.progress, TB_FLAG.AGILITY);
    const poisoned = TB_SPEARS.some(s => held(s.kpId) > 0);
    const poison = held(TB_ID.KARAMBWAN_POISON_PASTE) > 0;
    const fish = held(TB_ID.RAW_KARAMBWAN) + held(TB_ID.POORLY_COOKED_KARAMBWAN) > 0;
    const fishing = spear && !poisoned && !poison && !fish;
    const bankedFish = [TB_ID.RAW_KARAMBWAN, TB_ID.POORLY_COOKED_KARAMBWAN, TB_ID.KARAMBWAN_POISON_PASTE].some(id => (snap.bankIds?.get(id) ?? 0) > 0);
    const tools: number[] = [];
    if ((phase === 'lubufu' && lubufu < TB_LUBUFU.GIVEN_KARAMBWANJI) || (phase === 'tiadeche' && tiadeche < TB_TIADECHE.CAUGHT && !held(TB_ID.VESSEL_LOADED) && !held(TB_ID.RAW_KARAMBWANJI)) || (fishing && !bankedFish && held(TB_ID.RAW_KARAMBWANJI) < KARAMBWAN_BAIT)
        || (phase === 'bones' && ![TB_ID.RAW_KARAMBWANJI, TB_ID.KARAMBWANJI_PASTE, TB_ID.PASTY_JOGRE_BONES, TB_ID.MARINATED_JOGRE_BONES].some(id => held(id)))) tools.push(TB_ID.NET);
    if (phase === 'rum' && !held(TB_ID.SLICED_BANANA) && !held(TB_ID.RUM_SLICED)) tools.push(TB_ID.KNIFE);
    if ((spear && !poisoned && !poison) || (phase === 'bones' && ![TB_ID.KARAMBWANJI_PASTE, TB_ID.PASTY_JOGRE_BONES, TB_ID.MARINATED_JOGRE_BONES].some(id => held(id)))) tools.push(TB_ID.PESTLE);
    if (phase === 'bones' && ![TB_ID.BURNT_JOGRE_BONES, TB_ID.PASTY_JOGRE_BONES, TB_ID.MARINATED_JOGRE_BONES].some(id => held(id))) tools.push(TB_ID.TINDERBOX);
    if (phase === 'sandwich' && !held(TB_ID.SANDWICH)) tools.push(TB_ID.SEAWEED);
    const caps = new Map<number, number>([[TB_ID.COINS, Infinity], ...tools.map(id => [id, 1] as [number, number])]);
    const keep = (ids: number[], qty = 1): void => { for (const id of ids) caps.set(id, qty); };
    if (tiadeche < TB_TIADECHE.COMPLETE) keep([TB_ID.VESSEL, TB_ID.VESSEL_LOADED, TB_ID.CRAFTING_MANUAL]);
    if (phase === 'lubufu') caps.set(TB_ID.RAW_KARAMBWANJI, Math.max(0, TB_LUBUFU.GIVEN_KARAMBWANJI - Math.max(lubufu, TB_LUBUFU.FETCH_KARAMBWANJI)));
    else if (phase === 'tiadeche' || phase === 'bones') caps.set(TB_ID.RAW_KARAMBWANJI, 1);
    else if (fishing) caps.set(TB_ID.RAW_KARAMBWANJI, KARAMBWAN_BAIT);
    if (tamayu < TB_TAMAYU.COMPLETE && !hasFlag(snap.progress, TB_FLAG.SPEAR)) {
        keep([TB_ID.RAW_KARAMBWAN], 2);
        keep([TB_ID.POORLY_COOKED_KARAMBWAN, TB_ID.KARAMBWAN_POISON_PASTE]);
        if (spear) {
            const selected = TB_SPEARS.find(s => held(s.kpId))?.kpId ?? TB_SPEARS.find(s => held(s.id))?.id;
            if (selected) keep([selected]);
        }
    }
    if (potions) {
        let remaining = 4;
        for (const potion of TB_POTIONS) {
            const qty = Math.min(held(potion.id), Math.ceil(remaining / potion.doses));
            if (qty > 0) caps.set(potion.id, qty);
            remaining = Math.max(0, remaining - qty * potion.doses);
        }
    }
    if (tinsay < TB_TINSAY.GIVEN_RUM) keep([TB_ID.BANANA, TB_ID.SLICED_BANANA, TB_ID.RUM, TB_ID.RUM_SLICED]);
    if (tinsay < TB_TINSAY.GIVEN_SANDWICH) keep([TB_ID.MONKEY_CORPSE, TB_ID.MONKEY_SKIN, TB_ID.SANDWICH]);
    if (tinsay < TB_TINSAY.COMPLETE) keep([TB_ID.JOGRE_BONES, TB_ID.BURNT_JOGRE_BONES, TB_ID.PASTY_JOGRE_BONES, TB_ID.MARINATED_JOGRE_BONES, TB_ID.KARAMBWANJI_PASTE]);
    const catchHeld = held(TB_ID.RAW_KARAMBWANJI);
    const deliverCatch = phase === 'lubufu' && lubufu >= TB_LUBUFU.FETCH_KARAMBWANJI && lubufu < TB_LUBUFU.GIVEN_KARAMBWANJI
        && catchHeld > 0 && (catchHeld >= TB_LUBUFU.GIVEN_KARAMBWANJI - lubufu || (snap.freeSlots ?? 28) <= 1);
    const compact = (phase === 'rum' && (held(TB_ID.RUM_SLICED) > 0 || (held(TB_ID.SLICED_BANANA) > 0 && held(TB_ID.RUM) > 0) || (held(TB_ID.BANANA) > 0 && held(TB_ID.KNIFE) > 0)))
        || (phase === 'sandwich' && (held(TB_ID.SANDWICH) > 0 || (held(TB_ID.MONKEY_SKIN) > 0 && held(TB_ID.SEAWEED) > 0)))
        || (phase === 'bones' && held(TB_ID.MARINATED_JOGRE_BONES) > 0)
        || (phase === 'tamayu' && tamayu >= TB_TAMAYU.WATCHED_CUTSCENE && (potions ? TB_POTIONS.some(p => held(p.id)) : poisoned));
    const minFree = deliverCatch || compact ? 0 : fishing && !bankedFish
        ? Math.max(1, KARAMBWAN_BAIT - catchHeld) + (held(TB_ID.VESSEL) || held(TB_ID.VESSEL_LOADED) ? 0 : 1) + 2
        : phase === 'rum' || phase === 'sandwich' || phase === 'bones' ? 2 : 1;
    return { phase, tools, caps, food: FOOD_TARGET, minFree, spear, potions, deliverCatch, compact };
}

export interface PackItem { id: number; name: string | null; count: number; noted?: boolean }
const equipment = new Map(ITEM_DB.filter(item => item.slot).map(item => [item.id, item]));
export function retainLoadout(snap: QuestSnapshot, inventory: PackItem[], configured: string | null) {
    const ids = new Map<number, number>();
    for (const item of inventory) if (!item.noted) ids.set(item.id, (ids.get(item.id) ?? 0) + item.count);
    const plan = loadout({ ...snap, invIds: ids });
    const foods = new Set(foodFormsForQuest(configured));
    const keepIds: number[] = [];
    const caps: { id: number; qty: number }[] = [];
    const names = new Map(inventory.map(item => [item.id, item.name?.toLowerCase()]));
    const occupied = new Set(ITEM_DB.filter(item => item.slot && (snap.wornIds?.has(item.id) || snap.worn.has(item.name.toLowerCase()))).map(item => item.slot));
    const retained = new Map<number, number>();
    let slots = 0;
    for (const [id, count] of ids) {
        if (foods.has(names.get(id) ?? '')) continue;
        const gear = equipment.get(id);
        const spareSpear = TB_SPEARS.some(s => s.id === id || s.kpId === id);
        const limit = plan.caps.get(id) ?? (gear?.slot && !occupied.has(gear.slot) && !spareSpear ? gear.slot === 'quiver' ? Infinity : 1 : 0);
        const qty = Math.min(count, limit);
        if (qty <= 0) continue;
        retained.set(id, qty);
        slots += id === TB_ID.COINS || gear?.slot === 'quiver' ? 1 : qty;
        if (gear?.slot) occupied.add(gear.slot);
    }
    let food = Math.min(plan.food, Math.max(0, 28 - slots - plan.minFree));
    for (const [id, count] of ids) {
        const edible = foods.has(names.get(id) ?? '');
        const qty = edible ? Math.min(count, food) : retained.get(id) ?? 0;
        if (edible) food -= qty;
        if (qty > 0) keepIds.push(id);
        if (qty < count && qty > 0) caps.push({ id, qty });
    }
    return { keepIds, caps };
}
