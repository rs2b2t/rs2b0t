import { PriceBooks } from '../api/market/bookStore.js';
import { liveCatalog, type Catalog } from '../api/market/catalog.js';
import {
    DEFAULT_MARGIN,
    DEFAULT_MAX_TRADE,
    removeBook,
    uniqueBookName,
    upsertBook,
    type PriceBook
} from '../api/market/priceBook.js';
import { el } from './dom.js';
import { itemIconDataUrl } from './itemIcon.js';
import {
    addRow,
    displayRows,
    dropRow,
    pickerRows,
    setField,
    setMargin,
    setMaxTradeValue,
    toggleSide,
    type DisplayRow
} from './priceBookPanelLogic.js';

const ICON_FILL_MS = 500;
const ICON_FILL_TRIES = 12;
const PICKER_LIMIT = 60;

/**
 * Editor for the player's named price books.
 * Why: every mutation goes through the store and re-renders, so no in-memory copy can drift from what is saved.
 */
export class PriceBookPanel {
    readonly root = el('div', 'rs2b0t-loadout-backdrop');
    private readonly window = el('div', 'rs2b0t-loadout-panel rs2b0t-pricebook');

    private selected: string | null = null;
    private query = '';
    private adding = false;
    private renaming = false;
    private iconTries = 0;
    private iconTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.root.style.display = 'none';
        // Why: the Edit… button opens this from inside the params modal, which shares z-index 1000.
        this.root.style.zIndex = '1001';
        this.root.appendChild(this.window);
        this.root.addEventListener('click', e => {
            if (e.target === this.root) {
                this.close();
            }
        });
    }

    open(bookName?: string): void {
        this.root.style.display = 'flex';
        this.ensureBook();
        const names = PriceBooks.names();
        const wanted = bookName?.trim().toLowerCase();
        this.selected = names.find(n => n.toLowerCase() === wanted) ?? names[0] ?? null;
        this.adding = false;
        this.renaming = false;
        this.query = '';
        this.iconTries = 0;
        this.render();
    }

    close(): void {
        this.root.style.display = 'none';
        this.adding = false;
        this.stopIconFill();
    }

    isOpen(): boolean {
        return this.root.style.display === 'flex';
    }

    /**
     * Never sit on nothing.
     * Why: every field writes into a book, and with none selected they are silent no-ops that make the panel look broken rather than empty.
     */
    private ensureBook(): void {
        if (PriceBooks.all().length === 0) {
            PriceBooks.save([{ name: 'prices', margin: DEFAULT_MARGIN, maxTradeValue: DEFAULT_MAX_TRADE, rows: [] }]);
        }
    }

    private current(): PriceBook | null {
        return this.selected === null ? null : PriceBooks.byName(this.selected);
    }

    private commit(next: PriceBook): void {
        PriceBooks.save(upsertBook(PriceBooks.all(), next));
        this.selected = next.name;
        this.render();
    }

    private render(): void {
        this.window.replaceChildren();
        this.window.appendChild(this.header());
        const book = this.current();
        if (book) {
            this.window.appendChild(this.bookFields(book));
            this.window.appendChild(this.table(book, liveCatalog()));
            this.window.appendChild(this.addBar());
            if (this.adding) {
                this.window.appendChild(this.picker(book, liveCatalog()));
            }
        }
        if (this.fillIcons() > 0) {
            this.scheduleIconFill();
        }
    }

    private header(): HTMLElement {
        const bar = el('div', 'rs2b0t-loadout-header');

        const title = el('span', 'rs2b0t-loadout-title');
        title.textContent = 'Price book';
        bar.appendChild(title);

        bar.appendChild(this.renaming ? this.nameField() : this.namePicker());

        bar.appendChild(this.action('new', '+ new', () => {
            this.commit({
                name: uniqueBookName(PriceBooks.all(), 'prices'),
                margin: DEFAULT_MARGIN,
                maxTradeValue: DEFAULT_MAX_TRADE,
                rows: []
            });
        }));
        bar.appendChild(this.action('rename', 'rename', () => {
            if (this.current()) {
                this.renaming = true;
                this.render();
            }
        }));
        bar.appendChild(this.action('duplicate', 'duplicate', () => {
            const from = this.current();
            if (from) {
                this.commit({ ...from, name: uniqueBookName(PriceBooks.all(), from.name), rows: [...from.rows] });
            }
        }));
        bar.appendChild(this.action('delete', 'delete', () => {
            if (this.selected === null) {
                return;
            }
            PriceBooks.save(removeBook(PriceBooks.all(), this.selected));
            this.ensureBook();
            this.selected = PriceBooks.names()[0] ?? null;
            this.adding = false;
            this.render();
        }));
        bar.appendChild(this.action('close', '✕', () => this.close()));
        return bar;
    }

    private namePicker(): HTMLElement {
        const select = el('select', 'rs2b0t-select');
        for (const name of PriceBooks.names()) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            opt.selected = name === this.selected;
            select.appendChild(opt);
        }
        select.addEventListener('change', () => {
            this.selected = select.value;
            this.adding = false;
            this.render();
        });
        return select;
    }

    /** Renames edit in place; Electron has no `window.prompt`. */
    private nameField(): HTMLElement {
        const field = el('input', 'rs2b0t-input rs2b0t-loadout-name');
        field.type = 'text';
        field.dataset.role = 'book-name';
        field.value = this.current()?.name ?? '';
        field.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                this.commitRename(field.value);
            } else if (e.key === 'Escape') {
                this.renaming = false;
                this.render();
            }
        });
        field.addEventListener('blur', () => {
            if (this.renaming) {
                this.commitRename(field.value);
            }
        });
        setTimeout(() => {
            field.focus();
            field.select();
        }, 0);
        return field;
    }

    private commitRename(raw: string): void {
        const from = this.current();
        this.renaming = false;
        const typed = raw.trim();
        if (!from || typed.length === 0 || typed.toLowerCase() === from.name.toLowerCase()) {
            this.render();
            return;
        }
        const without = removeBook(PriceBooks.all(), from.name);
        const name = uniqueBookName(without, typed);
        PriceBooks.save(upsertBook(without, { ...from, name }));
        this.selected = name;
        this.render();
    }

    private action(name: string, label: string, onClick: () => void): HTMLButtonElement {
        const btn = el('button', 'rs2b0t-button');
        btn.dataset.action = name;
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }

    private bookFields(book: PriceBook): HTMLElement {
        const box = el('div', 'rs2b0t-pricebook-fields');

        box.appendChild(this.numberField('Spread %', book.margin, 'margin', value => {
            this.commit(setMargin(book, value));
        }, 'total spread, split either side of mid'));

        box.appendChild(this.numberField('Max trade gp', book.maxTradeValue, 'max-trade', value => {
            this.commit(setMaxTradeValue(book, value));
        }, 'refuse any single trade worth more than this'));

        return box;
    }

    private numberField(
        label: string,
        value: number,
        role: string,
        onChange: (value: number) => void,
        help?: string
    ): HTMLElement {
        const wrap = el('label', 'rs2b0t-pricebook-field');
        const text = el('span', 'rs2b0t-pricebook-field-label');
        text.textContent = label;
        if (help) {
            wrap.title = help;
        }
        wrap.appendChild(text);

        const input = el('input', 'rs2b0t-loadout-qty');
        input.type = 'number';
        input.min = '0';
        input.dataset.role = role;
        input.value = String(value);
        input.addEventListener('change', () => onChange(Number(input.value)));
        wrap.appendChild(input);
        return wrap;
    }

    private table(book: PriceBook, cat: Catalog): HTMLElement {
        const table = el('div', 'rs2b0t-pricebook-table');
        table.appendChild(this.headRow());
        const rows = displayRows(book, cat);
        if (rows.length === 0) {
            const empty = el('div', 'rs2b0t-pricebook-empty');
            empty.textContent = 'No items yet. Add one below.';
            table.appendChild(empty);
            return table;
        }
        for (const row of rows) {
            table.appendChild(this.itemRow(book, row));
        }
        return table;
    }

    private headRow(): HTMLElement {
        const head = el('div', 'rs2b0t-pricebook-row rs2b0t-pricebook-head');
        for (const label of ['', 'Item', 'Mid', 'Buy', 'Sell', 'Cap', 'B', 'S', '']) {
            const cell = el('span', 'rs2b0t-pricebook-cell');
            cell.textContent = label;
            head.appendChild(cell);
        }
        return head;
    }

    private itemRow(book: PriceBook, row: DisplayRow): HTMLElement {
        const line = el('div', 'rs2b0t-pricebook-row');
        line.dataset.item = String(row.id);
        if (!row.valid) {
            line.dataset.invalid = 'true';
            line.title = 'buy is not below sell, so this row will not trade';
        }

        line.appendChild(this.itemFace(row.id, row.name));

        const name = el('span', 'rs2b0t-pricebook-cell rs2b0t-pricebook-name');
        name.textContent = row.name;
        line.appendChild(name);

        line.appendChild(this.priceCell('mid', row.mid, false, value => this.commit(setField(book, row.id, 'mid', value))));
        line.appendChild(this.priceCell('buy', row.buy, row.pinnedBuy, value => this.commit(setField(book, row.id, 'buy', value))));
        line.appendChild(this.priceCell('sell', row.sell, row.pinnedSell, value => this.commit(setField(book, row.id, 'sell', value))));
        line.appendChild(this.priceCell('cap', row.cap, false, value => this.commit(setField(book, row.id, 'cap', value))));

        line.appendChild(this.sideToggle('buying', row.buying, () => this.commit(toggleSide(book, row.id, 'buying'))));
        line.appendChild(this.sideToggle('selling', row.selling, () => this.commit(toggleSide(book, row.id, 'selling'))));

        line.appendChild(this.action('drop', '✕', () => this.commit(dropRow(book, row.id))));
        return line;
    }

    /** A pinned cell holds an override; clicking the pin clears it back to the derived price. */
    private priceCell(role: string, value: number, pinned: boolean, onChange: (value: number) => void): HTMLElement {
        const cell = el('span', 'rs2b0t-pricebook-cell');
        const input = el('input', 'rs2b0t-loadout-qty');
        input.type = 'number';
        input.min = '0';
        input.dataset.role = role;
        input.value = String(value);
        if (pinned) {
            input.dataset.pinned = 'true';
            input.title = 'pinned override, click the dot to clear';
        }
        input.addEventListener('change', () => onChange(Number(input.value)));
        cell.appendChild(input);
        return cell;
    }

    private sideToggle(side: 'buying' | 'selling', on: boolean, onClick: () => void): HTMLElement {
        const cell = el('span', 'rs2b0t-pricebook-cell');
        const btn = el('button', 'rs2b0t-button rs2b0t-pricebook-toggle');
        btn.dataset.role = side;
        btn.dataset.on = String(on);
        btn.textContent = on ? '✓' : '–';
        btn.title = `${side} is ${on ? 'on' : 'off'}`;
        btn.addEventListener('click', onClick);
        cell.appendChild(btn);
        return cell;
    }

    private addBar(): HTMLElement {
        const bar = el('div', 'rs2b0t-pricebook-addbar');
        bar.appendChild(this.action('add', this.adding ? 'done' : '+ add item', () => {
            this.adding = !this.adding;
            this.query = '';
            this.render();
        }));
        return bar;
    }

    private picker(book: PriceBook, cat: Catalog): HTMLElement {
        const box = el('div', 'rs2b0t-loadout-picker');

        const search = el('input', 'rs2b0t-input');
        search.type = 'text';
        search.dataset.role = 'item-search';
        search.placeholder = 'search items…';
        search.value = this.query;
        search.addEventListener('input', () => {
            this.query = search.value;
            this.render();
            (this.root.querySelector('[data-role=item-search]') as HTMLInputElement | null)?.focus();
        });
        box.appendChild(search);

        const results = el('div', 'rs2b0t-loadout-results');
        for (const hit of pickerRows(book, cat, this.query).slice(0, PICKER_LIMIT)) {
            const line = el('div', 'rs2b0t-loadout-result');
            line.dataset.item = String(hit.id);
            line.appendChild(this.itemFace(hit.id, hit.name));

            const name = el('span', 'rs2b0t-loadout-result-name');
            name.textContent = hit.added ? `${hit.name} (in book)` : hit.name;
            line.appendChild(name);

            const cost = el('span', 'rs2b0t-pricebook-cost');
            cost.textContent = `${hit.cost}gp`;
            line.appendChild(cost);

            if (hit.added) {
                line.dataset.added = 'true';
            } else {
                line.addEventListener('click', () => this.commit(addRow(book, hit.id, hit.cost)));
            }
            results.appendChild(line);
        }
        box.appendChild(results);
        return box;
    }

    /** Icon when the cache has one, the name until it does. */
    private itemFace(id: number, name: string): HTMLElement {
        const face = el('span', 'rs2b0t-loadout-face');
        face.dataset.iconId = String(id);
        const url = itemIconDataUrl(id);
        if (url) {
            const img = el('img', 'rs2b0t-loadout-icon');
            img.src = url;
            img.alt = name;
            face.appendChild(img);
        }
        return face;
    }

    /**
     * The client streams item models on demand, so a sprite is null until the one asked about arrives.
     * Why: re-rendering would blow away the search box mid-type, so icons are patched in place a few times before giving up.
     */
    private scheduleIconFill(): void {
        this.stopIconFill();
        if (this.iconTries >= ICON_FILL_TRIES) {
            return;
        }
        this.iconTimer = setTimeout(() => {
            this.iconTries++;
            if (this.fillIcons() > 0) {
                this.scheduleIconFill();
            }
        }, ICON_FILL_MS);
    }

    private stopIconFill(): void {
        if (this.iconTimer !== null) {
            clearTimeout(this.iconTimer);
            this.iconTimer = null;
        }
    }

    /** Returns how many faces are still waiting on a sprite. */
    fillIcons(): number {
        let missing = 0;
        for (const face of Array.from(this.root.querySelectorAll('[data-icon-id]'))) {
            if (face.querySelector('img')) {
                continue;
            }
            const id = Number(face.getAttribute('data-icon-id'));
            const url = itemIconDataUrl(id);
            if (url === null) {
                missing++;
                continue;
            }
            const img = el('img', 'rs2b0t-loadout-icon');
            img.src = url;
            img.alt = String(id);
            face.replaceChildren(img);
        }
        return missing;
    }
}
