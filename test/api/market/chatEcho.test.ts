import { describe, expect, test } from 'bun:test';

import {
    formatAmbiguous,
    formatBuyQuote,
    formatGp,
    formatPriceList,
    formatSellQuote,
    parseCommand
} from '#/bot/api/market/chatProtocol.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import { Ledger } from '#/bot/api/market/ledger.js';
import { formatValuation, valueOffer } from '#/bot/api/market/quote.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, certlink: -1, certtemplate: -1 };
}

const CAT = buildCatalog([rec(440, 'Iron ore'), rec(995, 'Coins'), rec(1127, 'Rune platebody')]);
const BOOK: PriceBook = {
    name: 'seers',
    margin: 20,
    maxTradeValue: 100_000,
    rows: [{ id: 440, mid: 20, cap: 1000, buying: true, selling: true }]
};

const ledger = new Ledger();
ledger.setStock([{ id: 440, count: 500 }], 100_000);

const valuation = valueOffer(BOOK, CAT, ledger, [
    { id: 440, name: 'Iron ore', count: 100 },
    { id: 1127, name: 'Rune platebody', count: 1 }
], 995);

/** Every line MarketMaker can put into public chat. Keep in step with the `say(` calls in MarketMaker.ts. */
const EVERY_REPLY: string[] = [
    'Nothing listed right now.',
    ...formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }, { name: 'Yew logs', buy: 288, sell: 352 }], 'both'),
    ...formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }], 'buy'),
    ...formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }], 'sell'),
    "I don't sell 'dragon claws'.",
    "I don't buy 'dragon claws'.",
    formatAmbiguous(['Maple longbow', 'Maple longbow (u)']),
    'Out of Iron ore.',
    `Iron ore is over my ${formatGp(100_000)}gp trade cap.`,
    'Someone beat you to that Iron ore.',
    "I'm full on Iron ore.",
    "I can't afford that many Iron ore.",
    'My coins are spoken for, one moment.',
    'Queue is full, ask again in a minute.',
    formatSellQuote('Iron ore', 100, 22),
    formatBuyQuote('Iron ore', 100, 18),
    "You're #1 in the queue.",
    formatValuation(valuation),
    'Thanks Elliott. Pleasure doing business.',
    `Buying/selling: ${formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }], 'both')[0]}`,
    'Quote first, e.g. "buy 100 iron ore".',
    'Trade declined: their offer does not match the quote.',
    'Elliott, stand next to me.'
];

// Why: two MarketMakers at one bank hear each other. If any reply parsed as a command they would quote
// Why: each other forever, and the pair would flood the chat until both were muted.
describe('no reply the bot can emit is a command', () => {
    for (const line of EVERY_REPLY) {
        test(`ignores its own line: ${line.slice(0, 46)}`, () => {
            expect(parseCommand(line)).toEqual({ kind: 'none' });
        });
    }
});

describe('the keyword has to lead', () => {
    // Why: 'Quote first, e.g. "buy 100 iron ore".' contains a valid command verbatim, so a parser that
    // Why: matched anywhere in the line would answer its own help text.
    test('a command quoted inside a sentence is not a command', () => {
        expect(parseCommand('Quote first, e.g. "buy 100 iron ore".')).toEqual({ kind: 'none' });
        expect(parseCommand('anyone selling 100 iron ore?')).toEqual({ kind: 'none' });
        expect(parseCommand('he said buy 100 iron ore')).toEqual({ kind: 'none' });
    });
});
