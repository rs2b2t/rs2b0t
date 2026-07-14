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

// ---- collapsible groups + showIf visibility ----
const styled: SettingsSchema = {
    style: { type: 'string', default: 'melee', options: ['melee', 'mage'], label: 'Style' },
    spell: { type: 'string', default: 'Wind Strike', label: 'Spell', group: 'Combat', showIf: { key: 'style', anyOf: ['mage'] } },
    weapon: { type: 'string', default: '', label: 'Weapon', group: 'Combat', showIf: { key: 'style', anyOf: ['mage'] } },
    food: { type: 'string', default: 'Lobster', label: 'Food', group: 'Food' }
};

test('showIf rows are hidden until the master dropdown matches, and re-render in place', () => {
    const modal = new ParamsModal(() => false, () => {});
    modal.open('Styled', styled);
    // melee: whole Combat group hidden (every row conditioned away), Food shown
    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(2); // style + food
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).map(g => g.textContent)).toEqual(['▾ Food']);

    const sel = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement;
    sel.value = 'mage';
    sel.dispatchEvent(new Event('change'));

    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(4);
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).map(g => g.textContent)).toEqual(['▾ Combat', '▾ Food']);
    modal.close();
});

test('group headers collapse/expand and remember state across re-renders', () => {
    SettingsStore.save('Styled2', 'style', 'mage');
    const modal = new ParamsModal(() => false, () => {});
    modal.open('Styled2', styled);

    const combat = Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat')) as HTMLButtonElement;
    combat.click();
    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(2); // style + food; Combat collapsed
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat'))?.textContent).toBe('▸ Combat');

    // collapsed state survives a dependency re-render
    const sel = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement;
    sel.value = 'melee';
    sel.dispatchEvent(new Event('change'));
    sel.value = 'mage';
    // re-query: the body re-rendered
    const sel2 = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement;
    sel2.value = 'mage';
    sel2.dispatchEvent(new Event('change'));
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat'))?.textContent).toBe('▸ Combat');

    const combat2 = Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat')) as HTMLButtonElement;
    combat2.click();
    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(4);
    modal.close();
});
