import { describe, expect, test, beforeEach } from 'bun:test';

import { EssenceSession } from '#/bot/event/webwalk/essenceSession.js';
import { worldStateFromData, emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import { meetsRequires } from '#/bot/event/webwalk/requires.js';

describe('EssenceSession (server varp not on wire)', () => {
    beforeEach(() => {
        EssenceSession._resetForTests();
    });

    test('noteEntryFromNpc maps wizard names', () => {
        expect(EssenceSession.noteEntryFromNpc('Aubury')).toBe('aubury');
        expect(EssenceSession.getReturnId()).toBe('aubury');
        expect(EssenceSession.noteEntryFromNpc('Wizard Cromperty')).toBe('cromperty');
        expect(EssenceSession.getReturnId()).toBe('cromperty');
        expect(EssenceSession.noteEntryFromNpc('Brimstail')).toBe('brimstail');
    });

    test('noteEntryFromCrossingLabel parses specialCrossing labels', () => {
        expect(EssenceSession.noteEntryFromCrossingLabel('Aubury → essence mine')).toBe('aubury');
        expect(EssenceSession.noteEntryFromCrossingLabel('Distentor → essence mine')).toBe('distentor');
        expect(EssenceSession.noteEntryFromCrossingLabel('Spirit tree → Village')).toBeNull();
    });

    test('Teleport transport notes entry; Portal Use does not', () => {
        expect(
            EssenceSession.noteEntryFromTransport({
                locName: 'Sedridor',
                action: 'Teleport',
                locX: 3106,
                locZ: 9572
            })
        ).toBe('sedridor');
        expect(
            EssenceSession.noteEntryFromTransport({
                locName: 'Portal',
                action: 'Use',
                locX: 2932,
                locZ: 4854
            })
        ).toBeNull();
        expect(EssenceSession.getReturnId()).toBe('sedridor');
    });

    test('harness override wins over session for live cheat-tele', () => {
        EssenceSession.noteEntry('aubury');
        EssenceSession.setHarnessOverride('brimstail');
        expect(EssenceSession.getReturnId()).toBe('brimstail');
        EssenceSession.clearHarnessOverride();
        expect(EssenceSession.getReturnId()).toBe('aubury');
    });

    test('session return gates exit requires like live WorldState', () => {
        EssenceSession.noteEntry('aubury');
        const state = worldStateFromData({
            ...emptyWorldStateData(),
            essenceExitReturn: EssenceSession.getReturnId()
        });
        expect(meetsRequires({ essenceExitReturn: 'aubury' }, state).ok).toBe(true);
        expect(meetsRequires({ essenceExitReturn: 'sedridor' }, state).ok).toBe(false);
    });
});
