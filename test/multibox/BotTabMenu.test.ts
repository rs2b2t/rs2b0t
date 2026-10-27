import { afterEach, expect, test } from 'bun:test';
import { BotTabMenu } from '#/bot/multibox/BotTabMenu.js';

let menu: BotTabMenu;
afterEach(() => {
    menu?.close();
    document.body.innerHTML = '';
});

function setup() {
    const moves: Array<[number, string]> = [];
    const rail = document.createElement('div');
    rail.tabIndex = 0;
    document.body.append(rail);
    menu = new BotTabMenu((id, tab) => moves.push([id, tab]));
    menu.open({ id: 7, tab: 'Main' }, ['Main', 'miners', '<alts>'], 20, 30, rail);
    return { moves, rail };
}

test('moves the selected bot to a named tab and closes the menu', () => {
    const { moves } = setup();
    const choices = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    expect(choices.map(button => button.textContent)).toEqual(['Main', 'miners', '<alts>']);
    expect(choices[0].disabled).toBe(true);
    expect(choices[0].getAttribute('aria-checked')).toBe('true');
    choices[2].click();
    expect(moves).toEqual([[7, '<alts>']]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
});

test('reopening for another bot uses its current membership and target id', () => {
    const { moves, rail } = setup();
    menu.open({ id: 11, tab: 'miners' }, ['Main', 'miners'], 30, 40, rail);
    expect(document.querySelectorAll('[role="menu"]').length).toBe(1);
    const main = document.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!;
    expect(main.disabled).toBe(false);
    main.click();
    expect(moves).toEqual([[11, 'Main']]);
});

test('Escape dismisses without moving and restores rail keyboard focus', () => {
    const { moves, rail } = setup();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(rail);
    expect(moves).toEqual([]);
});

test('keyboard navigation skips the current tab and wraps', () => {
    setup();
    expect(document.activeElement?.textContent).toBe('miners');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement?.textContent).toBe('<alts>');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement?.textContent).toBe('miners');
});

for (const trigger of ['pointerdown', 'wheel', 'blur', 'resize'] as const) {
    test(`${trigger} outside the menu dismisses without moving`, () => {
        const { moves } = setup();
        expect(document.querySelector('[role="menu"]')).not.toBeNull();
        if (trigger === 'pointerdown' || trigger === 'wheel') document.body.dispatchEvent(new Event(trigger, { bubbles: true }));
        else window.dispatchEvent(new Event(trigger));
        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(moves).toEqual([]);
    });
}

test('a delayed rail scroll does not dismiss a newly opened menu', () => {
    const { rail } = setup();
    rail.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
});
