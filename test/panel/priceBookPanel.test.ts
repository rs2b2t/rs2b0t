import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { PriceBooks } from '#/bot/api/market/bookStore.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { PriceBookPanel } from '#/bot/panel/PriceBookPanel.js';
import { boxKey } from '#/bot/runtime/box.js';
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

function selectImport(panel: PriceBookPanel, file: Pick<File, 'name' | 'text'>): void {
    const input = panel.root.querySelector('[data-role=orderbook-import]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
}

async function chooseImport(panel: PriceBookPanel, name: string, contents: string): Promise<void> {
    selectImport(panel, new File([contents], name));
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
    const buyField = '[data-item="440"] [data-role=buy]';
    const clearBuy = '[data-item="440"] [data-action=clear-buy]';

    function openPinnedPanel(): PriceBookPanel {
        const panel = openPanel();
        const buy = panel.root.querySelector<HTMLInputElement>(buyField)!;
        buy.value = '80';
        buy.dispatchEvent(new Event('change'));
        return panel;
    }

    test('saves the next price edit after a clear fails', () => {
        const panel = openPinnedPanel();
        const save = spyOn(PriceBooks, 'save').mockImplementationOnce(() => {
            throw new DOMException('storage full', 'QuotaExceededError');
        });
        const report = spyOn(console, 'error').mockImplementationOnce(() => {});
        try {
            panel.root.querySelector<HTMLButtonElement>(clearBuy)!.click();
        } finally {
            save.mockRestore();
            report.mockRestore();
        }

        const buy = panel.root.querySelector<HTMLInputElement>(buyField)!;
        expect(buy.value).toBe('80');
        buy.value = '81';
        buy.dispatchEvent(new Event('change'));
        sessionStorage.removeItem(boxKey('set:PriceBooks:books'));
        expect(PriceBooks.byName('seers')!.rows.find(row => row.id === 440)?.buy).toBe(81);
        panel.close();
    });

    test('refreshes the selection when clearing a pin in a deleted book', () => {
        const panel = openPinnedPanel();
        const book = PriceBooks.byName('seers')!;
        PriceBooks.save([book, { ...book, name: 'other' }]);
        const second = new PriceBookPanel();
        document.body.appendChild(second.root);
        second.open('seers');
        second.root.querySelector<HTMLButtonElement>('[data-action=delete]')!.click();
        second.close();

        const mid = panel.root.querySelector<HTMLInputElement>('[data-item="440"] [data-role=mid]')!;
        type(mid, '200');
        mid.addEventListener('blur', () => mid.dispatchEvent(new Event('change')), { once: true });
        const staleClear = panel.root.querySelector<HTMLButtonElement>(clearBuy)!;
        staleClear.click();
        expect(panel.root.querySelector<HTMLSelectElement>('select')!.value).toBe('other');
        expect(staleClear.isConnected).toBe(false);
        expect(PriceBooks.all()).toEqual([{ ...book, name: 'other' }]);
        panel.close();
    });

    test.each([
        { side: 'buy', edit: 'buy', pinned: '80', pending: '85', derived: '90' },
        { side: 'sell', edit: 'sell', pinned: '120', pending: '125', derived: '110' },
        { side: 'sell', edit: 'mid', pinned: '125', pending: '85', derived: '94' }
    ])('clears the $side pin while $edit has a pending edit', ({ side, edit, pinned, pending, derived }) => {
        const panel = openPanel();
        const row = '[data-item="440"]';
        const field = (role = side) => panel.root.querySelector<HTMLInputElement>(`${row} [data-role="${role}"]`)!;
        const input = field();
        input.value = pinned;
        input.dispatchEvent(new Event('change'));

        const editing = field(edit);
        type(editing, pending);
        let changed = false;
        const commitPending = () => {
            if (changed) return;
            changed = true;
            editing.dispatchEvent(new Event('change'));
        };
        editing.addEventListener('blur', commitPending, { once: true });
        const editor = panel.root.querySelector<HTMLElement>('.rs2b0t-pricebook')!;
        const replaceChildren = editor.replaceChildren.bind(editor);
        editor.replaceChildren = (...nodes) => {
            if (document.activeElement === editing) commitPending();
            replaceChildren(...nodes);
        };
        const clear = panel.root.querySelector<HTMLButtonElement>(`${row} [data-action="clear-${side}"]`)!;
        if (clear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))) {
            clear.focus();
        }
        if (clear.isConnected) {
            clear.click();
        }

        const saved = PriceBooks.byName('seers')!.rows.find(row => row.id === 440)!;
        expect(saved.mid).toBe(edit === 'mid' ? 85 : 100);
        expect(saved).not.toHaveProperty(side);
        expect(field().value).toBe(derived);
        panel.close();
    });

    test.each([
        { side: 'buy', other: 'sell', pin: '250', derived: '90', afterMid: '180', afterSpread: '160' },
        { side: 'sell', other: 'buy', pin: '75', derived: '110', afterMid: '220', afterSpread: '240' }
    ])('keeps $side derived and $other pinned after a stale panel toggles selling', ({ side, other, pin, derived, afterMid, afterSpread }) => {
        const panel = openPanel();
        const row = '[data-item="440"]';
        const field = (role: string) => panel.root.querySelector<HTMLInputElement>(`${row} input[data-role="${role}"]`)!;
        const clear = () => panel.root.querySelector<HTMLButtonElement>(`${row} button[data-action="clear-${side}"]`);
        const change = (input: HTMLInputElement, value: string) => {
            input.value = value;
            input.dispatchEvent(new Event('change'));
        };

        change(field('buy'), '80');
        change(field('sell'), '125');
        const second = new PriceBookPanel();
        document.body.appendChild(second.root);
        second.open('seers');
        change(second.root.querySelector<HTMLInputElement>(`${row} input[data-role="${other}"]`)!, pin);
        expect(clear()).not.toBeNull();
        clear()!.click();
        expect(clear()).toBeNull();
        expect(field(side).value).toBe(derived);
        expect(field(other).value).toBe(pin);

        second.root.querySelector<HTMLButtonElement>(`${row} [data-role=selling]`)!.click();
        second.close();
        const key = boxKey('set:PriceBooks:books');
        const [book] = JSON.parse(localStorage.getItem(key)!);
        expect(book.rows.find((r: { id: number }) => r.id === 440)).toEqual({
            id: 440, mid: 100, cap: 0, buying: true, selling: false, [other]: Number(pin)
        });
        panel.close();
        sessionStorage.removeItem(key);
        panel.open('seers');
        change(field('mid'), '200');
        expect(field(side).value).toBe(afterMid);
        change(panel.root.querySelector<HTMLInputElement>('[data-role=margin]')!, '40');
        expect(field(side).value).toBe(afterSpread);
        expect(field(other).value).toBe(pin);
        panel.close();
    });

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

    test.each(['buying', 'selling'] as const)('turning off %s in two open panels keeps it off', side => {
        const first = openPanel();
        const second = new PriceBookPanel();
        document.body.appendChild(second.root);
        second.open('seers');
        const toggle = (panel: PriceBookPanel) => panel.root.querySelector<HTMLButtonElement>(`[data-item="440"] [data-role="${side}"]`)!;

        toggle(first).click();
        expect(toggle(first).dataset.on).toBe('false');
        expect(toggle(second).dataset.on).toBe('true');
        toggle(second).click();

        expect(PriceBooks.byName('seers')!.rows.find(row => row.id === 440)![side]).toBe(false);
        expect(toggle(second).dataset.on).toBe('false');
        first.close();
        second.close();
    });

    test('a toggle keeps the scroll too', () => {
        const panel = openPanel();
        table(panel).scrollTop = 90;

        (panel.root.querySelector('[data-item="453"] [data-role=selling]') as HTMLButtonElement).click();

        expect(table(panel).scrollTop).toBe(90);
        expect(PriceBooks.byName('seers')?.rows.find(r => r.id === 453)?.selling).toBe(false);
    });
});

