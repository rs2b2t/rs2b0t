import { afterEach, describe, expect, test } from 'bun:test';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { ArravHandoffState } from '#/bot/api/ai/quests/defs/shieldofarrav/partner.js';
import { HeroHandoffState } from '#/bot/api/ai/quests/defs/heroquest/partner.js';
import { HeroConfig } from '#/bot/api/ai/quests/defs/heroquest/config.js';
import { QuestPartnerships, establishedQuestGang, type PartnershipChannel } from '#/bot/scripts/AIOQuester/QuestPartnerships.js';
import type { PartnershipSnapshot, PartnerQuest } from '#/bot/scripts/AIOQuester/partnerships.js';

const running: QuestPartnerships[] = [];
afterEach(() => {
    for (const bot of running.splice(0)) bot.stop();
    ArravConfig.partner = '';
    HeroConfig.partner = '';
    ArravHandoffState.halvesGiven = 0;
    ArravHandoffState.gaveCert = false;
    HeroHandoffState.gaveKey = false;
    HeroHandoffState.lureFailures = 0;
});

function clients(activeQuest: PartnerQuest = 'blackarmgang') {
    const channels = new Set<PartnershipChannel>();
    const factory = (): PartnershipChannel => {
        const channel: PartnershipChannel = {
            onmessage: null,
            postMessage(message) { for (const other of channels) if (other !== channel) other.onmessage?.(new MessageEvent('message', { data: structuredClone(message) })); },
            close() { channels.delete(channel); }
        };
        channels.add(channel);
        return channel;
    };
    const states: PartnershipSnapshot[] = [
        { name: 'Phoenix', gang: 'phoenix', world: '1', available: true, tradeActive: false, activeQuest, quests: { blackarmgang: { eligible: true, stage: 9 }, hero: { eligible: true, stage: 4 } } },
        { name: 'Black arm', gang: 'blackarm', world: '1', available: true, tradeActive: false, activeQuest, quests: { blackarmgang: { eligible: true, stage: 22, hasKey: true }, hero: { eligible: true, stage: 11, hasKey: true } } }
    ];
    const bots = states.map((_, i) => new QuestPartnerships({ read: () => states[i] }, { channelFactory: factory }));
    running.push(...bots);
    const refresh = () => { for (let n = 0; n < 5; n++) for (const bot of bots) bot.refresh(); };
    for (const bot of bots) bot.start();
    refresh();
    return { bots, states, refresh };
}

describe('quest partnership lifecycle', () => {
    test('publishes automatic partners into the existing quest configs', () => {
        const { bots, states, refresh } = clients();
        bots[0].refresh();
        expect(ArravConfig.partner).toBe('Black arm');
        expect(ArravConfig.partnerStage).toBe(22);
        expect(ArravConfig.partnerHasKey).toBe(true);
        expect(bots[0].waitingForPartner('blackarmgang')).toBe(true);
        expect(bots[0].waitingForPartner('demon')).toBe(false);
        for (const state of states) state.activeQuest = 'hero';
        refresh();
        bots[0].refresh();
        expect(HeroConfig.partner).toBe('Black arm');
        expect(HeroConfig.partnerStage).toBe(11);
        expect(HeroConfig.partnerHasKey).toBe(true);
    });

    test('a live peer on another quest does not suppress failure recovery', () => {
        const { bots, states, refresh } = clients();
        states[1].activeQuest = 'cook';
        refresh();
        expect(bots[0].hasLivePartner('blackarmgang')).toBe(false);
        expect(bots[0].waitingForPartner('blackarmgang')).toBe(false);
    });

    test('pause releases the pair and resume rediscovers the running peer', () => {
        const { bots, refresh } = clients();
        bots[1].pause();
        bots[0].refresh();
        expect(bots[0].partner('blackarmgang')).toBe('');
        expect(bots[0].waitingForPartner('blackarmgang')).toBe(false);
        bots[1].resume();
        refresh();
        expect(bots[0].partner('blackarmgang')).toBe('Black arm');
    });

    test('preserves handoff debt across a pause but clears it for a new counterpart', () => {
        const { bots, states, refresh } = clients();
        ArravHandoffState.halvesGiven = 1;
        ArravHandoffState.gaveCert = true;
        bots[1].pause();
        bots[0].refresh();
        bots[1].resume();
        refresh();
        expect(ArravHandoffState.halvesGiven).toBe(1);
        states[1].name = 'New rival';
        refresh();
        expect(ArravHandoffState.halvesGiven).toBe(0);
        expect(ArravHandoffState.gaveCert).toBe(false);
    });

    test('a different Hero counterpart resets the spare key handoff', () => {
        const { states, refresh } = clients('hero');
        HeroHandoffState.gaveKey = true;
        states[1].name = 'New rival';
        refresh();
        expect(HeroHandoffState.gaveKey).toBe(false);
    });

    test('stop immediately releases a peer without waiting for expiry', () => {
        const { bots } = clients();
        bots[1].stop();
        bots[0].refresh();
        expect(bots[0].partner('blackarmgang')).toBe('');
        expect(bots[0].waitingForPartner('blackarmgang')).toBe(false);
    });

    test('manual settings work when BroadcastChannel is unavailable', () => {
        const bot = new QuestPartnerships({ arravPartner: ' Named friend ', heroPartner: 'Hero friend', read: () => ({
            name: 'Phoenix', gang: 'phoenix', world: '1', available: true, tradeActive: false, activeQuest: null, quests: {}
        }) }, { channelFactory: () => null });
        running.push(bot);
        bot.start();
        expect(ArravConfig.partner).toBe('Named friend');
        expect(HeroConfig.partner).toBe('Hero friend');
        expect(bot.waitingForPartner('blackarmgang')).toBe(false);
    });
});

describe('established gang inference', () => {
    test('uses the observed branch without guessing from early or complete journals', () => {
        for (const [id, stage, gang] of [
            ['blackarmgang', 9, 'phoenix'], ['blackarmgang', 22, 'blackarm'], ['blackarmgang', 23, 'blackarm'],
            ['hero', 4, 'phoenix'], ['hero', 11, 'blackarm'], ['blackarmgang', 4, null],
            ['blackarmgang', 30, null], ['hero', 1, null], ['hero', 14, null]
        ] as const) expect(establishedQuestGang(id, stage)).toBe(gang);
    });
});
