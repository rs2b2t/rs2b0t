import { Bank } from '../../api/bank/Bank.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { burnBatch, expeditionTier, huntBatch } from './advanced-policy.js';
import { PRAYER_POTIONS, type CombatSupport } from './combat.js';
import { ID, reserveKey, SHADE_TIERS, spendableKeys } from './data.js';
import type { LootProcessor } from './loot.js';
import type { Minigame } from './minigame.js';
import { FOOD, type Stock } from './policy.js';
import type { ExpeditionOptions } from './settings.js';
import { MorttonShop, noteId, withdrawNoted } from './shop.js';
import { counts, held, type Supplies } from './supply.js';

type Step = 'continue' | 'bank' | 'failure';
type Phase = 'prepare' | 'hunt' | 'burn' | 'chests' | 'dispose';

export class Expedition {
    phase: Phase = 'prepare';
    cycles = 0;
    reason = '';
    private failures = 0;
    private baseline: Stock | null = null;
    private tier = 0;
    private buybackFailed = false;

    constructor(
        private supply: Pick<Supplies, 'stock' | 'take'>,
        private game: Pick<Minigame, 'pending' | 'resume' | 'hunt' | 'cremate' | 'openChests' | 'exit'>,
        private shop: Pick<MorttonShop, 'open' | 'pending' | 'resume' | 'refill'>,
        private combat: Pick<CombatSupport, 'maintain' | 'standDown' | 'protected'>,
        private loot: Pick<LootProcessor, 'process'>,
        private options: ExpeditionOptions
    ) {}

    async load(): Promise<boolean> {
        try {
            await Bank.setNoteMode(false);
            if (!(await this.supply.take(FOOD, 4)) || !(await this.supply.take(ID.TINDERBOX, 1))
                || !(await this.supply.take(2347, 1))) return false;
            const key = reserveKey(this.supply.stock);
            if (key !== null && !(await this.supply.take(key, 1))) return false;
            const coins = Math.min(30000, Bank.countById(ID.COINS));
            if (coins < 3000 || !(await this.supply.take(ID.COINS, coins))) return false;
            const pyres = Math.min(this.options.pyres, Bank.countById(ID.MAGIC_PYRE_LOGS));
            if (!pyres || !(await withdrawNoted(ID.MAGIC_PYRE_LOGS, pyres))) return false;
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
            const qty = Math.min(this.options.targetRemains, pyres, Bank.countById(remains), Math.max(0, Inventory.free() - 5));
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
        return ++this.failures >= 3 ? this.bank('repeated failure') : 'continue';
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
        if (!(await this.combat.maintain())) {
            if (EventSignal.pending()) return 'continue';
            if (!this.notes(FOOD) || !(await this.game.exit()) || !(await this.food())) return EventSignal.pending() ? 'continue' : this.bank('food exhausted');
            await Shop.close();
            if (!(await this.combat.maintain())) return this.bank('food exhausted');
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
                if (!(await this.shop.open())) return EventSignal.pending() ? 'continue' : this.bank('access');
                if (!(await this.food())) return EventSignal.pending() ? 'continue' : this.bank('food exhausted');
                if (this.options.prayer && !PRAYER_POTIONS.some(potion => held(potion.id) > 0)) {
                    const potion = PRAYER_POTIONS.find(potion => this.notes(potion.id) > 0);
                    if (potion && Inventory.free() > 2 && !(await this.shop.refill(potion.id, 1))) return this.failed();
                }
                await Shop.close();
                this.phase = held(remains) ? 'burn' : 'hunt';
                break;
            case 'hunt': {
                const total = held(ID.MAGIC_PYRE_LOGS) + this.notes(ID.MAGIC_PYRE_LOGS);
                const qty = huntBatch(this.options.targetRemains, held(remains), total, Inventory.free(), held(FOOD), this.combat.protected());
                if (qty <= 0) {
                    if (held(remains)) this.phase = 'burn';
                    else if (spendableKeys(inventory).length) this.phase = 'chests';
                    else return this.bank(total ? 'protected loot capacity' : 'pyres exhausted');
                    break;
                }
                const before = held(remains);
                const ok = await this.game.hunt(this.tier, qty);
                if (EventSignal.pending()) return 'continue';
                if (held(remains) <= before && !ok) return this.failed();
                this.phase = 'burn';
                break;
            }
            case 'burn': {
                if (!(await this.game.exit())) return this.failed();
                await this.combat.standDown();
                if (this.buybackFailed && !held(ID.MAGIC_PYRE_LOGS)) return this.bank('pyre buyback unavailable');
                if (!held(remains)) { this.phase = 'chests'; break; }
                const qty = burnBatch(held(remains), held(ID.MAGIC_PYRE_LOGS), this.notes(ID.MAGIC_PYRE_LOGS), Inventory.free());
                if (!qty) return this.bank('pyres or capacity exhausted');
                if (!held(ID.MAGIC_PYRE_LOGS)) {
                    const restored = await this.shop.refill(ID.MAGIC_PYRE_LOGS, qty);
                    if (EventSignal.pending() || this.shop.pending()) return 'continue';
                    if (!restored) {
                        this.buybackFailed = true;
                        if (!held(ID.MAGIC_PYRE_LOGS)) return this.bank('pyre buyback unavailable');
                    }
                    await Shop.close();
                }
                if (!(await this.game.cremate(this.tier))) return this.failed();
                break;
            }
            case 'chests':
                if (!spendableKeys(inventory).length) { this.phase = 'dispose'; break; }
                if (Inventory.free() < 5) return this.bank('chest loot capacity');
                this.baseline ??= inventory;
                if (!(await this.game.openChests())) return this.failed();
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
