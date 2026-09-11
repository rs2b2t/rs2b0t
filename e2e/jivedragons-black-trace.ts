import type { Page } from 'playwright-core';
import type { Game } from '../src/bot/api/game/Game.js';
import type { Npc } from '../src/bot/api/model/Npc.js';
import type { GroundItem } from '../src/bot/api/model/GroundItem.js';
import type { Npcs } from '../src/bot/api/npcs/Npcs.js';
import type { GroundItems } from '../src/bot/api/grounditems/GroundItems.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { Reachability } from '../src/bot/event/webwalk/geometry/Reachability.js';
import type { Inventory, InvItem } from '../src/bot/api/inventory/Inventory.js';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';

type TaskView = {
    execute(): void | Promise<void>;
    idle?(): Promise<void>;
    leash?(index: number): Promise<boolean>;
    readonly engaged?: number | null;
    readonly lootTarget?: number | null;
    readonly blindSince?: number;
    readonly seen?: Map<number, { since: number }>;
    readonly skip?: Map<number, number>;
};
export type BlackRuntime = {
    readonly __rs2b0t: { readonly Game: typeof Game; readonly Npc: typeof Npc; readonly Npcs: typeof Npcs;
        readonly GroundItem: typeof GroundItem; readonly GroundItems: typeof GroundItems; readonly Skills: typeof Skills;
        readonly Reachability: typeof Reachability; readonly Inventory: typeof Inventory; readonly InvItem: typeof InvItem; readonly Equipment: typeof Equipment };
    readonly rs2b0t: { readonly host: { readonly tickCount: number; addTickListener(fn: () => void): () => void };
        readonly client: { readonly mapBuildBaseX: number; readonly mapBuildBaseZ: number;
            readonly npc: readonly ({ readonly x: number; readonly z: number; readonly routeX: Int32Array; readonly routeZ: Int32Array; readonly routeLength: number } | null)[];
            readonly localPlayer: { readonly name: string | null; readonly routeX: Int32Array; readonly routeZ: Int32Array; readonly routeLength: number } | null;
            readonly minimapFlagX: number; readonly minimapFlagZ: number };
        readonly reader: { selfFaceEntity(): number };
        readonly runner: { readonly bot: { readonly tasks: TaskView[]; readonly status: string; readonly safespotIdx: number;
             readonly targetIdx: number | null; armSpecial?(): Promise<void>; setSafespotIndex(n: number): void;
             hpFraction(): number; panicHp(): number; retreatHp(): number;
             readonly settings: { num(key: string, fallback: number): number } }; readonly ctx: { readonly log: readonly unknown[] } } };
};
declare global { var __blackTrace: { events: unknown[]; restore(): void } | undefined; }

