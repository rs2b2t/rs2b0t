import { Bank } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Shop } from '../../api/shop/Shop.js';
import { unitPrice } from '../../api/shop/StockModel.js';
import type { ShopRecord } from '../../api/shop/types.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { SHILO_WATER_VENDOR } from '../../data/fishingLocations.js';
import { SHOP_DB } from '../../data/shopdb.js';
import type Tile from '../../geometry/Tile.js';
import type GatheringBot from './GatheringBot.js';

type Phase = 'idle' | 'bank-outbound' | 'feathers' | 'water-vials' | 'bank-return' | 'home';
type Shelf = { readonly shop: ShopRecord; readonly name: string; readonly keeper: string; readonly stand: Tile };

function cart(shelf: Shelf, stock: number, limits: { readonly coins: number; readonly slots: number }) {
    const item = shelf.shop.items.find(line => line.name === shelf.name);
    let quantity = 0;
    let cost = 0;
    if (item) {
        const cap = Math.min(stock, item.baseline, item.stackable ? limits.slots > 0 ? item.baseline : 0 : limits.slots);
        while (quantity < cap) {
            const price = unitPrice(item, shelf.shop, stock - quantity);
            if (cost + price > limits.coins) break;
            cost += price;
            quantity++;
        }
    }
    return { quantity, cost };
}

export class ShiloSupplyTrip {
    private current: Phase = 'idle';

    get phase(): Phase { return this.current; }
    get active(): boolean { return this.current !== 'idle'; }

    async step(bot: GatheringBot): Promise<void> {
        const vendor = bot.baitVendor();
        const featherShop = SHOP_DB.shilofishingshop;
        const vialShop = SHOP_DB.shilojunglestore;
        if (!vendor || !featherShop || !vialShop) return;
        const feathers: Shelf = { shop: featherShop, name: vendor.item, keeper: vendor.keeper, stand: vendor.stand };
        const vials: Shelf = { shop: vialShop, name: SHILO_WATER_VENDOR.item, ...SHILO_WATER_VENDOR };
        switch (this.current) {
            case 'idle':
            case 'bank-outbound': {
                if (!this.active) bot.noteGuildFeatherTrip();
                this.current = 'bank-outbound';
                if (await this.bank(bot, { feathers, vials })) this.current = 'feathers';
                return;
            }
            case 'feathers':
                await this.buy(bot, feathers);
                this.current = 'water-vials';
                return;
            case 'water-vials':
                await this.buy(bot, vials);
                this.current = Inventory.contains(vials.name) ? 'bank-return' : 'home';
                return;
            case 'bank-return':
                if (await this.bank(bot)) this.current = 'home';
                return;
            case 'home':
                if (await bot.walkHomeIfNeeded()) {
                    bot.noteGuildFeatherTrip();
                    this.current = 'idle';
                }
                return;
            default: {
                const unreachable: never = this.current;
                return unreachable;
            }
        }
    }

    private async bank(bot: GatheringBot, shelves?: { readonly feathers: Shelf; readonly vials: Shelf }): Promise<boolean> {
        const log = (message: string) => bot.log(`  ${message}`);
        bot.setStatus('supplies: banking');
        if (Bank.isOpen() && !(await bot.closeScriptBank(log, { allowForgetful: false }))) return false;
        const snapshot = Bank.normalBackpackSnapshot();
        if (!snapshot || !(await bot.openScriptBank(log))) return false;
        if (!(await Bank.waitReady(4000, log)) || !(await Bank.backpackReady(snapshot, log))) {
            await bot.closeScriptBank(log, { allowForgetful: false });
            return false;
        }
        const keep = new Set(['coins', ...(bot.fishMethodDef()?.gear.map(piece => piece.name.toLowerCase()) ?? [])]);
        const expected = snapshot.filter(item => keep.has((item.name ?? '').toLowerCase()));
        await Bank.depositAllMatching(name => !keep.has(name.toLowerCase()), log);
        const cleared = await Bank.backpackReady(expected, log);
        if (cleared && shelves) {
            const slots = Math.max(0, Inventory.free() - Number(!Inventory.contains('Coins')) - Number(!Inventory.contains('Feather')));
            const vialBaseline = shelves.vials.shop.items.find(item => item.name === shelves.vials.name)?.baseline ?? 0;
            let vialReserve = 0;
            for (let stock = 1; stock <= vialBaseline; stock++) {
                vialReserve = Math.max(vialReserve, cart(shelves.vials, stock, { coins: Infinity, slots }).cost);
            }
            const budget = cart(shelves.feathers, 800, { coins: Infinity, slots: 1 }).cost + vialReserve;
            const draw = Math.min(Bank.count('Coins'), Math.max(0, budget - Inventory.count('Coins')));
            if (draw > 0) await Bank.withdrawX('Coins', draw);
        }
        const closed = await bot.closeScriptBank(log, { allowForgetful: false });
        return cleared && closed;
    }

    private async buy(bot: GatheringBot, shelf: Shelf): Promise<void> {
        bot.setStatus(`supplies: ${shelf.keeper}`);
        const log = (message: string) => bot.log(`  ${message}`);
        if (!(await Traversal.walkResilient(shelf.stand, { radius: 0, attempts: 3, timeoutMs: 60000, log }))) return;
        if (!(await Shop.open(shelf.keeper))) return;
        try {
            const stock = Shop.stock().find(line => line.name === shelf.name)?.count ?? 0;
            const slots = Inventory.free() + (shelf.name === 'Feather' && Inventory.contains(shelf.name) ? 1 : 0);
            const { quantity } = cart(shelf, stock, { coins: Inventory.count('Coins'), slots });
            if (quantity > 0) await Shop.buy(shelf.name, quantity);
        } finally {
            await Shop.close();
        }
    }
}
