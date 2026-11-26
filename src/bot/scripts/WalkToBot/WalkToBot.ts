import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Game, waitForPlayerTile } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { SettingsBag, SettingsStore } from '../../runtime/Settings.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { WALK_OPTIONS, resolveDestination } from '../../api/map/WalkDestinations.js';
import { hasArrived, isSetCustomTile, MAP_PICK, resolveWalkTarget, UNSET_TILE } from './WalkToLogic.js';

export const DEST_OPTIONS = [MAP_PICK, ...WALK_OPTIONS];

export const WALKTO_SETTINGS: SettingsSchema = {
    destination: {
        type: 'string',
        default: WALK_OPTIONS[0],
        options: DEST_OPTIONS,
        label: 'Destination',
        help: 'Pick on Map sets Map pick. Choosing a named destination clears the map pick.'
    },
    customTile: {
        type: 'tile',
        default: UNSET_TILE,
        label: 'Map pick tile (x,z)',
        help: 'set by Pick on Map. A named Destination above clears this.'
    },
    arriveRadius: {
        type: 'number',
        default: 0,
        min: 0,
        max: 12,
        label: 'Arrive within (tiles)',
        help: '0 = stand on the destination tile, then the script stops'
    }
};

let syncingWalkTo = false;
SettingsStore.onChange((name, key, raw) => {
    if (syncingWalkTo || name !== 'WalkTo') {
        return;
    }
    syncingWalkTo = true;
    try {
        if (key === 'destination' && raw !== MAP_PICK) {
            SettingsStore.save('WalkTo', 'customTile', '0,0,0');
        }
        if (key === 'customTile') {
            const parts = raw.split(',').map(s => Number(s.trim()));
            if (parts.length >= 2 && isSetCustomTile({ x: parts[0], z: parts[1] })) {
                SettingsStore.save('WalkTo', 'destination', MAP_PICK);
            }
        }
    } finally {
        syncingWalkTo = false;
    }
});

export default class WalkToBot extends TaskBot {
    override loopDelay = 600;

    private target: Tile | null = null;
    private label = '';
    private radius = 0;
    private arrived = false;
    private status = 'starting';
    private tripStartDist = 0;
    private unsub: (() => void) | null = null;

    override async onStart(): Promise<void> {
        await waitForPlayerTile();

        this.applyDestination();
        if (!this.target) {
            this.log('WalkTo: no destination set — stopping');
            throw new Error('WalkTo: no destination');
        }

        this.log(`walking to ${this.label} at ${this.target} (arrive within ${this.radius})`);
        this.add(new WalkTo(this));
        this.unsub = SettingsStore.onChange((name, key) => {
            if (name === 'WalkTo' && (key === 'destination' || key === 'customTile')) {
                this.applyDestination();
            }
        });
    }

    override onStop(): void {
        this.unsub?.();
        this.unsub = null;
    }

    private applyDestination(): void {
        this.settings = new SettingsBag(SettingsStore.resolve('WalkTo', WALKTO_SETTINGS));
        this.radius = this.settings.num('arriveRadius', 0);
        const resolved = resolveWalkTarget(
            this.settings.str('destination', WALK_OPTIONS[0]),
            this.settings.tile('customTile', UNSET_TILE)
        );
        if (!resolved) {
            return;
        }
        const same = this.target !== null && resolved.tile.equals(this.target) && resolved.label === this.label;
        this.target = resolved.tile;
        this.label = resolved.label;
        const here = Game.tile();
        this.tripStartDist = here ? resolved.tile.distanceTo(here) : 0;
        if (!same) {
            this.arrived = false;
        }
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
        const destNow = WALK_OPTIONS.includes(this.label) ? this.label : MAP_PICK;
        const picked = p.stepper('dest', 'Destination', DEST_OPTIONS, destNow);
        if (picked) {
            this.switchDestination(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchDestination(name: string): void {
        if (name === MAP_PICK) {
            return;
        }
        const dest = resolveDestination(name);
        if (!dest || dest.name === this.label) {
            return;
        }
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
        if (start && hasArrived(start, target, radius)) {
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
        if (here && hasArrived(here, target, radius)) {
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
        ScriptRunner.stop(`WalkTo: arrived at ${this.bot.destLabel()}`);
    }
}
