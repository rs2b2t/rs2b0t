import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';

/**
 * Slice 5 exit-criterion demo: web-walks a fixed route from wherever it
 * starts — up and down the Lumbridge castle staircase, through the
 * east-Lumbridge chicken-pen gate, then the three-city crossing on to
 * Varrock square and Falador square (two more gates) — logging
 * arrival/failure timings per leg. Reads no settings; idles when done
 * (check the log for 'NavDemo complete').
 */
export default class NavDemo extends LoopingBot {
    override loopDelay = 600;

    private readonly legs = [
        { name: 'castle upstairs L1', dest: new Tile(3205, 3209, 1) },
        { name: 'back down to courtyard', dest: new Tile(3211, 3216, 0) },
        { name: 'chicken pen interior', dest: new Tile(3232, 3298, 0) },
        { name: 'Varrock square', dest: new Tile(3213, 3428, 0) },
        { name: 'Falador square', dest: new Tile(2964, 3378, 0) }
    ];

    private legIndex = 0;
    private arrivals = 0;
    private done = false;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        Traversal.preload();
        this.log(`starting demo route from ${Tile.from(Game.tile()!)}`);
    }

    async loop(): Promise<number | void> {
        if (this.done) {
            this.status = 'done';
            return 5000;
        }

        const leg = this.legs[this.legIndex];
        const legNo = this.legIndex + 1;
        this.status = `leg ${legNo}: ${leg.name}`;
        this.log(`leg ${legNo} (${leg.name}): walking to ${leg.dest}`);

        const started = performance.now();
        const arrived = await Traversal.walkTo(leg.dest, { radius: 2, timeoutMs: 8 * 60_000, log: msg => this.log(`  ${msg}`) });
        const seconds = ((performance.now() - started) / 1000).toFixed(1);

        if (arrived) {
            this.arrivals++;
            this.log(`leg ${legNo} (${leg.name}): arrived at ${Tile.from(Game.tile()!)} in ${seconds}s`);
        } else {
            this.log(`leg ${legNo} (${leg.name}): FAILED after ${seconds}s at ${Game.tile() ? Tile.from(Game.tile()!).toString() : '?'}`);
        }

        this.legIndex++;
        if (this.legIndex >= this.legs.length) {
            this.done = true;
            this.log(`NavDemo complete: ${this.arrivals}/${this.legs.length} legs arrived`);
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const me = Game.tile();
        const leg = this.legs[Math.min(this.legIndex, this.legs.length - 1)];
        const distance = me ? Math.max(Math.abs(me.x - leg.dest.x), Math.abs(me.z - leg.dest.z)) : -1;
        const lines = [`NavDemo — ${this.status}`, this.done ? `arrived ${this.arrivals}/${this.legs.length}` : `target ${leg.dest} dist ${distance}`, `path tiles left ${Traversal.remaining()}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(line => ctx.measureText(line).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#6bd5ff';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }
}
