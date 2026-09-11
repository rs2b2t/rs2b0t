import { describe, expect, test } from 'bun:test';

import { CC_LOGOUT, finishRelog, logoutIfaceId, titleAfterLogoutPress } from '../../e2e/lib/cleanLogout.js';

describe('clean logout (274bot Relog)', () => {
    test('presses the CC_LOGOUT iface, not a hardcoded 2458', () => {
        const ifaces: Array<{ clientCode: number } | null | undefined> = Array.from({ length: 10 }, () => null);
        ifaces[7] = { clientCode: CC_LOGOUT };
        ifaces[2458] = undefined;
        expect(logoutIfaceId(ifaces)).toBe(7);
    });

    test('missing CC_LOGOUT iface is false, no panic', () => {
        expect(logoutIfaceId([])).toBe(null);
        expect(logoutIfaceId([{ clientCode: 1 }, null])).toBe(null);
    });

    test('a dead socket after the press goes to title, not lostCon reconnect', () => {
        expect(titleAfterLogoutPress({ ingame: true, logoutTimer: 250, remoteClosed: true })).toBe('title');
        expect(titleAfterLogoutPress({ ingame: false, logoutTimer: 0, remoteClosed: true })).toBe('title');
    });

    test('an armed timer that already expired on a dead socket is the lostCon overlay', () => {
        expect(titleAfterLogoutPress({ ingame: true, logoutTimer: 0, remoteClosed: true })).toBe('lost-con-reconnect');
    });

    test('still connected after the press stays ingame until LOGOUT or close', () => {
        expect(titleAfterLogoutPress({ ingame: true, logoutTimer: 250, remoteClosed: false })).toBe('ingame');
    });

    test('Relog does not DC-wait: a dead socket titles even if the 250-frame timer already ran out', () => {
        expect(finishRelog(true, true)).toBe('title-now');
        expect(finishRelog(false, true)).toBe('done');
        expect(finishRelog(true, false)).toBe('wait');
    });
});
