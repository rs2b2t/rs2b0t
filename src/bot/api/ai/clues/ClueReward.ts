import { Inventory, type InvItem } from '#/bot/api/inventory/Inventory.js';
import { actions, reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { GroundItem } from '#/bot/api/model/GroundItem.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { CASKET_IDS } from './data/cluedb.js';
import { distance, groundCounts, groundKey, quantities } from './rewardAccounting.js';

export type RewardQuantity = { readonly id: number; readonly count: number };
type RewardProgress = { readonly remaining: readonly RewardQuantity[] | null; readonly tile: WorldTile | null };
export type RewardBlockReason = 'delivery-deadline' | 'missing-casket-or-tile' | 'open-refused' | 'missing-or-stale-manifest'
    | 'food-not-consumed' | 'pickup-not-delivered' | 'food-refused' | 'pickup-refused';
export type ClueRewardOutcome = RewardProgress & (
    | { readonly kind: 'complete' }
    | { readonly kind: 'yield'; readonly reason: 'event' | 'waiting' | 'return-to-tile' }
    | { readonly kind: 'needs-space' }
    | { readonly kind: 'blocked'; readonly reason: RewardBlockReason }
);
export type ClueRewardOptions = {
    readonly casketId: number;
    readonly food?: (item: InvItem) => boolean;
};

export class ClueReward {
    private opening: WorldTile | null = null;
    private delivery: WorldTile | null = null;
    private openedAt: number | null = null;
    private readonly startedAt = Game.tick();
    private baseline = new Map<string, number>();
    private lastInventory = new Map<number, number>();
    private manifest: Map<number, number> | null = null;
    private readonly collected = new Map<number, number>();
    private terminal: ClueRewardOutcome | null = null;
    private banking = false;
    private automaticDelivery = true;
    private nextEatAt = 0;
    private pending: { readonly id: number; readonly before: number; readonly tick: number; readonly eating: boolean } | null = null;

    constructor(readonly options: ClueRewardOptions) {}

    get active(): boolean { return this.terminal?.kind !== 'complete'; }

    resumeAfterBank(): void {
        if (!this.banking) return;
        this.lastInventory = quantities(Inventory.items());
        this.automaticDelivery = false;
        this.banking = false;
    }

    private progress(): RewardProgress {
        const remaining = this.manifest === null ? null : [...this.manifest].flatMap(([id, count]) => {
            const left = count - (this.collected.get(id) ?? 0);
            return left > 0 ? [{ id, count: left }] : [];
        });
        return { remaining, tile: this.delivery ?? this.opening };
    }

    private block(reason: RewardBlockReason): ClueRewardOutcome {
        this.terminal = { kind: 'blocked', reason, ...this.progress() };
        return this.terminal;
    }

    private async wait(): Promise<ClueRewardOutcome> {
        await Execution.delayTicks(1);
        return { kind: 'yield', reason: 'waiting', ...this.progress() };
    }

    private observe(): void {
        if (this.openedAt === null || this.banking) return;
        if (!this.manifest && reader.modals().main === 6960 && !Inventory.items().some(i => i.id === this.options.casketId)) {
            const fresh = reader.shopInv(6963);
            if (fresh.length > 0 && fresh.every(i => Number.isSafeInteger(i.id) && i.id > 0 && Number.isSafeInteger(i.count) && i.count > 0)) {
                this.manifest = quantities(fresh);
            }
        }
        if (!this.delivery && !Inventory.items().some(i => i.id === this.options.casketId)) {
            const here = reader.worldTile();
            if (here && this.opening && distance(here, this.opening) <= 1) this.delivery = { ...here };
        }
        if (!this.manifest) return;
        const now = quantities(Inventory.items());
        if (this.pending?.eating && (now.get(this.pending.id) ?? 0) < this.pending.before) {
            this.nextEatAt = Game.tick() + 2;
            this.pending = null;
        }
        for (const [id, total] of this.manifest) {
            if (!this.automaticDelivery && (this.pending?.eating !== false || this.pending.id !== id)) continue;
            const gain = Math.max(0, (now.get(id) ?? 0) - (this.lastInventory.get(id) ?? 0));
            this.collected.set(id, Math.min(total, (this.collected.get(id) ?? 0) + gain));
        }
        this.lastInventory = now;
    }

    async advance(): Promise<ClueRewardOutcome> {
        if (this.terminal) return this.terminal;
        this.observe();
        if (EventSignal.pending()) return { kind: 'yield', reason: 'event', ...this.progress() };
        const progress = this.progress();
        if (progress.remaining?.length === 0) {
            this.terminal = { kind: 'complete', ...progress };
            return this.terminal;
        }
        if (Game.tick() - this.startedAt >= 100) return this.block('delivery-deadline');
        if (this.banking) return { kind: 'needs-space', ...this.progress() };
        if (this.openedAt === null) {
            if (reader.modals().main !== -1) { actions.closeModal(); return this.wait(); }
            const casket = Inventory.items().find(i => i.id === this.options.casketId);
            const here = reader.worldTile();
            if (!casket || !here) return this.block('missing-casket-or-tile');
            this.opening = { ...here };
            this.lastInventory = quantities(Inventory.items());
            this.baseline = groundCounts(reader.groundItems().filter(g => distance(g.tile, here) <= 1));
            this.openedAt = Game.tick();
            if (!(await casket.interact('Open'))) return this.block('open-refused');
            this.observe();
            return this.wait();
        }
        if (!this.manifest) {
            if (Game.tick() - this.openedAt >= 8) return this.block('missing-or-stale-manifest');
            return this.wait();
        }
        if (this.pending) {
            const p = this.pending;
            const count = quantities(Inventory.items()).get(p.id) ?? 0;
            const confirmed = p.eating ? count < p.before : count > p.before;
            if (!confirmed) {
                if (Game.tick() - p.tick >= 5) return this.block(p.eating ? 'food-not-consumed' : 'pickup-not-delivered');
                return this.wait();
            }
            this.pending = null;
        }
        if (reader.modals().main === 6960) { actions.closeModal(); return this.wait(); }
        const here = reader.worldTile();
        if (progress.tile && (!here || distance(here, progress.tile) > 1)) return { kind: 'yield', reason: 'return-to-tile', ...progress };
        const ground = reader.groundItems();
        const totals = groundCounts(ground);
        const spill = ground.find(g => {
            if (!this.opening || (distance(g.tile, this.opening) !== 0 && (!this.delivery || distance(g.tile, this.delivery) !== 0))) return false;
            const left = progress.remaining?.find(i => i.id === g.id)?.count ?? 0;
            const excess = (totals.get(groundKey(g)) ?? 0) - (this.baseline.get(groundKey(g)) ?? 0);
            return g.count > 0 && ground.filter(other => groundKey(other) === groundKey(g))
                .every(other => other.count <= left && other.count <= excess && other.count === g.count);
        });
        if (!spill) return this.wait();
        if (!here || distance(here, spill.tile) > 1) return { kind: 'yield', reason: 'return-to-tile', ...progress, tile: spill.tile };
        const held = Inventory.items();
        const stackable = reader.objCatalog().find(i => i.id === spill.id)?.stackable === true;
        const fits = Inventory.free() >= (stackable ? 1 : spill.count) || (stackable && held.some(i => i.id === spill.id));
        if (!fits) {
            const hard = CASKET_IDS[this.options.casketId]?.includes('_hard_') === true;
            const food = held.find(i => !this.manifest?.has(i.id) && i.actions().includes('Eat') && (hard ? i.id === 385 : this.options.food?.(i) === true));
            if (!food) { this.banking = true; return { kind: 'needs-space', ...progress }; }
            if (Game.tick() < this.nextEatAt) return this.wait();
            this.pending = { id: food.id, before: quantities(held).get(food.id) ?? 0, tick: Game.tick(), eating: true };
            if (!(await food.interact('Eat'))) return this.block('food-refused');
            return this.wait();
        }
        this.pending = { id: spill.id, before: quantities(held).get(spill.id) ?? 0, tick: Game.tick(), eating: false };
        if (!(await new GroundItem(spill).interact('Take'))) return this.block('pickup-refused');
        return this.wait();
    }
}
