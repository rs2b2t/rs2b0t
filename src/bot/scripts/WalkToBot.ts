import type { WorldTile } from '../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { WALK_OPTIONS, resolveDestination } from './WalkDestinations.js';

/** Tunable parameters (panel + `?WalkTo.<key>=...`). */
export const WALKTO_SETTINGS: SettingsSchema = {
    destination: { type: 'string', default: WALK_OPTIONS[0], options: WALK_OPTIONS, label: 'Destination' },
    customTile: { type: 'tile', default: new Tile(0, 0, 0), label: 'Custom tile (x,z)', help: 'if set (non-zero), walk here instead of the destination above' },
    arriveRadius: { type: 'number', default: 3, min: 0, max: 12, label: 'Arrive within (tiles)' }
};

/**
 * Walks to a chosen destination (a named town centre / bank, or a custom tile)
 * with the resilient web-walker, then stops — no other behaviour. Start it
 * anywhere; it routes there and idles on arrival.
 */
export default class WalkToBot extends TaskBot {
    override loopDelay = 600;

    private target: Tile | null = null;
    private label = '';
    private radius = 3;
    private arrived = false;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.radius = this.settings.num('arriveRadius', 3);

        const custom = this.settings.tile('customTile', new Tile(0, 0, 0));
        if (custom.x !== 0 || custom.z !== 0) {
            this.target = custom;
            this.label = `custom ${custom.x},${custom.z},${custom.level}`;
        } else {
            const dest = resolveDestination(this.settings.str('destination', WALK_OPTIONS[0]));
            if (dest) {
                this.target = dest.tile;
                this.label = dest.name;
            }
        }

        if (!this.target) {
            this.log('WalkTo: no destination set — stopping');
            throw new Error('WalkTo: no destination');
        }

        this.log(`walking to ${this.label} at ${this.target} (arrive within ${this.radius})`);
        this.add(new WalkTo(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const here = Game.tile();
        const dist = here && this.target ? this.target.distanceTo(here) : -1;
        const lines = [
            `WalkTo — ${this.status}`,
            `dest ${this.label}  ${this.arrived ? 'ARRIVED' : dist >= 0 ? `${dist} tiles away` : ''}`,
            `tick ${Game.tick()}`
        ];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = this.arrived ? '#9be05b' : '#6cb6ff';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    targetTile(): Tile {
        return this.target!;
    }
    destLabel(): string {
        return this.label;
    }
    arriveRadius(): number {
        return this.radius;
    }
    isArrived(): boolean {
        return this.arrived;
    }
    markArrived(): void {
        this.arrived = true;
    }
}

/** Route to the target and stop; validates until we've arrived. */
class WalkTo implements Task {
    constructor(private bot: WalkToBot) {}

    validate(): boolean {
        return !this.bot.isArrived();
    }

    async execute(): Promise<void> {
        const target = this.bot.targetTile();
        const radius = this.bot.arriveRadius();

        // already there? (started at/near the destination)
        const start = Game.tile();
        if (start && target.distanceTo(start) <= radius) {
            this.arrive(start);
            return;
        }

        this.bot.setStatus(`walking to ${this.bot.destLabel()}`);
        const reached = await Traversal.walkResilient(target, {
            radius,
            attempts: 6,
            timeoutMs: 300_000,
            log: m => this.bot.log(`  ${m}`)
        });

        const here = Game.tile();
        if (here && target.distanceTo(here) <= radius + 1) {
            this.arrive(here);
        } else if (!reached) {
            this.bot.setStatus(`could not reach ${this.bot.destLabel()} — retrying`);
            this.bot.log(`could not reach ${this.bot.destLabel()} (at ${here ?? '?'}) — retrying`);
            await Execution.delayTicks(3);
        }
    }

    private arrive(here: WorldTile): void {
        this.bot.markArrived();
        this.bot.setStatus(`arrived at ${this.bot.destLabel()}`);
        this.bot.log(`arrived at ${this.bot.destLabel()} (${here})`);
    }
}
