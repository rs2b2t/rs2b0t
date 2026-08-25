import { describe, expect, test } from 'bun:test';

import {
    formatAmbiguous,
    formatGp,
    formatPriceList,
    parseCommand
} from '#/bot/api/market/chatProtocol.js';
import { appraise, describeAppraisal } from '#/bot/api/market/appraise.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';
import Packet from '#/client/io/Packet.js';
import WordPack from '#/client/wordfilter/WordPack.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

const CAT = buildCatalog([rec(440, 'Iron ore'), rec(995, 'Coins', { stackable: true }), rec(1127, 'Rune platebody')]);
const BOOK: PriceBook = {
    name: 'seers',
    margin: 20,
    maxTradeValue: 100_000,
    rows: [{ id: 440, mid: 20, cap: 1000, buying: true, selling: true }]
};
const DESK = { available: () => 500, held: () => 0, purse: 100_000 };

function priced(theirOffer: { id: number; name: string; count: number }[], intent: { itemId: number; maxQty: number } | null = null) {
    return describeAppraisal(appraise({ book: BOOK, cat: CAT, desk: DESK, coinId: 995, theirOffer, intent }));
}

/** Every line MarketMaker can put into public chat. Keep in step with the `say(` calls in MarketMaker.ts. */
const EVERY_REPLY: string[] = [
    'Nothing listed right now.',
    ...formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }, { name: 'Yew logs', buy: 288, sell: 352 }], 'both'),
    ...formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }], 'buy'),
    ...formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }], 'sell'),
    "I don't sell 'dragon claws'.",
    formatAmbiguous([{ name: 'Maple longbow', id: 851 }, { name: 'Maple longbow', id: 62 }]),
    `Iron ore is ${formatGp(22)}ea. Trade me and put up coins.`,
    'Just trade me and put it up. I price what I see.',
    priced([{ id: 440, name: 'Iron ore', count: 100 }]),
    priced([{ id: 440, name: 'Iron ore', count: 100 }, { id: 995, name: 'Coins', count: 500 }]),
    priced([{ id: 1127, name: 'Rune platebody', count: 1 }]),
    priced([]),
    priced([{ id: 995, name: 'Coins', count: 2200 }], { itemId: 440, maxQty: 100 }),
    priced([{ id: 995, name: 'Coins', count: 5 }], { itemId: 440, maxQty: 100 }),
    'Thanks Elliott. Pleasure doing business.',
    `Trading: ${formatPriceList([{ name: 'Iron ore', buy: 18, sell: 22 }], 'both')[0]}`,
    'Trade declined: too many changes in one trade.',
    'Trade declined: the confirm screen changed.',
    'Trade declined. Ask again in a minute.',
    'Trade closed. Ask again in a minute.',
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
    test('a command quoted inside a sentence is not a command', () => {
        expect(parseCommand('Quote first, e.g. "buy 100 iron ore".')).toEqual({ kind: 'none' });
        expect(parseCommand('anyone selling 100 iron ore?')).toEqual({ kind: 'none' });
        expect(parseCommand('he said buy 100 iron ore')).toEqual({ kind: 'none' });
    });
});

/** What the wire does to a line: pack it, unpack it, and compare on the codec's own terms. */
function overTheWire(line: string): string {
    const out = new Packet(new Uint8Array(256));
    WordPack.pack(out, line);
    const size = out.pos;
    return WordPack.unpack(new Packet(out.data.slice(0, size)), size).trim().toLowerCase();
}

// Why: WordPack maps any character outside its alphabet to a space without complaining, so '18/22'
// Why: leaves the shop and arrives as '18 22'. Only a round trip catches it.
describe('every reply survives the chat wire', () => {
    for (const line of EVERY_REPLY) {
        test(`carries intact: ${line.slice(0, 42)}`, () => {
            expect(overTheWire(line)).toBe(line.trim().toLowerCase());
        });
    }
});

describe('the wire itself', () => {
    test('a slash is silently eaten, which is what the rule above exists for', () => {
        expect(overTheWire('18/22')).toBe('18 22');
    });

    test('the separators the shop does use come back', () => {
        expect(overTheWire('18-22')).toBe('18-22');
        expect(overTheWire("2 matches: 'maple longbow' #851. which?")).toBe(
            "2 matches: 'maple longbow' #851. which?"
        );
    });
});
