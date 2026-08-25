import { afterEach, describe, expect, test } from 'bun:test';

import { actions, attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import ObjType from '#/client/config/ObjType.js';
import Packet from '#/client/io/Packet.js';
import { ClientProt } from '#/client/io/ClientProt.js';
import WordPack from '#/client/wordfilter/WordPack.js';

const originalInterfaces = IfType.list;
const realObjList = ObjType.list;

/** Minimal stand-in: `attach` only reads statSessionGeneration and wraps tcpIn when present. */
function fakeClient(): { out: Packet; statSessionGeneration: number } {
    return { out: new Packet(new Uint8Array(512)), statSessionGeneration: 0 };
}

function invComponent(id: number, slots: readonly { id: number; count: number }[]): IfType {
    const com = new IfType();
    com.id = id;
    com.type = ComponentType.TYPE_INV;
    com.linkObjType = new Int32Array(28);
    com.linkObjNumber = new Int32Array(28);
    slots.forEach((slot, i) => {
        com.linkObjType![i] = slot.id + 1;
        com.linkObjNumber![i] = slot.count;
    });
    return com;
}

function installConfirm(parts: {
    mine1?: { id: number; count: number }[];
    mine2?: { id: number; count: number }[];
    theirs1?: { id: number; count: number }[];
    theirs2?: { id: number; count: number }[];
    mineNothing?: string;
    theirsNothing?: string;
}): void {
    const text = (id: number, value: string): IfType => {
        const com = new IfType();
        com.id = id;
        com.type = ComponentType.TYPE_TEXT;
        com.text = value;
        return com;
    };

    IfType.list = [];
    for (const com of [
        invComponent(3542, parts.mine1 ?? []),
        invComponent(3538, parts.mine2 ?? []),
        invComponent(3532, parts.theirs1 ?? []),
        invComponent(3539, parts.theirs2 ?? []),
        text(3557, parts.mineNothing ?? ''),
        text(3558, parts.theirsNothing ?? '')
    ]) {
        IfType.list[com.id] = com;
    }

    ObjType.list = ((id: number) => {
        const type = new ObjType();
        type.id = id;
        type.name = id === 995 ? 'Coins' : `obj ${id}`;
        return type;
    }) as typeof ObjType.list;
}

afterEach(() => {
    detach();
    IfType.list = originalInterfaces;
    ObjType.list = realObjList;
});

describe('actions.sayPublic', () => {
    test('writes MESSAGE_PUBLIC with a colour, an effect and a length prefix', () => {
        const raw = fakeClient();
        attach(raw as never);

        expect(actions.sayPublic('hello')).toBe(true);

        const bytes = raw.out.data.slice(0, raw.out.pos);
        expect(bytes[0]).toBe(ClientProt.MESSAGE_PUBLIC & 0xff);
        expect(bytes[1]).toBe(bytes.length - 2);
        expect(bytes[2]).toBe(0);
        expect(bytes[3]).toBe(0);
    });

    // Why: pack lowercases and nibble-pads, unpack sentence-cases for display, so the round trip is only faithful after trim + lowercase.
    test('the payload unpacks back to the message', () => {
        const raw = fakeClient();
        attach(raw as never);

        actions.sayPublic('buy 100 iron ore');

        const size = raw.out.data[1];
        const body = new Packet(raw.out.data.slice(4, 2 + size));
        expect(WordPack.unpack(body, size - 2).trim().toLowerCase()).toBe('buy 100 iron ore');
    });

    test('refuses an empty message and a detached client', () => {
        const raw = fakeClient();
        attach(raw as never);
        expect(actions.sayPublic('   ')).toBe(false);
        detach();
        expect(actions.sayPublic('hello')).toBe(false);
    });

    test('truncates past the game limit', () => {
        const raw = fakeClient();
        attach(raw as never);
        expect(actions.sayPublic('x'.repeat(300))).toBe(true);
        expect(raw.out.pos).toBeLessThan(120);
    });
});

describe('reader.tradeConfirmOffers', () => {
    test('reads the small-offer components', () => {
        installConfirm({
            mine1: [{ id: 440, count: 100 }],
            theirs1: [{ id: 995, count: 2000 }]
        });

        const offers = reader.tradeConfirmOffers();

        expect(offers.mine.map(i => ({ id: i.id, count: i.count }))).toEqual([{ id: 440, count: 100 }]);
        expect(offers.theirs.map(i => ({ id: i.id, count: i.count }))).toEqual([{ id: 995, count: 2000 }]);
    });

    // Why: the engine switches to inv2 / otherinv2 once a side offers 14 or more items.
    test('reads the large-offer components too', () => {
        installConfirm({ mine2: [{ id: 440, count: 7 }], theirs2: [{ id: 1127, count: 1 }] });

        const offers = reader.tradeConfirmOffers();

        expect(offers.mine.map(i => i.id)).toEqual([440]);
        expect(offers.theirs.map(i => i.id)).toEqual([1127]);
    });

    test('an empty screen that has not filled reads as not ready', () => {
        installConfirm({});
        expect(reader.tradeConfirmReady()).toBe(false);
    });

    // Why: an empty offer is legitimate, and only the "Absolutely nothing!" label separates it from a screen still filling.
    test('a declared-empty offer reads as ready', () => {
        installConfirm({ mineNothing: 'Absolutely nothing!', theirs1: [{ id: 995, count: 5 }] });
        expect(reader.tradeConfirmReady()).toBe(true);
        expect(reader.tradeConfirmOffers().mine).toEqual([]);
    });

    test('a filled offer reads as ready', () => {
        installConfirm({ mine1: [{ id: 440, count: 1 }], theirsNothing: 'Absolutely nothing!' });
        expect(reader.tradeConfirmReady()).toBe(true);
    });
});
