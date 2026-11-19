import type { Temple } from './temple.js';
import { Bank } from '../../api/bank/Bank.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { burnBatch, expeditionTier, huntBatch } from './advanced-policy.js';
import { PRAYER_POTIONS, type CombatSupport } from './combat.js';
import { ID, reserveKey, SHADE_TIERS, spendableSilverKeys } from './data.js';
import type { LootProcessor } from './loot.js';
import type { Minigame } from './minigame.js';
import { FOOD, oilDoses, type Stock } from './policy.js';
import type { ExpeditionOptions } from './settings.js';
import { MorttonShop, noteId, withdrawNoted } from './shop.js';
import { counts, held, type Supplies } from './supply.js';

type Step = 'continue' | 'bank' | 'failure';
type Phase = 'oil' | 'prepare' | 'hunt' | 'burn' | 'chests' | 'dispose';

export class Expedition {
    phase: Phase = 'prepare';
    cycles = 0;
    reason = '';
    private failures = 0;
    private baseline: Stock | null = null;
    private tier = 0;
    private buybackFailed = false;

    constructor(
        private supply: Pick<Supplies, 'stock' | 'take' | 'douse' | 'clearWaste'>,
        private game: Pick<Minigame, 'pending' | 'resume' | 'hunt' | 'cremate' | 'openChests' | 'exit'>,
        private shop: Pick<MorttonShop, 'open' | 'pending' | 'resume' | 'refill' | 'budget'>,
        private combat: Pick<CombatSupport, 'maintain' | 'standDown' | 'protected'>,
        private loot: Pick<LootProcessor, 'process'>,
        private options: ExpeditionOptions,
        private temple: Pick<Temple, 'localOil'> & Partial<Pick<Temple, 'resupplyReason'>>
    ) {}

    get description(): string {
        switch (this.phase) {
            case 'prepare': return 'Preparing supplies in Mortton';
            case 'oil': return 'Making sacred oil';
            case 'hunt': return `Hunting ${SHADE_TIERS[this.tier].name} shades`;
            case 'burn': return 'Dousing logs and cremating remains';
            case 'chests': return 'Opening reward chests';
            case 'dispose': return 'Selling chest loot';
        }
    }

    async load(): Promise<boolean> {
        try {
            await Bank.setNoteMode(false);
            if (!(await this.supply.take(FOOD, 4)) || !(await this.supply.take(ID.TINDERBOX, 1))
                || !(await this.supply.take(Bank.countById(3678) ? 3678 : 2347, 1))) return false;
            const key = reserveKey(this.supply.stock);
            if (key !== null && !(await this.supply.take(key, 1))) return false;
            const spareKeys = spendableSilverKeys(this.supply.stock);
            let keys = 6;
            for (const spare of spareKeys) {
                const qty = Math.min(keys, spare.count);
                if (qty && !(await this.supply.take(spare.id, qty))) return false;
                keys -= qty;
            }
            const coins = Math.min(50000, Bank.countById(ID.COINS));
            if ((!spareKeys.length && coins < 3000) || (coins > 0 && !(await this.supply.take(ID.COINS, coins)))) return false;
            const serum = [3416, 3417, 3418, 3419, 3408, 3410, 3412, 3414].find(id => Bank.countById(id) > 0);
            if (serum !== undefined) {
                if (!(await this.supply.take(serum, 1))) return false;
            } else if (Bank.countById(592) > 0) {
                if (!(await this.supply.take(592, 1))) return false;
            } else {
                const log = [1511, 1521, 1519, 1517, 1515, 1513].find(id => Bank.countById(id) > 0);
                if (log !== undefined && !(await this.supply.take(log, 1))) return false;
            }
            const paste = Math.min(100, Bank.countById(ID.SWAMP_PASTE));
            if (paste && !(await this.supply.take(ID.SWAMP_PASTE, paste))) return false;
            const source = Bank.countById(ID.MAGIC_LOGS) ? ID.MAGIC_LOGS : ID.MAGIC_PYRE_LOGS;
            const logs = Math.min(100, Bank.countById(source));
            if ((!logs && !held(ID.MAGIC_LOGS) && !spareKeys.length) || (logs > 0 && !(await withdrawNoted(source, logs)))) return false;
            const food = Math.min(300, Bank.countById(FOOD));
            if (food > 0 && !(await withdrawNoted(FOOD, food))) return false;
            if (this.options.prayer && Skills.level('prayer') >= 43) {
                const potion = PRAYER_POTIONS.find(potion => Bank.countById(potion.id) > 0);
                if (potion) {
                    if (!(await this.supply.take(potion.id, 1))) return false;
                    const notes = Math.min(8, Bank.countById(potion.id));
                    if (notes && !(await withdrawNoted(potion.id, notes))) return false;
                }
            }
            if (this.options.alch && Skills.level('magic') >= 55) {
                for (const [id, cap] of [[561, 100], [554, 500]]) {
                    const qty = Math.min(cap, Bank.countById(id));
                    if (qty && !(await this.supply.take(id, qty))) return false;
                }
            }
            const bankedTier = SHADE_TIERS.findLastIndex(tier => Bank.countById(tier.remains) > 0);
            this.tier = bankedTier >= 0 ? bankedTier : expeditionTier(counts());
            const remains = SHADE_TIERS[this.tier].remains;
            const qty = Math.min(28, logs, Bank.countById(remains), Math.max(0, Inventory.free() - (source === ID.MAGIC_LOGS ? 10 : 5)));
            if (qty && !(await this.supply.take(remains, qty))) return false;
            return Bank.close();
        } finally {
            await Bank.setNoteMode(false);
        }
    }

