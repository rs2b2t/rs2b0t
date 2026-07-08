// test/ui/param-controls-dom.test.ts
import { expect, test } from 'bun:test';
import { renderControl } from '#/bot/ui/paramControls.js';
import type { SettingDef } from '#/bot/runtime/Settings.js';

const def = (d: Partial<SettingDef> & Pick<SettingDef, 'type' | 'default'>): SettingDef => d as SettingDef;

test('slider edit fires onChange with the numeric string', () => {
    let saved = '';
    const elc = renderControl(def({ type: 'number', default: 5, min: 0, max: 10 }), '5', v => (saved = v), { disabled: false });
    const range = elc.querySelector('input[type=range]') as HTMLInputElement;
    expect(range).not.toBeNull();
    range.value = '8';
    range.dispatchEvent(new Event('input'));
    expect(saved).toBe('8');
    // the numeric box mirrors it
    const num = elc.querySelector('input[type=number]') as HTMLInputElement;
    expect(num.value).toBe('8');
});

test('multiselect edit saves the comma-joined selection', () => {
    let saved = '';
    const elc = renderControl(def({ type: 'string[]', default: [], options: ['Iron', 'Coal', 'Gold'] }), 'Iron', v => (saved = v), { disabled: false });
    document.body.appendChild(elc); // happy-dom v20: click() fires change only on connected nodes
    const boxes = Array.from(elc.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true); // Iron
    boxes[1].click(); // check Coal
    expect(saved).toBe('Iron, Coal');
});

test('checkbox edit saves true/false', () => {
    let saved = '';
    const elc = renderControl(def({ type: 'boolean', default: false }), 'false', v => (saved = v), { disabled: false });
    document.body.appendChild(elc); // happy-dom v20: click() fires change only on connected nodes
    const box = elc.querySelector('input[type=checkbox]') as HTMLInputElement;
    box.click();
    expect(saved).toBe('true');
});

test('tile edit saves x,z,level', () => {
    let saved = '';
    const elc = renderControl(def({ type: 'tile', default: null }), '2661,3306,0', v => (saved = v), { disabled: false });
    const fields = Array.from(elc.querySelectorAll('input[type=number]')) as HTMLInputElement[];
    fields[0].value = '2662';
    fields[0].dispatchEvent(new Event('change'));
    expect(saved).toBe('2662,3306,0');
});

test('disabled applies to every input', () => {
    const elc = renderControl(def({ type: 'string', default: 'a' }), 'a', () => {}, { disabled: true });
    expect((elc.querySelector('input') as HTMLInputElement).disabled).toBe(true);
});
