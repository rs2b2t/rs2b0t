import { describe, expect, test } from 'bun:test';

import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import { decideHandoff, type HandoffInput } from '#/bot/api/ai/quests/defs/shieldofarrav/partner.js';

function input(over: Partial<HandoffInput>): HandoffInput {
    return {
        gang: 'phoenix',
        stage: SOA_STAGE.PHOENIX_JOINED,
        hasKey: false,
        hasOwnHalf: false,
        hasOtherHalf: false,
        certs: 0,
        certsHeld: 0,
        certTarget: 2,
        partnerConfigured: true,
        halvesGiven: 0,
        gaveCert: false,
        ...over
    };
}

describe('arrav handoffs', () => {
    test('no partner means no handoff at all', () => {
        expect(decideHandoff(input({ partnerConfigured: false, hasKey: true }))).toBeNull();
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.KATRINE_TASK, partnerConfigured: false
        }))).toBeNull();
    });

    test('a joined phoenix bot hands its spare key over', () => {
        expect(decideHandoff(input({ hasKey: true }))).toBe('give-key');
    });

    test('a phoenix bot below the join has no key to give', () => {
        expect(decideHandoff(input({ stage: SOA_STAGE.KILL_JONNY, hasKey: true }))).toBeNull();
    });

    test('a keyless black arm bot on the crossbow task asks for one', () => {
        expect(decideHandoff(input({ gang: 'blackarm', stage: SOA_STAGE.KATRINE_TASK }))).toBe('take-key');
    });

    test('a black arm bot that already holds the key asks for nothing', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.KATRINE_TASK, hasKey: true
        }))).toBeNull();
    });

    test('a black arm bot holding its half gives it to the minter', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, hasOwnHalf: true
        }))).toBe('give-half');
    });

    test('a phoenix bot holding only its own half waits to receive the other', () => {
        expect(decideHandoff(input({ hasOwnHalf: true }))).toBe('take-half');
    });

    test('a phoenix bot with both halves does not trade — it mints', () => {
        expect(decideHandoff(input({ hasOwnHalf: true, hasOtherHalf: true }))).toBeNull();
    });

    test('two certificates at target are split with the partner', () => {
        expect(decideHandoff(input({ certs: 2, certsHeld: 2, certTarget: 2 }))).toBe('give-cert');
    });

    // Why: a trade can only offer from the pack, and the withdraw that fixes a banked stockpile is the certificate step's job.
    test('a banked stockpile is not offerable, so no handoff is asked for', () => {
        expect(decideHandoff(input({ certs: 6, certsHeld: 0, certTarget: 6 }))).toBeNull();
    });

    test('the split happens once', () => {
        expect(decideHandoff(input({ certs: 6, certsHeld: 2, certTarget: 6, gaveCert: true }))).toBeNull();
    });

    test('two certificates below target are not split yet', () => {
        expect(decideHandoff(input({ certs: 2, certsHeld: 2, certTarget: 10 }))).toBeNull();
    });

    test('ten certificates at a target of ten are split', () => {
        expect(decideHandoff(input({ certs: 10, certsHeld: 2, certTarget: 10 }))).toBe('give-cert');
    });

    test('a black arm bot that gave its half away collects a certificate', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, hasOwnHalf: false, certs: 0, halvesGiven: 1
        }))).toBe('take-cert');
    });

    // Why: the two states look identical in the snapshot, and asking first leaves the bot waiting for a certificate only its own half can buy.
    // Why: each half buys the pair two certificates, so a stockpile needs the supplier to keep going rather than stop after one.
    test('a black arm bot keeps supplying halves until the target is covered', () => {
        const stocking = {
            gang: 'blackarm' as const, stage: SOA_STAGE.BLACKARM_JOINED,
            hasOwnHalf: false, certs: 0, certTarget: 6
        };
        expect(decideHandoff(input({ ...stocking, halvesGiven: 1 }))).toBeNull();
        expect(decideHandoff(input({ ...stocking, halvesGiven: 2 }))).toBeNull();
        expect(decideHandoff(input({ ...stocking, halvesGiven: 3 }))).toBe('take-cert');
    });

    test('a black arm bot that has never farmed a half is left to the cupboard leg', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, hasOwnHalf: false, certs: 0, halvesGiven: 0
        }))).toBeNull();
    });

    test('a black arm bot that already holds a certificate is done trading', () => {
        expect(decideHandoff(input({
            gang: 'blackarm', stage: SOA_STAGE.BLACKARM_JOINED, certs: 1
        }))).toBeNull();
    });

    test('the key hand-over stops once the quest is complete', () => {
        expect(decideHandoff(input({ stage: SOA_STAGE.COMPLETE, hasKey: true }))).toBeNull();
    });
});
