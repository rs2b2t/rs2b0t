import { beforeEach, expect, test } from 'bun:test';
import ParamsModal from '#/bot/panel/ParamsModal.js';
import { SettingsStore, type SettingsSchema } from '#/bot/runtime/Settings.js';

const schema: SettingsSchema = {
    leash: { type: 'number', default: 8, min: 2, max: 30, label: 'Leash radius' },
    mode: { type: 'string', default: 'Auto', options: ['Auto', 'None'], label: 'Banking' }
};

beforeEach(() => {
    // ParamsModal writes settings, and SettingsStore persists to both
    // storages — leaving either behind changes what a later test file reads.
    document.body.replaceChildren();
    sessionStorage.clear();
    localStorage.clear();
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

const styled: SettingsSchema = {
    style: { type: 'string', default: 'melee', options: ['melee', 'mage'], label: 'Style' },
    spell: { type: 'string', default: 'Wind Strike', label: 'Spell', group: 'Combat', showIf: { key: 'style', anyOf: ['mage'] } },
    weapon: { type: 'string', default: '', label: 'Weapon', group: 'Combat', showIf: { key: 'style', anyOf: ['mage'] } },
    food: { type: 'string', default: 'Lobster', label: 'Food', group: 'Food' }
};

test('showIf rows are hidden until the master dropdown matches, and re-render in place', () => {
    const modal = new ParamsModal(() => false, () => {});
    modal.open('Styled', styled);
    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(2);
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).map(g => g.textContent)).toEqual(['▾ Food']);

    const sel = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement;
    sel.value = 'mage';
    sel.dispatchEvent(new Event('change'));

    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(4);
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).map(g => g.textContent)).toEqual(['▾ Combat', '▾ Food']);
    modal.close();
});

test('Escape closes the open modal and stops propagation (nested hosts)', () => {
    const modal = new ParamsModal(() => false, () => {});
    modal.open('DemoEsc', schema);
    expect(modal.isOpen()).toBe(true);

    let outerSawEscape = false;
    const outer = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            outerSawEscape = true;
        }
    };
    // Same phase/order as WorldMapPicker window keydown (bubble on window).
    window.addEventListener('keydown', outer);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', outer);

    expect(modal.isOpen()).toBe(false);
    expect(outerSawEscape).toBe(false);
});

test('script params disable while active, with a lock banner', () => {
    const modal = new ParamsModal(() => true, () => {});
    modal.open('DemoLock', schema);
    const intro = document.querySelector('.rs2b0t-param-intro');
    expect(intro?.textContent ?? '').toContain('Script is running');
    expect(intro?.textContent ?? '').toContain('Global settings');
    const sel = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement | null;
    const range = document.querySelector('.rs2b0t-param-range') as HTMLInputElement | null;
    expect(sel?.disabled ?? range?.disabled).toBe(true);
    modal.close();
});

test('Global settings stay editable while a script is active', () => {
    const globalSchema: SettingsSchema = {
        lampSkill: {
            type: 'string',
            default: 'strength',
            options: ['strength', 'mining', 'attack'],
            label: 'Genie lamp skill'
        }
    };
    const modal = new ParamsModal(() => true, () => {});
    modal.open('Global', globalSchema, { title: 'Global settings' });
    expect(document.querySelector('.rs2b0t-param-intro')).toBeNull();
    const sel = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement;
    expect(sel.disabled).toBe(false);
    sel.value = 'mining';
    sel.dispatchEvent(new Event('change'));
    expect(SettingsStore.saved('Global', 'lampSkill')).toBe('mining');
    modal.close();
});

test('group headers collapse/expand and remember state across re-renders', () => {
    SettingsStore.save('Styled2', 'style', 'mage');
    const modal = new ParamsModal(() => false, () => {});
    modal.open('Styled2', styled);

    const combat = Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat')) as HTMLButtonElement;
    combat.click();
    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(2);
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat'))?.textContent).toBe('▸ Combat');

    const sel = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement;
    sel.value = 'melee';
    sel.dispatchEvent(new Event('change'));
    sel.value = 'mage';
    const sel2 = document.querySelector('.rs2b0t-param-select') as HTMLSelectElement;
    sel2.value = 'mage';
    sel2.dispatchEvent(new Event('change'));
    expect(Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat'))?.textContent).toBe('▸ Combat');

    const combat2 = Array.from(document.querySelectorAll('.rs2b0t-param-group')).find(g => g.textContent?.includes('Combat')) as HTMLButtonElement;
    combat2.click();
    expect(document.querySelectorAll('.rs2b0t-param-row').length).toBe(4);
    modal.close();
});
