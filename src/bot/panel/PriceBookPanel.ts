import { PriceBooks } from '../api/market/bookStore.js';
import { liveCatalog, type Catalog } from '../api/market/catalog.js';
import {
    DEFAULT_MARGIN,
    DEFAULT_MAX_TRADE,
    removeBook,
    rowOf,
    uniqueBookName,
    upsertBook,
    type PriceBook
} from '../api/market/priceBook.js';
import { CATEGORIES, shelves, type Category } from '../api/market/categories.js';
import { el } from './dom.js';
import { itemIconDataUrl } from './itemIcon.js';
import {
    addRow,
    addRows,
    displayRows,
    dropRow,
    formatPrice,
    nextSort,
    parsePrice,
    pickerRows,
    setField,
    setMargin,
    setMaxTradeValue,
    toggleSide,
    viewRows,
    type DisplayRow,
    type SortDir,
    type SortKey
} from './priceBookPanelLogic.js';

const ICON_FILL_MS = 500;
const ICON_FILL_TRIES = 12;
const PICKER_LIMIT = 60;

/** What survives a re-render: where each list was scrolled to, and which box the operator was typing in. */
interface Held {
    scroll: Map<string, number>;
    focus: { at: string; start: number | null; end: number | null } | null;
}

function fieldPath(node: Element): string | null {
    const role = node instanceof HTMLElement ? node.dataset.role : undefined;
    if (role === undefined) {
        return null;
    }
    const row = node.closest<HTMLElement>('[data-item]');
    return row ? `[data-item="${row.dataset.item}"] [data-role="${role}"]` : `[data-role="${role}"]`;
}

/**
 * Editor for the player's named order books.
 * Why: every mutation goes through the store and re-renders, so no in-memory copy can drift from what is saved.
 */
export class PriceBookPanel {
    readonly root = el('div', 'rs2b0t-loadout-backdrop');
    private readonly window = el('div', 'rs2b0t-loadout-panel rs2b0t-pricebook');

