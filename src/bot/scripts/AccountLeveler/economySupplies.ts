import { liveCatalog, tradeable, worthStocking } from '../../api/market/catalog.js';
import { categoryOf } from '../../api/market/categories.js';
import { HERBS } from '../../data/herbs.js';
import { ITEM_DB } from '../../data/itemdb.js';
import { NAME_COLLISIONS } from '../../data/nameCollisions.js';
import { SECONDARY_SOURCES } from '../../data/herbloreSecondarySources.js';
import { dumpables, type Dumpable } from '../JiveMarketDumper/logic.js';
import { marketLotSize } from './marketLots.js';
import { RUNE_TARGETS } from './runes.js';

export const ECONOMY_SALE = 'sell-seers-surplus';
export const ECONOMY_SALE_LOT = 1000;
const reserves = new Map<string, number>();
for (const item of ['Coal', 'Copper ore', 'Tin ore', 'Iron ore', 'Silver ore', 'Gold ore', 'Mithril ore', 'Adamantite ore', 'Runite ore',
    'Limpwurt root', 'Unicorn horn', ...SECONDARY_SOURCES.map(secondary => secondary.name)]) reserves.set(item.toLowerCase(), 100);
for (const [item, count] of Object.entries(RUNE_TARGETS)) reserves.set(item.toLowerCase(), count);

const gear = new Set(ITEM_DB.filter(item => tradeable(item.id) && item.slot).map(item => item.name.toLowerCase()));
const questHerbs = new Set(HERBS.filter(herb => !tradeable(herb.id)).map(herb => herb.name.toLowerCase()));
const ambiguous = new Set(NAME_COLLISIONS.map(group => group.name.toLowerCase()));

const arrows = new Set(ITEM_DB.filter(item => item.slot === 'quiver' && item.name.toLowerCase().includes('arrow')).map(item => item.name.toLowerCase()));

function supplierReserve(item: string): number {
    const name = item.toLowerCase();
    return name.endsWith(' rune') || arrows.has(name) ? ECONOMY_SALE_LOT : 0;
}

export function supplierStockForSale(item: string, quantity: number): number {
    const reserve = supplierReserve(item);
    return reserve + quantity + (reserve > 0 && quantity === ECONOMY_SALE_LOT ? 1 : 0);
}

export function economyReserve(item: string, supplierOnly = false): number | undefined {
    const name = item.toLowerCase();
    if (!supplierOnly) return reserves.get(name);
    if (questHerbs.has(name) || !worthStocking(name)) return;
    if (reserves.has(name) || gear.has(name) || marketLotSize(name, ECONOMY_SALE_LOT) === ECONOMY_SALE_LOT
        || categoryOf({ name, equippable: false }) !== 'Other') return supplierReserve(name);
}

export function saleQuantity(item: string, banked: number, supplierOnly = false): number {
    if (banked < supplierStockForSale(item, ECONOMY_SALE_LOT)) return 0;
    const reserve = economyReserve(item, supplierOnly);
    if (reserve === undefined) return 0;
    return Math.floor(Math.max(0, banked - reserve) / ECONOMY_SALE_LOT) * ECONOMY_SALE_LOT;
}

export function isSupplierLot(line: Dumpable): boolean {
    return (line.stackable || line.notedId !== null) && saleQuantity(line.name, line.count, true) > 0;
}

export function supplierSaleItems(bank: Readonly<Record<string, number>>): string[] {
    const entries = Object.entries(bank);
    if (!entries.some(([key]) => key.startsWith('#'))) {
        return entries.filter(([name, count]) => saleQuantity(name, count, true) > 0)
            .map(([name]) => name.toLowerCase());
    }
    const rows = entries.filter(([key, count]) => key.startsWith('#') && count >= ECONOMY_SALE_LOT)
        .map(([key, count]) => ({ id: Number(key.slice(1)), count }));
    if (!rows.length) return [];
    return dumpables(rows, liveCatalog()).filter(isSupplierLot)
        .map(line => ambiguous.has(line.name.toLowerCase()) ? '#' + line.id : line.name.toLowerCase());
}
