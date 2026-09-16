import { BANK, inLair, near, SURFACE, UPPER, type Point } from './policy.js';
import type { QueenSighting } from './search.js';
import { deathReport, type Casualty, type DeathReport } from './recovery.js';

export type Gate = 'surface' | 'upper';
export type Stage = 'bank' | 'travel' | Gate | 'fight' | 'retreat';
export interface MemberStats { hp: number; prayer: number; food: number; damage: number; dps: number; kills: number }
export interface Member { name: string; session: string; trip: number; stage: Stage; tile: Point | null; ready: boolean; playerSlot?: number; restocking?: boolean; blocked?: boolean; lure?: Point; queen?: QueenSighting; death?: DeathReport; recoverySpace?: number; reason?: string; stats?: MemberStats }
type Barrier = Gate | 'bank';
export interface Release { stage: Barrier; trip: number; sessions: string[]; at: number }
const FRESH_MS = 6000;
const RELEASE_MS = 12_000;

export function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/[_\s]+/g, ' ');
}

export function parseRoster(value: string): string[] {
    const names = value.split(',').map(normalizeName);
    if (names.length !== 4 || names.some(n => !n || n.length > 12) || new Set(names).size !== 4) {
        throw new Error('Set Team to exactly four distinct account names, separated by commas');
    }
    return names;
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function point(value: unknown): value is Point {
    return record(value) && ['x', 'z', 'level'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
}

export class Party {
    private peers = new Map<string, { member: Member; seen: number }>();
    private gates = new Map<Barrier, Release>();
    private aborted = new Set<number>();
    private casualties = new Map<string, Casualty>();
    readonly messages: string[] = [];

    constructor(readonly roster: string[], readonly self: string, readonly session: string, private readonly log: (message: string) => void = () => {}) {}

    private report(message: string): void {
        this.messages.push(message);
        if (this.messages.length > 5) this.messages.shift();
        this.log(message);
    }

    receive(value: unknown, now: number): void {
        if (!record(value) || typeof value.name !== 'string' || !this.roster.includes(value.name)
            || typeof value.session !== 'string' || typeof value.trip !== 'number' || !Number.isInteger(value.trip)
            || !['bank', 'travel', 'surface', 'upper', 'fight', 'retreat'].includes(String(value.stage))
            || typeof value.ready !== 'boolean' || (value.tile !== null && !point(value.tile))) return;
        const member: Member = { name: value.name, session: value.session, trip: value.trip, stage: value.stage as Stage, tile: value.tile, ready: value.ready };
        if (typeof value.playerSlot === 'number' && Number.isInteger(value.playerSlot) && value.playerSlot >= 0 && value.playerSlot < 2048) member.playerSlot = value.playerSlot;
        if (typeof value.recoverySpace === 'number' && Number.isInteger(value.recoverySpace) && value.recoverySpace >= 0 && value.recoverySpace <= 28) member.recoverySpace = value.recoverySpace;
        member.restocking = value.restocking === true && (member.stage === 'retreat' || member.stage === 'bank');
        const death = deathReport(value.death, now);
        if (death) {
            member.death = death;
            const key = `${member.name}:${member.session}:${member.trip}`;
            if (!this.casualties.has(key)) this.report(`${member.name} died at ${death.tile.x},${death.tile.z}; recovering dropped items`);
            this.casualties.set(key, { name: member.name, session: member.session, trip: member.trip, death });
        }
        member.blocked = value.blocked === true;
        if (point(value.lure)) member.lure = value.lure;
        const queen = value.queen;
        if (record(queen) && [1158, 1160].includes(Number(queen.id)) && point(queen.tile) && inLair(queen.tile)
            && typeof queen.at === 'number' && Number.isFinite(queen.at) && queen.at <= now + 1000 && now - queen.at <= 8000 && typeof queen.engaged === 'boolean') {
            member.queen = { id: Number(queen.id), tile: queen.tile, at: queen.at, engaged: queen.engaged };
        }
        if (typeof value.reason === 'string') member.reason = value.reason.slice(0, 120);
        const stats = value.stats;
        if (record(stats) && ['hp', 'prayer', 'food', 'damage', 'dps', 'kills'].every(key => typeof stats[key] === 'number' && Number.isFinite(stats[key]) && stats[key] >= 0)) {
            member.stats = { hp: Number(stats.hp), prayer: Number(stats.prayer), food: Number(stats.food), damage: Number(stats.damage), dps: Number(stats.dps), kills: Number(stats.kills) };
        }
        if (member.reason === 'paused' || !member.restocking && (member.stage === 'retreat' || (!member.ready && member.stage !== 'bank'))) this.aborted.add(member.trip);
        const previous = this.peers.get(member.name)?.member;
        if (member.queen && (!previous?.queen || previous.queen.id !== member.queen.id)) this.report(`${member.name} spotted the ${member.queen.id === 1160 ? 'flying' : 'ground'} queen at ${member.queen.tile.x},${member.queen.tile.z}`);
        if (!previous || previous.session !== member.session || previous.trip !== member.trip || previous.stage !== member.stage || previous.ready !== member.ready || previous.reason !== member.reason || previous.blocked !== member.blocked || previous.restocking !== member.restocking) {
            this.report(`${member.name}: ${member.stage}, ${member.ready ? 'ready' : 'not ready'} (trip ${member.trip})${member.restocking ? ': restocking for next trip' : ''}${member.reason ? `: ${member.reason}` : ''}${member.blocked ? ': cross blocked' : ''}`);
        }
        this.peers.set(member.name, { member, seen: now });
    }

    members(now: number): Member[] {
        return this.roster.flatMap(name => {
            const peer = this.peers.get(name);
            return peer && now - peer.seen <= FRESH_MS ? [peer.member] : [];
        });
    }

    deaths(trip: number): Casualty[] { return [...this.casualties.values()].filter(c => c.trip === trip); }

    release(stage: Barrier, trip: number, now: number): Release | null {
        const members = this.members(now);
        const tile = stage === 'bank' ? BANK : stage === 'surface' ? SURFACE : UPPER;
        if (this.aborted.has(trip) || this.self !== this.roster[0] || members.length !== 4
            || members.some(m => m.stage !== stage || !m.ready || !near(m.tile, tile, 4))) return null;
        if (stage === 'bank' ? trip !== Math.max(...members.map(m => m.trip)) + 1 : members.some(m => m.trip !== trip)) return null;
        return { stage, trip, sessions: members.map(m => m.session), at: now };
    }

    accept(value: unknown, now: number): void {
        if (!record(value) || (value.stage !== 'surface' && value.stage !== 'upper' && value.stage !== 'bank')
            || typeof value.trip !== 'number' || typeof value.at !== 'number'
            || !Array.isArray(value.sessions) || value.sessions.length !== 4
            || !value.sessions.every(s => typeof s === 'string')
            || value.sessions[this.roster.indexOf(this.self)] !== this.session
            || value.at > now + 1000 || now - value.at > RELEASE_MS) return;
        const sessions = value.sessions;
        const previous = this.gates.get(value.stage);
        if (!previous || previous.trip !== value.trip || previous.sessions.some((session, i) => session !== sessions[i])) {
            this.report(`${this.roster[0]} released ${value.stage}: all four ready (trip ${value.trip})`);
        }
        this.gates.set(value.stage, { stage: value.stage, trip: value.trip, at: value.at, sessions: value.sessions });
    }

    released(stage: Gate, trip: number, now: number): boolean {
        const gate = this.gates.get(stage);
        const members = this.members(now);
        return gate !== undefined && gate.trip === trip && now >= gate.at && now - gate.at <= RELEASE_MS
            && !this.unsafe(trip, now) && members.every((m, i) => m.session === gate.sessions[i]);
    }

    departure(currentTrip: number, now: number): number | null {
        const gate = this.gates.get('bank');
        const members = this.members(now);
        if (!gate || gate.trip <= currentTrip || this.aborted.has(gate.trip) || now < gate.at || now - gate.at > RELEASE_MS
            || members.length !== 4 || members.some((m, i) => !m.ready || m.trip > gate.trip || m.session !== gate.sessions[i])) return null;
        return gate.trip;
    }

    unsafe(trip: number, now: number): boolean {
        const members = this.members(now);
        const dead = new Set(this.deaths(trip).map(c => c.name));
        return this.aborted.has(trip) || this.roster.some(name => !members.some(m => m.name === name) && !dead.has(name))
            || members.some(m => m.trip !== trip || !m.restocking && (!m.ready || m.stage === 'retreat' || m.stage === 'bank'));
    }
}
