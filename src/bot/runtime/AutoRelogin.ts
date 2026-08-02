import { actions, reader } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { Credentials, type Creds } from './Credentials.js';
import { LoginBackoff } from './LoginBackoff.js';
import type { LoginCoordination } from './LoginCoordination.js';
import { ScriptRunner } from './ScriptRunner.js';

const FIRST_RETRY_MS = 6000;
const RECONNECT_INTERVAL_MS = 9000;
const BUSY_RETRY_MS = 250;
const MAX_ATTEMPTS = 15;

class AutoReloginImpl {
    private enabled = false;
    private autoLogin = false;

    private wasIngame = false;
    private reconnecting = false;
    private wePaused = false;
    private attempts = 0;
    private nextAttemptAt = 0;
    private backoff = new LoginBackoff();
    private rateLimitedAttempt = 0;
    private coordination: LoginCoordination | null = null;
    private waitingForPermit = false;

    enable(autoLogin = false): void {
        this.autoLogin = this.autoLogin || autoLogin;
        if (this.enabled) {
            return;
        }
        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    setAutoLogin(on: boolean): void {
        this.autoLogin = on;
        if (!on) {
            // Title-screen checkbox off must stop in-flight reconnect attempts (#215).
            // Script-active reconnect still uses scriptActive() separately.
            this.reconnecting = false;
            this.waitingForPermit = false;
            this.attempts = 0;
            this.nextAttemptAt = 0;
            this.rateLimitedAttempt = 0;
            this.backoff.reset();
        }
    }

    /** Whether title-screen auto-login is armed (UI should mirror this). */
    isAutoLogin(): boolean {
        return this.autoLogin;
    }

    setLoginCoordination(coordination: LoginCoordination | null): void {
        this.coordination = coordination;
        this.waitingForPermit = false;
    }

    setCredentials(username: string, password: string): void {
        if (username.length > 0) {
            Credentials.save(username, password);
        } else {
            Credentials.clear();
        }
    }

    private creds(): Creds | null {
        return Credentials.get();
    }

    loginNow(): boolean {
        const c = this.creds();
        if (!c || reader.ingame() || (this.coordination !== null && !this.coordination.requestPermit())) {
            return false;
        }
        return actions.login(c.username, c.password);
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
            const live = actions.loginCredentials();
            const saved = this.creds();
            if (live.username.length > 0 && (!saved || live.username !== saved.username || live.password !== saved.password)) {
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
                this.waitingForPermit = false;
            }

            this.wasIngame = true;
            return;
        }

        const c = this.creds();
        const wantLogin = c !== null && (this.autoLogin || this.scriptActive() || this.reconnecting);

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
        }

        if (!this.reconnecting || !c) {
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
            this.waitingForPermit = false;
            return;
        }

        if (this.coordination !== null && !this.coordination.requestPermit()) {
            if (!this.waitingForPermit) {
                this.waitingForPermit = true;
                this.log('info', 'auto-login: queued by multibox login coordinator');
            }
            return;
        }

        this.waitingForPermit = false;
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
