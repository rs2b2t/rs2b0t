import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';

/**
 * First built-in: proves the runtime end to end. Logs the nearest NPCs every
 * couple of server ticks and paints a live overlay box.
 */
export default class DebugBot extends LoopingBot {
    private nearest: Npc[] = [];

    override async onStart(): Promise<void> {
        this.log('DebugBot started — waiting until ingame');
        await Execution.delayUntil(() => Game.ingame(), 0);
    }

    async loop(): Promise<void> {
        this.nearest = Npcs.nearest(3);

        const tile = Game.tile();
        const where = tile ? `(${tile.x}, ${tile.z}, ${tile.level})` : '(?)';
        const list = this.nearest.map(n => `${n.name ?? '?'}@${n.distance()}`).join(', ');
        this.log(`tick ${Game.tick()} ${where} energy ${Game.energy()}% — nearest: ${list || 'none'}`);

        await Execution.delayTicks(2);
    }

    override onStop(): void {
        this.log('DebugBot stopped');
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`DebugBot  tick ${Game.tick()}`, ...this.nearest.map(n => `${n.name ?? '?'} lvl ${n.level} dist ${n.distance()}`)];

        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width), 120) + 12;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);

        ctx.fillStyle = '#5be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }
}
