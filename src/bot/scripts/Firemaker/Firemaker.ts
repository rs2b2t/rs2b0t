import { actions, reader, type WorldTile } from '../../adapter/ClientAdapter.js';
import { depositAllExcept } from '../../api/bank/Banking.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Bank } from '../../api/bank/Bank.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Paint } from '../../paint/Paint.js';
import { Skills } from '../../api/skills/Skills.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import {
    CANT_LIGHT,
    FIRE_LIGHT_TICKS,
    FIRE_SPOTS,
    FIRE_START_TICKS,
    LOG_LEVELS,
    TINDERBOX,
    burnLaneWant,
    findBurnLane,
    fireReactionTicks,
    inFirePlot,
    isBurnWest,
    runInDir,
    tileKey,
    type FirePlot
} from '../../api/firemaking/Firemaking.js';
import { exactTool, hasAllTools, toolKeepNames, toolRestockPlan, type ToolReq } from '../../api/acquisition/Tools.js';

export { FIRE_SPOTS, LOG_LEVELS } from '../../api/firemaking/Firemaking.js';

export const FIREMAKER_SETTINGS: SettingsSchema = {
    logType: { type: 'string', default: 'Logs', options: Object.keys(LOG_LEVELS), label: 'What to burn' },
    location: {
        type: 'string',
        default: 'Varrock East',
        options: Object.keys(FIRE_SPOTS),
        label: 'Where to burn',
        help: 'each spot is a bank plus the longest clear west-running ground next to it'
    }
};

const TOOLS: readonly ToolReq[] = [exactTool(TINDERBOX)];

export default class Firemaker extends LoopingBot {
    override loopDelay = 600;

    private plot: FirePlot = FIRE_SPOTS['Varrock East'];
    private spotName = 'Varrock East';
    private logName = 'Logs';

    private lane = 0;
    private fires = 0;
    private trips = 0;
    private xpStart = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.spotName = this.settings.str('location', 'Varrock East');
        this.plot = FIRE_SPOTS[this.spotName];
        this.logName = this.settings.str('logType', 'Logs');
        this.xpStart = Skills.xp('firemaking');
        this.startedAt = Date.now();

