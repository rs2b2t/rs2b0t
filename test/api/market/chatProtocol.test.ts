import { describe, expect, test } from 'bun:test';

import {
    CHAT_LIMIT,
    formatAmbiguous,
    formatGp,
    formatPriceList,
    parseCommand,
    parseCount,
    truncateChat
} from '#/bot/api/market/chatProtocol.js';

describe('parseCount', () => {
    test('plain integers', () => {
        expect(parseCount('100')).toBe(100);
        expect(parseCount('1')).toBe(1);
    });

    test('k and m suffixes', () => {
        expect(parseCount('1k')).toBe(1000);
        expect(parseCount('2K')).toBe(2000);
        expect(parseCount('1m')).toBe(1_000_000);
    });

    test('all', () => {
        expect(parseCount('all')).toBe('all');
        expect(parseCount('ALL')).toBe('all');
    });

    test('rejects zero, negatives and words', () => {
        expect(parseCount('0')).toBeNull();
        expect(parseCount('-5')).toBeNull();
        expect(parseCount('me')).toBeNull();
        expect(parseCount('')).toBeNull();
        expect(parseCount('1.5')).toBeNull();
    });
});

describe('parseCommand', () => {
    test('buy is the player buying, so the bot sells', () => {
        expect(parseCommand('buy 100 iron ore')).toEqual({ kind: 'quoteSell', qty: 100, query: 'iron ore', qtyImplied: false });
    });

    test('sell is the player selling, so the bot buys', () => {
        expect(parseCommand('sell 100 iron ore')).toEqual({ kind: 'quoteBuy', qty: 100, query: 'iron ore', qtyImplied: false });
    });

    test('case and surrounding whitespace do not matter', () => {
        expect(parseCommand('  BUY 1k Iron Ore ')).toEqual({ kind: 'quoteSell', qty: 1000, query: 'Iron Ore', qtyImplied: false });
    });

    test('bare list commands', () => {
        expect(parseCommand('prices')).toEqual({ kind: 'prices' });
        expect(parseCommand('buying')).toEqual({ kind: 'buying' });
        expect(parseCommand('selling')).toEqual({ kind: 'selling' });
    });

    test('several words ask for the book', () => {
        for (const word of ['list', 'book', 'rates', 'stock', 'prices']) {
            expect(parseCommand(word)).toEqual({ kind: 'prices' });
        }
    });

    // Why: the engine filters every public message before broadcasting, and reads "pric" as an obfuscated
    // Why: slur, so a customer typing "prices" reaches the shop as "****es".
    test('the censored form of prices still asks for the book', () => {
        expect(parseCommand('****es')).toEqual({ kind: 'prices' });
    });

    test('stars alone are not a command', () => {
        expect(parseCommand('****')).toEqual({ kind: 'none' });
        expect(parseCommand('***')).toEqual({ kind: 'none' });
    });

    // Why: the count is optional, so a line with none of it parses as one of them and the shop decides whether the words name anything it trades.
    test('a missing count means one of them', () => {
        expect(parseCommand('buying rune scimitar')).toEqual({
            kind: 'quoteSell',
            qty: 1,
            query: 'rune scimitar',
            qtyImplied: true
        });
        expect(parseCommand('buy rune scimitar')).toEqual({
            kind: 'quoteSell',
            qty: 1,
            query: 'rune scimitar',
            qtyImplied: true
        });
        expect(parseCommand('selling rune scimitar')).toEqual({
            kind: 'quoteBuy',
            qty: 1,
            query: 'rune scimitar',
            qtyImplied: true
        });
    });

    test('a stated count of one is the same request, minus the guess', () => {
        expect(parseCommand('buying 1 rune scimitar')).toEqual({
            kind: 'quoteSell',
            qty: 1,
            query: 'rune scimitar',
            qtyImplied: false
        });
    });

    test('ordinary chat opening with a keyword still parses, and is flagged as a guess', () => {
        expect(parseCommand('buy me a beer')).toEqual({
            kind: 'quoteSell',
            qty: 1,
            query: 'me a beer',
            qtyImplied: true
        });
    });

    test('a count of zero is not a count, so the words carry the request', () => {
        expect(parseCommand('buy 0 iron ore')).toEqual({
            kind: 'quoteSell',
            qty: 1,
            query: '0 iron ore',
            qtyImplied: true
        });
    });

    test('a keyword with a count but no item is not a command', () => {
        expect(parseCommand('buy 100')).toEqual({ kind: 'none' });
    });

    test('a keyword that is not leading is not a command', () => {
        expect(parseCommand('i want to buy 100 iron ore')).toEqual({ kind: 'none' });
    });

    test('empty and punctuation-only lines are not commands', () => {
        expect(parseCommand('')).toEqual({ kind: 'none' });
        expect(parseCommand('!!!')).toEqual({ kind: 'none' });
    });

    test('a list keyword with trailing words is not a command', () => {
        expect(parseCommand('prices are too high')).toEqual({ kind: 'none' });
    });

    test('all is carried through as a count', () => {
        expect(parseCommand('sell all iron ore')).toEqual({ kind: 'quoteBuy', qty: 'all', query: 'iron ore', qtyImplied: false });
    });

    // Why: this is how a person says it out loud, and a shop that only takes "buy" reads as broken.
    test('buying N x is the same as buy N x', () => {
        expect(parseCommand('buying 1k maple longbows')).toEqual({
            kind: 'quoteSell',
            qty: 1000,
            query: 'maple longbows',
            qtyImplied: false
        });
        expect(parseCommand('selling 500 iron ore')).toEqual({
            kind: 'quoteBuy',
            qty: 500,
            query: 'iron ore',
            qtyImplied: false
        });
    });

    test('a bare buying or selling is still the price list', () => {
        expect(parseCommand('buying')).toEqual({ kind: 'buying' });
        expect(parseCommand('selling')).toEqual({ kind: 'selling' });
    });

    // Why: players reach for a slash out of habit.
    test('a leading slash is accepted on any command', () => {
        expect(parseCommand('/prices')).toEqual({ kind: 'prices' });
        expect(parseCommand('/help')).toEqual({ kind: 'help' });
        expect(parseCommand('/buy 100 iron ore')).toEqual({ kind: 'quoteSell', qty: 100, query: 'iron ore', qtyImplied: false });
    });

    test('help has a few spellings and they all land', () => {
        for (const word of ['help', 'commands', 'shop']) {
            expect(parseCommand(word)).toEqual({ kind: 'help' });
        }
    });

    // Why: it is the way out of a shop that has stopped answering, so it has to be one word and hard to mistype.
    test('reset is a command, by either name', () => {
        expect(parseCommand('reset')).toEqual({ kind: 'reset' });
        expect(parseCommand('RESET')).toEqual({ kind: 'reset' });
        expect(parseCommand('/reset')).toEqual({ kind: 'reset' });
        expect(parseCommand('unstick')).toEqual({ kind: 'reset' });
    });

    test('reset with anything after it is ordinary chat', () => {
        expect(parseCommand('reset please')).toEqual({ kind: 'none' });
        expect(parseCommand('Resetting. Trade me again in a moment.')).toEqual({ kind: 'none' });
    });

    test('a slash on its own is not a command', () => {
        expect(parseCommand('/')).toEqual({ kind: 'none' });
    });
});

