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
