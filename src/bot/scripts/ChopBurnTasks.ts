
import type { Task } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Reachability } from '../api/Reachability.js';
import { Traversal } from '../api/Traversal.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Npcs } from '../api/queries/Npcs.js';
import { reader } from '../adapter/ClientAdapter.js';
import { GameMessages } from '../events/gameMessages.js';
import {
    CANT_LIGHT,
    FIRE_LIGHT_TICKS,
    FIRE_START_TICKS,
    TINDERBOX,
    burnLaneWant,
    findBurnLane,
    fireReactionTicks,
    inFirePlot,
    isBurnWest,
    runInDir,
    shouldBurnFullLoad,
    tileKey,
    type BurnDir,
    type FirePlot
} from './FiremakingLogic.js';

/** Same face-target filter as GatheringBot.FleeCombat — sticky combatCycle is ignored. */
function hostileFaceTarget(): boolean {
    return (
        Npcs.query()
            .where(n => n.inCombat && n.targetsMe() && n.actions().includes('Attack'))
            .nearest() !== null
        || Npcs.query()
            .where(
                n =>
                    n.inCombat
                    && !n.targetsAnotherPlayer()
                    && n.actions().includes('Attack')
                    && n.distance() <= 2
            )
            .nearest() !== null
    );
}

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
    /** Auto start-area burn: repath/expand instead of banking leftover logs. */
    isLocalBurn?(): boolean;
    tryExpandBurnPlot?(): boolean;
}

export function createChopBurnTasks(bot: ChopBurnHost): Task[] {
    return [new ChopBurnLoad(bot)];
}

function occupied(): Set<string> {
    return new Set(reader.locs().map(l => tileKey(l.tile)));
}

class ChopBurnLoad implements Task {
    private laneDir: BurnDir = { dx: -1, dz: 0 };

    constructor(private bot: ChopBurnHost) {}

    validate(): boolean {
        if (!this.bot.burnEnabled() || this.bot.isPowerMode()) {
            return false;
        }
        if (EventSignal.pending()) {
            return false;
        }
        // Real attackers: FleeCombat owns the loop. Sticky combatCycle alone must not
        // freeze chop-then-burn for minutes (Draynor harness thrash).
        if (Game.inCombat() && hostileFaceTarget()) {
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
        let plot = this.bot.burnPlotOrNull();
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
        let laneFails = 0;
        const local = this.bot.isLocalBurn?.() === true;

        while (this.bot.logCount() > 0) {
            if (EventSignal.pending() || (Game.inCombat() && hostileFaceTarget())) {
                // Yield to FleeCombat / events. If we have already walked off the
                // burn plot (Jail guard kite), end the load so we can re-enter
                // chop-then-burn near the plot after combat instead of soft-locking
                // with burningLoad=true and no lights.
                const here = Game.tile();
                const p = this.bot.burnPlotOrNull();
                if (
                    here
                    && p
                    && !inFirePlot(here, p)
                    && Math.max(
                        Math.abs(here.x - Math.floor((p.x0 + p.x1) / 2)),
                        Math.abs(here.z - Math.floor((p.z0 + p.z1) / 2))
                    ) > 16
                ) {
                    this.bot.log('burn: combat kite left the plot — ending load to re-camp');
                    this.bot.endBurningLoad();
                }
                return;
            }
            plot = this.bot.burnPlotOrNull() ?? plot;
            if (this.bot.burnLaneLeft() <= 0 && !(await this.gotoLane(plot))) {
                if (local && this.bot.tryExpandBurnPlot?.()) {
                    laneFails = 0;
                    continue;
                }
                if (local && laneFails < 4) {
                    laneFails++;
                    this.bot.setStatus('burn: waiting for clear tiles');
                    this.bot.log(`burn: no clear lane — repath wait (${laneFails}/4)`);
                    await Execution.delayTicks(20);
                    continue;
                }
                // Named bank strips (or exhausted local): stop burning this load; bank leftover logs.
                this.bot.log(local ? 'burn: no space left near start — banking leftover logs' : 'burn: no clear lane — banking logs');
                this.bot.endBurningLoad();
                return;
            }

            this.bot.setStatus(`burn: ${this.bot.logCount()} ${this.bot.burnLogName()} (lane ${this.bot.burnLaneLeft()})`);
            const outcome = await this.lightOne();
            if (outcome === 'lit') {
                this.bot.recordFire(1);
                this.bot.setBurnLaneLeft(this.bot.burnLaneLeft() - 1);
                stalls = 0;
                laneFails = 0;
                await Execution.delayTicks(fireReactionTicks());
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
            const want = burnLaneWant(this.bot.logCount());
            const live = this.bot.burnPlotOrNull() ?? plot;
            const found = findBurnLane(
                live,
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
            this.laneDir = found.dir;
            const full = found.run >= want && isBurnWest(found.dir);
            this.bot.setStatus(
                full
                    ? `burn: walk to full lane ${found.start.x},${found.start.z} x${found.run}`
                    : `burn: walk to tile ${found.start.x},${found.start.z} (lane x${found.run})`
            );
            await Traversal.walkResilient(found.start, {
                radius: 0,
                attempts: 2,
                timeoutMs: 60_000,
                log: m => this.bot.log(`  ${m}`)
            });
            const at = Game.tile();
            const ok = at !== null && inFirePlot(at, live);
            // Re-measure from where we stopped. Non-west is single-tile only (client shoves west).
            const cap = isBurnWest(this.laneDir) ? want : 1;
            const lane = ok
                ? runInDir(
                      at!,
                      live,
                      this.laneDir,
                      occupied(),
                      t => Reachability.walkable(t),
                      (a, b) => Reachability.canStep(a, b),
                      cap
                )
                : 0;
            this.bot.setBurnLaneLeft(lane);
            if (lane > 0) {
                this.bot.log(
                    `burn: lane ${at!.x},${at!.z} dir ${this.laneDir.dx},${this.laneDir.dz} x${lane}` +
                        (full ? ' (full load)' : lane < want ? ' (tight — light wherever)' : '')
                );
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

        // Use tinderbox → logs (same order as working quest/FM paths). Logs→tinderbox is a no-op.
        if (!(await tinder.useOn(logs))) {
            return 'stalled';
        }
        if (
            !(await Execution.delayUntilTicks(
                () => this.bot.logCount() < held || blocked() || Game.animating(),
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
}
