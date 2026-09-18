import type { KqTile } from './kqEvidence.js';

export interface CleanupSample {
    at: number; ingame: boolean | null; sceneReady: boolean; tile: KqTile | null; serverTile: KqTile | null;
    hp: number; inCombat: boolean; runner: string; chat: string[]; deathChatCount?: number;
}
export interface CleanupAction { player: number; kind: 'retreat' | 'teleport' | 'pause' | 'stop' | 'logout'; at: number; resume?: boolean }

const safe = (s: CleanupSample) => s.ingame === true && s.sceneReady && s.serverTile?.level === 0 && !s.inCombat
    && [[3308, 3120, 10], [2757, 3478, 12], [3315, 3235, 12], [3221, 3218, 25]].some(([x, z, radius]) => Math.max(Math.abs(s.serverTile!.x - x), Math.abs(s.serverTile!.z - z)) <= radius);

export class KqCleanup {
    readonly deaths: { player: number; at: number; hp: number; chat: string[] }[] = [];
    readonly fixtureTeleports: { player: number; at: number; reason: string }[] = [];
    readonly failures: string[] = [];
    readonly actions: (CleanupAction & { succeeded?: boolean; error?: string })[] = [];
    private latest: CleanupSample[] = [];
    private expired = false;
    private readonly players: { requested: boolean; failedRetreat: boolean; pending?: CleanupAction; lastKind?: CleanupAction['kind']; lastAt: number; loggedOut: boolean; deathChats: number; zeroHp: boolean }[];

    constructor(count: number, private readonly startedAt: number, private capture = false, knownDeaths: { player: number; chatCount: number; zeroHp: boolean }[] = []) {
        this.players = Array.from({ length: count }, (_, i) => ({ requested: false, failedRetreat: false, lastAt: -Infinity, loggedOut: false,
            deathChats: knownDeaths.find(d => d.player === i)?.chatCount ?? 0, zeroHp: knownDeaths.find(d => d.player === i)?.zeroHp ?? false }));
    }

    get loggedOut(): number { return this.players.filter(p => p.loggedOut).length; }
    get finished(): boolean { return this.expired || this.loggedOut === this.players.length; }
    get captureReady(): boolean {
        return this.capture && this.latest.length === this.players.length && this.latest.every(s => s.ingame === false || safe(s) && !['running', 'stopping'].includes(s.runner));
    }
    releaseCapture(): void { this.capture = false; }

    observe(samples: CleanupSample[]): CleanupAction[] {
        if (samples.length !== this.players.length) throw new Error('Missing cleanup observations');
        this.latest = samples;
        const actions: CleanupAction[] = [];
        samples.forEach((s, i) => {
            if (s.ingame !== null) this.players[i].loggedOut = s.ingame === false;
        });
        if (Math.max(...samples.map(s => s.at)) - this.startedAt >= 120_000) {
            this.expired = true;
            this.players.forEach((p, i) => {
                if (!p.loggedOut) this.fail(`Player ${i + 1} logout was not verified within 120 seconds`);
            });
        }
        samples.forEach((s, player) => {
            const state = this.players[player];
            if (s.ingame && s.runner === 'crashed') this.fail(`Player ${player + 1} runner crashed during cleanup`);
            const deathChat = s.chat.filter(line => /oh dear,? you are dead/i.test(line));
            const chatCount = s.deathChatCount ?? deathChat.length;
            if (s.ingame && !state.zeroHp && (s.sceneReady && s.hp <= 0 || chatCount > state.deathChats) && !this.deaths.some(d => d.player === player)) {
                this.deaths.push({ player, at: s.at, hp: s.hp, chat: deathChat });
                this.fail(`Player ${player + 1} died during cleanup`);
            }
            if (s.sceneReady || s.deathChatCount !== undefined) state.deathChats = chatCount;
            if (s.ingame === true && s.sceneReady && s.hp >= 0) state.zeroHp = s.hp === 0;
            else if (s.ingame === false) state.zeroHp = false;
            if (this.expired || state.loggedOut || state.pending || s.ingame !== true) return;
            const active = ['running', 'paused', 'stopping'].includes(s.runner);
            let action: CleanupAction | undefined;
            let rescueReason = '';
            if (active && !state.requested) {
                state.requested = true;
                action = { player, kind: 'retreat', at: s.at, ...(s.runner === 'paused' ? { resume: true } : {}) };
            } else if (safe(s)) {
                if (this.capture && (s.runner === 'paused' || !active)) return;
                action = { player, kind: this.capture ? 'pause' : active ? 'stop' : 'logout', at: s.at };
            } else if (!active || state.failedRetreat || s.at - this.startedAt > 15_000 || s.hp > 0 && s.hp <= 15 && s.at - this.startedAt > 1000) {
                rescueReason = !active ? `${s.runner} runner in an unsafe location` : state.failedRetreat ? 'retreat request failed' : 'retreat did not reach safety';
                action = { player, kind: 'teleport', at: s.at };
            }
            if (!action || action.kind === state.lastKind && s.at - state.lastAt < 2000) return;
            if (action.kind === 'teleport') {
                this.fixtureTeleports.push({ player, at: s.at, reason: rescueReason });
                this.fail(`Player ${player + 1} needed fixture cleanup teleport`);
            }
            state.pending = action;
            state.lastKind = action.kind;
            state.lastAt = s.at;
            this.actions.push(action);
            actions.push(action);
        });
        return actions;
    }

    complete(action: CleanupAction, succeeded: boolean, error?: string): void {
        const state = this.players[action.player];
        if (state.pending !== action) return;
        state.pending = undefined;
        Object.assign(action, { succeeded, ...(error ? { error } : {}) });
        if (!succeeded && action.kind !== 'logout') {
            if (action.kind === 'retreat') state.failedRetreat = true;
            this.fail(`Player ${action.player + 1} cleanup ${action.kind} failed${error ? `: ${error}` : ''}`);
        }
    }

    private fail(message: string): void {
        if (!this.failures.includes(message)) this.failures.push(message);
    }
}

export async function cleanupDeadline<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([operation, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
        })]);
    } finally {
        clearTimeout(timer);
    }
}
