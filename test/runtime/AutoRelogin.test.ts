import { describe, expect, test } from 'bun:test';
import { AutoRelogin } from '#/bot/runtime/AutoRelogin.js';

describe('AutoRelogin title-screen flag (#215)', () => {
    test('isAutoLogin mirrors setAutoLogin', () => {
        AutoRelogin.setAutoLogin(true);
        expect(AutoRelogin.isAutoLogin()).toBe(true);
        AutoRelogin.setAutoLogin(false);
        expect(AutoRelogin.isAutoLogin()).toBe(false);
    });
});
