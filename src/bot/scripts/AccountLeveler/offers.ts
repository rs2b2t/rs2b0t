import { SHOP_DB } from '../../data/shopdb.js';
import type { ShopItemDef, ShopRecord } from '../../api/shop/types.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';

export interface SupplyOffer {
    keeper: string;
    tile: WorldTile;
    item: ShopItemDef;
    shop: Pick<ShopRecord, 'sell' | 'delta'>;
}

const vendors: [string, string, number, number][] = [
    ['scimitarshop', 'Zeke', 3288, 3190],
    ['axeshop', 'Bob', 3231, 3203],
    ['pickaxeshop', 'Nurmof', 2997, 9844],
    ['fishingshop', 'Gerrant', 3013, 3224],
    ['archeryshop', 'Lowe', 3231, 3421],
    ['runeshop', 'Aubury', 3253, 3401],
    ['generalshop1', 'Shop keeper', 3212, 3247],
    ['shantayshop', 'Shantay', 3304, 3123],
    ['magicshop', 'Betty', 3012, 3258],
    ['adventurershop', 'Aemad', 2613, 3294],
    ['armourshop', 'Horvik', 3229, 3438],
    ['craftingshop2', 'Dommik', 3316, 3192]
];

export function supplyOffer(name: string): SupplyOffer | null {
    if (name === 'Staff of air') {
        return {
            keeper: 'Zaff', tile: { x: 3203, z: 3433, level: 0 }, shop: { sell: 1000, delta: 20 },
            item: { obj: 'staff_of_air', name, baseline: 2, restockTicks: 1000, cost: 1500, stackable: false, members: false }
        };
    }
    for (const [key, keeper, x, z] of vendors) {
        const shop = SHOP_DB[key];
        const item = shop?.items.find(i => i.name.toLowerCase() === name.toLowerCase() && i.baseline > 0);
        if (item) return { keeper, tile: { x, z, level: 0 }, item, shop };
    }
    return null;
}

export function purchaseBudget(offer: SupplyOffer, count: number): number {
    return Math.ceil(Math.max(1, count) * offer.item.cost * (offer.shop.sell + 5000) / 1000);
}
