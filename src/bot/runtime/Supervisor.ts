import { reader, type WorldTile } from '../adapter/ClientAdapter.js';
import type { AbstractBot } from '../api/Bot.js';
import { RandomEvents } from '../api/RandomEvents.js';
import { Traversal } from '../api/Traversal.js';
import { bus } from '../events/EventBus.js';
import { WalkExecutor } from '../nav/WalkExecutor.js';
import { ScriptAborted, type ScriptContext } from './ScriptContext.js';
import { StallGuard } from './StallGuard.js';

const WEDGE_MS = 10 * 60_000;
const RETRY_MS = 15 * 60_000;

interface SupervisorIteration {
    label: string;
    run: () => Promise<void>;
}

class SupervisorImpl {
    private lastProgressAt = performance.now();
    private lastTile: WorldTile | null = null;
    private lastRecoveryAt = 0;

    constructor() {
        bus.on('skill.xp', () => (this.lastProgressAt = performance.now()));
    }

    resetProgress(): void {
        this.lastProgressAt = performance.now();
        this.lastTile = null;
        this.lastRecoveryAt = 0;
    }

    private sampleProgress(): void {
        const t = reader.worldTile();
        if (t && (!this.lastTile || t.x !== this.lastTile.x || t.z !== this.lastTile.z || t.level !== this.lastTile.level)) {
            this.lastTile = t;
            this.lastProgressAt = performance.now();
        }
    }

    intercept(ctx: ScriptContext, bot: AbstractBot): SupervisorIteration | null {
        const event = RandomEvents.detect();
        if (event) {
            const label = `${event.kind}: ${event.name}`;
            if (ctx.activeEvent === null) {
                ctx.addLog('warn', `⚡ random event: ${event.name} — script paused`);
            }
            ctx.activeEvent = label;
            return {
                label,
                run: async () => {
                    try {
                        await RandomEvents.handle(msg => ctx.addLog('info', msg));
                    } catch (err) {
                        if (err instanceof ScriptAborted) {
                            throw err;
                        }
                        ctx.addLog('error', `event handler (${label}) threw: ${err instanceof Error ? err.message : String(err)} — ignoring; attempt/cooldown backstop applies`);
                    }
                }
            };
        }

        if (ctx.activeEvent !== null) {
            ctx.activeEvent = null;
            ctx.addLog('info', 'random event cleared — resuming script');
        }

        this.sampleProgress();
        const now = performance.now();
        if (now - this.lastProgressAt > WEDGE_MS && now - this.lastRecoveryAt > RETRY_MS) {
            this.lastRecoveryAt = now;
            return {
                label: 'watchdog recovery',
                run: async () => {
                    const anchor = bot.recoveryAnchor?.() ?? null;
                    const me = reader.worldTile();
                    ctx.addLog('warn', `watchdog: no progress for ${Math.round(WEDGE_MS / 60000)}min at (${me?.x},${me?.z},${me?.level})`);
                    if (anchor && me && Math.max(Math.abs(anchor.x - me.x), Math.abs(anchor.z - me.z)) > 8) {
                        ctx.addLog('info', 'watchdog: walking back to the anchor');
                        const ok = await Traversal.walkResilient(anchor, { radius: 3, attempts: 3, log: msg => ctx.addLog('info', msg) });
                        if (ok) {
                            this.lastProgressAt = performance.now();
                            return;
                        }
                        if (WalkExecutor.lastOutcome === 'interrupted') {
                            ctx.addLog('info', 'watchdog: walk home interrupted by a random event — deferring');
                            return;
                        }
                        ctx.addLog('warn', 'watchdog: walk home failed — requesting script restart');
                    } else {
                        ctx.addLog('warn', 'watchdog: wedged near anchor (or no anchor) — requesting script restart');
                    }
                    StallGuard.requestRestart('watchdog: no progress');
                }
            };
        }
        return null;
    }
}

export const Supervisor = new SupervisorImpl();
