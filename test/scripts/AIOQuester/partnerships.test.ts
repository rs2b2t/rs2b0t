import { describe, expect, test } from 'bun:test';
import { PartnerCoordinator, type PartnershipSnapshot, type PartnerQuest } from '#/bot/scripts/AIOQuester/partnerships.js';

function snapshot(name: string, gang: 'phoenix' | 'blackarm', extra: Partial<PartnershipSnapshot> = {}): PartnershipSnapshot {
    return { name, gang, world: '1', available: true, tradeActive: false, activeQuest: 'blackarmgang',
        quests: { blackarmgang: { eligible: true, stage: 9 }, hero: { eligible: true, stage: 1 } }, ...extra };
}

function fleet(...states: PartnershipSnapshot[]) {
    const bots = states.map((_, index) => new PartnerCoordinator(`session-${index}`, {}, 0));
    const cycle = (now = 0, times = 5) => {
        for (let pass = 0; pass < times; pass++) {
            const messages = bots.map((bot, i) => bot.update(states[i], now));
            for (const bot of bots) for (const message of messages) bot.receive(message, now);
        }
    };
    return { bots, states, cycle };
}

const quests: PartnerQuest[] = ['blackarmgang', 'hero'];

describe('automatic quest partnerships', () => {
    test('does not expose a proposal before both sides claim each other', () => {
        const a = new PartnerCoordinator('a', {}, 0);
        const b = new PartnerCoordinator('b', {}, 0);
        a.update(snapshot('Phoenix', 'phoenix'), 0);
        a.receive(b.update(snapshot('Black arm', 'blackarm'), 0), 0);
        a.update(snapshot('Phoenix', 'phoenix'), 1);
        expect(a.partner('blackarmgang')).toBe('');
        b.receive(a.update(snapshot('Phoenix', 'phoenix'), 2), 2);
        a.receive(b.update(snapshot('Black arm', 'blackarm'), 2), 2);
        a.update(snapshot('Phoenix', 'phoenix'), 3);
        expect(a.partner('blackarmgang')).toBe('Black arm');
        expect(b.partner('blackarmgang')).toBe('Phoenix');
    });

    test('pairs four clients without duplicate claims for either quest', () => {
        const team = fleet(snapshot('Phoenix A', 'phoenix'), snapshot('Phoenix B', 'phoenix'), snapshot('Black A', 'blackarm'), snapshot('Black B', 'blackarm'));
        for (const quest of quests) {
            for (const state of team.states) state.activeQuest = quest;
            team.cycle();
            expect(team.bots.map(bot => bot.partner(quest))).toEqual(['Black A', 'Black B', 'Phoenix A', 'Phoenix B']);
        }
    });

    test('an inactive eligible peer cannot capture a bot from an active counterpart', () => {
        const team = fleet(snapshot('Phoenix', 'phoenix'), snapshot('Black A', 'blackarm', { activeQuest: 'cook' }), snapshot('Black B', 'blackarm'));
        team.cycle();
        expect(team.bots[0].partner('blackarmgang')).toBe('Black B');
    });

    test('keeps established pairs when an alphabetically earlier client arrives', () => {
        const team = fleet(snapshot('Phoenix Z', 'phoenix'), snapshot('Black Z', 'blackarm'));
        team.cycle();
        team.bots.push(new PartnerCoordinator('new', {}, 1));
        team.states.push(snapshot('Phoenix A', 'phoenix'));
        team.cycle(2);
        expect(team.bots.map(bot => bot.partner('blackarmgang'))).toEqual(['Black Z', 'Phoenix Z', '']);
    });

    test('excludes other worlds, same gangs, unavailable clients and unselected quests', () => {
        const team = fleet(snapshot('Phoenix', 'phoenix'), snapshot('Elsewhere', 'blackarm', { world: '2' }),
            snapshot('Same gang', 'phoenix'), snapshot('Paused', 'blackarm', { available: false }),
            snapshot('Done', 'blackarm', { quests: { blackarmgang: { eligible: false, stage: 30 } } }));
        team.cycle();
        expect(team.bots[0].partner('blackarmgang')).toBe('');
        expect(team.bots[0].partner('hero')).toBe('');
    });

    test('a hero who already earned the armband cannot strand another rival', () => {
        const team = fleet(snapshot('Phoenix A', 'phoenix', { activeQuest: 'hero', quests: { hero: { eligible: true, stage: 6 } } }),
            snapshot('Black', 'blackarm', { activeQuest: 'hero', quests: { hero: { eligible: true, stage: 11 } } }),
            snapshot('Phoenix B', 'phoenix', { activeQuest: 'hero', quests: { hero: { eligible: true, stage: 4 } } }));
        team.cycle();
        expect(team.bots.map(bot => bot.partner('hero'))).toEqual(['', 'Phoenix B', 'Black']);
    });

    test('retains manual names while reserving those bots for their named counterparts', () => {
        const team = fleet(snapshot('Phoenix', 'phoenix'), snapshot('Black A', 'blackarm'), snapshot('Black B', 'blackarm'));
        team.bots[0] = new PartnerCoordinator('session-0', { blackarmgang: ' Black_B ', hero: 'Offline friend' }, 0);
        team.cycle();
        expect(team.bots.map(bot => bot.partner('blackarmgang'))).toEqual(['Black_B', '', 'Phoenix']);
        expect(team.bots[0].partner('hero')).toBe('Offline friend');
        expect(team.bots[0].hasLivePartner('hero', 0)).toBe(false);
    });

    test('expires a vanished peer and releases it to another running client', () => {
        const team = fleet(snapshot('Phoenix A', 'phoenix'), snapshot('Black', 'blackarm'), snapshot('Phoenix B', 'phoenix'));
        team.cycle();
        team.bots.splice(0, 1);
        team.states.splice(0, 1);
        team.cycle(60_000);
        expect(team.bots.map(bot => bot.partner('blackarmgang'))).toEqual(['Phoenix B', 'Black']);
    });

    test('a death or pause immediately clears the pair before its heartbeat expires', () => {
        const team = fleet(snapshot('Phoenix', 'phoenix'), snapshot('Black', 'blackarm'));
        team.cycle();
        team.states[1].available = false;
        team.cycle(1);
        expect(team.bots.map(bot => bot.partner('blackarmgang'))).toEqual(['', '']);
    });

    test('never changes the configured partner while its trade screen is active', () => {
        const team = fleet(snapshot('Phoenix', 'phoenix'), snapshot('Black', 'blackarm'));
        team.cycle();
        team.states[0].tradeActive = true;
        team.bots[0].update(team.states[0], 60_000);
        expect(team.bots[0].partner('blackarmgang')).toBe('Black');
        expect(team.bots[0].hasLivePartner('blackarmgang', 60_000)).toBe(false);
        team.states[0].tradeActive = false;
        team.bots[0].update(team.states[0], 60_001);
        expect(team.bots[0].partner('blackarmgang')).toBe('');
    });

    test('publishes progress so a waiting counterpart can observe preparation', () => {
        const team = fleet(snapshot('Phoenix', 'phoenix'), snapshot('Black', 'blackarm'));
        team.cycle();
        team.states[1].quests.blackarmgang = { eligible: true, stage: 22 };
        team.cycle(1);
        expect(team.bots[0].peer('blackarmgang', 1)?.quests.blackarmgang?.stage).toBe(22);
        expect(team.bots[0].hasLivePartner('blackarmgang', 1)).toBe(true);
    });

    test('rejects a claimed key receipt with a non-boolean value', () => {
        const a = new PartnerCoordinator('a', {}, 0);
        const b = new PartnerCoordinator('b', {}, 0);
        a.update(snapshot('Phoenix', 'phoenix'), 0);
        a.receive({ ...b.update(snapshot('Black', 'blackarm'), 0), claims: { blackarmgang: 'a' },
            quests: { blackarmgang: { eligible: true, stage: 22, hasKey: 'yes' } } }, 0);
        a.update(snapshot('Phoenix', 'phoenix'), 0);
        expect(a.partner('blackarmgang')).toBe('');
    });

    test('ignores malformed channel messages and self echoes', () => {
        const bot = new PartnerCoordinator('a', {}, 0);
        bot.update(snapshot('Phoenix', 'phoenix'), 0);
        for (const message of [null, {}, { session: 'oops', name: 'Black' }, { ...snapshot('Black', 'blackarm'), session: 'a', startedAt: 0, claims: {}, overrides: {} }]) bot.receive(message, 0);
        bot.update(snapshot('Phoenix', 'phoenix'), 1);
        expect(bot.partner('blackarmgang')).toBe('');
    });
});
