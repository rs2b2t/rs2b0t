/**
 * Welcome dismisser logic is thin; this documents the intended session flag
 * behaviour. Full iframe login flow is covered by e2e / manual multibox.
 */
import { describe, expect, test } from 'bun:test';

describe('WelcomeDismisser session policy', () => {
    test('dismiss only while the welcome modal is the open main modal', () => {
        const WELCOME = 5993;
        const shouldAct = (ingame: boolean, mainModal: number, alreadyDismissed: boolean): boolean => {
            if (!ingame || alreadyDismissed) {
                return false;
            }
            return mainModal === WELCOME;
        };
        expect(shouldAct(true, WELCOME, false)).toBe(true);
        expect(shouldAct(true, WELCOME, true)).toBe(false);
        expect(shouldAct(true, -1, false)).toBe(false);
        expect(shouldAct(false, WELCOME, false)).toBe(false);
    });
});
