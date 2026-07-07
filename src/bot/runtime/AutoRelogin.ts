import { actions, reader } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { Credentials, type Creds } from './Credentials.js';
import { LoginBackoff } from './LoginBackoff.js';
import { ScriptRunner } from './ScriptRunner.js';

const FIRST_RETRY_MS = 6000; // delay before the first reconnect attempt
const RECONNECT_INTERVAL_MS = 9000; // spacing between attempts (non-overlapping)
const MAX_ATTEMPTS = 15;

/**
 * Login keeper (Slice 7 + credential store). While ingame it captures the
 * live session credentials (Client.logout() clears them); on a drop to the
 * title screen it logs back in with backoff (the server rejects "already
 * online" for ~10s) and resumes the running script. Credentials fall back to
 * the locally-saved ones (Credentials), so it works even on a fresh page or
 * after the in-memory creds were wiped.
 *
 * With auto-login enabled (panel toggle / ?autologin=1) it also logs in from
 * the title screen unprompted whenever saved credentials exist — for fully
 * unattended operation. Host-side: runs off the frame hook.
 */
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

    /** Inject per-instance credentials (MultiBox) so creds() never falls back
     *  to the shared localStorage key. Set BEFORE arming auto-login. */
    setCredentials(username: string, password: string): void {
        this.username = username;
        this.password = password;
    }

    /** Best credentials: the live session's, else the locally-saved ones. */
    private creds(): Creds | null {
        if (this.username.length > 0) {
            return { username: this.username, password: this.password };
        }
        return Credentials.get();
    }

    /** Explicit login (panel "Log in" button): log in now if on the title screen. */
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
            console.log(`[lcbuddy] ${msg}`);
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

        // --- on the title screen ---
        const c = this.creds();
        // re-login if a script was running (mid-session drop) OR auto-login is
        // on and we have saved credentials
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
            // fresh title screen (e.g. page load) with saved creds + auto-login
            this.reconnecting = true;
            this.attempts = 0;
            this.nextAttemptAt = performance.now();
        }

        if (!this.reconnecting || !c) {
            return;
        }

        // response 16: the server's per-IP rate-limit counters are sliding
        // windows that every attempt refreshes, so retrying on the normal
        // cadence keeps the IP locked forever (and poisons it for every other
        // client behind it — all clients share uid 1337). Hold off instead.
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
        // flat spacing: wide enough that a login handshake fully completes (or
        // fails) before the next attempt — overlapping login() calls stomp on
        // each other's connection and never finish. Also clears the server's
        // ~10s already-online window within a couple of tries.
        this.nextAttemptAt = performance.now() + RECONNECT_INTERVAL_MS;
        this.log('info', `auto-login: attempt ${this.attempts}/${MAX_ATTEMPTS} as '${c.username}'`);
        actions.login(c.username, c.password);
    }
}

export const AutoRelogin = new AutoReloginImpl();
