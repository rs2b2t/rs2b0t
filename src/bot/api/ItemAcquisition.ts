import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { AbstractBot, Task } from './Bot.js';
import { Execution } from './Execution.js';
import { Traversal } from './Traversal.js';
import { Inventory } from './hud/Inventory.js';
import { Shop } from './hud/Shop.js';
import { GroundItems } from './queries/GroundItems.js';

/**
 * Declarative item acquisition (Task 5): turns "I need 1x Hammer and 1x Egg"
 * into an executable Task. Quest modules (Plan B) declare an ItemNeed[] up
 * front; AcquireTask fulfils it one step at a time; Task 6's DeathRecovery
 * re-runs the same needs list to recover items lost on death. Every building
 * block already exists (Shop, GroundItems, Traversal, Inventory) — this is
 * pure composition, no adapter changes.
 *
 * 'gather' (skilling trainers) and 'make' (make-chains) are Plan B/C
 * territory — deliberately unimplemented; see AcquireTask.execute() below.
 */
export type ItemSource = { kind: 'shop'; npc: string; near: WorldTile } | { kind: 'ground'; at: WorldTile } | { kind: 'gather' } | { kind: 'make' };

export type ItemNeed = { name: string; count: number; source: ItemSource };

/** Held count of `name` across every matching backpack slot (case-insensitive, like Inventory.contains/Shop's countHeld). */
export function held(name: string): number {
    const wanted = name.toLowerCase();
    return Inventory.items()
        .filter(i => i.name?.toLowerCase() === wanted)
        .reduce((sum, i) => sum + i.count, 0);
}

/** True once every need's count is already met. */
export function hasAll(needs: ItemNeed[]): boolean {
    return needs.every(n => held(n.name) >= n.count);
}

/**
 * Fulfils a needs list one step at a time. validate() stays true while any
 * need is unmet; execute() advances exactly one (the first unmet, in list
 * order) — walking then acting within that single call is fine (e.g. a shop
 * trip fully completes in one execute() if nothing goes wrong). Reusable by
 * any TaskBot (quest modules) and by Task 6's DeathRecovery.
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
            return; // hasAll() flipped true between validate() and execute(); nothing left to do this tick.
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
                await Execution.delayTicks(5); // spawn cycle — nothing there right now, retry next loop
                return;
            }

            const before = held(need.name);
            await item.interact('Take');
            await Execution.delayUntil(() => held(need.name) > before, 5000);
            return;
        }

        throw new Error(`ItemSource.${src.kind}: implemented in Plan B`);
    }
}
