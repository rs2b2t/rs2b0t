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
        expect(parseCommand('buy 100 iron ore')).toEqual({ kind: 'quoteSell', qty: 100, query: 'iron ore' });
    });

    test('sell is the player selling, so the bot buys', () => {
        expect(parseCommand('sell 100 iron ore')).toEqual({ kind: 'quoteBuy', qty: 100, query: 'iron ore' });
    });

    test('case and surrounding whitespace do not matter', () => {
        expect(parseCommand('  BUY 1k Iron Ore ')).toEqual({ kind: 'quoteSell', qty: 1000, query: 'Iron Ore' });
    });

    test('bare list commands', () => {
        expect(parseCommand('prices')).toEqual({ kind: 'prices' });
        expect(parseCommand('buying')).toEqual({ kind: 'buying' });
        expect(parseCommand('selling')).toEqual({ kind: 'selling' });
    });

    test('a keyword with no count is not a command', () => {
        expect(parseCommand('buy me a beer')).toEqual({ kind: 'none' });
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
        expect(parseCommand('sell all iron ore')).toEqual({ kind: 'quoteBuy', qty: 'all', query: 'iron ore' });
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
