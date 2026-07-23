import { expect, test } from 'bun:test';

import { ActionRouter } from '#/bot/input/ActionRouter.js';

test('the router always returns the direct driver', () => {
    expect(ActionRouter.driver.mode).toBe('direct');
});

test('beginRun takes only a log sink (no input-mode arg)', () => {
    expect(ActionRouter.beginRun.length).toBe(1);
});
