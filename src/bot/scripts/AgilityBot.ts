import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Skills } from '../api/hud/Skills.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Shared parameter schema for any agility-course preset. */
export const AGILITY_SETTINGS: SettingsSchema = {
    obstacles: {
        type: 'string',
        // one 'Obstacle pipe' step: a single interaction traverses the whole
        // double-pipe lane (the engine forcewalks + exact-moves past both
        // placements and awards xp once)
        default: 'Log balance,Obstacle net,Tree branch,Balancing rope,Tree branch,Obstacle net,Obstacle pipe',
        label: 'Obstacles (lap order)',
        help: 'comma-separated obstacle loc names in lap order, repeats allowed; each step uses the nearest loc with that name and advances when agility xp is awarded'
    },
    searchRadius: { type: 'number', default: 20, min: 4, max: 64, label: 'Obstacle search radius (tiles)' },
    menuSelect: {
        type: 'boolean',
        default: true,
        label: 'Right-click + menu select',
        help: 'interact via the right-click menu instead of a single left click — steadier on thin course models (ropes, logs)'
    }
};

/**
 * Runs an agility course as an ordered lap: for each step, walk to and use the
 * nearest loc matching that step's name (its op1 — Walk-across / Climb /
 * Squeeze-through / …), wait for the agility xp award that every course
 * obstacle grants on traversal, then advance to the next step (wrapping laps).
 *
 * Ordered stepping matters: obstacles are directional and several share a
 * name (both gnome nets are "Obstacle net", climb-up and climb-down are both
 * "Tree branch"), so "nearest matching anything" re-clicks the obstacle just
 * completed from its wrong side and wedges the lap. XP is the completion
 * signal because tile-delta heuristics misjudge short hops like the 2-tile
 * net climbs.
 */
export default class AgilityBot extends TaskBot {
    override loopDelay = 600;

    private course: string[] = [];
    private step = 0;
    private radius = 20;
    private viaMenu = true;
    private laps = 0;
    private obstaclesCleared = 0;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.course = this.settings
            .str('obstacles', '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        this.radius = this.settings.num('searchRadius', 20);
        this.viaMenu = this.settings.bool('menuSelect', true);
        this.log(`running agility course: [${this.course.join(' -> ')}] within ${this.radius} tiles`);

        this.add(new ContinueDialog(), new DoObstacle(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`Agility — ${this.status}`, `obstacles ${this.obstaclesCleared}  laps ${this.laps}`, `tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    searchRadius(): number {
        return this.radius;
    }
    menuSelect(): boolean {
        return this.viaMenu;
    }
    currentName(): string {
        return this.course[this.step];
    }
    courseNames(): string[] {
        return this.course;
    }
    cleared(): void {
        this.obstaclesCleared++;
    }
    /** Move to the next obstacle, counting laps on wrap. */
    advance(): void {
        this.step++;
        if (this.step >= this.course.length) {
            this.step = 0;
            this.laps++;
            this.log(`lap ${this.laps} complete`);
        }
    }
    /**
     * Re-sync after a desync (started mid-course, or a traversal whose xp we
     * missed): point the lap at the first course step whose loc is in range.
     * Ambiguous for repeated names, but xp-gated advancement self-corrects.
     */
    resyncTo(name: string): boolean {
        const idx = this.course.indexOf(name);
        if (idx === -1) {
            return false;
        }

        this.log(`course re-sync: step ${this.step} (${this.currentName()}) -> ${idx} (${name})`);
        this.step = idx;
        return true;
    }
}

class ContinueDialog implements Task {
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
}

class DoObstacle implements Task {
    // consecutive xp-less attempts at the current step; obstacles are
    // side-gated ("You can not do that from here."), so repeated failure
    // means we're past this step — skip rather than wedge the lap
    private stuck = 0;

    constructor(private bot: AgilityBot) {}

    /** Nearest in-range loc with this name that has a clickable op — courses
     *  have decorative same-named locs (the gnome tightrope's op-less mid
     *  segments) that must never win the nearest() race. */
    private find(name: string): Loc | null {
        const within = this.bot.searchRadius();
        return Locs.query()
            .where(l => l.name?.toLowerCase() === name && l.distance() <= within && l.actions().length > 0)
            .nearest();
    }

    validate(): boolean {
        return true;
    }

    async execute(): Promise<void> {
        let obstacle = this.find(this.bot.currentName());
        if (!obstacle) {
            for (const name of new Set(this.bot.courseNames())) {
                if (this.find(name) && this.bot.resyncTo(name)) {
                    obstacle = this.find(name);
                    break;
                }
            }
        }
        if (!obstacle) {
            this.bot.setStatus(`waiting: no ${this.bot.currentName()} within ${this.bot.searchRadius()} tiles`);
            await Execution.delayTicks(2);
            return;
        }

        const op = obstacle.actions()[0];
        if (!op) {
            return;
        }

        const before = Skills.xp('agility');
        this.bot.setStatus(`${op} ${obstacle.name} at ${obstacle.tile()}`);
        const clicked = await obstacle.interact(op, this.bot.menuSelect());

        // every course obstacle awards agility xp when the traversal script
        // finishes — that's the completion signal. Generous timeout: the pipe
        // is a forcewalk plus two exact-moves and takes ~10s.
        const cleared = clicked && (await Execution.delayUntil(() => Skills.xp('agility') > before, 15000));
        if (!clicked) {
            await Execution.delayTicks(2);
        }

        // let any trailing force-move settle before clicking the next one
        let last = Game.tile();
        for (let settle = 0; settle < 25; settle++) {
            await Execution.delayTicks(1);
            if (ChatDialog.canContinue()) {
                // level-up dialog — stop settling so the ContinueDialog task
                // (first in task order) clears it on the next loop
                break;
            }
            const now = Game.tile();
            if (now && last && now.x === last.x && now.z === last.z && !Game.animating()) {
                break;
            }
            last = now;
        }

        if (cleared) {
            this.stuck = 0;
            this.bot.cleared();
            this.bot.advance();
        } else if (++this.stuck >= 4) {
            this.bot.log(`step '${this.bot.currentName()}' gave no xp after ${this.stuck} attempts — skipping`);
            this.stuck = 0;
            this.bot.advance();
        }
    }
}
