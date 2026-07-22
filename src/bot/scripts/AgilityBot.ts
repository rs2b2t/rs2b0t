import { TaskBot, type Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Reachability } from '../api/Reachability.js';
import { DirectNavigator } from '../nav/DirectNavigator.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

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
    searchRadius: { type: 'number', default: 20, min: 4, max: 64, label: 'Obstacle search radius (tiles)' }
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
    private laps = 0;
    private obstaclesCleared = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.course = this.settings
            .str('obstacles', '')
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);
        this.radius = this.settings.num('searchRadius', 20);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');
        this.log(`running agility course: [${this.course.join(' -> ')}] within ${this.radius} tiles`);

        this.add(new ContinueDialog(), new DoObstacle(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`Agility — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('agility') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Laps: ${this.laps}`, `XP/hr: ${xph}`);
        p.row(`Obstacles: ${this.obstaclesCleared}`, `Step: ${this.currentName() ?? '—'}`);

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }

    setStatus(s: string): void {
        this.status = s;
    }
    searchRadius(): number {
        return this.radius;
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

    /**
     * An xp-less attempt usually means we're SIDE-ON to a directional obstacle:
     * course obstacles axis-check the stand ("You can not do that from here."),
     * and both gnome nets have open corridors around their west ends where the
     * op-walk can park us side-on — every re-click from there fails and the
     * old skip-after-4 cascaded into restarting the course from the log
     * (issue #10). Between retries, step onto a DIFFERENT face of the obstacle
     * (south first — the pre-pipe net climbs from the south — then north, then
     * the flanks) so the next click comes from a valid side.
     */
    private async repositionForRetry(obstacle: Loc): Promise<void> {
        const t = obstacle.tile();
        const me = Game.tile();
        const faces = [
            { x: t.x, z: t.z - 1 }, // south face
            { x: t.x, z: t.z + 1 }, // north face
            { x: t.x - 1, z: t.z }, // west flank
            { x: t.x + 1, z: t.z }  // east flank
        ];
        const usable = faces
            .map(f => ({ x: f.x, z: f.z, level: t.level }))
            .filter(f => !(me && me.x === f.x && me.z === f.z)) // must actually MOVE
            .filter(f => Reachability.walkable(f) && Reachability.canReach(f));
        const dest = usable[(this.stuck - 1) % Math.max(1, usable.length)];
        if (!dest) {
            return; // nothing reachable to try — fall through to the retry/skip path
        }
        this.bot.log(`no xp from '${obstacle.name}' — repositioning to its (${dest.x},${dest.z}) face and retrying`);
        this.bot.setStatus('repositioning at the obstacle');
        await DirectNavigator.walkTo(dest, 0, 10000);
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
        const clicked = await obstacle.interact(op);

        // every course obstacle awards agility xp when the traversal script
        // finishes — that's the completion signal. Generous timeout: the pipe
        // is a forcewalk plus two exact-moves and takes ~10s.
        const cleared = clicked && (await Execution.delayUntil(() => Skills.xp('agility') > before || EventSignal.pending(), 15000));
        if (!clicked) {
            await Execution.delayTicks(2);
        }

        // a random event (e.g. the Swarm) interrupted us — yield at once so the
        // runtime event guard walks us away from it before we retry the obstacle
        if (EventSignal.pending()) {
            this.bot.setStatus('random event — handling');
            return;
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
        } else if (++this.stuck >= 6) {
            // six tries = the original stand plus every face repositionForRetry
            // offers — genuinely past this step, not just side-on
            this.bot.log(`step '${this.bot.currentName()}' gave no xp after ${this.stuck} attempts — skipping`);
            this.stuck = 0;
            this.bot.advance();
        } else {
            await this.repositionForRetry(obstacle);
        }
    }
}
