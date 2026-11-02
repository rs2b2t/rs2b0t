import { ITEM_DB } from '../../../../data/itemdb.js';
import { UNTRADEABLE_IDS } from '../../../../data/untradeable.js';
import { BIO_ITEM } from '../defs/biohazard/areas.js';
import { CB_ID } from '../defs/chompybird/areas.js';
import { DEATH_ITEM } from '../defs/deathplateau/areas.js';
import { DIG_ID } from '../defs/digsite/areas.js';
import { ER_ITEM } from '../defs/eadgar/areas.js';
import { EW_ITEM } from '../defs/elementalworkshop/areas.js';
import { FC_ID } from '../defs/familycrest/areas.js';
import { FT_ID } from '../defs/fremenniktrials/areas.js';
import { HERO_ID } from '../defs/heroquest/areas.js';
import { LQ_ID } from '../defs/legends/areas.js';
import { PC_ITEM } from '../defs/plaguecity/areas.js';
import { RG_ITEM } from '../defs/regicide/areas.js';
import { SV_ITEM } from '../defs/shilo/areas.js';
import { TB_ID, TB_POTION_IDS, TB_SPEAR_IDS } from '../defs/tbwt/areas.js';
import { UP_ITEM } from '../defs/upass/areas.js';
import { WT_ITEM } from '../defs/watchtower/areas.js';
import { FOOD_FLOAT } from '../food.js';
import type { QuestModule, QuestSnapshot } from './types.js';

const ids = (items: Record<string, { id: number }>): number[] => Object.values(items).map(item => item.id);
const QUEST_IDS: Record<string, readonly number[]> = {
    biohazard: ids(BIO_ITEM), chompybird: Object.values(CB_ID), death: ids(DEATH_ITEM),
    itexam: Object.values(DIG_ID), eadgar: ids(ER_ITEM), elemental_workshop: ids(EW_ITEM),
    crest: Object.values(FC_ID), viking: Object.values(FT_ID), hero: Object.values(HERO_ID),
    legends: Object.values(LQ_ID), elena: ids(PC_ITEM), regicide: ids(RG_ITEM),
    zombiequeen: ids(SV_ITEM), tbwt: [...Object.values(TB_ID), ...TB_POTION_IDS, ...TB_SPEAR_IDS],
    upass: ids(UP_ITEM), itwatchtower: ids(WT_ITEM)
};
const MATERIAL_FOOD: Record<string, Readonly<Record<string, number>>> = {
    death: { bread: 10, trout: 10 }, crest: { tuna: 1, bass: 1, salmon: 1, shrimps: 1, swordfish: 1 },
    viking: { cabbage: 1, onion: 1, potato: 1 }, regicide: { 'cooked rabbit': 1 },
    tbwt: { banana: Infinity, 'sliced banana': Infinity, 'raw karambwan': Infinity, karambwan: Infinity, 'poorly cooked karambwan': Infinity }
};
const EQUIPMENT_IDS = new Set(ITEM_DB.filter(item => item.slot).map(item => item.id));
const PROTECTED_IDS = new Set([...UNTRADEABLE_IDS, 995, ...EQUIPMENT_IDS]);
const FOODS = ['trout', 'salmon', 'tuna', 'lobster', 'swordfish', 'shark'];

export function resumePreparation(
    module: QuestModule,
    snap: QuestSnapshot,
    inventory: { id: number; name: string | null; count: number; noted?: boolean }[],
    food: string | null
): { keepIds: number[]; caps: { id: number; qty: number }[] } | null {
    if (snap.journal !== 'inProgress' || (snap.freeSlots ?? 28) > 4) return null;
    if (module.record.id === 'legends'
        && [LQ_ID.GOLD_BOWL_WATER, LQ_ID.GOLD_BOWL_PURE, LQ_ID.GOLD_BOWL_BLESSED_WATER, LQ_ID.GOLD_BOWL_BLESSED_PURE]
            .some(id => (snap.invIds?.get(id) ?? 0) > 0 || inventory.some(item => item.id === id && item.count > 0))) return null;

    const questIds = new Set(QUEST_IDS[module.record.id] ?? []);
    const materialFood = new Map(Object.entries(MATERIAL_FOOD[module.record.id] ?? {}));
    const materials = new Set([
        ...module.record.items.map(item => item.name.toLowerCase()),
        ...materialFood.keys()
    ]);
    const tools = (module.tools ?? []).map(name => name.toLowerCase());
    const foods = new Set([...FOODS, ...(module.sustain?.foods ?? []), ...(food ? [food] : [])].map(name => name.toLowerCase()));
    for (const item of module.record.items) {
        const name = item.name.toLowerCase();
        if (foods.has(name) || materialFood.has(name)) materialFood.set(name, Math.max(item.qty, materialFood.get(name) ?? 0));
    }
    const totals = new Map<number, { name: string | null; count: number; noted: boolean; slots: number }>();
    for (const item of inventory) {
        if (item.count <= 0) continue;
        const previous = totals.get(item.id);
        totals.set(item.id, {
            name: item.name?.toLowerCase() ?? previous?.name ?? null,
            count: item.count + (previous?.count ?? 0), noted: item.noted === true, slots: (previous?.slots ?? 0) + 1
        });
    }

    const keepIds: number[] = [];
    const caps: { id: number; qty: number }[] = [];
    let remainingFood = module.food ?? FOOD_FLOAT;
    for (const [id, item] of totals) {
        if (item.noted) continue;
        const name = item.name;
        const material = name !== null && (materials.has(name) || (questIds.has(id) && !FOODS.includes(name)));
        const edible = name !== null && foods.has(name);
        const tool = name !== null && tools.some(tool => name.includes(tool));
        const spareGear = EQUIPMENT_IDS.has(id) && item.slots > 1 && item.count === item.slots && !questIds.has(id) && !material && !tool;
        if (name === null || PROTECTED_IDS.has(id) || questIds.has(id) || material || edible
            || tool || / rune$|potion|antipoison|antifire/.test(name)) {
            keepIds.push(id);
        }
        const target = name !== null && materialFood.has(name) ? materialFood.get(name) : edible && !material ? remainingFood : spareGear ? 1 : undefined;
        if (target !== undefined && !UNTRADEABLE_IDS.includes(id)) {
            const qty = Math.min(item.count, target);
            if (edible && !material) remainingFood -= qty;
            if (qty < item.count) caps.push({ id, qty });
        }
    }
    return keepIds.length < totals.size || caps.length > 0 ? { keepIds, caps } : null;
}
