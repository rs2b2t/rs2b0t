import { actions, reader } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { Credentials, type Creds } from './Credentials.js';
import { LoginBackoff } from './LoginBackoff.js';
import { ScriptRunner } from './ScriptRunner.js';

const FIRST_RETRY_MS = 6000;
const RECONNECT_INTERVAL_MS = 9000;
const MAX_ATTEMPTS = 15;

class AutoReloginImpl {
    private enabled = false;
    private autoLogin = false;
    private username = '';
    private password = '';

    private wasIngame = false;
    private reconnecting = false;
    private wePaused = false;
    private attempts = 0;
    private nextAttemptAt = 0;
    private backoff = new LoginBackoff();
    private rateLimitedAttempt = 0;

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
    }

    setCredentials(username: string, password: string): void {
        this.username = username;
        this.password = password;
    }

    private creds(): Creds | null {
        if (this.username.length > 0) {
            return { username: this.username, password: this.password };
        }
        return Credentials.get();
    }

    loginNow(): boolean {
        const c = this.creds();
        if (!c || reader.ingame()) {
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
            if (live.username.length > 0) {
                this.username = live.username;
                this.password = live.password;
            }

            if (this.reconnecting && reader.sceneState() === 2) {
                this.log('info', `auto-relogin: back ingame as '${this.username}' after ${this.attempts} attempt(s)`);
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

        if (this.attempts > 0 && this.rateLimitedAttempt !== this.attempts && reader.loginMessage().startsWith('Login attempts exceeded')) {
            this.rateLimitedAttempt = this.attempts;
            const holdMs = this.backoff.next();
            this.nextAttemptAt = performance.now() + holdMs;
            this.log('warn', `auto-login: rate limited by server — holding off ${Math.round(holdMs / 1000)}s`);
        }

        if (performance.now() < this.nextAttemptAt) {
            return;
        }

        if (this.attempts >= MAX_ATTEMPTS) {
            this.log('error', `auto-login: giving up after ${MAX_ATTEMPTS} attempts`);
            this.reconnecting = false;
            return;
        }

        this.attempts++;
        this.nextAttemptAt = performance.now() + RECONNECT_INTERVAL_MS;
        this.log('info', `auto-login: attempt ${this.attempts}/${MAX_ATTEMPTS} as '${c.username}'`);
        actions.login(c.username, c.password);
    }
}

export const AutoRelogin = new AutoReloginImpl();
