import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { AbstractBot, Task } from '../bot/Bot.js';
import { Execution } from '../execution/Execution.js';
import { findSceneTarget } from '../walking/Reach.js';
import { Traversal } from '../walking/Traversal.js';
import { Inventory } from '../inventory/Inventory.js';
import { buyWithRestockWait, Shop } from '../shop/Shop.js';
import { GroundItems } from '../grounditems/GroundItems.js';

type ItemSource = { kind: 'shop'; npc: string; near: WorldTile } | { kind: 'ground'; at: WorldTile } | { kind: 'gather' } | { kind: 'make' };

/**
 * A quantity of an item, and where to get it.
 * @see docs/reference/api-items.md#item-acquisition
 */
export type ItemNeed = { name: string; count: number; source: ItemSource };

export function held(name: string): number {
    return Inventory.count(name);
}

export function hasAll(needs: ItemNeed[]): boolean {
    return needs.every(n => held(n.name) >= n.count);
}

/**
 * Acquires the first unmet need, a shop trip or a ground pickup.
 * @see docs/reference/api-items.md#item-acquisition
 */
export class AcquireTask implements Task {
    constructor(
        private bot: AbstractBot,
        private needs: ItemNeed[]
    ) {}

    validate(): boolean {
        return !hasAll(this.needs);
    }

    async execute(): Promise<void> {
        const need = this.needs.find(n => held(n.name) < n.count);
        if (!need) {
            return;
        }

        const src = need.source;
        if (src.kind === 'shop') {
            this.bot.log(`acquiring ${need.name}: walking to ${src.npc}`);
            const arrived = await Traversal.walkResilient(src.near, { radius: 4, timeoutMs: 120000 });
            if (!arrived) {
                this.bot.log(`warning: could not reach ${src.npc} for ${need.name} at (${src.near.x},${src.near.z},${src.near.level}) — will retry`);
                return;
            }
            if (await Shop.open(src.npc)) {
                const bought = await buyWithRestockWait(need.name, need.count - held(need.name), 5);
                if (bought === 0) {
                    this.bot.log(`warning: bought 0 of ${need.name} — out of stock or coins`);
                }
                await Shop.close();
            }
            return;
        }

        if (src.kind === 'ground') {
            this.bot.log(`acquiring ${need.name}: walking to its ground spawn`);
            const arrived = await Traversal.walkResilient(src.at, { radius: 3, timeoutMs: 120000 });
            if (!arrived) {
                this.bot.log(`warning: could not reach the ground spawn for ${need.name} at (${src.at.x},${src.at.z},${src.at.level}) — will retry`);
                return;
            }
            const item = await findSceneTarget(() => GroundItems.query().name(need.name).within(6).nearest(), 5);
            if (!item) {
                return;
            }

            const before = held(need.name);
            await item.interact('Take');
            await Execution.delayUntil(() => held(need.name) > before, 5000);
            return;
        }

        throw new Error(`ItemSource.${src.kind}: not implemented yet`);
    }
}
