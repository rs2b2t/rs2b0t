import { ArravConfig, type ArravGang } from '../../api/ai/quests/defs/shieldofarrav/config.js';
import { ArravHandoffState } from '../../api/ai/quests/defs/shieldofarrav/partner.js';
import { resetHeroHandoffState } from '../../api/ai/quests/defs/heroquest/partner.js';
import { HeroConfig } from '../../api/ai/quests/defs/heroquest/config.js';
import { PARTNER_QUESTS, PartnerCoordinator, type PartnerQuest, type PartnershipMember, type PartnershipSnapshot } from './partnerships.js';

export interface PartnershipChannel {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage(message: unknown): void;
    close(): void;
}
interface PartnershipOptions {
    arravPartner?: string;
    heroPartner?: string;
    read: () => PartnershipSnapshot;
    log?: (message: string) => void;
}
interface PartnershipDependencies {
    channelFactory?: () => PartnershipChannel | null;
    now?: () => number;
}

export function establishedQuestGang(id: string, stage: number | undefined): ArravGang | null {
    if (stage === undefined) return null;
    if (id === 'blackarmgang') {
        if (stage >= 8 && stage <= 9) return 'phoenix';
        if (stage >= 21 && stage <= 23) return 'blackarm';
    }
    if (id === 'hero') {
        if (stage >= 2 && stage <= 6) return 'phoenix';
        if (stage >= 7 && stage <= 13) return 'blackarm';
    }
    return null;
}

export class QuestPartnerships {
    private readonly coordinator: PartnerCoordinator;
    private readonly now: () => number;
    private readonly channelFactory: () => PartnershipChannel | null;
    private channel: PartnershipChannel | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;
    private started = false;
    private paused = false;
    private paired: Partial<Record<PartnerQuest, string>> = {};
    private last: Partial<Record<PartnerQuest, string>> = {};

    constructor(private readonly options: PartnershipOptions, dependencies: PartnershipDependencies = {}) {
        this.now = dependencies.now ?? Date.now;
        this.channelFactory = dependencies.channelFactory ?? (() => typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('rs2b0t:quest-partners:v1'));
        this.coordinator = new PartnerCoordinator(crypto.randomUUID(), {
            blackarmgang: options.arravPartner ?? '', hero: options.heroPartner ?? ''
        }, this.now());
    }

    start(): void {
        if (this.started) return;
        this.started = true;
        this.paused = false;
        try { this.channel = this.channelFactory(); } catch { this.channel = null; }
        if (this.channel) this.channel.onmessage = event => this.coordinator.receive(event.data, this.now());
        this.refresh();
        this.timer = setInterval(() => this.refresh(), 1000);
    }

    refresh(): void {
        if (!this.started) return;
        const snapshot = this.options.read();
        const message = this.coordinator.update({ ...snapshot, available: snapshot.available && !this.paused }, this.now());
        this.channel?.postMessage(message);
        for (const quest of PARTNER_QUESTS) {
            const partner = this.coordinator.partner(quest);
            const progress = this.peer(quest)?.quests[quest];
            if (quest === 'blackarmgang') {
                ArravConfig.partner = partner;
                ArravConfig.partnerStage = progress?.stage;
                ArravConfig.partnerHasKey = progress?.hasKey;
            } else {
                HeroConfig.partner = partner;
                HeroConfig.partnerStage = progress?.stage;
                HeroConfig.partnerHasKey = progress?.hasKey;
            }
            const identity = partner.trim().toLowerCase().replace(/[_\s]+/g, ' ');
            if (identity && identity !== this.paired[quest]) {
                if (quest === 'blackarmgang') {
                    ArravHandoffState.halvesGiven = 0;
                    ArravHandoffState.gaveCert = false;
                } else resetHeroHandoffState();
                this.paired[quest] = identity;
            }
            if (partner !== (this.last[quest] ?? '')) this.options.log?.(`${quest}: ${partner ? `partner ${partner}` : 'waiting for an opposite-gang partner'}`);
            this.last[quest] = partner;
        }
    }

    partner(id: string): string { return isPartnerQuest(id) ? this.coordinator.partner(id) : ''; }
    peer(id: string): PartnershipMember | null { return isPartnerQuest(id) ? this.coordinator.peer(id, this.now()) : null; }
    hasLivePartner(id: string): boolean { return this.peer(id) !== null; }
    waitingForPartner(id: string): boolean { return this.peer(id)?.activeQuest === id; }

    pause(): void {
        this.paused = true;
        this.refresh();
        this.clearTimer();
    }

    resume(): void {
        if (!this.started || !this.paused) return;
        this.paused = false;
        this.refresh();
        this.timer = setInterval(() => this.refresh(), 1000);
    }

    stop(): void {
        if (!this.started) return;
        this.pause();
        this.started = false;
        this.channel?.close();
        this.channel = null;
        ArravConfig.partner = this.options.arravPartner?.trim() ?? '';
        HeroConfig.partner = this.options.heroPartner?.trim() ?? '';
        ArravConfig.partnerStage = undefined;
        ArravConfig.partnerHasKey = undefined;
        HeroConfig.partnerStage = undefined;
        HeroConfig.partnerHasKey = undefined;
    }

    private clearTimer(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
    }
}

function isPartnerQuest(id: string): id is PartnerQuest { return id === 'blackarmgang' || id === 'hero'; }
