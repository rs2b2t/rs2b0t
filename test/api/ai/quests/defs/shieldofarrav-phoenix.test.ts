import { afterEach, describe, expect, test } from 'bun:test';

import { SOA_ID } from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import { phoenixStep } from '#/bot/api/ai/quests/defs/shieldofarrav/phoenix.js';

import { arravSnapshot } from './shieldofarrav-snapshot.fixture.js';

const VARROCK = { x: 3210, z: 3490, level: 0 };
const at = arravSnapshot.bind(null, VARROCK);

afterEach(() => {
    ArravConfig.partner = '';
});

describe('phoenix leg', () => {
    test('an unstarted quest talks to Reldo', () => {
        expect(phoenixStep(at(SOA_STAGE.NOT_STARTED))).toMatchObject({ kind: 'custom', name: 'ask Reldo for a quest' });
    });

    test('the book is checked out of the quest bookcase', () => {
        expect(phoenixStep(at(SOA_STAGE.TOLD_OF_BOOK))).toMatchObject({ kind: 'custom' });
    });

    test('a held book is read rather than re-taken', () => {
        expect(phoenixStep(at(SOA_STAGE.TOLD_OF_BOOK, [], [[SOA_ID.BOOK, 1]]))).toMatchObject({ kind: 'custom' });
    });

    test('after reading, Reldo names Baraek', () => {
        expect(phoenixStep(at(SOA_STAGE.READ_BOOK))).toMatchObject({ kind: 'custom', name: 'ask Reldo for a quest' });
    });

    test('the bribe is funded before Baraek is approached', () => {
        expect(phoenixStep(at(SOA_STAGE.SENT_TO_BARAEK))).toMatchObject({ kind: 'withdraw' });
    });

    test('nineteen coins is not twenty', () => {
        expect(phoenixStep(at(SOA_STAGE.SENT_TO_BARAEK, [], [[SOA_ID.COINS, 19]]))).toMatchObject({ kind: 'withdraw' });
    });

    test('with the bribe in the pack Baraek is approached', () => {
        expect(phoenixStep(at(SOA_STAGE.SENT_TO_BARAEK, [], [[SOA_ID.COINS, 500]])))
            .toMatchObject({ kind: 'custom', name: 'bribe Baraek for the hideout' });
    });

    test('the located hideout sends the bot to Straven', () => {
        expect(phoenixStep(at(SOA_STAGE.FIND_STRAVEN, [], [[SOA_ID.COINS, 480]])))
            .toMatchObject({ kind: 'custom', name: 'offer Straven your services' });
    });

    test('the mission stage kills Jonny while no report is held', () => {
        expect(phoenixStep(at(SOA_STAGE.KILL_JONNY))).toMatchObject({ kind: 'custom' });
    });

    test('a held report is handed to Straven', () => {
        expect(phoenixStep(at(SOA_STAGE.KILL_JONNY, [], [[SOA_ID.REPORT, 1]])))
            .toMatchObject({ kind: 'custom', name: 'hand the report to Straven' });
    });

    test('the journal flag alone is enough to hand in, before the pack has synced', () => {
        expect(phoenixStep(at(SOA_STAGE.KILL_JONNY, ['report-held'])))
            .toMatchObject({ kind: 'custom', name: 'hand the report to Straven' });
    });

    test('a joined member without the half searches the chest', () => {
        expect(phoenixStep(at(SOA_STAGE.PHOENIX_JOINED))).toMatchObject({ kind: 'custom' });
    });

    test('a joined member holding the half asks for nothing more from this leg', () => {
        const step = phoenixStep(at(SOA_STAGE.PHOENIX_JOINED, ['own-half-only'], [[SOA_ID.SHIELD_PHOENIX, 1]]));
        expect(step.kind).toBe('wait');
    });

    // Why: `[oploc1,phoenixopenchest]` reads `inv_total(bank, arravshield1)`, so a banked half leaves the chest empty for good.
    test('a banked half is withdrawn, not searched for a second time', () => {
        const step = phoenixStep(at(SOA_STAGE.PHOENIX_JOINED, [], [], [[SOA_ID.SHIELD_PHOENIX, 1]]));
        expect(step).toMatchObject({ kind: 'withdraw' });
        expect((step as { items: { id: number }[] }).items[0].id).toBe(SOA_ID.SHIELD_PHOENIX);
    });

    // Why: the guard is the pack, never the split, so a stale bank read cannot make the withdraw repeat.
    test('a held half stops the withdraw even while the bank read still shows one', () => {
        const step = phoenixStep(
            at(SOA_STAGE.PHOENIX_JOINED, [], [[SOA_ID.SHIELD_PHOENIX, 1]], [[SOA_ID.SHIELD_PHOENIX, 1]])
        );
        expect(step.kind).toBe('wait');
    });

    test('an unread bank searches the chest rather than a booth it never opened', () => {
        const step = phoenixStep(at(SOA_STAGE.PHOENIX_JOINED, [], [], [[SOA_ID.SHIELD_PHOENIX, 1]], false));
        expect(step).toMatchObject({ kind: 'custom', name: 'search the Phoenix hideout chest' });
    });

    // Why: `~obj_gettotal` counts the bank, so Straven re-issues nothing while the key sits in a booth.
    test('a banked store key is withdrawn for the partner who is owed it', () => {
        ArravConfig.partner = 'Someone';
        const step = phoenixStep(at(SOA_STAGE.PHOENIX_JOINED, [], [], [[SOA_ID.STORE_KEY, 1]]));
        expect(step).toMatchObject({ kind: 'withdraw' });
        expect((step as { items: { id: number }[] }).items[0].id).toBe(SOA_ID.STORE_KEY);
    });

    test('a banked half and a banked key come out on one trip', () => {
        ArravConfig.partner = 'Someone';
        const step = phoenixStep(
            at(SOA_STAGE.PHOENIX_JOINED, [], [], [[SOA_ID.SHIELD_PHOENIX, 1], [SOA_ID.STORE_KEY, 1]])
        );
        expect((step as { items: { id: number }[] }).items.map(i => i.id))
            .toEqual([SOA_ID.SHIELD_PHOENIX, SOA_ID.STORE_KEY]);
    });

    test('a partnerless bot leaves the key where it is, since nothing it does needs one', () => {
        const step = phoenixStep(at(SOA_STAGE.PHOENIX_JOINED, [], [], [[SOA_ID.STORE_KEY, 1]]));
        expect(step).toMatchObject({ kind: 'custom', name: 'search the Phoenix hideout chest' });
    });

    test('a black arm stage is not this leg and says so', () => {
        const step = phoenixStep(at(SOA_STAGE.KATRINE_TASK));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('phoenix leg');
    });
});
