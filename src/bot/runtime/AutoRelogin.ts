import { actions, reader } from '../adapter/ClientAdapter.js';
import { BotHost } from './BotHost.js';
import { Credentials } from './Credentials.js';
import { LoginBackoff } from './LoginBackoff.js';
import type {
    LoginCoordination,
    LoginQueueStatus
} from './LoginCoordination.js';
import { ScriptRunner } from './ScriptRunner.js';

const FIRST_RETRY_MS = 6000;
const RECONNECT_INTERVAL_MS = 9000;
const BUSY_RETRY_MS = 250;
const MAX_ATTEMPTS = 15;

class AutoReloginImpl {
    private enabled = false;
    private autoLogin = false;
    private autoLoginListeners = new Set<(on: boolean) => void>();

    private wasIngame = false;
    private reconnecting = false;
    private wePaused = false;
    private attempts = 0;
    private nextAttemptAt = 0;
    private backoff = new LoginBackoff();
    private rateLimitedAttempt = 0;
    private coordination: LoginCoordination | null = null;

    enable(autoLogin = false): void {
        // Notify UI even when already enabled, Multibox / URL may arm after the panel paints (#215).
        if (autoLogin && !this.autoLogin) {
            this.setAutoLogin(true);
        }
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    setAutoLogin(on: boolean): void {
        const was = this.autoLogin;
        this.autoLogin = on;
        // Title checkbox off stops title-only reconnects. A running/paused script
        // still reconnects via scriptActive(), do not clear that mid-flight (#215).
        if (!on && !this.scriptActive()) {
            this.clearReconnect();
        }
        if (was !== on) {
            for (const cb of this.autoLoginListeners) {
                cb(on);
            }
        }
    }

    /** Whether title-screen auto-login is armed (UI should mirror this). */
    isAutoLogin(): boolean {
        return this.autoLogin;
    }

    /** Keep the Global checkbox in sync when Multibox / URL / console arms the flag. */
    onAutoLoginChange(cb: (on: boolean) => void): () => void {
        this.autoLoginListeners.add(cb);
        return () => {
            this.autoLoginListeners.delete(cb);
        };
    }

    private clearReconnect(): void {
        this.reconnecting = false;
        this.wePaused = false;
        this.cancelQueuedLogin();
        this.attempts = 0;
        this.nextAttemptAt = 0;
        this.rateLimitedAttempt = 0;
        this.backoff.reset();
    }

    /** Live FIFO position while waiting for the shared multibox login permit. */
    loginQueueStatus(): LoginQueueStatus | null {
        return this.coordination?.queueStatus() ?? null;
    }

    setLoginCoordination(coordination: LoginCoordination | null): void {
        if (coordination === this.coordination) {
            return;
        }
        this.cancelQueuedLogin();
        this.coordination = coordination;
    }

    setCredentials(username: string, password: string): void {
        if (username.length > 0) {
            Credentials.save(username, password);
        } else {
            Credentials.clear();
            this.cancelQueuedLogin();
        }
    }

    loginNow(): boolean {
        const c = Credentials.get();
        if (!c || reader.ingame()) {
            return false;
        }
        if (this.coordination !== null) {
            const wasQueued = this.coordination.queueStatus() !== null;
            if (!this.coordination.requestPermit()) {
                if (!wasQueued) {
                    this.coordination.leaveQueue();
                }
                return false;
            }
        }
        return actions.login(c.username, c.password);
    }

    private cancelQueuedLogin(): void {
        this.coordination?.leaveQueue();
    }

    private scriptActive(): boolean {
        const state = ScriptRunner.state;
        return state === 'running' || state === 'paused';
    }

    private log(level: 'info' | 'warn' | 'error', msg: string): void {
        ScriptRunner.ctx?.addLog(level, msg);
        if (!ScriptRunner.ctx) {
            console.log(`[rs2b0t] ${msg}`);
        }
    }

    private onFrame(): void {
        if (reader.ingame()) {
            this.cancelQueuedLogin();
            const live = actions.loginCredentials();
            if (live.username.length > 0) {
                this.setCredentials(live.username, live.password);
            }

            if (this.reconnecting && reader.sceneState() === 2) {
                this.log('info', `auto-relogin: back ingame as '${live.username}' after ${this.attempts} attempt(s)`);
                if (this.wePaused) {
                    ScriptRunner.resume();
                }
                this.reconnecting = false;
                this.wePaused = false;
                this.attempts = 0;
                this.backoff.reset();
                this.rateLimitedAttempt = 0;
            }

            this.wasIngame = true;
            return;
        }

        const c = Credentials.get();
        // Why: title-screen auto-login is checkbox-only, and a running or paused script still reconnects after a disconnect so unattended scripts survive a DC (#215).
        // Why: mid-reconnect must not keep logging in once the script is stopped and the checkbox is off, which read as "cannot turn off autologin" in Multibox.
        const wantLogin = c !== null && (this.autoLogin || this.scriptActive());

        if (this.wasIngame) {
            this.wasIngame = false;
            if (wantLogin) {
                this.reconnecting = true;
                this.attempts = 0;
                this.nextAttemptAt = performance.now() + FIRST_RETRY_MS;
                if (ScriptRunner.state === 'running') {
                    ScriptRunner.pause();
                    this.wePaused = true;
                }
                this.log('warn', `disconnected — logging back in as '${c?.username}'`);
            }
        } else if (wantLogin && !this.reconnecting) {
            this.reconnecting = true;
            this.attempts = 0;
            this.nextAttemptAt = performance.now();
        } else if (this.reconnecting && !wantLogin) {
            this.clearReconnect();
            return;
        }

        if (!this.reconnecting || !c) {
            this.cancelQueuedLogin();
            return;
        }

        const loginMessage = reader.loginMessage();
        const rateLimited = loginMessage.startsWith('Login attempts exceeded') || loginMessage.startsWith('Login limit exceeded');
        if (this.attempts > 0 && this.rateLimitedAttempt !== this.attempts && rateLimited) {
            this.rateLimitedAttempt = this.attempts;
            const holdMs = this.backoff.next();
            this.nextAttemptAt = performance.now() + holdMs;
            this.coordination?.holdFor(holdMs);
            this.log('warn', `auto-login: rate limited by server — holding off ${Math.round(holdMs / 1000)}s`);
        }

        if (performance.now() < this.nextAttemptAt) {
            return;
        }

        if (this.attempts >= MAX_ATTEMPTS) {
            this.log('error', `auto-login: giving up after ${MAX_ATTEMPTS} attempts`);
            this.reconnecting = false;
            this.cancelQueuedLogin();
            return;
        }

        if (this.coordination !== null) {
            const wasQueued = this.loginQueueStatus() !== null;
            if (!this.coordination.requestPermit()) {
                if (!wasQueued) {
                    this.log('info', 'auto-login: queued by multibox login coordinator');
                }
                return;
            }
        }

        if (!actions.login(c.username, c.password)) {
            this.nextAttemptAt = performance.now() + BUSY_RETRY_MS;
            return;
        }

        this.attempts++;
        this.nextAttemptAt = performance.now() + RECONNECT_INTERVAL_MS;
        this.log('info', `auto-login: attempt ${this.attempts}/${MAX_ATTEMPTS} as '${c.username}'`);
    }
}

export const AutoRelogin = new AutoReloginImpl();
