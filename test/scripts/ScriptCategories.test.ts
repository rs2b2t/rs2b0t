import { expect, test } from 'bun:test';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import ScriptLibrary from '#/bot/panel/ScriptLibrary.js';
import '#/bot/scripts/index.js';

test('Firemaker appears in the Firemaking category', () => {
    expect(ScriptRegistry.get('Firemaker')?.category).toBe('Firemaking');
});

test('the script selector renders Firemaker under its Firemaking filter', () => {
    document.body.replaceChildren();
    const library = new ScriptLibrary(() => {});
    library.open();

    const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.rs2b0t-chip'));
    const firemaking = chips.find(chip => chip.textContent?.startsWith('Firemaking '));
    expect(firemaking).toBeDefined();
    expect(chips.some(chip => chip.textContent?.startsWith('Skilling '))).toBe(false);

    firemaking!.click();
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.rs2b0t-library-card'));
    expect(cards.map(card => card.querySelector('.rs2b0t-card-name')?.textContent)).toEqual(['Firemaker']);
    expect(cards[0]?.querySelector('.rs2b0t-card-cat')?.textContent).toBe('Firemaking');
});

test('category chips list All first, then the rest alphabetically', () => {
    document.body.replaceChildren();
    const library = new ScriptLibrary(() => {});
    library.open();

    const labels = Array.from(document.querySelectorAll<HTMLButtonElement>('.rs2b0t-chip')).map(chip => chip.textContent!.replace(/ \(\d+\)$/, ''));
    expect(labels[0]).toBe('All');
    const rest = labels.slice(1);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(rest).toContain('Combat');
    expect(rest.indexOf('Combat')).toBeLessThan(rest.indexOf('Woodcutting'));
});

test('the library lists its cards alphabetically, whatever order they registered in', () => {
    document.body.replaceChildren();
    const library = new ScriptLibrary(() => {});
    library.open();

    const names = Array.from(document.querySelectorAll<HTMLElement>('.rs2b0t-card-name')).map(el => el.textContent!);
    expect(names.length).toBe(ScriptRegistry.list().length);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(ScriptRegistry.list().map(m => m.name)).not.toEqual(names);
});

test('Escape closes the open script selector and stops propagation to outer handlers', () => {
    document.body.replaceChildren();
    const library = new ScriptLibrary(() => {});
    library.open();

    let outerSawEscape = false;
    const outer = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            outerSawEscape = true;
        }
    };
    window.addEventListener('keydown', outer);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.removeEventListener('keydown', outer);

    expect(library.isOpen()).toBe(false);
    expect(outerSawEscape).toBe(false);
});
