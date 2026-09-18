import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { PriceBooks } from '#/bot/api/market/bookStore.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { PriceBookPanel } from '#/bot/panel/PriceBookPanel.js';
import { parseOrderbookFile } from '#/bot/api/market/orderbook-format.js';
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
    PriceBooks.save([
        {
            name: 'seers',
            margin: 20,
            maxTradeValue: 500_000,
            rows: Object.keys(ITEMS).map(id => ({ id: Number(id), mid: 100, cap: 0, buying: true, selling: true }))
        }
    ]);
    const panel = new PriceBookPanel();
    document.body.appendChild(panel.root);
    panel.open('seers');
    return panel;
}

const names = (panel: PriceBookPanel): string[] => Array.from(panel.root.querySelectorAll('.rs2b0t-pricebook-table .rs2b0t-pricebook-name')).map(n => n.textContent ?? '');

const filterBox = (panel: PriceBookPanel): HTMLInputElement => panel.root.querySelector('[data-role=book-filter]') as HTMLInputElement;

const table = (panel: PriceBookPanel): HTMLElement => panel.root.querySelector('.rs2b0t-pricebook-table') as HTMLElement;

function type(box: HTMLInputElement, text: string): void {
    box.focus();
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new Event('input'));
}

async function chooseImport(panel: PriceBookPanel, name: string, contents: string): Promise<void> {
    const input = panel.root.querySelector('[data-role=orderbook-import]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([contents], name)] });
    input.dispatchEvent(new Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
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

describe('transferring books', () => {
    test('exports either the selected book or every book', async () => {
        const panel = openPanel();
        PriceBooks.save([...PriceBooks.all(), { name: 'varrock', margin: 10, maxTradeValue: 1000, rows: [] }]);
        panel.open('seers');
        const blobs: Blob[] = [];
        const realCreate = URL.createObjectURL;
        const realRevoke = URL.revokeObjectURL;
        URL.createObjectURL = blob => {
            blobs.push(blob as Blob);
            return 'blob:test';
        };
        URL.revokeObjectURL = () => {};
        try {
            (panel.root.querySelector('[data-action=export-selected]') as HTMLButtonElement).click();
            (panel.root.querySelector('[data-action=export-all]') as HTMLButtonElement).click();
            expect(parseOrderbookFile(await blobs[0]!.text()).map(book => book.name)).toEqual(['seers']);
            expect(parseOrderbookFile(await blobs[1]!.text()).map(book => book.name)).toEqual(['seers', 'varrock']);
        } finally {
            URL.createObjectURL = realCreate;
            URL.revokeObjectURL = realRevoke;
        }
    });

    test('keeps the download URL alive after clicking a connected anchor', async () => {
        const panel = openPanel();
        const realClick = HTMLAnchorElement.prototype.click;
        const realCreate = URL.createObjectURL;
        const realRevoke = URL.revokeObjectURL;
        let connectedAtClick = false;
        let revoked = false;
        HTMLAnchorElement.prototype.click = function () {
            connectedAtClick = this.isConnected;
        };
        URL.createObjectURL = () => 'blob:test';
        URL.revokeObjectURL = () => {
            revoked = true;
        };
        try {
            (panel.root.querySelector('[data-action=export-selected]') as HTMLButtonElement).click();
            expect(connectedAtClick).toBe(true);
            expect(revoked).toBe(false);
            await new Promise(resolve => setTimeout(resolve, 1050));
            expect(revoked).toBe(true);
        } finally {
            HTMLAnchorElement.prototype.click = realClick;
            URL.createObjectURL = realCreate;
            URL.revokeObjectURL = realRevoke;
        }
    });

    test('shows export limit errors without changing storage or a staged import', async () => {
        const panel = openPanel();
        const before = Array.from({ length: 51 }, (_, i) => ({ name: `saved${i}`, margin: 5, maxTradeValue: 1000, rows: [] }));
        PriceBooks.save(before);
        panel.open('saved0');
        await chooseImport(panel, 'books.json', JSON.stringify([before[0]]));
        const realCreate = URL.createObjectURL;
        const realClick = HTMLAnchorElement.prototype.click;
        let created = false;
        let downloaded = false;
        URL.createObjectURL = () => {
            created = true;
            return 'blob:test';
        };
        HTMLAnchorElement.prototype.click = () => {
            downloaded = true;
        };
        try {
            (panel.root.querySelector('[data-action=export-all]') as HTMLButtonElement).click();
            expect(panel.root.querySelector('[data-role=import-error]')?.textContent).toContain('Could not export');
            expect(panel.root.querySelector('[data-role=import-error]')?.textContent).toContain('50 books');
            expect(panel.root.querySelector('[data-role=import-preview]')?.textContent).toContain('books.json');
            expect(PriceBooks.all()).toEqual(before);
            expect(created).toBe(false);
            expect(downloaded).toBe(false);
        } finally {
            URL.createObjectURL = realCreate;
            HTMLAnchorElement.prototype.click = realClick;
        }
    });

    test('stages filename, row counts and conflicts before Apply saves once', async () => {
        const panel = openPanel();
        const before = PriceBooks.all();
        const incoming = [
            { name: 'SEERS', margin: 5, maxTradeValue: 700, rows: [] },
            { name: 'ardougne', margin: 10, maxTradeValue: 900, rows: [{ id: 9999, mid: 8, cap: 4, buying: false, selling: true }] }
        ];
        await chooseImport(panel, 'books.json', JSON.stringify(incoming));

        expect(PriceBooks.all()).toEqual(before);
        expect(panel.root.querySelector('[data-role=import-preview]')?.textContent).toContain('books.json');
        expect(panel.root.querySelector('[data-role=import-preview]')?.textContent).toContain('SEERS: 0 rows');
        expect(panel.root.querySelector('[data-role=import-preview]')?.textContent).toContain('ardougne: 1 row');
        expect(panel.root.querySelector('[data-role=import-conflicts]')?.textContent).toContain('SEERS');

        (panel.root.querySelector('[data-action=apply-import]') as HTMLButtonElement).click();
        expect(PriceBooks.all()).toEqual(incoming);
        expect(panel.root.querySelector('[data-role=import-preview]')).toBeNull();
    });

    test('Cancel discards a staged import without changing storage', async () => {
        const panel = openPanel();
        const before = PriceBooks.all();
        await chooseImport(panel, 'books.json', JSON.stringify([{ ...before[0], name: 'other' }]));
        (panel.root.querySelector('[data-action=cancel-import]') as HTMLButtonElement).click();
        expect(PriceBooks.all()).toEqual(before);
        expect(panel.root.querySelector('[data-role=import-preview]')).toBeNull();
    });

    test('locks book edits until a staged import is cancelled', async () => {
        const panel = openPanel();
        const before = PriceBooks.all();
        await chooseImport(panel, 'books.json', JSON.stringify([{ ...before[0], name: 'other' }]));

        for (const action of ['new', 'rename', 'duplicate', 'delete']) {
            const button = panel.root.querySelector(`[data-action=${action}]`) as HTMLButtonElement;
            expect(button.disabled).toBe(true);
            button.click();
        }
        const toggle = panel.root.querySelector('[data-item="440"] [data-role=buying]') as HTMLButtonElement;
        expect(toggle.disabled).toBe(true);
        toggle.click();
        expect((panel.root.querySelector('[data-role=margin]') as HTMLInputElement).disabled).toBe(true);
        expect(PriceBooks.all()).toEqual(before);

        (panel.root.querySelector('[data-action=cancel-import]') as HTMLButtonElement).click();
        const enabledToggle = panel.root.querySelector('[data-item="440"] [data-role=buying]') as HTMLButtonElement;
        expect(enabledToggle.disabled).toBe(false);
        enabledToggle.click();
        expect(PriceBooks.byName('seers')?.rows.find(row => row.id === 440)?.buying).toBe(false);
    });

    test('requires another review when a new replacement appears before Apply', async () => {
        const panel = openPanel();
        const incoming = [{ name: 'other', margin: 5, maxTradeValue: 700, rows: [] }];
        await chooseImport(panel, 'books.json', JSON.stringify(incoming));
        const current = [...PriceBooks.all(), { ...incoming[0]!, maxTradeValue: 900 }];
        PriceBooks.save(current);

        (panel.root.querySelector('[data-action=apply-import]') as HTMLButtonElement).click();
        expect(PriceBooks.all()).toEqual(current);
        expect(panel.root.querySelector('[data-role=import-preview]')).not.toBeNull();
        expect(panel.root.querySelector('[data-role=import-conflicts]')?.textContent).toContain('other');

        (panel.root.querySelector('[data-action=apply-import]') as HTMLButtonElement).click();
        expect(PriceBooks.byName('other')?.maxTradeValue).toBe(700);
    });

    test('keeps the preview and storage when the merged collection exceeds its limit', async () => {
        const panel = openPanel();
        const books = (prefix: string) => Array.from({ length: 30 }, (_, i) => ({ name: `${prefix}${i}`, margin: 5, maxTradeValue: 1000, rows: [] }));
        const before = books('saved');
        PriceBooks.save(before);
        panel.open('saved0');
        await chooseImport(panel, 'books.json', JSON.stringify(books('imported')));

        expect(() => (panel.root.querySelector('[data-action=apply-import]') as HTMLButtonElement).click()).not.toThrow();
        expect(PriceBooks.all()).toEqual(before);
        expect(panel.root.querySelector('[data-role=import-preview]')?.textContent).toContain('books.json');
        expect(panel.root.querySelector('[data-role=import-error]')?.textContent).toContain('50 books');

        (panel.root.querySelector('[data-action=cancel-import]') as HTMLButtonElement).click();
        expect(panel.root.querySelector('[data-role=import-preview]')).toBeNull();
        expect(PriceBooks.all()).toEqual(before);
    });

    test('an invalid import shows an actionable error and leaves storage untouched', async () => {
        const panel = openPanel();
        const before = PriceBooks.all();
        await chooseImport(panel, 'broken.json', '[{"name":"bad"}]');
        expect(panel.root.querySelector('[data-role=import-error]')?.textContent).toContain('broken.json');
        expect(panel.root.querySelector('[data-role=import-error]')?.textContent).toContain('rows');
        expect(PriceBooks.all()).toEqual(before);
    });
});
