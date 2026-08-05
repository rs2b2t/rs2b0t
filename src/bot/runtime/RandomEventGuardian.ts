import { Game } from '../api/Game.js';
import { RandomEvents } from '../api/RandomEvents.js';
import { BotHost } from '../BotHost.js';
import { ScriptRunner } from './ScriptRunner.js';

/**
 * Always-on random-event solver while the scene is live (`ingame` + sceneState 2),
 * **whether or not a script is running**.
 *
 * Scripted bots still yield via Supervisor / EventSignal; this covers AFK players
 * and the gap between script loops. Work is tick-gated and single-flight.
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
        BotHost.addFrameListener(() => {
            void this.onFrame();
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

    private async onFrame(): Promise<void> {
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
        if (!RandomEvents.detect()) {
            return;
        }
        this.lastKickTick = tick;
        this.inFlight = true;
        try {
            await RandomEvents.handle(msg => this.log(msg));
        } catch (err) {
            console.error('[rs2b0t] RandomEventGuardian error', err);
        } finally {
            this.inFlight = false;
        }
    }
}

export const RandomEventGuardian = new RandomEventGuardianImpl();