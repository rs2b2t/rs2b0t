
import type { Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Reachability } from '../api/Reachability.js';
import { Traversal } from '../api/Traversal.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { reader } from '../adapter/ClientAdapter.js';
import { GameMessages } from '../events/gameMessages.js';
import {
    CANT_LIGHT,
    FIRE_LIGHT_MS,
    FIRE_START_MS,
    TINDERBOX,
    findBurnLane,
    fireReactionMs,
    inFirePlot,
    runWest,
    shouldBurnFullLoad,
    tileKey,
    type FirePlot
} from './FiremakingLogic.js';

export interface ChopBurnHost {
    log(msg: string): void;
    setStatus(s: string): void;
    burnEnabled(): boolean;
    isBurningLoad(): boolean;
    beginBurningLoad(): void;
    endBurningLoad(): void;
    recordFire(n?: number): void;
    burnPlotOrNull(): FirePlot | null;
    burnLogName(): string;
    burnLaneLeft(): number;
    setBurnLaneLeft(n: number): void;
    hasTinderbox(): boolean;
    logCount(): number;
    isPowerMode(): boolean;
}

export function createChopBurnTasks(bot: ChopBurnHost): Task[] {
    return [new ChopBurnLoad(bot)];
}

function occupied(): Set<string> {
    return new Set(reader.locs().map(l => tileKey(l.tile)));
}

class ChopBurnLoad implements Task {
    constructor(private bot: ChopBurnHost) {}

    validate(): boolean {
        if (!this.bot.burnEnabled() || this.bot.isPowerMode()) {
            return false;
        }
        if (EventSignal.pending() || Game.inCombat()) {
            return false;
        }
        if (this.bot.isBurningLoad()) {
            return this.bot.logCount() > 0 && this.bot.hasTinderbox();
        }
        return shouldBurnFullLoad(
            'chop-then-burn',
            Inventory.isFull(),
            this.bot.logCount(),
            this.bot.hasTinderbox()
        );
    }

    async execute(): Promise<void> {
        const plot = this.bot.burnPlotOrNull();
        if (!plot) {
            this.bot.log('burn: no fire plot — skipping');
            this.bot.endBurningLoad();
            return;
        }
        if (!this.bot.hasTinderbox()) {
            this.bot.setStatus('burn: need tinderbox');
            this.bot.log('burn: need tinderbox — restock will fetch');
            this.bot.endBurningLoad();
            return;
        }

        this.bot.beginBurningLoad();
        let stalls = 0;

        while (this.bot.logCount() > 0) {
            if (EventSignal.pending() || Game.inCombat()) {
                return;
            }
            if (this.bot.burnLaneLeft() <= 0 && !(await this.gotoLane(plot))) {

                this.bot.log('burn: no clear lane — banking logs');
                this.bot.endBurningLoad();
                return;
            }

            this.bot.setStatus(`burn: ${this.bot.logCount()} ${this.bot.burnLogName()} (lane ${this.bot.burnLaneLeft()})`);
            const outcome = await this.lightOne();
            if (outcome === 'lit') {
                this.bot.recordFire(1);
                this.bot.setBurnLaneLeft(this.bot.burnLaneLeft() - 1);
                stalls = 0;
                await Execution.delay(fireReactionMs());
                continue;
            }
            this.bot.setBurnLaneLeft(0);
            if (outcome === 'blocked') {
                continue;
            }
            if (++stalls >= 3) {
                this.bot.log('burn: three stalls — ending load');
                this.bot.endBurningLoad();
                return;
            }
        }

        this.bot.endBurningLoad();
        this.bot.log('burn: load finished');
    }

    private async gotoLane(plot: FirePlot): Promise<boolean> {
        const here0 = Game.tile();
        if (!here0) {
            return false;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            const want = this.bot.logCount();
            const found = findBurnLane(
                plot,
                Game.tile()!,
                occupied(),
                want,
                t => Reachability.walkable(t),
                (a, b) => Reachability.canStep(a, b)
            );
            if (!found) {
                this.bot.setStatus('burn: waiting for clear lane');
                await Execution.delayTicks(15);
                continue;
            }
            this.bot.setStatus(`burn: walk to lane ${found.start.x},${found.start.z}`);
            await Traversal.walkResilient(found.start, {
                radius: 0,
                attempts: 2,
                timeoutMs: 60_000,
                log: m => this.bot.log(`  ${m}`)
            });
            const at = Game.tile();
            const ok = at !== null && inFirePlot(at, plot);
            const lane = ok
                ? runWest(at!, plot, occupied(), t => Reachability.walkable(t), (a, b) => Reachability.canStep(a, b), want)
                : 0;
            this.bot.setBurnLaneLeft(lane);
            if (lane > 0) {
                this.bot.log(`burn: lane ${at!.x},${at!.z} west x${lane}`);
                return true;
            }
        }
        return false;
    }

    private async lightOne(): Promise<'lit' | 'blocked' | 'stalled'> {
        const logs = Inventory.first(this.bot.burnLogName());
        const tinder = Inventory.first(TINDERBOX);
        if (!logs || !tinder) {
            return 'stalled';
        }
        const mark = GameMessages.mark();
        const xp = Skills.xp('firemaking');
        const held = this.bot.logCount();
        const lit = (): boolean => Skills.xp('firemaking') > xp;
        const blocked = (): boolean => GameMessages.sawSince(mark, CANT_LIGHT);

        await logs.useOn(tinder);
        if (!(await Execution.delayUntil(() => this.bot.logCount() < held || blocked(), FIRE_START_MS))) {
            return 'stalled';
        }
        if (!(await Execution.delayUntil(() => lit() || blocked() || EventSignal.pending(), FIRE_LIGHT_MS))) {
            return 'stalled';
        }
        return blocked() ? 'blocked' : lit() ? 'lit' : 'stalled';
    }
}