test('sets stock caps across the selected book, including filtered items', () => {
    const panel = openPanel();
    const book = PriceBooks.byName('seers')!;
    const other = { ...book, name: 'varrock' };
    PriceBooks.save([book, other]);
    type(filterBox(panel), 'coal');
    const input = panel.root.querySelector<HTMLInputElement>('[data-role=stock-cap]')!;
    const apply = panel.root.querySelector<HTMLButtonElement>('[data-action=set-all-caps]')!;
    expect(input).not.toBeNull();
    for (const invalid of ['', '-1', '1.5', 'bad', '2147483648']) {
        type(input, invalid);
        expect(apply.disabled).toBe(true);
    }
    type(input, '10k');
    expect(PriceBooks.byName('seers')).toEqual(book);
    apply.click();
    expect(PriceBooks.all()).toEqual([{ ...book, rows: book.rows.map(row => ({ ...row, cap: 10_000 })) }, other]);
    expect(names(panel)).toEqual(['Coal']);
    panel.open('seers');
    const reopened = panel.root.querySelector<HTMLInputElement>('[data-role=stock-cap]')!;
    expect(reopened.value).toBe('10000');
    type(reopened, '0');
    panel.root.querySelector<HTMLButtonElement>('[data-action=set-all-caps]')!.click();
    expect(PriceBooks.all()).toEqual([book, other]);
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

    test.each(['succeeds', 'fails'])('keeps the latest import when an older read %s afterward', async outcome => {
        const panel = openPanel();
        const before = PriceBooks.all();
        const book = { name: 'B', margin: 5, maxTradeValue: 700, rows: [] };
        const older = Promise.withResolvers<string>();
        selectImport(panel, { name: 'A.json', text: () => older.promise });
        await chooseImport(panel, 'B.json', JSON.stringify([book]));
        const preview = () => panel.root.querySelector('[data-role=import-preview]')?.textContent;
        expect(preview()).toBe('B.json: B: 0 rows');

        if (outcome === 'succeeds') {
            older.resolve(JSON.stringify([{ ...book, name: 'A' }]));
        } else {
            older.reject(new Error('read failed'));
        }
        await Promise.resolve();

        expect(preview()).toBe('B.json: B: 0 rows');
        expect(panel.root.querySelector('[data-role=import-error]')).toBeNull();
        panel.root.querySelector<HTMLButtonElement>('[data-action=apply-import]')!.click();
        expect(PriceBooks.all()).toEqual([...before, book]);
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
