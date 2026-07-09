// test/ui/params-modal.test.ts
import { beforeEach, expect, test } from 'bun:test';
import ParamsModal from '#/bot/ui/ParamsModal.js';
import { SettingsStore, type SettingsSchema } from '#/bot/runtime/Settings.js';

const schema: SettingsSchema = {
    leash: { type: 'number', default: 8, min: 2, max: 30, label: 'Leash radius' },
    mode: { type: 'string', default: 'Auto', options: ['Auto', 'None'], label: 'Banking' }
};

// happy-dom shares one document across tests in a file; each ParamsModal appends
// its backdrop to document.body in the constructor and never removes it. Reset
// the body between tests so document.querySelector targets this test's modal.
beforeEach(() => {
    document.body.replaceChildren();
});

test('open renders one row per parameter and closes', () => {
    const modal = new ParamsModal(() => false, () => {});
    modal.open('Demo', schema);
    expect(modal.isOpen()).toBe(true);
    const rows = document.querySelectorAll('.rs2b0t-param-row');
    expect(rows.length).toBe(2);
    modal.close();
    expect(modal.isOpen()).toBe(false);
});

test('editing a control live-saves through SettingsStore + fires onChanged', () => {
    let changed = 0;
    const modal = new ParamsModal(() => false, () => (changed += 1));
    modal.open('Demo2', schema);
    const range = document.querySelector('.rs2b0t-param-range') as HTMLInputElement;
    range.value = '12';
    range.dispatchEvent(new Event('input'));
    expect(SettingsStore.saved('Demo2', 'leash')).toBe('12');
    expect(changed).toBeGreaterThan(0);
    modal.close();
});
