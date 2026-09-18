import { chamber, count, type KqItem, type KqSample, type KqTile } from './kqEvidence.js';

export interface RecoverySample extends KqSample {
    serverTile?: KqTile | null; stage?: string; runner: string; status?: string; chat: string[]; deathChatCount?: number;
    death: { at: number; tile: KqTile; items: KqItem[]; ground: KqItem[] } | null;
    recoveredItems: { owner: string; id: number; count: number; at: number }[];
}
export const RECOVERY_CHECKLIST = {
    waitedForFourth: 'Wait for the fourth member', sharedKit: 'Prepare the ordinary four-player kit', surface: 'Descend the first rope together', entered: 'Enter the chamber together', formation: 'Reach the four cardinal melee positions',
    recoveryArmed: 'Announce and dispatch one controlled real death', recoveryDeath: 'Observe the intended death', recoveryRespawn: 'Observe Lumbridge respawn and loss of the bow', recoveryGround: 'Observe the new death-tile bow drop',
    recoveryPickup: 'Observe an own-roster survivor pick up the dead member\'s bow', recoveryBanked: 'Observe the recovered bow deposited at Shantay', recoveryWaiting: 'Observe the dead member waiting for gear at Shantay'
} as const;

const near = (tile: KqTile | null | undefined, x: number, z: number, radius: number) => tile?.level === 0 && Math.max(Math.abs(tile.x - x), Math.abs(tile.z - z)) <= radius;
const owned = (s: KqSample) => count(s.pack, 861) + count(s.gear, 861);
const deathChats = (s: RecoverySample) => s.deathChatCount ?? s.chat.filter(line => /oh dear,? you are dead/i.test(line)).length;

export class KqRecoveryEvidence {
    readonly milestones: Record<string, number> = {};
    fixture: { player: number; command: string; requestedAt: number; tile: KqTile; bowCount: number; groundBefore: number; ownedBefore: number[]; bankBefore: number[] } | null = null;
    readonly deaths: { player: number; at: number; expected: boolean; hp: number; chat: string[]; respawnedAt?: number }[] = [];
    readonly pickups: { player: number; owner: string; id: number; count: number; pickedAt: number; bankBefore: number; ownedBefore: number; ownedAfter: number; bankedAt?: number }[] = [];
    readonly ground: { at: number; count: number; tile: KqTile }[] = [];
    private readonly banks: KqItem[][] = [[], [], [], []];
    private readonly baselineXp: number[] = [];
    private previous: RecoverySample[] | null = null;
    private stable: { at: number; tile: KqTile } | null = null;

    constructor(private readonly names: string[], readonly player = 3) {}

    get complete(): boolean { return ['recoveryDeath', 'recoveryRespawn', 'recoveryGround', 'recoveryPickup', 'recoveryBanked', 'recoveryWaiting'].every(key => !!this.milestones[key]); }

    ready(samples: RecoverySample[]): boolean {
        const victim = samples[this.player];
        if (this.fixture || samples.length !== 4 || !samples.every((s, i) => s.sceneReady && chamber(s) && s.runner === 'running' && s.stage === 'fight' && !s.restocking && s.hp > 0
            && s.xp.melee + s.xp.ranged > this.baselineXp[i]) || !samples.some((s, i) => i !== this.player && s.pack.length < 28)
            || !victim.queens.some(q => [1158, 1160].includes(q.id) && (q.hp > 0 || q.total === 0))) { this.stable = null; return false; }
        const tile = victim.serverTile ?? victim.tile!;
        if (!this.stable || tile.x !== this.stable.tile.x || tile.z !== this.stable.tile.z || tile.level !== this.stable.tile.level) this.stable = { at: victim.at, tile: { ...tile } };
        return victim.at - this.stable.at >= 400;
    }

    arm(samples: RecoverySample[], requestedAt: number): void {
        if (this.fixture) throw new Error('Recovery death fixture was already requested');
        const victim = samples[this.player];
        const tile = victim.serverTile ?? victim.tile;
        if (!tile || !chamber(victim) || owned(victim) < 1) throw new Error('Recovery fixture needs the equipped party in the queen chamber');
        const groundBefore = Math.max(0, ...samples.map(s => count(s.ground.filter(g => near(g.tile, tile.x, tile.z, 0)), 861)));
        this.fixture = { player: this.player, command: '~hit 999', requestedAt, tile: { ...tile }, bowCount: owned(victim), groundBefore, ownedBefore: samples.map(owned), bankBefore: this.banks.map(bank => count(bank, 861)) };
        this.milestones.recoveryArmed = requestedAt;
    }

