import { Game } from '../api/Game.js';
import { RandomEvents } from '../api/RandomEvents.js';
import { BotHost } from '../BotHost.js';
import { Scheduler } from './Scheduler.js';
import { ScriptRunner } from './ScriptRunner.js';

/**
 * Always-on random-event solver while the scene is live (`ingame` + sceneState 2),
 * **whether or not a script is running**.
 *
 * Scripted bots still yield via Supervisor / EventSignal; this covers AFK players,
 * paused scripts, and the gap between script loops.
 *
 * Waits go through {@link Scheduler.runHost} so they settle on hostWaiters even
 * when a script context is active (script waiters freeze while paused / not running).
 * Work is tick-gated and single-flight with Supervisor.
 */
class RandomEventGuardianImpl {
    private enabled = false;
    private inFlight = false;
    private lastKickTick = -1;

    enable(): void {
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        // Frames settle Execution waits; ticks catch events even if the tab is
        // background-throttled and frames are sparse (packets still arrive).
        BotHost.addFrameListener(() => {
            void this.kick();
        });
        BotHost.addTickListener(() => {
            void this.kick();
        });
    }

    private log(msg: string): void {
        const ctx = ScriptRunner.ctx;
        if (ctx) {
            ctx.addLog('info', msg);
            return;
        }
        console.log(`[rs2b0t] ${msg}`);
    }

    private async kick(): Promise<void> {
        if (this.inFlight || RandomEvents.handling) {
            return;
        }
        // Same readiness gate as ScriptRunner / Game.sceneReady — sceneState === 2.
        if (!Game.sceneReady()) {
            return;
        }
        const tick = BotHost.tickCount;
        if (tick === this.lastKickTick) {
            return;
        }
        // Stamp before detecting, not after: events only arrive on server packets,
        // so one scan per tick is as responsive as one per frame. Stamping after a
        // successful detect left the guard permanently disarmed for the common case
        // (nothing found), and detectRaw() -- two NPC passes plus a full loc scan --
        // then ran on every frame of all 27 bots.
        this.lastKickTick = tick;
        const event = RandomEvents.detect();
        if (!event) {
            return;
        }
        this.inFlight = true;
        const ctx = ScriptRunner.ctx;
        const watchdogHold = `random event: ${event.kind}: ${event.name}`;
        if (ctx) {
            ctx.watchdogHold = watchdogHold;
        }
        try {
            // Host scope: never park guardian delays on a (possibly paused) script queue.
            await Scheduler.runHost(() => RandomEvents.handle(msg => this.log(msg)));
        } catch (err) {
            console.error('[rs2b0t] RandomEventGuardian error', err);
        } finally {
            if (ctx?.watchdogHold === watchdogHold) {
                ctx.watchdogHold = null;
            }
            this.inFlight = false;
        }
    }
}

export const RandomEventGuardian = new RandomEventGuardianImpl();