export async function installBlackTrace(page: Page, site: 'black' | 'blue' = 'black'): Promise<void> {
    await page.waitForFunction(() => {
        function ready(value: unknown): value is BlackRuntime {
            return typeof value === 'object' && value !== null && '__rs2b0t' in value && 'rs2b0t' in value;
        }
        const g = globalThis;
        return ready(g);
    }, undefined, { timeout: 30000 });
    await page.evaluate(site => {
        function ready(value: unknown): value is BlackRuntime {
            return typeof value === 'object' && value !== null && '__rs2b0t' in value && 'rs2b0t' in value;
        }
        const g = globalThis;
        if (!ready(g)) throw new Error('bot runtime absent');
        const api: BlackRuntime['__rs2b0t'] = g.__rs2b0t;
        const raw = g.rs2b0t.client;
        const events: unknown[] = [];
        let taskName = '';
        const capture = (kind: string, detail: object = {}) => {
            const bot = g.rs2b0t.runner.bot;
            if (!bot) return;
            const fight = bot.tasks.find(task => 'engaged' in task);
            const now = performance.now();
            const stands = site === 'black' ? [[2836, 9817], [2835, 9817], [2834, 9817]] : [[2901, 9809], [2904, 9808], [2901, 9810]];
            const [x, z] = stands[bot.safespotIdx] ?? stands[0];
            const anchor = { x, z, level: 0 };
            events.push({ kind, site, at: Date.now(), now, tick: g.rs2b0t.host.tickCount, tile: api.Game.tile(), anchor,
                anchorIndex: bot.safespotIdx, status: bot.status, task: taskName, target: bot.targetIdx,
                playerName: raw.localPlayer?.name ?? null,
                engaged: fight?.engaged ?? null, lootTarget: fight?.lootTarget ?? null, blindAge: now - (fight?.blindSince ?? now),
                combat: api.Game.inCombat(), face: g.rs2b0t.reader.selfFaceEntity(), hp: api.Skills.effective('hitpoints'),
                hpFraction: bot.hpFraction(), panicHp: bot.panicHp(), retreatHp: bot.retreatHp(), foodReserve: bot.settings.num('foodReserve', 4),
                requiredSupplies: api.Inventory.count('Rune arrow') + (api.Equipment.items().find(i => i.name === 'Rune arrow')?.count ?? 0) > 0,
                equipment: api.Equipment.items().map(i => ({ id: i.id, name: i.name, count: i.count })),
                playerRouteHead: raw.localPlayer ? { x: raw.mapBuildBaseX + raw.localPlayer.routeX[0], z: raw.mapBuildBaseZ + raw.localPlayer.routeZ[0], length: raw.localPlayer.routeLength } : null,
                pendingWalkGoal: raw.minimapFlagX === 0 ? null : { x: raw.mapBuildBaseX + raw.minimapFlagX, z: raw.mapBuildBaseZ + raw.minimapFlagZ },
                xp: api.Skills.xp('ranged'), prayerXp: api.Skills.xp('prayer'), used: api.Inventory.used(), sharks: api.Inventory.count('Shark'),
                inventory: api.Inventory.items().map(i => ({ id: i.id, name: i.name, count: i.count })), logs: g.rs2b0t.runner.ctx.log.slice(-3),
                npcs: api.Npcs.all().filter(n => n.name === (site === 'black' ? 'Black dragon' : 'Blue dragon')).map(n => {
                    const t = n.tile();
                    const origin = { x: t.x - (n.size >> 1), z: t.z - (n.size >> 1), level: t.level };
                    const gap = Math.max(Math.max(origin.x - anchor.x, anchor.x - (origin.x + n.size - 1), 0),
                        Math.max(origin.z - anchor.z, anchor.z - (origin.z + n.size - 1), 0));
                    const body = raw.npc[n.index];
                    const networkOrigin = body ? { x: raw.mapBuildBaseX + body.routeX[0], z: raw.mapBuildBaseZ + body.routeZ[0], level: t.level } : null;
                    const networkGap = networkOrigin ? Math.max(Math.max(networkOrigin.x - anchor.x, anchor.x - (networkOrigin.x + n.size - 1), 0),
                        Math.max(networkOrigin.z - anchor.z, anchor.z - (networkOrigin.z + n.size - 1), 0)) : null;
                    return { index: n.index, tile: t, origin, size: n.size, hp: n.health, gap,
                        networkTile: n.networkTile(),
                        stands: networkOrigin ? stands.map(([x, z]) => ({ x, z,
                            gap: Math.max(Math.max(networkOrigin.x - x, x - (networkOrigin.x + n.size - 1), 0), Math.max(networkOrigin.z - z, z - (networkOrigin.z + n.size - 1), 0)),
                            los: api.Reachability.lineOfSight({ x, z, level: t.level }, networkOrigin, n.size) })) : [],
                        renderedRaw: body ? { x: body.x, z: body.z } : null, networkOrigin, networkGap, routeLength: body?.routeLength ?? null,
                        networkLos: networkOrigin ? api.Reachability.lineOfSight(anchor, networkOrigin, n.size) : null,
                        los: api.Reachability.lineOfSight(anchor, origin, n.size), combat: n.inCombat,
                        me: n.targetsMe(), other: n.targetsAnotherPlayer(), distance: n.distance(),
                        settledAge: now - (fight?.seen?.get(n.index)?.since ?? now), skipRemaining: Math.max(0, (fight?.skip?.get(n.index) ?? 0) - now) };
                }),
                ground: api.GroundItems.query().results().map(item => ({ id: item.id, name: item.name, count: item.count, tile: item.tile() })), ...detail });
        };
        const restores: (() => void)[] = [];
        const bound = new Set<TaskView>();
        let hostBound = false;
        const bindTasks = () => {
            const bot = g.rs2b0t.runner.bot;
            if (!bot) return;
            const fight = bot.tasks.find(task => 'engaged' in task);
            if (!hostBound) {
                hostBound = true;
                const selectAnchor = bot.setSafespotIndex;
                bot.setSafespotIndex = function (selected) { capture('anchor-selection', { selected }); return selectAnchor.call(this, selected); };
                restores.push(() => { bot.setSafespotIndex = selectAnchor; });
                const armSpecial = bot.armSpecial;
                if (armSpecial) {
                    bot.armSpecial = async function () { capture('special-arm-start'); await armSpecial.call(this); capture('special-arm-end'); };
                    restores.push(() => { bot.armSpecial = armSpecial; });
                }
            }
            for (const task of bot.tasks) {
                if (bound.has(task)) continue;
                bound.add(task);
                const execute = task.execute;
                task.execute = function () { taskName = this === fight ? 'Fight' : this.constructor.name; capture('decision'); return execute.call(this); };
                restores.push(() => { task.execute = execute; });
                if (task === fight && task.idle) {
                    const idle = task.idle;
                    task.idle = function () { capture('idle'); return idle.call(this); };
                    restores.push(() => { task.idle = idle; });
                }
                if (task === fight && task.leash) {
                    const leash = task.leash;
                    task.leash = function (index) { capture('leash-start', { index }); return leash.call(this, index); };
                    restores.push(() => { task.leash = leash; });
                }
            }
        };
        const interact = api.Npc.prototype.interact;
        api.Npc.prototype.interact = function (action) {
            capture('npc-action', { action, index: this.index, id: this.id });
            return interact.call(this, action);
        };
        const take = api.GroundItem.prototype.interact;
        api.GroundItem.prototype.interact = function (action) {
            capture('ground-action', { action, item: this.name, itemId: this.id, itemCount: this.count, itemTile: this.tile() });
            return take.call(this, action);
        };
        const inventoryInteract = api.InvItem.prototype.interact;
        api.InvItem.prototype.interact = function (action) {
            capture('inventory-action', { action, item: this.name, itemId: this.id });
            return inventoryInteract.call(this, action);
        };
        const untick = g.rs2b0t.host.addTickListener(() => { bindTasks(); capture('tick'); });
        globalThis.__blackTrace = { events, restore() {
            untick(); restores.forEach(restore => restore());
            api.Npc.prototype.interact = interact; api.GroundItem.prototype.interact = take;
            api.InvItem.prototype.interact = inventoryInteract;
        } };
        capture('installed');
    }, site);
}
