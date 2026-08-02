import { describe, expect, test } from 'bun:test';
import { parseTradePartnerHeader } from '#/bot/api/hud/Trade.js';

describe('parseTradePartnerHeader', () => {
    test('strips Trading With: prefix', () => {
        expect(parseTradePartnerHeader('Trading With: RunnerBot')).toBe('RunnerBot');
        expect(parseTradePartnerHeader('Trading With:  RunnerBot  ')).toBe('RunnerBot');
    });
    test('handles missing colon prefix', () => {
        expect(parseTradePartnerHeader('Trading with RunnerBot')).toBe('RunnerBot');
    });
    test('bare name passes through', () => {
        expect(parseTradePartnerHeader('RunnerBot')).toBe('RunnerBot');
    });
    test('empty / whitespace is null', () => {
        expect(parseTradePartnerHeader('')).toBeNull();
        expect(parseTradePartnerHeader('   ')).toBeNull();
        expect(parseTradePartnerHeader('Trading With:')).toBeNull();
    });
});
