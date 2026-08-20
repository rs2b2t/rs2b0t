import { describe, expect, test } from 'bun:test';
import { WELCOME_SCREEN } from '#/bot/adapter/ClientAdapter.js';
import { welcomeNeedsDismiss } from '#/bot/runtime/WelcomeScreen.js';

describe('WelcomeDismisser', () => {
    test('keeps closing while the welcome modal is still the main modal', () => {
        expect(welcomeNeedsDismiss(true, WELCOME_SCREEN)).toBe(true);
        expect(welcomeNeedsDismiss(true, WELCOME_SCREEN)).toBe(true);
        expect(welcomeNeedsDismiss(true, -1)).toBe(false);
        expect(welcomeNeedsDismiss(false, WELCOME_SCREEN)).toBe(false);
    });
});
