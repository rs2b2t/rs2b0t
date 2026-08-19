import { beforeEach, describe, expect, test } from 'bun:test';

import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { TG_ITEM, TG_TILE } from '#/bot/api/ai/quests/defs/treegnome/areas.js';
import { TG_STAGE } from '#/bot/api/ai/quests/defs/treegnome/journal.js';
import { decide, treegnome } from '#/bot/api/ai/quests/defs/treegnome/index.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

// Why: `QuestLoadout` is one module-level singleton, so a neighbouring suite's declared kit decides this one's gear step.
beforeEach(() => {
    QuestLoadout.current = null;
});

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    invIds?: number[];
    bank?: string[];
    bankIds?: number[];
    bankKnown?: boolean;
    tile?: WorldTile;
}

function tally<T>(values: T[]): Map<T, number> {
    const out = new Map<T, number>();
    for (const value of values) {
        out.set(value, (out.get(value) ?? 0) + 1);
    }
    return out;
}

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? TG_STAGE.STARTED;
    return {
        journal: options.journal ?? 'inProgress',
        inv: tally((options.inv ?? []).map(n => n.toLowerCase())),
        invIds: tally(options.invIds ?? []),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set() },
        bank: tally((options.bank ?? []).map(n => n.toLowerCase())),
        bankIds: tally(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? { ...TG_TILE.BANK },
        freeSlots: 20
    };
}

const name = (step: QuestStep): string | null => (step.kind === 'custom' ? step.name : null);
const talker = (step: QuestStep): string | null => (step.kind === 'talk' ? step.stop.npc : null);

const logs = (count: number): number[] => Array.from({ length: count }, () => TG_ITEM.LOGS.id);

describe('Tree Gnome Village decide', () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        const blind = { ...snap(), progress: undefined, stage: undefined };
        expect(decide(blind).kind).toBe('wait');
    });

    test('opens with King Bolren', () => {
        expect(talker(decide(snap({ journal: 'notStarted', stage: TG_STAGE.NOT_STARTED })))).toBe('King Bolren');
    });

    test('reports to Montai once Bolren has sent us north', () => {
        expect(talker(decide(snap({ stage: TG_STAGE.STARTED })))).toBe('Commander Montai');
    });

    test('buys an axe when neither the pack nor the bank has one', () => {
        const step = decide(snap({ stage: TG_STAGE.SPOKEN_MONTAI }));

        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Iron axe');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Aemad');
    });

    test('takes the banked axe rather than walking to Aemad', () => {
        const step = decide(snap({ stage: TG_STAGE.SPOKEN_MONTAI, bankIds: [1349] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].id).toBe(1349);
    });

    test('reads the bank before believing it has no axe', () => {
        expect(decide(snap({ stage: TG_STAGE.SPOKEN_MONTAI, bankKnown: false })).kind).toBe('scanBank');
    });

    test('chops once an axe is carried', () => {
        expect(name(decide(snap({ stage: TG_STAGE.SPOKEN_MONTAI, invIds: [1349] })))).toBe('chop 6 logs on the battlefield');
    });

    test('hands the six logs over rather than chopping a seventh', () => {
        const step = decide(snap({ stage: TG_STAGE.SPOKEN_MONTAI, invIds: [1349, ...logs(6)] }));

        expect(talker(step)).toBe('Commander Montai');
    });

    test('fires the ballista once Montai has briefed us', () => {
        expect(name(decide(snap({ stage: TG_STAGE.FINDING_TRACKERS })))).toBe('fire the gnome ballista at the stronghold');
    });

    test('goes for the chest once the stronghold is breached', () => {
        expect(name(decide(snap({ stage: TG_STAGE.BALLISTA_FIRED })))).toBe("search the Khazard chest for the gnomes' orb");
    });

    test('carries the orb back to Bolren', () => {
        expect(talker(decide(snap({ stage: TG_STAGE.RETRIEVED_ORB, invIds: [TG_ITEM.ORB.id] })))).toBe('King Bolren');
    });

    // Why: the chest refuses while a copy sits in the bank, so a banked orb has to come back out rather than be re-earned.
    test('withdraws a banked orb rather than searching the chest again', () => {
        const step = decide(snap({ stage: TG_STAGE.RETRIEVED_ORB, bankIds: [TG_ITEM.ORB.id] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].id).toBe(TG_ITEM.ORB.id);
    });

    test('goes back to the chest when the orb is nowhere', () => {
        expect(name(decide(snap({ stage: TG_STAGE.RETRIEVED_ORB })))).toBe("search the Khazard chest for the gnomes' orb");
    });

    test('hunts the warlord after the village is raided', () => {
        expect(name(decide(snap({ stage: TG_STAGE.RETURNED_FIRST_ORB })))).toBe('kill the Khazard warlord for the last two orbs');
    });

    test('tells the two orbs from the one by id', () => {
        const wrongOrb = decide(snap({ stage: TG_STAGE.DEFEATED_WARLORD, invIds: [TG_ITEM.ORB.id] }));

        expect(name(wrongOrb)).toBe('kill the Khazard warlord for the last two orbs');
        expect(talker(decide(snap({ stage: TG_STAGE.DEFEATED_WARLORD, invIds: [TG_ITEM.ORBS.id] })))).toBe('King Bolren');
    });

    // Why: Bolren deletes the orbs a tick before the queue that finishes the quest, and a walk back to the warlord in that gap is 200 tiles wasted.
    test('waits out the ceremony rather than re-hunting from Bolren\'s feet', () => {
        const step = decide(snap({ stage: TG_STAGE.DEFEATED_WARLORD, tile: { ...TG_TILE.BOLREN } }));

        expect(step.kind).toBe('wait');
    });

    test('walks out of the stronghold before any errand that is not the chest', () => {
        const inside = { ...TG_TILE.LADDER_STAND };

        expect(name(decide(snap({ stage: TG_STAGE.RETURNED_FIRST_ORB, tile: inside })))).toBe('walk out of the Khazard stronghold');
        expect(name(decide(snap({ stage: TG_STAGE.RETRIEVED_ORB, invIds: [TG_ITEM.ORB.id], tile: inside }))))
            .toBe('walk out of the Khazard stronghold');
    });

    test('stays for the chest while the orb is still in it', () => {
        const step = decide(snap({ stage: TG_STAGE.BALLISTA_FIRED, tile: { ...TG_TILE.CHEST_STAND } }));

        expect(name(step)).toBe("search the Khazard chest for the gnomes' orb");
    });

    // Why: armed at the first fight instead, the bot walks the battlefield back to Ardougne for a kit the opening bank trip could have carried.
    test('arms itself on the opening bank trip', () => {
        const step = decide(snap({ stage: TG_STAGE.NOT_STARTED, journal: 'notStarted', bank: ['Rune scimitar'] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Rune scimitar');
    });

    test('wears the kit it is carrying before walking on', () => {
        const step = decide(snap({ stage: TG_STAGE.STARTED, inv: ['Rune scimitar'] }));

        expect(name(step)).toBe('wear Rune scimitar');
    });
});

describe('Tree Gnome Village module', () => {
    test('leaves the logs off the record, so a resume past Montai chops nothing', () => {
        expect(treegnome.record.items).toEqual([]);
    });

    test('keeps the logs, the axe and both orbs off the deposit list', () => {
        for (const tool of ['logs', 'axe', 'orb of protection']) {
            expect(treegnome.tools).toContain(tool);
        }
    });

    test('banks in East Ardougne, the nearest booth to the maze', () => {
        expect(treegnome.bank).toBe(TG_TILE.BANK);
    });
});
