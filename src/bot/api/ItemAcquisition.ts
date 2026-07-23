import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { AbstractBot, Task } from './Bot.js';
import { Execution } from './Execution.js';
import { Traversal } from './Traversal.js';
import { Inventory } from './hud/Inventory.js';
import { Shop } from './hud/Shop.js';
import { GroundItems } from './queries/GroundItems.js';

type ItemSource = { kind: 'shop'; npc: string; near: WorldTile } | { kind: 'ground'; at: WorldTile } | { kind: 'gather' } | { kind: 'make' };

export type ItemNeed = { name: string; count: number; source: ItemSource };

export function held(name: string): number {
    return Inventory.count(name);
}

export function hasAll(needs: ItemNeed[]): boolean {
    return needs.every(n => held(n.name) >= n.count);
}

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
                const bought = await Shop.buy(need.name, need.count - held(need.name));
                if (bought === 0) {
                    this.bot.log(`warning: bought 0 of ${need.name} — out of stock or coins`);
                    await Execution.delayTicks(5);
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
            const item = GroundItems.query().name(need.name).within(6).nearest();
            if (!item) {
                await Execution.delayTicks(5);
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