describe('formatting', () => {
    test('formatGp groups thousands', () => {
        expect(formatGp(2000)).toBe('2,000');
        expect(formatGp(17)).toBe('17');
    });

    test('ambiguous reply lists at most three names', () => {
        expect(formatAmbiguous([{ name: 'Maple longbow', id: 851 }, { name: 'Yew longbow', id: 855 }])).toBe(
            "2 matches: 'Maple longbow', 'Yew longbow'. Which?"
        );
        const four = [
            { name: 'a', id: 1 },
            { name: 'b', id: 2 },
            { name: 'c', id: 3 },
            { name: 'd', id: 4 }
        ];
        expect(formatAmbiguous(four)).toContain('4 matches');
        expect(formatAmbiguous(four)).not.toContain("'d'");
    });

    // Why: the strung and unstrung maple longbow are both literally "Maple longbow", so listing the
    // Why: names alone gives the player nothing to choose between.
    test('names that read the same are tagged with their id', () => {
        expect(formatAmbiguous([{ name: 'Maple longbow', id: 851 }, { name: 'Maple longbow', id: 62 }])).toBe(
            "2 matches: 'Maple longbow' #851, 'Maple longbow' #62. Which?"
        );
    });

    test('price list chunks into lines under the chat limit', () => {
        const entries = Array.from({ length: 12 }, (_, i) => ({ name: `Item number ${i}`, buy: 10, sell: 20 }));
        const lines = formatPriceList(entries, 'both');
        expect(lines.length).toBeGreaterThan(1);
        for (const line of lines) {
            expect(line.length).toBeLessThanOrEqual(CHAT_LIMIT);
        }
    });

    test('price list shows one side when asked', () => {
        expect(formatPriceList([{ name: 'Iron ore', buy: 14, sell: 20 }], 'buy')).toEqual(['Iron ore 14']);
        expect(formatPriceList([{ name: 'Iron ore', buy: 14, sell: 20 }], 'sell')).toEqual(['Iron ore 20']);
    });

    test('an empty price list produces no lines', () => {
        expect(formatPriceList([], 'both')).toEqual([]);
    });

    test('truncateChat cuts to the game limit', () => {
        expect(truncateChat('x'.repeat(200))).toHaveLength(CHAT_LIMIT);
        expect(truncateChat('short')).toBe('short');
    });
});
