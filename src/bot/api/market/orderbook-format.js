/** @typedef {{ id:number, mid:number, buy?:number, sell?:number, margin?:number, cap:number, buying:boolean, selling:boolean }} PriceRow */
/** @typedef {{ name:string, margin:number, maxTradeValue:number, rows:PriceRow[] }} PriceBook */

export const MAX_FILE_BYTES = 1048576;

const MAX_BOOKS = 50;
const MAX_ROWS_PER_BOOK = 5000;
const MAX_ROWS_TOTAL = 10000;
const MAX_NAME_LENGTH = 80;
const MAX_ID = 65535;
const MAX_VALUE = 2147483647;
const MAX_MARGIN = 200;
const BOOK_FIELDS = new Set(['name', 'margin', 'maxTradeValue', 'rows']);
const ROW_FIELDS = new Set(['id', 'mid', 'buy', 'sell', 'margin', 'cap', 'buying', 'selling']);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} value
 * @param {Set<string>} allowed
 * @param {string} at
 */
function rejectUnknown(value, allowed, at) {
    const unknown = Object.keys(value).find(key => !allowed.has(key));
    if (unknown !== undefined) {
        throw new Error(`${at} has unknown field "${unknown}"`);
    }
}

/**
 * @param {unknown} value
 * @param {string} at
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function integer(value, at, min, max) {
    if (!Number.isInteger(value) || /** @type {number} */ (value) < min || /** @type {number} */ (value) > max) {
        throw new Error(`${at} must be an integer from ${min} to ${max}`);
    }
    return /** @type {number} */ (value);
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} at
 * @returns {PriceRow}
 */
function validateRow(raw, at) {
    rejectUnknown(raw, ROW_FIELDS, at);
    if (typeof raw.buying !== 'boolean') {
        throw new Error(`${at}.buying must be a boolean`);
    }
    if (typeof raw.selling !== 'boolean') {
        throw new Error(`${at}.selling must be a boolean`);
    }
    const row = {
        id: integer(raw.id, `${at}.id`, 0, MAX_ID),
        mid: integer(raw.mid, `${at}.mid`, 1, MAX_VALUE),
        cap: integer(raw.cap, `${at}.cap`, 0, MAX_VALUE),
        buying: raw.buying,
        selling: raw.selling
    };
    /** @type {PriceRow} */
    const result = row;
    if (Object.hasOwn(raw, 'buy')) {
        result.buy = integer(raw.buy, `${at}.buy`, 0, MAX_VALUE);
    }
    if (Object.hasOwn(raw, 'sell')) {
        result.sell = integer(raw.sell, `${at}.sell`, 0, MAX_VALUE);
    }
    if (Object.hasOwn(raw, 'margin')) {
        result.margin = integer(raw.margin, `${at}.margin`, 0, MAX_MARGIN);
    }
    return result;
}

/**
 * @param {unknown} raw
 * @returns {PriceBook[]}
 */
export function validateBooks(raw) {
    if (!Array.isArray(raw)) {
        throw new Error('books must be an array');
    }
    if (raw.length > MAX_BOOKS) {
        throw new Error(`books must contain at most ${MAX_BOOKS} books`);
    }

    const names = new Set();
    let totalRows = 0;
    return raw.map((value, bookIndex) => {
        const at = `books[${bookIndex}]`;
        if (!isObject(value)) {
            throw new Error(`${at} must be an object`);
        }
        rejectUnknown(value, BOOK_FIELDS, at);
        if (typeof value.name !== 'string' || value.name.length === 0 || value.name.length > MAX_NAME_LENGTH) {
            throw new Error(`${at}.name must be 1 to ${MAX_NAME_LENGTH} characters`);
        }
        if (value.name !== value.name.trim()) {
            throw new Error(`${at}.name must not have leading or trailing whitespace`);
        }
        const folded = value.name.toLowerCase();
        if (names.has(folded)) {
            throw new Error(`duplicate book name "${value.name}"`);
        }
        names.add(folded);
        if (!Array.isArray(value.rows)) {
            throw new Error(`${at}.rows must be an array`);
        }
        if (value.rows.length > MAX_ROWS_PER_BOOK) {
            throw new Error(`${at}.rows must contain at most ${MAX_ROWS_PER_BOOK} rows`);
        }
        totalRows += value.rows.length;
        if (totalRows > MAX_ROWS_TOTAL) {
            throw new Error(`books must contain at most ${MAX_ROWS_TOTAL} rows total`);
        }

        const ids = new Set();
        const rows = value.rows.map((row, rowIndex) => {
            const rowAt = `${at}.rows[${rowIndex}]`;
            if (!isObject(row)) {
                throw new Error(`${rowAt} must be an object`);
            }
            const checked = validateRow(row, rowAt);
            if (ids.has(checked.id)) {
                throw new Error(`${at} has duplicate item id ${checked.id}`);
            }
            ids.add(checked.id);
            return checked;
        });
        return {
            name: value.name,
            margin: integer(value.margin, `${at}.margin`, 0, MAX_MARGIN),
            maxTradeValue: integer(value.maxTradeValue, `${at}.maxTradeValue`, 0, MAX_VALUE),
            rows
        };
    });
}

/**
 * @param {string} text
 * @returns {PriceBook[]}
 */
export function parseOrderbookFile(text) {
    if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
        throw new Error('orderbook file exceeds 1 MiB');
    }
    /** @type {unknown} */
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('orderbook file is not valid JSON');
    }
    if (Array.isArray(parsed)) {
        return validateBooks(parsed);
    }
    if (!isObject(parsed)) {
        throw new Error('orderbook file must be a native array or versioned envelope');
    }
    rejectUnknown(parsed, new Set(['format', 'version', 'books']), 'orderbook file');
    if (parsed.format !== 'rs2b0t-orderbooks') {
        throw new Error('unsupported orderbook format');
    }
    if (parsed.version !== 1) {
        throw new Error(`unsupported orderbook version "${String(parsed.version)}"`);
    }
    return validateBooks(parsed.books);
}

/**
 * @param {ReadonlyArray<PriceBook>} books
 * @returns {string}
 */
export function exportOrderbooks(books) {
    const text = JSON.stringify({
        format: 'rs2b0t-orderbooks',
        version: 1,
        books: validateBooks(books)
    });
    if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
        throw new Error('orderbook export exceeds 1 MiB');
    }
    return text;
}

/**
 * @param {ReadonlyArray<PriceBook>} existing
 * @param {ReadonlyArray<PriceBook>} incoming
 * @returns {PriceBook[]}
 */
export function mergeOrderbooks(existing, incoming) {
    const current = validateBooks(existing);
    const additions = validateBooks(incoming);
    const replacements = new Map(additions.map(book => [book.name.toLowerCase(), book]));
    const merged = current.map(book => replacements.get(book.name.toLowerCase()) ?? book);
    const currentNames = new Set(current.map(book => book.name.toLowerCase()));
    for (const book of additions) {
        if (!currentNames.has(book.name.toLowerCase())) {
            merged.push(book);
        }
    }
    return validateBooks(merged);
}

/**
 * @param {PriceBook} book
 * @param {PriceRow} row
 * @returns {{ buy:number, sell:number }}
 */
export function resolvePrices(book, row) {
    const margin = row.margin ?? book.margin;
    const buy = Math.max(1, row.buy ?? Math.floor((row.mid * (200 - margin)) / 200));
    const sell = Math.max(buy + 1, row.sell ?? Math.ceil((row.mid * (200 + margin)) / 200));
    return { buy, sell };
}
