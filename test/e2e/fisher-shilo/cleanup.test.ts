import { expect, test } from 'bun:test';
import { isConfirmedLogout, logoutAfterCombat } from '../../../e2e/fisher-shilo/cleanup.js';

test('logs out when an attack requires leaving combat first', async () => {
    let attacked = true;
    const result = await logoutAfterCombat({
        inCombat: async () => attacked,
        leaveCombat: async () => { attacked = false; },
        logout: async () => !attacked
    });
    expect(result).toBe(true);
});
test('retries the logout button when the recent-combat cooldown rejects it once', async () => {
    let attempts = 0;
    const result = await logoutAfterCombat({
        inCombat: async () => false, leaveCombat: async () => {},
        logout: async () => ++attempts >= 2
    });
    expect(result).toBe(true);
});
test('reports failure rather than silently accepting repeated logout rejection', async () => {
    const result = await logoutAfterCombat({
        inCombat: async () => false, leaveCombat: async () => {}, logout: async () => false
    });
    expect(result).toBe(false);
});
test('does not accept a transient reconnect as logout', () => {
    expect(isConfirmedLogout({ ingame: false, loginUser: 'fsfixture', loginscreen: 0 })).toBe(false);
});
test('confirms the cleared client login state after logout', () => {
    expect(isConfirmedLogout({ ingame: false, loginUser: '', loginscreen: 0 })).toBe(true);
});
test('rejects an active login screen after disconnect', () => {
    expect(isConfirmedLogout({ ingame: false, loginUser: '', loginscreen: 2 })).toBe(false);
});
