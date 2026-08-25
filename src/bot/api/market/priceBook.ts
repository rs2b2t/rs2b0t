export interface PriceRow {
    /** Unnoted obj id. The book's only key. */
    id: number;
    mid: number;
    buy?: number;
    sell?: number;
    /** Total spread %, overriding the book default. */
    margin?: number;
    /** Max units held before the bot stops buying. */
    cap: number;
    buying: boolean;
    selling: boolean;
}

export interface PriceBook {
    name: string;
    /** Total spread %, split either side of mid. */
    margin: number;
    maxTradeValue: number;
    rows: PriceRow[];
}

export const DEFAULT_MARGIN = 20;
export const DEFAULT_MAX_TRADE = 1_000_000;

function int(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function optInt(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function parseRow(raw: unknown): PriceRow | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'number' || !Number.isFinite(r.id)) {
        return null;
    }

    const row: PriceRow = {
        id: Math.trunc(r.id),
        mid: Math.max(1, int(r.mid, 1)),
        cap: Math.max(0, int(r.cap, 0)),
        buying: r.buying !== false,
        selling: r.selling !== false
    };

    const buy = optInt(r.buy);
    const sell = optInt(r.sell);
    const margin = optInt(r.margin);
    if (buy !== undefined) {
        row.buy = buy;
    }
    if (sell !== undefined) {
        row.sell = sell;
    }
    if (margin !== undefined) {
        row.margin = margin;
    }
    return row;
}

// Why: storage is player-editable JSON, so a malformed book must degrade to an empty list rather than throw inside a panel render.
export function parseBooks(json: string): PriceBook[] {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(raw)) {
        return [];
    }

    const out: PriceBook[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const b = entry as Record<string, unknown>;
        if (typeof b.name !== 'string' || b.name.trim() === '') {
            continue;
        }
        out.push({
            name: b.name,
            margin: int(b.margin, DEFAULT_MARGIN),
            maxTradeValue: int(b.maxTradeValue, DEFAULT_MAX_TRADE),
            rows: Array.isArray(b.rows) ? b.rows.map(parseRow).filter((r): r is PriceRow => r !== null) : []
        });
    }
    return out;
}

export function serializeBooks(books: readonly PriceBook[]): string {
    return JSON.stringify(books);
}

export function upsertBook(books: readonly PriceBook[], book: PriceBook): PriceBook[] {
    const i = books.findIndex(b => b.name.toLowerCase() === book.name.toLowerCase());
    if (i === -1) {
        return [...books, book];
    }
    const out = [...books];
    out[i] = book;
    return out;
}

export function removeBook(books: readonly PriceBook[], name: string): PriceBook[] {
    const wanted = name.trim().toLowerCase();
    return books.filter(b => b.name.toLowerCase() !== wanted);
}

export function uniqueBookName(books: readonly PriceBook[], wanted: string): string {
    const taken = new Set(books.map(b => b.name.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) {
        return wanted;
    }
    for (let n = 2; ; n++) {
        const candidate = `${wanted} ${n}`;
        if (!taken.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
}

export function rowOf(book: PriceBook, id: number): PriceRow | null {
    return book.rows.find(r => r.id === id) ?? null;
}