    private selected: string | null = null;
    private query = '';
    private filter = '';
    private adding = false;
    private browsing = false;
    private shelf: Category | 'All' = 'All';
    private sort: { key: SortKey; dir: SortDir } = { key: 'name', dir: 'asc' };
    private renaming = false;
    private iconTries = 0;
    private iconTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.root.style.display = 'none';
        // Why: the Edit… button opens this from inside the params modal, which shares z-index 1000.
        this.root.style.zIndex = '1001';
        this.window.dataset.scroll = 'panel';
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
        this.browsing = false;
        this.renaming = false;
        this.query = '';
        this.filter = '';
        this.iconTries = 0;
        this.render();
    }

    close(): void {
        this.root.style.display = 'none';
        this.adding = false;
        this.browsing = false;
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

    // Why: every edit commits through the store and rebuilds the panel, which threw away the scroll position and the caret, so a change to the eightieth row sent the operator back to the first.
    private render(): void {
        const held = this.hold();
        this.window.replaceChildren();
        this.window.appendChild(this.header());
        const book = this.current();
        if (book) {
            const cat = liveCatalog();
            const all = displayRows(book, cat);
            const shown = viewRows(all, this.shelf, this.sort.key, this.sort.dir, this.filter);
            this.window.appendChild(this.bookFields(book));
            this.window.appendChild(this.shelfBar(all));
            this.window.appendChild(this.filterBar(shown.length, all.length));
            this.window.appendChild(this.table(book, shown));
            this.window.appendChild(this.addBar());
            if (this.adding) {
                this.window.appendChild(this.picker(book, cat));
            }
            if (this.browsing) {
                this.window.appendChild(this.browser(book, cat));
            }
        }
        this.release(held);
        if (this.fillIcons() > 0) {
            this.scheduleIconFill();
        }
    }

    private hold(): Held {
        const scroll = new Map<string, number>();
        for (const box of this.scrollers()) {
            scroll.set(box.dataset.scroll!, box.scrollTop);
        }

        const active = document.activeElement;
        const at = active && this.window.contains(active) ? fieldPath(active) : null;
        const typing = active instanceof HTMLInputElement && active.type === 'text' ? active : null;
        return {
            scroll,
            focus: at === null ? null : { at, start: typing?.selectionStart ?? null, end: typing?.selectionEnd ?? null }
        };
    }

    private release(held: Held): void {
        const node = held.focus === null ? null : this.window.querySelector<HTMLElement>(held.focus.at);
        if (node !== null) {
            node.focus();
            if (node instanceof HTMLInputElement && node.type === 'text' && held.focus!.start !== null) {
                node.setSelectionRange(held.focus!.start, held.focus!.end);
            }
        }

        // Why: focusing a field scrolls it into view, and it does that against a layout the rebuilt rows have not had yet, which lands the table near the top. The offset goes back after the focus so it is the one that wins.
        for (const box of this.scrollers()) {
            const was = held.scroll.get(box.dataset.scroll!);
            if (was !== undefined) {
                box.scrollTop = was;
            }
        }
    }

    /** The panel body plus every list inside it that has its own bar. */
    private scrollers(): HTMLElement[] {
        return [this.window, ...Array.from(this.window.querySelectorAll<HTMLElement>('[data-scroll]'))];
    }

    private header(): HTMLElement {
        const bar = el('div', 'rs2b0t-loadout-header');

        const title = el('span', 'rs2b0t-loadout-title');
        title.textContent = 'Order book';
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
        }, 'refuse any single trade worth more than this', true));

        return box;
    }

    private numberField(
        label: string,
        value: number,
        role: string,
        onChange: (value: number) => void,
        help?: string,
        big = false
    ): HTMLElement {
        const wrap = el('label', 'rs2b0t-pricebook-field');
        const text = el('span', 'rs2b0t-pricebook-field-label');
        text.textContent = label;
        if (help) {
            wrap.title = help;
        }
        wrap.appendChild(text);

        const input = el('input', 'rs2b0t-loadout-qty');
        input.dataset.role = role;
        if (big) {
            input.type = 'text';
            input.inputMode = 'numeric';
            input.value = formatPrice(value);
            input.addEventListener('change', () => {
                const parsed = parsePrice(input.value);
                if (parsed === null) {
                    input.value = formatPrice(value);
                    return;
                }
                onChange(parsed);
            });
        } else {
            input.type = 'number';
            input.min = '0';
            input.value = String(value);
            input.addEventListener('change', () => onChange(Number(input.value)));
        }
        wrap.appendChild(input);
        return wrap;
    }

    private table(book: PriceBook, rows: readonly DisplayRow[]): HTMLElement {
        const table = el('div', 'rs2b0t-pricebook-table');
        table.dataset.scroll = 'table';
        table.appendChild(this.headRow());
        if (rows.length === 0) {
            const empty = el('div', 'rs2b0t-pricebook-empty');
            empty.textContent = this.emptyNote();
            table.appendChild(empty);
            return table;
        }
        for (const row of rows) {
            table.appendChild(this.itemRow(book, row));
        }
        return table;
    }

    private emptyNote(): string {
        const typed = this.filter.trim();
        if (typed.length > 0) {
            return `Nothing matches '${typed}'.`;
        }
        return this.shelf === 'All' ? 'No items yet. Add some below.' : `Nothing on the ${this.shelf} shelf yet.`;
    }

    /** Narrows what the table shows without touching the book. */
    private filterBar(shown: number, total: number): HTMLElement {
        const bar = el('div', 'rs2b0t-pricebook-filterbar');

        const box = el('input', 'rs2b0t-input rs2b0t-pricebook-filter');
        box.type = 'text';
        box.dataset.role = 'book-filter';
        box.placeholder = 'filter the book…';
        box.value = this.filter;
        box.addEventListener('input', () => {
            this.filter = box.value;
            this.render();
        });
        bar.appendChild(box);

        if (this.filter.trim().length > 0) {
            const count = el('span', 'rs2b0t-pricebook-filter-count');
            count.textContent = `${shown} of ${total}`;
            bar.appendChild(count);
            bar.appendChild(this.action('clear-filter', '✕', () => {
                this.filter = '';
                this.render();
            }));
        }
        return bar;
    }

    private headRow(): HTMLElement {
        const head = el('div', 'rs2b0t-pricebook-row rs2b0t-pricebook-head');
        const cols: { label: string; key?: SortKey }[] = [
            { label: '' },
            { label: 'Item', key: 'name' },
            { label: 'Mid' },
            { label: 'Buy', key: 'buy' },
            { label: 'Sell', key: 'sell' },
            { label: 'Cap', key: 'cap' },
            { label: 'B' },
            { label: 'S' },
            { label: '' }
        ];
        for (const col of cols) {
            const cell = el('span', 'rs2b0t-pricebook-cell');
            if (col.key === undefined) {
                cell.textContent = col.label;
            } else {
                const btn = el('button', 'rs2b0t-pricebook-sort');
                const active = this.sort.key === col.key;
                btn.textContent = active ? `${col.label} ${this.sort.dir === 'asc' ? '▲' : '▼'}` : col.label;
                btn.dataset.on = String(active);
                btn.title = `sort by ${col.label.toLowerCase()}`;
                btn.addEventListener('click', () => {
                    this.sort = nextSort(this.sort, col.key!);
                    this.render();
                });
                cell.appendChild(btn);
            }
            head.appendChild(cell);
        }
        return head;
    }

    /** Which shelf the table is showing, and how many rows the book carries from it. */
    private shelfBar(rows: readonly DisplayRow[]): HTMLElement {
        const bar = el('div', 'rs2b0t-pricebook-shelfbar');
        const counts = new Map<string, number>();
        for (const row of rows) {
            counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
            if (row.popular) {
                counts.set('Popular', (counts.get('Popular') ?? 0) + 1);
            }
        }

        const chip = (label: string, shelf: Category | 'All', n: number): HTMLElement => {
            const btn = el('button', 'rs2b0t-pricebook-chip');
            btn.textContent = `${label} ${n}`;
            btn.dataset.on = String(this.shelf === shelf);
            btn.addEventListener('click', () => {
                this.shelf = shelf;
                this.render();
            });
            return btn;
        };

        bar.appendChild(chip('All', 'All', rows.length));
        for (const name of CATEGORIES) {
            const n = counts.get(name) ?? 0;
            if (n > 0) {
                bar.appendChild(chip(name, name, n));
            }
        }
        return bar;
    }

    /** Every item the client knows, by shelf, so a shelf goes in at once. */
    private browser(book: PriceBook, cat: Catalog): HTMLElement {
        const box = el('div', 'rs2b0t-loadout-picker');
        const all = shelves(cat);

        const note = el('div', 'rs2b0t-pricebook-note');
        note.textContent = 'Adds every item on a shelf at its own value, and leaves anything already in the book alone.';
        box.appendChild(note);

        const list = el('div', 'rs2b0t-pricebook-shelves');
        list.dataset.scroll = 'shelves';
        for (const name of CATEGORIES) {
            const items = all.get(name) ?? [];
            if (items.length === 0) {
                continue;
            }
            const missing = items.filter(r => rowOf(book, r.id) === null);
            const line = el('div', 'rs2b0t-pricebook-shelf');

            const label = el('span', 'rs2b0t-pricebook-shelf-name');
            label.textContent = name;
            line.appendChild(label);

            const count = el('span', 'rs2b0t-pricebook-shelf-count');
            count.textContent = missing.length === 0 ? `all ${items.length} in book` : `${missing.length} of ${items.length} not in book`;
            line.appendChild(count);

            const add = el('button', 'rs2b0t-button rs2b0t-pricebook-shelf-add');
            add.textContent = missing.length === 0 ? '✓' : `+ add ${missing.length}`;
            add.disabled = missing.length === 0;
            add.addEventListener('click', () => this.commit(addRows(book, missing.map(r => ({ id: r.id, cost: r.cost })))));
            line.appendChild(add);

            list.appendChild(line);
        }
        box.appendChild(list);
        return box;
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
        // Why: the box shows 1.25M, which a number input will not hold, so it takes text and parses it back.
        input.type = 'text';
        input.inputMode = 'numeric';
        input.dataset.role = role;
        input.value = formatPrice(value);
        if (pinned) {
            input.dataset.pinned = 'true';
            input.title = 'pinned override, click the dot to clear';
        }
        input.addEventListener('change', () => {
            const parsed = parsePrice(input.value);
            if (parsed === null) {
                // Why: writing what cannot be read would store NaN, so an unreadable edit is put back instead.
                input.value = formatPrice(value);
                return;
            }
            onChange(parsed);
        });
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
            this.browsing = false;
            this.query = '';
            this.render();
        }));
        bar.appendChild(this.action('browse', this.browsing ? 'done' : 'browse categories', () => {
            this.browsing = !this.browsing;
            this.adding = false;
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
        });
        box.appendChild(search);

        const results = el('div', 'rs2b0t-loadout-results');
        results.dataset.scroll = 'picker';
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
