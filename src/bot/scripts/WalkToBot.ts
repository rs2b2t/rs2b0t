import type { WorldTile } from '../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore } from '../runtime/Settings.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { WALK_OPTIONS, resolveDestination } from './WalkDestinations.js';

export const WALKTO_SETTINGS: SettingsSchema = {
    destination: { type: 'string', default: WALK_OPTIONS[0], options: WALK_OPTIONS, label: 'Destination' },
    customTile: { type: 'tile', default: new Tile(0, 0, 0), label: 'Custom tile (x,z)', help: 'if set (non-zero), walk here instead of the destination above' },
    arriveRadius: { type: 'number', default: 3, min: 0, max: 12, label: 'Arrive within (tiles)' }
};

export default class WalkToBot extends TaskBot {
    override loopDelay = 600;

    private target: Tile | null = null;
    private label = '';
    private radius = 3;
    private arrived = false;
    private status = 'starting';
    private tripStartDist = 0;

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
        const here = Game.tile();
        this.tripStartDist = here ? this.target.distanceTo(here) : 0;
        this.add(new WalkTo(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const here = Game.tile();
        const dist = here && this.target ? this.target.distanceTo(here) : -1;
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.arrived ? '#9be05b' : '#6cb6ff' });
        p.title(`WalkTo — ${this.status}`);
        p.row(`Destination: ${this.label}`, this.arrived ? 'ARRIVED' : dist >= 0 ? `${dist} tiles away` : '…');
        const progress = this.arrived ? 1 : this.tripStartDist > 0 ? Math.max(0, Math.min(1, 1 - dist / this.tripStartDist)) : 0;
        p.bar('Trip', progress, '#6cb6ff');
        p.row(`Walker queue: ${Traversal.remaining()}`, `Arrive within: ${this.radius}`);
        p.gap();
        const picked = p.select('dest', 'dest', WALK_OPTIONS, WALK_OPTIONS.includes(this.label) ? this.label : WALK_OPTIONS[0]);
        if (picked) {
            this.switchDestination(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchDestination(name: string): void {
        const dest = resolveDestination(name);
        if (!dest || dest.name === this.label) {
            return;
        }
        this.target = dest.tile;
        this.label = dest.name;
        this.arrived = false;
        const here = Game.tile();
        this.tripStartDist = here ? dest.tile.distanceTo(here) : 0;
        SettingsStore.save('WalkTo', 'destination', name);
        this.log(`destination switched to ${name} (from the paint)`);
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

class WalkTo implements Task {
    private lastDist = Number.POSITIVE_INFINITY;
    private stalls = 0;

    constructor(private bot: WalkToBot) {}

    validate(): boolean {
        return !this.bot.isArrived();
    }

    async execute(): Promise<void> {
        const target = this.bot.targetTile();
        const radius = this.bot.arriveRadius();

        const start = Game.tile();
        if (start && target.distanceTo(start) <= radius) {
            this.arrive(start);
            return;
        }

        this.bot.setStatus(`walking to ${this.bot.destLabel()}`);
        await Traversal.walkTo(target, { radius, timeoutMs: 15_000, log: m => this.bot.log(`  ${m}`) });

        const here = Game.tile();
        if (!this.bot.targetTile().equals(target)) {
            this.lastDist = Number.POSITIVE_INFINITY;
            this.stalls = 0;
            return;
        }
        if (here && target.distanceTo(here) <= radius + 1) {
            this.arrive(here);
            return;
        }

        const dist = here ? target.distanceTo(here) : Number.POSITIVE_INFINITY;
        this.stalls = dist >= this.lastDist - 1 ? this.stalls + 1 : 0;
        this.lastDist = dist;
        if (this.stalls >= 3) {
            this.stalls = 0;
            this.bot.setStatus(`stuck ${dist} tiles out — recovery walk`);
            this.bot.log(`no progress toward ${this.bot.destLabel()} — escalating to a resilient pass`);
            await Traversal.walkResilient(target, { radius, attempts: 2, timeoutMs: 60_000, log: m => this.bot.log(`  ${m}`) });
        }
    }

    private arrive(here: WorldTile): void {
        this.bot.markArrived();
        this.bot.setStatus(`arrived at ${this.bot.destLabel()}`);
        this.bot.log(`arrived at ${this.bot.destLabel()} (${here.x}, ${here.z}, ${here.level})`);
    }
}