        const need = LOG_LEVELS[this.logName];
        const have = Skills.level('firemaking');
        if (!this.plot || need === undefined) {
            ScriptRunner.stop(`unknown setting — logType='${this.logName}', location='${this.spotName}'`);
            return;
        }
        if (have < need) {
            ScriptRunner.stop(`${this.logName} need Firemaking ${need}, you have ${have}`);
            return;
        }
        this.log(`Firemaker — ${this.logName} at ${this.spotName}, plot x${this.plot.x0}-${this.plot.x1} z${this.plot.z0}-${this.plot.z1}`);
    }

    async loop(): Promise<void> {
        if (!(await this.bankLeg())) {
            return;
        }
        await this.burnLeg();
        this.trips++;
    }

    private setStatus(s: string): void {
        this.status = s;
    }

    private logsLeft(): number {
        return Inventory.count(this.logName);
    }

    private skillLevel = (skill: string): number => Skills.level(skill);
    private invCount = (name: string): number => Inventory.count(name);

    private async walkTo(dest: WorldTile, what: string, radius: number): Promise<boolean> {
        this.setStatus(`walking to ${what}`);
        return Traversal.walkResilient(dest, { radius, attempts: 3, timeoutMs: 120_000, log: m => this.log(`  ${m}`) });
    }

    private async bankLeg(): Promise<boolean> {
        const here = Game.tile();
        if (here && Math.max(Math.abs(here.x - this.plot.bank.x), Math.abs(here.z - this.plot.bank.z)) > 4 && !(await this.walkTo(this.plot.bank, `the ${this.spotName} bank`, 2))) {
            return false;
        }
        this.setStatus('banking');
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — retrying');
            return false;
        }

        await Bank.depositAllMatching(depositAllExcept(toolKeepNames(TOOLS)));
        const plan = toolRestockPlan(TOOLS, this.skillLevel, this.invCount, name => Bank.count(name));
        for (const step of plan) {
            await Bank.withdraw(step.name);
            if (!(await Execution.delayUntilTicks(() => Inventory.count(step.name) > 0, 5))) {
                ScriptRunner.stop(`no ${step.name} in the bank or pack`);
                return false;
            }
        }
        if (!hasAllTools(TOOLS, this.skillLevel, this.invCount)) {
            ScriptRunner.stop('no tinderbox in the bank or pack');
            return false;
        }
        if (!(await Bank.withdrawX(this.logName, reader.inventorySize() - Inventory.used()))) {
            ScriptRunner.stop(`no ${this.logName} left in the bank`);
            return false;
        }

        actions.closeModal();
        await Execution.delayUntilTicks(() => !Bank.isOpen(), 5);
        return this.logsLeft() > 0;
    }

    private occupied(): Set<string> {
        return new Set(reader.locs().map(l => tileKey(l.tile)));
    }

    private async gotoLane(): Promise<boolean> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const want = burnLaneWant(this.logsLeft());
            const found = findBurnLane(
                this.plot,
                Game.tile()!,
                this.occupied(),
                want,
                t => Reachability.walkable(t),
                (a, b) => Reachability.canStep(a, b)
            );
            if (!found) {
                this.log(`no clear ground left in the ${this.spotName} plot — waiting for fires to burn out`);
                this.setStatus('waiting for a clear lane');
                await Execution.delayTicks(25);
                continue;
            }
            const full = found.run >= want && isBurnWest(found.dir);
            this.setStatus(
                full
                    ? `walking to full lane ${found.start.x},${found.start.z} (${found.run} long)`
                    : `walking to tile ${found.start.x},${found.start.z} (${found.run} long)`
            );
            await this.walkTo(found.start, `lane ${found.start.x},${found.start.z}`, 0);

            const at = Game.tile();
            const ok = at !== null && inFirePlot(at, this.plot);
            const cap = isBurnWest(found.dir) ? want : 1;
            this.lane = ok
                ? runInDir(at!, this.plot, found.dir, this.occupied(), t => Reachability.walkable(t), (a, b) => Reachability.canStep(a, b), cap)
                : 0;
            if (this.lane > 0) {
                this.log(
                    `lane ${at!.x},${at!.z} dir ${found.dir.dx},${found.dir.dz} x${this.lane}` +
                        ` (wanted ${want} at ${found.start.x},${found.start.z}` +
                        (full ? ', full load)' : this.lane < want ? ', tight fallback)' : ')')
                );
                return true;
            }
            this.log(`stopped at ${at?.x},${at?.z}, which is ${ok ? 'not lightable' : 'outside the plot'} — rescanning`);
        }
        return false;
    }

    private async lightOne(): Promise<'lit' | 'blocked' | 'stalled'> {
        const logs = Inventory.first(this.logName);
        const tinder = Inventory.first(TINDERBOX);
        if (!logs || !tinder) {
            return 'stalled';
        }
        const mark = GameMessages.mark();
        const xp = Skills.xp('firemaking');
        const held = this.logsLeft();
        const lit = (): boolean => Skills.xp('firemaking') > xp;
        const blocked = (): boolean => GameMessages.sawSince(mark, CANT_LIGHT);

        // Use tinderbox → logs (same order as working quest/FM paths). Logs→tinderbox is a no-op.
        if (!(await tinder.useOn(logs))) {
            return 'stalled';
        }
        if (
            !(await Execution.delayUntilTicks(
                () => this.logsLeft() < held || blocked() || Game.animating(),
                FIRE_START_TICKS
            ))
        ) {
            return 'stalled';
        }
        if (
            !(await Execution.delayUntilTicks(
                () => lit() || blocked() || EventSignal.pending(),
                FIRE_LIGHT_TICKS
            ))
        ) {
            return 'stalled';
        }
        return blocked() ? 'blocked' : lit() ? 'lit' : 'stalled';
    }

    private async burnLeg(): Promise<void> {
        let stalls = 0;
        while (this.logsLeft() > 0) {
            if (EventSignal.pending()) {
                return;
            }
            if (this.lane <= 0 && !(await this.gotoLane())) {
                return;
            }
            this.setStatus(`burning ${this.logsLeft()} ${this.logName} (lane ${this.lane})`);
            const outcome = await this.lightOne();
            if (outcome === 'lit') {
                this.fires++;
                this.lane--;
                stalls = 0;
                await Execution.delayTicks(fireReactionTicks());
                continue;
            }
            this.lane = 0;
            if (outcome === 'blocked') {
                continue;
            }
            if (++stalls >= 3) {
                this.log('three lighting attempts went unanswered — rescanning from the bank');
                return;
            }
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e07a3f' });
        p.title(`Firemaker — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('firemaking') - this.xpStart;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Fires: ${this.fires}`, `Trips: ${this.trips}`);
        p.row(`Xp: ${xp}`, `Xp/hr: ${mins > 0.5 ? Math.round((xp / mins) * 60) : 0}`, `Logs: ${this.logsLeft()}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