    private notes(id: number): number {
        const note = noteId(id);
        return note === null ? 0 : held(note);
    }

    private bank(reason: string): Step {
        this.reason = reason;
        if (this.game.pending() || this.shop.pending()) return ++this.failures >= 8 ? 'failure' : 'continue';
        return 'bank';
    }

    private failed(): Step {
        if (EventSignal.pending()) return 'continue';
        if (++this.failures < 3) return 'continue';
        this.reason = `Could not complete: ${this.description}`;
        return 'failure';
    }

    private async food(): Promise<boolean> {
        if (held(FOOD) >= 4 || !this.notes(FOOD)) return held(FOOD) >= 2 || this.combat.protected();
        const target = Math.min(4, held(FOOD) + Math.max(0, Inventory.free() - 2), held(FOOD) + this.notes(FOOD));
        if (target < 2) return false;
        return this.shop.refill(FOOD, target);
    }

    async step(): Promise<Step> {
        if (EventSignal.pending()) return 'continue';
        if (this.game.pending() || this.shop.pending()) {
            const ok = this.game.pending() ? await this.game.resume() : await this.shop.resume();
            if (EventSignal.pending()) return 'continue';
            if (!ok) {
                if (this.game.pending() || this.shop.pending()) return ++this.failures >= 8 ? 'failure' : 'continue';
                return this.bank('unfinished transaction');
            }
            this.failures = 0;
            return 'continue';
        }
        if (!(await this.supply.clearWaste())) return this.failed();
        if (!(await this.combat.maintain())) {
            if (EventSignal.pending()) return 'continue';
            if (!this.notes(FOOD) || !(await this.game.exit()) || !(await this.food())) return EventSignal.pending() ? 'continue' : this.bank('food exhausted');
            await Shop.close();
            if (!(await this.combat.maintain())) return this.bank('food exhausted');
            this.failures = 0;
        }
        const inventory = counts();
        if (this.phase === 'prepare') {
            const carried = SHADE_TIERS.findLastIndex(tier => held(tier.remains) > 0);
            this.tier = carried >= 0 ? carried : expeditionTier(inventory);
        }
        const remains = SHADE_TIERS[this.tier].remains;
        switch (this.phase) {
            case 'prepare':
                if (Inventory.free() < 2) return this.bank('protected loot capacity');
                if (!(await this.shop.open())) return this.temple.resupplyReason ? this.bank(this.temple.resupplyReason) : this.failed();
                if (!(await this.food())) return EventSignal.pending() ? 'continue' : this.bank('food exhausted');
                if (this.options.prayer && !PRAYER_POTIONS.some(potion => held(potion.id) > 0)) {
                    const potion = PRAYER_POTIONS.find(potion => this.notes(potion.id) > 0);
                    if (potion && Inventory.free() > 2 && this.shop.budget(potion.id) > 0 && !(await this.shop.refill(potion.id, 1))) return this.failed();
                }
                await Shop.close();
                if (!held(remains) && spendableSilverKeys(counts()).length) { this.phase = 'chests'; break; }
                this.phase = held(ID.MAGIC_PYRE_LOGS) || this.notes(ID.MAGIC_PYRE_LOGS)
                    ? held(remains) ? 'burn' : 'hunt' : 'oil';
                break;
            case 'oil': {
                const logs = held(ID.MAGIC_LOGS) + this.notes(ID.MAGIC_LOGS);
                if (!logs) return this.bank('logs exhausted');
                if (!(await this.game.exit())) return this.failed();
                await this.combat.standDown();
                const qty = Math.min(this.tier < 4 ? 1 : 28, logs, held(remains) || Infinity,
                    Math.max(1, Math.floor((Inventory.free() - 5) / 2)));
                if (!(await this.temple.localOil(qty * 4))) return this.temple.resupplyReason ? this.bank(this.temple.resupplyReason) : this.failed();
                if (oilDoses(counts()) < 4) return this.failed();
                this.phase = held(remains) ? 'burn' : 'hunt';
                break;
            }
            case 'hunt': {
                const total = held(ID.MAGIC_PYRE_LOGS) + this.notes(ID.MAGIC_PYRE_LOGS)
                    + Math.min(held(ID.MAGIC_LOGS) + this.notes(ID.MAGIC_LOGS), Math.floor(oilDoses(inventory) / 4));
                const qty = huntBatch(28, held(remains), total, Inventory.free(), held(FOOD), this.combat.protected(), oilDoses(inventory) >= 4 ? 3 : 5);
                if (qty <= 0) {
                    if (held(remains)) this.phase = 'burn';
                    else if (spendableSilverKeys(inventory).length) this.phase = 'chests';
                    else return this.bank(total ? 'protected loot capacity' : 'logs or oil exhausted');
                    break;
                }
                const before = held(remains);
                const ok = await this.game.hunt(this.tier, qty);
                if (EventSignal.pending()) return 'continue';
                if (held(remains) <= before && !ok) return this.failed();
                this.phase = held(remains) >= before + qty ? 'burn' : 'hunt';
                break;
            }
            case 'burn': {
                if (!(await this.game.exit())) return this.failed();
                await this.combat.standDown();
                if (this.buybackFailed && !held(ID.MAGIC_PYRE_LOGS) && !held(ID.MAGIC_LOGS)) return this.bank('log buyback unavailable');
                if (!held(remains)) { this.phase = 'chests'; break; }
                if (!held(ID.MAGIC_PYRE_LOGS)) {
                    const source = this.notes(ID.MAGIC_PYRE_LOGS) ? ID.MAGIC_PYRE_LOGS : ID.MAGIC_LOGS;
                    const oils = Math.floor(oilDoses(counts()) / 4);
                    if (source === ID.MAGIC_LOGS && !oils) { this.phase = 'oil'; break; }
                    const qty = Math.min(burnBatch(held(remains), held(source), this.notes(source), Inventory.free()),
                        source === ID.MAGIC_LOGS ? oils : held(remains), held(source) + this.shop.budget(source));
                    if (!qty) return this.bank(this.shop.budget(source) <= 0 ? 'coins exhausted' : 'logs or capacity exhausted');
                    if (held(source) < qty) {
                        const restored = await this.shop.refill(source, qty);
                        if (EventSignal.pending() || this.shop.pending()) return 'continue';
                        if (!restored) {
                            this.buybackFailed = true;
                            if (!held(source)) return this.bank('log buyback unavailable');
                        }
                    }
                    await Shop.close();
                    if (source === ID.MAGIC_LOGS && !(await this.supply.douse(Math.min(qty, held(source))))) return this.failed();
                }
                if (!(await this.game.cremate(this.tier))) return this.failed();
                break;
            }
            case 'chests':
                if (!spendableSilverKeys(inventory).length) { this.phase = 'dispose'; break; }
                if (Inventory.free() < 5) return this.bank('chest loot capacity');
                this.baseline ??= inventory;
                if (!(await this.game.openChests(3))) return this.failed();
                if (EventSignal.pending()) return 'continue';
                this.phase = 'dispose';
                break;
            case 'dispose':
                if (!(await this.game.exit())) return this.failed();
                await this.combat.standDown();
                if (this.baseline && !(await this.loot.process(this.baseline, this.options.alch))) return this.failed();
                if (EventSignal.pending()) return 'continue';
                this.baseline = null;
                this.cycles++;
                this.phase = 'prepare';
                break;
        }
        this.failures = 0;
        return 'continue';
    }
}
