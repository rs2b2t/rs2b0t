import { beforeEach, describe, expect, test } from 'bun:test';
import { LoadoutPanel } from '#/bot/panel/LoadoutPanel.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';

beforeEach(() => {
    Loadouts.save([]);
    document.body.innerHTML = '';
});

function openPanel(): LoadoutPanel {
    const panel = new LoadoutPanel();
    document.body.appendChild(panel.root);
    panel.open();
    return panel;
}

describe('LoadoutPanel', () => {
    test('renders one cell per equipment slot', () => {
        const panel = openPanel();
        expect(panel.root.querySelectorAll('[data-slot]').length).toBe(11);
    });

    test('renders the six supply rows', () => {
        const panel = openPanel();
        expect(panel.root.querySelectorAll('[data-supply]').length).toBe(6);
    });

    test('new adds a second loadout beside the one you opened onto', () => {
        const panel = openPanel();
        (panel.root.querySelector('[data-action=new]') as HTMLButtonElement).click();
        expect(Loadouts.names()).toEqual(['loadout', 'loadout 2']);
    });

    test('picking an item for a slot persists it under that slot', () => {
        const panel = openPanel();
        (panel.root.querySelector('[data-slot=righthand]') as HTMLElement).click();
        const search = panel.root.querySelector('[data-role=item-search]') as HTMLInputElement;
        search.value = 'Rune scimitar';
        search.dispatchEvent(new Event('input'));
        (panel.root.querySelector('[data-item="Rune scimitar"]') as HTMLElement).click();
        expect(Loadouts.all()[0]!.worn.righthand).toBe('Rune scimitar');
    });

    test('a saved loadout renders back into its slots', () => {
        Loadouts.save([{ name: 'melee', worn: { righthand: 'Rune scimitar' }, carry: [] }]);
        const panel = openPanel();
        const cell = panel.root.querySelector('[data-slot=righthand]') as HTMLElement;
        expect(cell.getAttribute('data-item')).toBe('Rune scimitar');
    });

    test('clicking a filled slot clears it', () => {
        Loadouts.save([{ name: 'melee', worn: { righthand: 'Rune scimitar' }, carry: [] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-slot=righthand]') as HTMLElement).click();
        expect(Loadouts.all()[0]!.worn.righthand).toBeUndefined();
    });

    test('a two-handed weapon disables the shield slot', () => {
        Loadouts.save([{ name: 'melee', worn: { righthand: 'Rune 2h sword' }, carry: [] }]);
        const panel = openPanel();
        const shield = panel.root.querySelector('[data-slot=lefthand]') as HTMLElement;
        expect(shield.hasAttribute('data-disabled')).toBe(true);
    });

    test('setting a supply quantity persists it', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [] }]);
        const panel = openPanel();
        const row = panel.root.querySelector('[data-supply=Food]') as HTMLElement;
        (row.querySelector('[data-role=supply-item]') as HTMLElement).click();
        const search = panel.root.querySelector('[data-role=item-search]') as HTMLInputElement;
        search.value = 'Lobster';
        search.dispatchEvent(new Event('input'));
        (panel.root.querySelector('[data-item="Lobster"]') as HTMLElement).click();

        const qty = panel.root.querySelector('[data-supply=Food] input[type=number]') as HTMLInputElement;
        qty.value = '16';
        qty.dispatchEvent(new Event('change'));
        expect(Loadouts.all()[0]!.carry).toEqual([{ item: 'Lobster', qty: 16 }]);
    });

    test('a zero quantity removes the carried item', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [{ item: 'Lobster', qty: 16 }] }]);
        const panel = openPanel();
        const qty = panel.root.querySelector('[data-supply=Food] input[type=number]') as HTMLInputElement;
        qty.value = '0';
        qty.dispatchEvent(new Event('change'));
        expect(Loadouts.all()[0]!.carry).toEqual([]);
    });

    test('a supply row set while earlier rows are empty stays on its own row', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [] }]);
        const panel = openPanel();
        const prayer = panel.root.querySelector('[data-supply="Prayer potion"]') as HTMLElement;
        (prayer.querySelector('[data-role=supply-item]') as HTMLElement).click();
        const search = panel.root.querySelector('[data-role=item-search]') as HTMLInputElement;
        search.value = 'Prayer potion(4)';
        search.dispatchEvent(new Event('input'));
        (panel.root.querySelector('[data-item="Prayer potion(4)"]') as HTMLElement).click();

        // Food is still empty; the potion must not be rendered as the Food row.
        const food = panel.root.querySelector('[data-supply=Food] [data-role=supply-item]') as HTMLElement;
        const potionRow = panel.root.querySelector('[data-supply="Prayer potion"] [data-role=supply-item]') as HTMLElement;
        expect(food.textContent).toBe('choose…');
        expect(potionRow.textContent).toBe('Prayer potion(4)');
    });

    test('rename edits in place — Electron has no window.prompt', () => {
        Loadouts.save([{ name: 'melee', worn: { righthand: 'Rune scimitar' }, carry: [] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=rename]') as HTMLButtonElement).click();
        const field = panel.root.querySelector('[data-role=loadout-name]') as HTMLInputElement;
        expect(field).not.toBeNull();
        expect(field.value).toBe('melee');
    });

    test('committing a rename keeps the gear and drops the old name', () => {
        Loadouts.save([{ name: 'melee', worn: { righthand: 'Rune scimitar' }, carry: [] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=rename]') as HTMLButtonElement).click();
        const field = panel.root.querySelector('[data-role=loadout-name]') as HTMLInputElement;
        field.value = 'main melee';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(Loadouts.names()).toEqual(['main melee']);
        expect(Loadouts.byName('main melee')!.worn.righthand).toBe('Rune scimitar');
    });

    test('escape cancels a rename', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=rename]') as HTMLButtonElement).click();
        const field = panel.root.querySelector('[data-role=loadout-name]') as HTMLInputElement;
        field.value = 'nope';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(Loadouts.names()).toEqual(['melee']);
    });

    test('an empty rename leaves the name alone', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=rename]') as HTMLButtonElement).click();
        const field = panel.root.querySelector('[data-role=loadout-name]') as HTMLInputElement;
        field.value = '   ';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(Loadouts.names()).toEqual(['melee']);
    });

    test('renaming onto a taken name is uniquified rather than merging', () => {
        Loadouts.save([
            { name: 'melee', worn: {}, carry: [] },
            { name: 'range', worn: {}, carry: [] }
        ]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=rename]') as HTMLButtonElement).click();
        const field = panel.root.querySelector('[data-role=loadout-name]') as HTMLInputElement;
        field.value = 'range';
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(Loadouts.names().sort()).toEqual(['range', 'range 2']);
    });

    test('duplicating gives the copy a free name', () => {
        Loadouts.save([{ name: 'melee', worn: { righthand: 'Rune scimitar' }, carry: [] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=duplicate]') as HTMLButtonElement).click();
        expect(Loadouts.names()).toEqual(['melee', 'melee 2']);
        expect(Loadouts.byName('melee 2')!.worn.righthand).toBe('Rune scimitar');
    });

    test('deleting a loadout removes it', () => {
        Loadouts.save([
            { name: 'melee', worn: {}, carry: [] },
            { name: 'range', worn: {}, carry: [] }
        ]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=delete]') as HTMLButtonElement).click();
        expect(Loadouts.names()).toEqual(['range']);
    });

    test('deleting the last loadout leaves an empty one rather than a dead panel', () => {
        Loadouts.save([{ name: 'melee', worn: { righthand: 'Rune scimitar' }, carry: [] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=delete]') as HTMLButtonElement).click();
        expect(Loadouts.names()).toEqual(['loadout']);
        (panel.root.querySelector('[data-slot=hat]') as HTMLElement).click();
        expect(panel.root.querySelector('[data-role=item-search]')).not.toBeNull();
    });

    test('from worn fills the slots from what the character has on', () => {
        const panel = openPanel();
        (panel.root.querySelector('[data-action=from-worn]') as HTMLButtonElement).click();
        // No client attached, so nothing is worn — the point is it commits
        // cleanly rather than throwing or wiping the loadout out of existence.
        expect(Loadouts.names()).toEqual(['loadout']);
        expect(Loadouts.all()[0]!.worn).toEqual({});
    });

    test('from worn keeps the supplies you already set', () => {
        Loadouts.save([{ name: 'melee', worn: {}, carry: [{ item: 'Lobster', qty: 16 }] }]);
        const panel = openPanel();
        (panel.root.querySelector('[data-action=from-worn]') as HTMLButtonElement).click();
        expect(Loadouts.byName('melee')!.carry).toEqual([{ item: 'Lobster', qty: 16 }]);
    });

    test('opening with nothing saved gives you a loadout to edit', () => {
        const panel = openPanel();
        expect(Loadouts.names()).toEqual(['loadout']);
        expect(panel.root.querySelectorAll('[data-slot]').length).toBe(11);
        expect(panel.root.querySelector('[data-slot=righthand]')!.getAttribute('data-item')).toBeNull();
    });

    test('a slot click works on a freshly opened panel, without pressing new first', () => {
        const panel = openPanel();
        (panel.root.querySelector('[data-slot=hat]') as HTMLElement).click();
        expect(panel.root.querySelector('[data-role=item-search]')).not.toBeNull();
    });

    test('a supply click works on a freshly opened panel too', () => {
        const panel = openPanel();
        const row = panel.root.querySelector('[data-supply=Food]') as HTMLElement;
        (row.querySelector('[data-role=supply-item]') as HTMLElement).click();
        expect(panel.root.querySelector('[data-role=item-search]')).not.toBeNull();
    });
});