    observe(samples: RecoverySample[]): void {
        if (samples.length !== 4) throw new Error('Expected four recovery observations');
        const now = Math.max(...samples.map(s => s.at));
        samples.forEach((s, player) => {
            if (s.sceneReady && s.bankOpen) this.banks[player] = structuredClone(s.bank);
            this.baselineXp[player] ??= s.xp.melee + s.xp.ranged;
            const previous = this.previous?.[player];
            const lastDeath = this.deaths.findLast(d => d.player === player);
            const zero = s.sceneReady && s.hp <= 0 && (!previous || previous.hp > 0);
            let message = deathChats(s) > (previous ? deathChats(previous) : 0);
            if (message && lastDeath && !lastDeath.chat.length && !zero) {
                lastDeath.chat = s.chat.filter(line => /oh dear,? you are dead/i.test(line));
                message = false;
            }
            if (!zero && !message) return;
            const expected = !!this.fixture && player === this.player && this.deaths.length === 0 && s.at >= this.fixture.requestedAt && s.at - this.fixture.requestedAt <= 5000;
            this.deaths.push({ player, at: s.at, expected, hp: s.hp, chat: s.chat.filter(line => /oh dear,? you are dead/i.test(line)) });
            if (!expected) throw new Error(`Unexpected death of ${this.names[player]} during recovery probe`);
            this.milestones.recoveryDeath = s.at;
        });
        const fixture = this.fixture;
        if (fixture) {
            const death = this.deaths.find(d => d.expected);
            if (!death && now - fixture.requestedAt > 5000) throw new Error('Recovery fixture did not produce an observed death');
            if (death) {
                const victim = samples[this.player];
                if (victim.sceneReady && victim.hp > 0 && near(victim.tile, 3221, 3218, 5) && owned(victim) < fixture.bowCount) {
                    death.respawnedAt ??= victim.at;
                    this.milestones.recoveryRespawn ??= victim.at;
                }
                samples.forEach(s => {
                    if (!s.sceneReady || !chamber(s)) return;
                    const stack = s.ground.find(g => g.id === 861 && near(g.tile, fixture.tile.x, fixture.tile.z, 0) && g.count > fixture.groundBefore);
                    if (stack && !this.ground.length) {
                        this.ground.push({ at: s.at, count: stack.count - fixture.groundBefore, tile: { ...stack.tile } });
                        this.milestones.recoveryGround = s.at;
                    }
                });
                samples.forEach((s, player) => {
                    if (player === this.player || !s.sceneReady) return;
                    const records = s.recoveredItems.filter(r => r.owner === this.names[this.player] && r.id === 861 && r.at >= fixture.requestedAt && r.at <= s.at);
                    const recovered = records.reduce((sum, r) => sum + r.count, 0);
                    if (chamber(s) && this.ground.length && recovered > 0 && owned(s) > fixture.ownedBefore[player] && !this.pickups.some(p => p.player === player)) {
                        const amount = Math.min(recovered, owned(s) - fixture.ownedBefore[player], this.ground[0].count);
                        this.pickups.push({ player, owner: this.names[this.player], id: 861, count: amount, pickedAt: s.at, bankBefore: fixture.bankBefore[player], ownedBefore: fixture.ownedBefore[player], ownedAfter: owned(s) });
                        this.milestones.recoveryPickup ??= s.at;
                    }
                    const pickup = this.pickups.find(p => p.player === player);
                    const bank = count(s.bank, 861);
                    if (pickup && near(s.tile, 3308, 3120, 3) && s.bankOpen && owned(s) < pickup.ownedAfter && bank >= pickup.bankBefore + pickup.count
                        && owned(s) + bank >= pickup.bankBefore + pickup.ownedBefore + pickup.count) {
                        pickup.bankedAt ??= s.at;
                        this.milestones.recoveryBanked ??= s.at;
                    }
                });
                if (death.respawnedAt && victim.sceneReady && near(victim.tile, 3308, 3120, 3) && victim.bankOpen && victim.runner === 'running' && victim.stage === 'bank'
                    && victim.restocking && victim.death && victim.status?.includes('waiting for replacement gear') && count([...victim.pack, ...victim.gear, ...victim.bank], 861) === 0) {
                    this.milestones.recoveryWaiting ??= victim.at;
                }
            }
        }
        this.previous = structuredClone(samples);
    }
}
