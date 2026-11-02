import { SHOP_DB } from '../../data/shopdb.js';
import type { ShopItemDef, ShopRecord } from '../../api/shop/types.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { unitPrice } from '../../api/shop/StockModel.js';

export interface SupplyOffer {
    fillVials?: boolean;
    keeper: string;
    tile: WorldTile;
    item: ShopItemDef;
    shop: Pick<ShopRecord, 'sell' | 'delta'>;
}

const vendors: [string, string, number, number][] = [
    ['dragonswordshop', 'Jakut', 3252, 9572],
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
    ['legsshop', 'Louie legs', 3316, 3175],
    ['helmetshop', 'Peksa', 3076, 3429],
    ['armourshop', 'Horvik', 3229, 3438],
    ['craftingshop2', 'Dommik', 3316, 3192]
];

const vialVendors: [string, string, number, number][] = [
    ['herbloreshop', 'Jatix', 2899, 3427],
    ['viking_general_store', 'Sigmund The Merchant', 2641, 3680],
    ['junglestore', 'Jiminua', 2767, 3122]
];

export function supplyOffers(name: string): SupplyOffer[] {
    if (/ (rune|arrow)$/i.test(name)) {
        const sources = vendors.filter(([key]) => ['runeshop', 'magicshop', 'archeryshop'].includes(key));
        return shopOffers(name, [...sources, ['archeryshop2', 'Hickton', 2821, 3442]]);
    }
    const water = name.toLowerCase() === 'vial of water';
    if (!water && name.toLowerCase() !== 'vial') {
        const offer = primaryOffer(name);
        return offer ? [offer] : [];
    }
    const offers: SupplyOffer[] = [];
    if (water) offers.push(primaryOffer('Vial of water')!);
    for (const [key, keeper, x, z] of vialVendors) {
        const shop = SHOP_DB[key];
        const fillVials = water && keeper === 'Jatix';
        const item = shop.items.find(item => item.name === (water && !fillVials ? 'Vial of water' : 'Vial'))!;
        offers.push({ keeper, tile: { x, z, level: 0 }, item, shop, fillVials });
    }
    return offers;
}

export function supplyOffer(name: string): SupplyOffer | null {
    return supplyOffers(name)[0] ?? null;
}

function primaryOffer(name: string): SupplyOffer | null {
    if (name === 'Staff of air') {
        return {
            keeper: 'Zaff', tile: { x: 3203, z: 3433, level: 0 }, shop: { sell: 1000, delta: 20 },
            item: { obj: 'staff_of_air', name, baseline: 2, restockTicks: 1000, cost: 1500, stackable: false, members: false }
        };
    }
    return shopOffers(name)[0] ?? null;
}

function shopOffers(name: string, sources = vendors): SupplyOffer[] {
    return sources.flatMap(([key, keeper, x, z]) => {
        const shop = SHOP_DB[key];
        const item = shop?.items.find(i => i.name.toLowerCase() === name.toLowerCase() && i.baseline > 0);
        return item ? [{ keeper, tile: { x, z, level: 0 }, item, shop }] : [];
    });
}

export function purchaseBudget(offer: SupplyOffer, count: number): number {
    if (offer.keeper === 'Jakut') return Math.ceil(Math.max(1, count) * unitPrice(offer.item, offer.shop, 1));
    return Math.ceil(Math.max(1, count) * offer.item.cost * (offer.shop.sell + 5000) / 1000);
}
