import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { PriceBooks } from '#/bot/api/market/bookStore.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { PriceBookPanel } from '#/bot/panel/PriceBookPanel.js';
import { resetObjCatalog } from '#/bot/adapter/ClientAdapter.js';
import ObjType from '#/client/config/ObjType.js';

const realList = ObjType.list;
const realCount = ObjType.numDefinitions;

const ITEMS: Record<number, string> = {
    440: 'Iron ore',
    453: 'Coal',
    1515: 'Yew logs',
    1127: 'Rune platebody',
    1079: 'Rune platelegs',
    561: 'Nature rune'
};

function stubCatalog(): void {
    ObjType.numDefinitions = Math.max(...Object.keys(ITEMS).map(Number)) + 1;
    ObjType.list = ((id: number) => {
        const base = new ObjType();
        base.id = id;
        base.name = ITEMS[id] ?? null;
        base.cost = 10;
        base.certlink = -1;
        base.certtemplate = -1;
        base.countobj = null;
        return base;
    }) as typeof ObjType.list;
    resetObjCatalog();
    resetLiveCatalog();
}

function openPanel(): PriceBookPanel {
    PriceBooks.save([{
        name: 'seers',
        margin: 20,
        maxTradeValue: 500_000,
        rows: Object.keys(ITEMS).map(id => ({ id: Number(id), mid: 100, cap: 0, buying: true, selling: true }))
    }]);
    const panel = new PriceBookPanel();
    document.body.appendChild(panel.root);
    panel.open('seers');
    return panel;
}

const names = (panel: PriceBookPanel): string[] =>
    Array.from(panel.root.querySelectorAll('.rs2b0t-pricebook-table .rs2b0t-pricebook-name')).map(n => n.textContent ?? '');

const filterBox = (panel: PriceBookPanel): HTMLInputElement =>
    panel.root.querySelector('[data-role=book-filter]') as HTMLInputElement;

const table = (panel: PriceBookPanel): HTMLElement =>
    panel.root.querySelector('.rs2b0t-pricebook-table') as HTMLElement;

function type(box: HTMLInputElement, text: string): void {
    box.focus();
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new Event('input'));
}

beforeEach(() => {
    stubCatalog();
    PriceBooks.save([]);
    document.body.innerHTML = '';
});

afterEach(() => {
    ObjType.list = realList;
    ObjType.numDefinitions = realCount;
    resetObjCatalog();
    resetLiveCatalog();
});

describe('filtering the book', () => {
    test('narrows the table to what was typed', () => {
        const panel = openPanel();
        expect(names(panel).length).toBe(6);

        type(filterBox(panel), 'rune');
        expect(names(panel).sort()).toEqual(['Nature rune', 'Rune platebody', 'Rune platelegs']);
    });

    test('letters in order are enough', () => {
        const panel = openPanel();
        type(filterBox(panel), 'rnplt');
        expect(names(panel)).toEqual(['Rune platebody', 'Rune platelegs']);
    });

    test('clearing it brings the book back', () => {
        const panel = openPanel();
        type(filterBox(panel), 'coal');
        expect(names(panel)).toEqual(['Coal']);

        type(filterBox(panel), '');
        expect(names(panel).length).toBe(6);
    });

    test('a query that matches nothing says so rather than showing everything', () => {
        const panel = openPanel();
        type(filterBox(panel), 'zzzz');
        expect(names(panel)).toEqual([]);
        expect(panel.root.querySelector('.rs2b0t-pricebook-empty')?.textContent).toContain('zzzz');
    });

    // Why: the box re-renders the panel on every keystroke, so without this the caret leaves after the first letter.
    test('keeps the caret in the box while you type', () => {
        const panel = openPanel();
        type(filterBox(panel), 'run');

        const box = filterBox(panel);
        expect(document.activeElement === box).toBe(true);
        expect(box.selectionStart).toBe(3);
        expect(box.value).toBe('run');
    });
});

// Why: every edit commits through the store and rebuilds the panel, which used to drop the table back to the first row.
describe('editing a row', () => {
    test('leaves the table where it was scrolled to', () => {
        const panel = openPanel();
        table(panel).scrollTop = 140;

        const cell = panel.root.querySelector('[data-item="1515"] [data-role=mid]') as HTMLInputElement;
        cell.value = '250';
        cell.dispatchEvent(new Event('change'));

        expect(table(panel).scrollTop).toBe(140);
    });

    test('leaves the cursor in the cell it was typed into', () => {
        const panel = openPanel();
        const cell = panel.root.querySelector('[data-item="1515"] [data-role=buy]') as HTMLInputElement;
        cell.focus();
        cell.value = '300';
        cell.dispatchEvent(new Event('change'));

        const after = panel.root.querySelector('[data-item="1515"] [data-role=buy]') as HTMLInputElement;
        expect(document.activeElement === after).toBe(true);
        expect(after.value).toBe('300');
    });

    test('the edit still reaches the book', () => {
        const panel = openPanel();
        const cell = panel.root.querySelector('[data-item="440"] [data-role=mid]') as HTMLInputElement;
        cell.value = '2.5K';
        cell.dispatchEvent(new Event('change'));

        expect(PriceBooks.byName('seers')?.rows.find(r => r.id === 440)?.mid).toBe(2500);
    });

    // Why: the browser scrolls a focused field into view, and it measures that against rows the render has not laid out yet, so restoring the offset before the focus lands the table near the top.
    test('the offset survives the focus that the restore itself causes', () => {
        const panel = openPanel();
        const cell = panel.root.querySelector('[data-item="1515"] [data-role=mid]') as HTMLInputElement;
        cell.focus();
        table(panel).scrollTop = 140;
        // Stand in for the browser's scroll-into-view, which happy-dom does not do on its own.
        panel.root.addEventListener('focusin', () => (table(panel).scrollTop = 0));

        cell.value = '250';
        cell.dispatchEvent(new Event('change'));

        expect(table(panel).scrollTop).toBe(140);
    });

    test('a toggle keeps the scroll too', () => {
        const panel = openPanel();
        table(panel).scrollTop = 90;

        (panel.root.querySelector('[data-item="453"] [data-role=selling]') as HTMLButtonElement).click();

        expect(table(panel).scrollTop).toBe(90);
        expect(PriceBooks.byName('seers')?.rows.find(r => r.id === 453)?.selling).toBe(false);
    });
});
