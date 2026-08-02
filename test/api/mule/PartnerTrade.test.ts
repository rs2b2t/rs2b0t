import { describe, expect, test } from 'bun:test';
import {
    countOfferByName,
    countOfferMatching,
    decideGiverOfferScreen,
    decideReceiverOfferScreen,
    isConfiguredPartner,
    muleCookerActive,
    muleGathererHandoffActive,
    muleNonGathererActive,
    muleReceiverActive,
    muleSupplierActive,
    parseMuleMode,
    parsePartnerList
} from '#/bot/api/mule/PartnerTrade.js';

describe('parsePartnerList / isConfiguredPartner', () => {
    test('splits and trims comma names', () => {
        expect(parsePartnerList(' Alice, Bob , ')).toEqual(['Alice', 'Bob']);
        expect(parsePartnerList('')).toEqual([]);
    });

    test('partner match is case-insensitive', () => {
        expect(isConfiguredPartner('alice', ['Alice', 'Bob'])).toBe(true);
        expect(isConfiguredPartner('Eve', ['Alice'])).toBe(false);
        expect(isConfiguredPartner(null, ['Alice'])).toBe(false);
    });
});

describe('offer counts', () => {
    test('countOfferByName sums stacks', () => {
        expect(
            countOfferByName(
                [
                    { name: 'Iron ore', count: 10 },
                    { name: 'Tin ore', count: 5 },
                    { name: 'Iron ore', count: 2 }
                ],
                'Iron ore'
            )
        ).toBe(12);
    });

    test('countOfferMatching uses predicate', () => {
        expect(
            countOfferMatching(
                [
                    { name: 'Raw shrimp', count: 3 },
                    { name: 'Logs', count: 4 }
                ],
                n => n.toLowerCase().startsWith('raw ')
            )
        ).toBe(3);
    });
});

describe('decideReceiverOfferScreen', () => {
    const partners = ['Runner1'];

    test('waits for header lag', () => {
        expect(
            decideReceiverOfferScreen({
                partnerHeader: null,
                partners,
                myOfferSlots: 0,
                theirProductCount: 5
            }).action
        ).toBe('wait-header');
    });

    test('declines strangers and non-empty own offer', () => {
        expect(
            decideReceiverOfferScreen({
                partnerHeader: 'Stranger',
                partners,
                myOfferSlots: 0,
                theirProductCount: 5
            }).action
        ).toBe('decline');
        expect(
            decideReceiverOfferScreen({
                partnerHeader: 'Runner1',
                partners,
                myOfferSlots: 1,
                theirProductCount: 5
            }).action
        ).toBe('decline');
    });

    test('accepts when partner offered product', () => {
        expect(
            decideReceiverOfferScreen({
                partnerHeader: 'Runner1',
                partners,
                myOfferSlots: 0,
                theirProductCount: 12
            }).action
        ).toBe('accept');
        expect(
            decideReceiverOfferScreen({
                partnerHeader: 'Runner1',
                partners,
                myOfferSlots: 0,
                theirProductCount: 0
            }).action
        ).toBe('wait-offer');
    });
});

describe('decideGiverOfferScreen', () => {
    test('offer then accept', () => {
        expect(decideGiverOfferScreen(0)).toBe('offer');
        expect(decideGiverOfferScreen(2)).toBe('accept');
    });
});

describe('mule mode flags', () => {
    test('parseMuleMode', () => {
        expect(parseMuleMode('Gatherer')).toBe('gatherer');
        expect(parseMuleMode('mule')).toBe('mule');
        expect(parseMuleMode('Cooker')).toBe('cooker');
        expect(parseMuleMode('Supplier')).toBe('supplier');
        expect(parseMuleMode('Off')).toBe('off');
    });

    test('handoff only for gatherer with partners and not power', () => {
        expect(muleGathererHandoffActive('gatherer', ['Mule'], false)).toBe(true);
        expect(muleGathererHandoffActive('gatherer', ['Mule'], true)).toBe(false);
        expect(muleGathererHandoffActive('gatherer', [], false)).toBe(false);
        expect(muleGathererHandoffActive('off', ['Mule'], false)).toBe(false);
        expect(muleReceiverActive('mule', ['G'])).toBe(true);
        expect(muleReceiverActive('mule', [])).toBe(false);
    });

    test('cooker / supplier / non-gatherer roles', () => {
        expect(muleCookerActive('cooker', ['Fish'])).toBe(true);
        expect(muleCookerActive('mule', ['Fish'])).toBe(false);
        expect(muleSupplierActive('supplier', ['Cook'], false)).toBe(true);
        expect(muleSupplierActive('supplier', ['Cook'], true)).toBe(false);
        expect(muleNonGathererActive('cooker', ['A'])).toBe(true);
        expect(muleNonGathererActive('supplier', ['A'])).toBe(true);
        expect(muleNonGathererActive('gatherer', ['A'])).toBe(false);
    });
});
