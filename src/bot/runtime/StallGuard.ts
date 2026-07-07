import { BotHost } from '../BotHost.js';
import { RecoveryHints } from './RecoveryHints.js';
import { ScriptRunner } from './ScriptRunner.js';

const HARD_STALL_MS = 15 * 60_000; // no loop completion for this long ⇒ hung await

/**
 * Tier-2 stall recovery (host-side, off the frame hook like AutoRelogin).
 * Triggers: an explicit requestRestart() from the Supervisor watchdog, or a
 * hard stall — ctx.lastProgressAt frozen because an await never settles
 * (tier 1 can't run then). Recovery = stop + restart the same script with
 * RecoveryHints.pendingRecovery set so anchored scripts re-anchor correctly
 * and walk themselves home.
 */
class StallGuardImpl {
    private enabled = false;
    private restartPending = false;

    enable(): void {
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    requestRestart(reason: string): void {
        if (this.restartPending || !ScriptRunner.meta) {
            return;
        }
        ScriptRunner.ctx?.addLog('warn', `stall guard: restarting script — ${reason}`);
        this.restartPending = true;
        ScriptRunner.stop();
    }

    private onFrame(): void {
        const ctx = ScriptRunner.ctx;
        const meta = ScriptRunner.meta;
        if (!ctx || !meta) {
            return;
        }

        if (this.restartPending) {
            if (ctx.state === 'stopped' || ctx.state === 'crashed') {
                this.restartPending = false;
                RecoveryHints.pendingRecovery = true;
                ScriptRunner.start(meta);
            }
            return;
        }

        if (ctx.state === 'running' && performance.now() - ctx.lastProgressAt > HARD_STALL_MS) {
            this.requestRestart(`no loop progress for ${Math.round(HARD_STALL_MS / 60000)}min (hung await?)`);
        }
    }
}

export const StallGuard = new StallGuardImpl();
