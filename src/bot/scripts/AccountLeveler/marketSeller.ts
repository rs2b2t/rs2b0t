import { actions } from '../../adapter/ClientAdapter.js';
import { Trade } from '../../api/trade/Trade.js';
import { SettingsBag } from '../../runtime/Settings.js';
import JiveMarketDumper from '../JiveMarketDumper/JiveMarketDumper.js';
import type { Dumpable } from '../JiveMarketDumper/logic.js';
import { economyReserve, ECONOMY_SALE_LOT, isSupplierLot, saleQuantity } from './economySupplies.js';
import { atMarket, MAKER, marketWorld } from './market.js';

export const SUPPLIER_LOT_SOLD = 'Sold a Seers supply lot';

export class MarketSeller extends JiveMarketDumper {
    private lot?: Dumpable;
    private readonly item?: string;

    constructor(private readonly supplierOnly = false, item?: string) {
        super();
        this.item = item?.trim().toLowerCase();
    }

    override async onStart(): Promise<void> {
        if (marketWorld() !== 1) {
            this.requestFinish('Seers Market sales require World 1');
            return;
        }
        this.settings = new SettingsBag({ maker: MAKER, bank: 'Seers' });
        await super.onStart();
    }

    override onStop(): void {
        if (Trade.active()) actions.closeModal();
    }

    override dumpable(items: readonly { id: number; count: number }[], banked = false): Dumpable[] {
        const rows = super.dumpable(items);
        if (this.supplierOnly) {
            if (!banked) return rows.filter(line => line.id === this.lot?.id && line.count === this.lot.count);
            const lot = rows.find(line => isSupplierLot(line)
                && (!this.item || [line.name.toLowerCase(), line.displayName.toLowerCase(), '#' + line.id].includes(this.item)));
            this.lot = lot && { ...lot, count: saleQuantity(lot.name, lot.count, true) };
            return this.lot ? [this.lot] : [];
        }
        return rows.flatMap(line => {
            const reserve = economyReserve(line.name);
            if (reserve === undefined || (!line.stackable && line.notedId === null)) return [];
            const count = banked ? saleQuantity(line.name, line.count) : line.count;
            return count > 0 && count % ECONOMY_SALE_LOT === 0 ? [{ ...line, count }] : [];
        });
    }

    override saleGoods(pile: readonly Dumpable[]): ReadonlyMap<number, number> {
        if (!this.supplierOnly) return super.saleGoods(pile);
        return new Map(pile.map(line => [line.notedId ?? line.id, line.count]));
    }

    override noteSale(lines: readonly Dumpable[], gp: number): void {
        super.noteSale(lines, gp);
        if (this.supplierOnly) this.requestFinish(SUPPLIER_LOT_SOLD);
    }

    override makerNear() {
        const maker = super.makerNear();
        return maker && atMarket(maker.tile) ? maker : null;
    }

    override tradingWithMaker(): boolean {
        return marketWorld() === 1 && atMarket() && super.tradingWithMaker();
    }
}
