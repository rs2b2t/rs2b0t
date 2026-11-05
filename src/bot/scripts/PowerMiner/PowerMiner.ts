import { actions, reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { BotHost } from '../../runtime/BotHost.js';
import { PowerMineController } from './controller.js';
import {
    CUSTOM_LOCATION,
    POWER_MINE_RADIUS,
    powerMineCamp,
    resolvePowerMineAnchor
} from './locations.js';
import { DEPLETED_ROCK_IDS, EXTRA_DROP_IDS, IRON_ORE_IDS, IRON_ROCK_IDS, MINE_OP, ORE_NAME } from './rocks.js';
import type { IronRock, Observation, PowerMineHost, PowerMinerDebug } from './types.js';

const ORE_LOWER = ORE_NAME.toLowerCase();
const MAX_DROPS = 4;

/** Why: one snapshot per tick feeds a controller that drops first and clicks last, so the interaction survives. */
export default class PowerMiner extends LoopingBot implements PowerMineHost {
    override loopDelay = 0;

    private locationName = 'Legends Guild Iron (east)';
    private anchor = new Tile(2712, 3330, 0);
    private radius = POWER_MINE_RADIUS;
    private status = 'starting';
    private startXp = 0;
    private startedAt = Date.now();
    private ores = 0;
    private lastOreCount = 0;
    private obs: Observation | null = null;
    private stopTick: (() => void) | null = null;
    private lastRetaliateCheck = 0;
    private lastRealTickAt = 0;
    private readonly controller = new PowerMineController(this);

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.locationName = this.settings.str('location', 'Legends Guild Iron (east)');
        const here = Game.tile();
        const start = here ? Tile.from(here) : new Tile(2712, 3330, 0);
        const custom = this.settings.tile('customLocation', start);
        this.anchor = resolvePowerMineAnchor(this.locationName, new Tile(custom.x, custom.z, custom.level));
        const camp = powerMineCamp(this.locationName);
        this.radius = camp?.radius ?? POWER_MINE_RADIUS;

        Game.setAutoRetaliate(false);
        const retaliateOff = await Execution.delayUntil(() => !Game.autoRetaliateOn(), 3000);
        this.startXp = Skills.xp('mining');
        this.startedAt = Date.now();
        this.lastOreCount = 0;
        this.stopTick = BotHost.addTickListener(() => this.onTick());
        const route = this.buildRoute(camp);
        this.controller.setRoute(route);
        const dropMode = this.settings.str('dropMode', 'Every 2 ores');
        const batch = dropMode === 'Every ore' ? 1 : Number.parseInt(dropMode.match(/\d+/)?.[0] ?? '1', 10);
        this.controller.dropEvery = Number.isFinite(batch) && batch >= 1 ? Math.min(batch, 4) : 1;
        this.log(
            `PowerMiner: ${this.locationName} @ ${this.anchor.x},${this.anchor.z} | ` +
            `r=${this.radius} order=${route ? `${route.length} rocks` : 'discovered'} pick=${this.pickName() ?? 'none'} retaliateOff=${retaliateOff}`
        );
        if (camp?.rocks && camp.rocks.length > 0) {
            this.log(`rocks: ${camp.rocks.map((r, i) => `${r.x},${r.z}: ${i + 1}`).join('  ')}`);
        }
        if (route && route.length > 0) {
            this.log(`route: ${route.map((r, i) => `${i + 1}) ${r.x},${r.z}`).join('  ')}`);
        }
        if (powerMineCamp(this.locationName)?.note) {
            this.log(`  ${powerMineCamp(this.locationName)!.note}`);
        }
    }

    override onStop(): void {
        this.stopTick?.();
        this.stopTick = null;
    }

    override async loop(): Promise<number | void> {
        if (!Game.ingame() || !Game.sceneReady()) {
            return;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            return;
        }
        if (ChatDialog.isOpen() || reader.modals().main !== -1) {
            // Wait for the interface to close; never send an action into a modal.
            return;
        }
        if (!this.hasPickaxe()) {
            this.setStatus('missing pickaxe');
            await Execution.delayTicks(5);
            return;
        }
        const here = Game.tile();
        if (here && this.anchor.distanceTo(here) > this.radius + 4) {
            this.setStatus('walking to camp');
            await Traversal.walkResilient(this.anchor, {
                radius: 2,
                attempts: 2,
                timeoutMs: 30_000,
                log: message => this.log(`  ${message}`)
            });
            return;
        }
        // Keep auto-retaliate off if something toggled it (level-up, death, hop).
        // Checked rarely: an IF_BUTTON here competes with the drop+click USER_EVENT budget.
        if (Date.now() - this.lastRetaliateCheck > 10_000) {
            this.lastRetaliateCheck = Date.now();
            if (Game.autoRetaliateOn()) {
                Game.setAutoRetaliate(false);
                this.log('auto-retaliate back off (10s check)');
            }
        }
    }

    /** One snapshot per tick; the controller is the only thing that sends actions. */
    private onTick(): void {
        if (!Game.ingame() || !Game.sceneReady()) {
            return;
        }
        if (ChatDialog.isOpen() || ChatDialog.canContinue() || reader.modals().main !== -1) {
            return;
        }
        const tile = Game.tile();
        if (!tile) {
            return;
        }
        const here = Tile.from(tile);
        if (this.anchor.distanceTo(here) > this.radius + 4) {
            return;
        }

        const items = Inventory.items();
        const oreSlots = items
            .filter(item => item.name?.toLowerCase() === ORE_LOWER)
            .map(item => item.slot);
        const dropSlots = items
            .filter(item => item.name?.toLowerCase() === ORE_LOWER || EXTRA_DROP_IDS.has(item.id))
            .map(item => item.slot);
        if (oreSlots.length > this.lastOreCount) {
            this.ores += oreSlots.length - this.lastOreCount;
        }
        this.lastOreCount = oreSlots.length;

        const now = performance.now();
        const gapMs = this.lastRealTickAt > 0 ? now - this.lastRealTickAt : 600;
        this.lastRealTickAt = now;
        const obs: Observation = {
            tick: Game.tick(),
            at: now,
            gapMs,
            anim: reader.selfAnim() ?? -1,
            freeSlots: Inventory.free(),
            oreSlots,
            dropSlots,
            tile: here,
            live: this.scanRocks().live,
            depleted: this.scanRocks().depleted
        };
        this.obs = obs;
        this.controller.tick(obs);
    }

    private scanRocks(): { live: IronRock[]; depleted: Set<string> } {
        const live: IronRock[] = [];
        const depleted = new Set<string>();
        for (const loc of Locs.query().name('Rocks').action(MINE_OP).results()) {
            const tile = loc.tile();
            if (this.anchor.distanceTo(tile) > this.radius) {
                continue;
            }
            if (IRON_ROCK_IDS.has(loc.id)) {
                live.push({ id: loc.id, tile, loc });
            } else if (DEPLETED_ROCK_IDS.has(loc.id)) {
                depleted.add(`${tile.x},${tile.z}`);
            }
        }
        return { live, depleted };
    }

    /** Route from the per-rock order dropdowns; ties keep the listed order. */
    private buildRoute(camp: ReturnType<typeof powerMineCamp>): { x: number; z: number }[] | null {
        if (this.locationName === CUSTOM_LOCATION) {
            const custom: { pos: number; index: number; rock: { x: number; z: number } }[] = [];
            for (let i = 1; i <= 6; i++) {
                const raw = this.settings.str(`rock${i}`, String(i));
                if (raw.trim().toLowerCase() === 'exclude') {
                    continue;
                }
                const tile = this.settings.tile(`rock${i}At`, new Tile(0, 0, 0));
                if (tile.x === 0 && tile.z === 0) {
                    continue;
                }
                const pos = Number.parseInt(raw, 10);
                if (Number.isFinite(pos) && pos >= 1) {
                    custom.push({ pos, index: i, rock: { x: tile.x, z: tile.z } });
                }
            }
            if (custom.length === 0) {
                return null;
            }
            custom.sort((a, b) => a.pos - b.pos || a.index - b.index);
            return custom.map(entry => entry.rock);
        }
        if (!camp?.rocks || camp.rocks.length === 0) {
            return null;
        }
        const chosen: { pos: number; index: number; rock: { x: number; z: number } }[] = [];
        camp.rocks.forEach((rock, index) => {
            const raw = this.settings.str(`rock${index + 1}`, String(index + 1));
            if (raw.trim().toLowerCase() === 'exclude') {
                return;
            }
            const pos = Number.parseInt(raw, 10);
            if (Number.isFinite(pos) && pos >= 1) {
                chosen.push({ pos, index, rock });
            }
        });
        if (chosen.length === 0) {
            return [...camp.rocks];
        }
        chosen.sort((a, b) => a.pos - b.pos || a.index - b.index);
        return chosen.map(entry => entry.rock);
    }

    private pickName(): string | null {
        const isPick = (name: string | null | undefined): boolean => /pickaxe$/i.test(name ?? '');
        return Inventory.items().find(item => isPick(item.name))?.name
            ?? Equipment.items().find(item => isPick(item.name))?.name
            ?? null;
    }

    private hasPickaxe(): boolean {
        return this.pickName() !== null;
    }

    // PowerMineHost -----------------------------------------------------------------

    nowMs(): number {
        return performance.now();
    }

    /**
     * Drops first, click last, same tick. A drop clears the server-side mining
     * interaction (`clearPendingAction`), so the OPLOC must be the final action.
     */
    send(drops: readonly number[], rock: IronRock | null): number {
        const tick = Game.tick();
        this.dispatch(drops, rock);
        return tick;
    }

    private dispatch(drops: readonly number[], rock: IronRock | null): void {
        // Drop by id from the CURRENT inventory. Ores take the first empty slot,
        // so a precomputed slot is never trusted here.
        const items = Inventory.items();
        const droppable = items.filter(entry => IRON_ORE_IDS.has(entry.id) || EXTRA_DROP_IDS.has(entry.id));
        for (const item of droppable.slice(0, Math.min(drops.length, MAX_DROPS))) {
            item.interact('Drop');
        }
        if (rock) {
            rock.loc.interact(MINE_OP);
            if (this.settings.bool('diagnostics', true)) {
                this.log(`tick ${Game.tick()}: drop ${drops.length} -> mine ${rock.tile.x},${rock.tile.z} d=${rock.loc.distance()}`);
            }
        }
        // Why: one write keeps drops and the click in the same server tick.
        actions.flushOut();
    }

    setStatus(message: string): void {
        this.status = message;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#c9a227' });
        p.title(`PowerMiner — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const gained = Skills.xp('mining') - this.startXp;
        const perHour = mins > 0 ? Math.round(gained / (mins / 60)) : 0;
        const debug = this.controller.debug();
        const camp = powerMineCamp(this.locationName);
        p.row(`XP: ${gained}`, `XP/hr: ${perHour}`, `Ores: ${this.ores}`);
        p.row(`Clicks: ${debug.clicks}`, `Drops: ${debug.drops}`, `Waits: ${debug.waits}`);
        p.row(`Camp: ${camp?.name ?? this.locationName}`, `Rock: ${debug.current ?? '-'}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    /** e2e / live-tuning surface. */
    debug(): PowerMinerDebug {
        return {
            status: this.status,
            location: this.locationName,
            anchor: { x: this.anchor.x, z: this.anchor.z, level: this.anchor.level },
            radius: this.radius,
            ores: this.ores,
            controller: this.controller.debug(),
            obs: this.obs
        };
    }
}
