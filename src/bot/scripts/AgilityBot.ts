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

export const AGILITY_SETTINGS: SettingsSchema = {
    obstacles: {
        type: 'string',
        default: 'Log balance,Obstacle net,Tree branch,Balancing rope,Tree branch,Obstacle net,Obstacle pipe',
        label: 'Obstacles (lap order)',
        help: 'comma-separated obstacle loc names in lap order, repeats allowed; each step uses the nearest loc with that name and advances when agility xp is awarded'
    },
    searchRadius: { type: 'number', default: 20, min: 4, max: 64, label: 'Obstacle search radius (tiles)' }
};

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
    advance(): void {
        this.step++;
        if (this.step >= this.course.length) {
            this.step = 0;
            this.laps++;
            this.log(`lap ${this.laps} complete`);
        }
    }
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
    private stuck = 0;

    constructor(private bot: AgilityBot) {}

    private find(name: string): Loc | null {
        const within = this.bot.searchRadius();
        return Locs.query()
            .where(l => l.name?.toLowerCase() === name && l.distance() <= within && l.actions().length > 0)
            .nearest();
    }

    validate(): boolean {
        return true;
    }

    private async repositionForRetry(obstacle: Loc): Promise<void> {
        const t = obstacle.tile();
        const me = Game.tile();
        const faces = [
            { x: t.x, z: t.z - 1 },
            { x: t.x, z: t.z + 1 },
            { x: t.x - 1, z: t.z },
            { x: t.x + 1, z: t.z }
        ];
        const usable = faces
            .map(f => ({ x: f.x, z: f.z, level: t.level }))
            .filter(f => !(me && me.x === f.x && me.z === f.z))
            .filter(f => Reachability.walkable(f) && Reachability.canReach(f));
        const dest = usable[(this.stuck - 1) % Math.max(1, usable.length)];
        if (!dest) {
            return;
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

        const cleared = clicked && (await Execution.delayUntil(() => Skills.xp('agility') > before || EventSignal.pending(), 15000));
        if (!clicked) {
            await Execution.delayTicks(2);
        }

        if (EventSignal.pending()) {
            this.bot.setStatus('random event — handling');
            return;
        }

        let last = Game.tile();
        for (let settle = 0; settle < 25; settle++) {
            await Execution.delayTicks(1);
            if (ChatDialog.canContinue()) {
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
            this.bot.log(`step '${this.bot.currentName()}' gave no xp after ${this.stuck} attempts — skipping`);
            this.stuck = 0;
            this.bot.advance();
        } else {
            await this.repositionForRetry(obstacle);
        }
    }
}
