import type { ArravGang } from '../../api/ai/quests/defs/shieldofarrav/config.js';

export type PartnerQuest = 'blackarmgang' | 'hero';
export const PARTNER_QUESTS: readonly PartnerQuest[] = ['blackarmgang', 'hero'];
const FRESH_MS = 15_000;

type QuestMap<T> = Partial<Record<PartnerQuest, T>>;
export interface PartnershipProgress { eligible: boolean; stage?: number; hasKey?: boolean }
export interface PartnershipSnapshot {
    name: string;
    world: string;
    gang: ArravGang | null;
    quests: QuestMap<PartnershipProgress>;
    activeQuest: string | null;
    available: boolean;
    tradeActive: boolean;
}
export interface PartnershipMember extends PartnershipSnapshot {
    session: string;
    startedAt: number;
    claims: QuestMap<string>;
    overrides: QuestMap<string>;
}

function normalize(name: string): string { return name.trim().toLowerCase().replace(/[_\s]+/g, ' '); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

function member(value: unknown): value is PartnershipMember {
    if (!record(value) || typeof value.name !== 'string' || !normalize(value.name)
        || typeof value.session !== 'string' || !value.session || typeof value.world !== 'string'
        || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)
        || value.gang !== null && value.gang !== 'phoenix' && value.gang !== 'blackarm'
        || typeof value.available !== 'boolean' || typeof value.tradeActive !== 'boolean'
        || value.activeQuest !== null && typeof value.activeQuest !== 'string'
        || !record(value.quests) || !record(value.claims) || !record(value.overrides)) return false;
    const { quests, claims, overrides } = value;
    return PARTNER_QUESTS.every(quest => {
        const progress = quests[quest];
        return (progress === undefined || record(progress) && typeof progress.eligible === 'boolean'
            && (progress.stage === undefined || typeof progress.stage === 'number' && Number.isFinite(progress.stage))
            && (progress.hasKey === undefined || typeof progress.hasKey === 'boolean'))
            && (claims[quest] === undefined || typeof claims[quest] === 'string')
            && (overrides[quest] === undefined || typeof overrides[quest] === 'string');
    });
}

function eligible(peer: PartnershipMember, quest: PartnerQuest): boolean {
    const progress = peer.quests[quest];
    if (!progress?.eligible) return false;
    if (progress.stage === undefined) return true;
    return quest === 'hero' ? progress.stage !== 6 && progress.stage < 13 : progress.stage < 30;
}

function compatible(a: PartnershipMember, b: PartnershipMember, quest: PartnerQuest): boolean {
    return a.session !== b.session && normalize(a.name) !== normalize(b.name)
        && a.available && b.available && !!a.world && a.world === b.world
        && a.activeQuest === quest && b.activeQuest === quest
        && a.gang !== null && b.gang !== null && a.gang !== b.gang
        && eligible(a, quest) && eligible(b, quest)
        && (!a.overrides[quest] || normalize(a.overrides[quest]) === normalize(b.name))
        && (!b.overrides[quest] || normalize(b.overrides[quest]) === normalize(a.name));
}

export class PartnerCoordinator {
    private peers = new Map<string, { value: PartnershipMember; seen: number }>();
    private self: PartnershipMember | null = null;
    private partners: QuestMap<string> = {};
    private readonly overrides: QuestMap<string>;

    constructor(readonly session: string, overrides: QuestMap<string> = {}, private readonly startedAt = Date.now()) {
        this.overrides = Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, value.trim()]));
    }

    receive(value: unknown, now: number): void {
        if (!member(value) || value.session === this.session) return;
        this.peers.set(value.session, { value: structuredClone(value), seen: now });
    }

    update(snapshot: PartnershipSnapshot, now: number): PartnershipMember {
        const previous = this.self;
        const self: PartnershipMember = { ...structuredClone(snapshot), session: this.session, startedAt: this.startedAt,
            claims: { ...previous?.claims }, overrides: { ...this.overrides } };
        this.self = self;
        for (const [session, peer] of this.peers) if (now - peer.seen > FRESH_MS) this.peers.delete(session);
        const roster = this.roster(now);
        for (const quest of PARTNER_QUESTS) {
            if (self.tradeActive && self.activeQuest === quest && previous?.world === self.world && this.partners[quest]) continue;
            const claims = this.match(roster, quest);
            const claim = claims.get(this.session);
            if (claim) self.claims[quest] = claim;
            else delete self.claims[quest];
            const peer = this.peer(quest, now);
            this.partners[quest] = this.overrides[quest] || peer?.name || '';
        }
        return structuredClone(self);
    }

    partner(quest: PartnerQuest): string { return this.overrides[quest] || this.partners[quest] || ''; }

    peer(quest: PartnerQuest, now: number): PartnershipMember | null {
        const self = this.self;
        if (!self) return null;
        const other = this.roster(now).find(peer => peer.session === self.claims[quest]);
        return other && compatible(self, other, quest) && other.claims[quest] === self.session ? other : null;
    }

    hasLivePartner(quest: PartnerQuest, now: number): boolean { return this.peer(quest, now) !== null; }

    private roster(now: number): PartnershipMember[] {
        const self = this.self;
        if (!self) return [];
        const peers = [self, ...[...this.peers.values()].filter(peer => now - peer.seen <= FRESH_MS).map(peer => peer.value)]
            .sort((a, b) => b.startedAt - a.startedAt || a.session.localeCompare(b.session));
        const names = new Set<string>();
        return peers.filter(peer => {
            const key = `${peer.world}:${normalize(peer.name)}`;
            if (names.has(key)) return false;
            names.add(key);
            return true;
        }).sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)) || a.session.localeCompare(b.session));
    }

    private match(roster: PartnershipMember[], quest: PartnerQuest): Map<string, string> {
        const matches = new Map<string, string>();
        const pair = (a: PartnershipMember, b: PartnershipMember): void => {
            matches.set(a.session, b.session);
            matches.set(b.session, a.session);
        };
        for (const a of roster) {
            const b = roster.find(peer => peer.session === a.claims[quest]);
            if (b && b.claims[quest] === a.session && compatible(a, b, quest)) pair(a, b);
        }
        for (const a of roster) {
            if (matches.has(a.session)) continue;
            const b = roster.find(peer => !matches.has(peer.session) && compatible(a, peer, quest)
                && (a.claims[quest] === peer.session || peer.claims[quest] === a.session));
            if (b) pair(a, b);
        }
        for (const a of roster) {
            if (matches.has(a.session)) continue;
            const b = roster.find(peer => !matches.has(peer.session) && compatible(a, peer, quest));
            if (b) pair(a, b);
        }
        return matches;
    }
}
