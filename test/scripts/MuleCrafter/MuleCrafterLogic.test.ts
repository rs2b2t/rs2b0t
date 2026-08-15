import { describe, expect, test } from 'bun:test';
import { 
    RUNES, 
    bankTile, 
    RUNE_OPTIONS, 
    isConfiguredPartner, 
    classifyMuleState, 
    type RuneRoute 
} from '#/bot/scripts/MuleCrafter/MuleCrafterLogic.js';
import { type TradeItem } from '#/bot/api/trade/Trade.js';

describe('MuleCrafterLogic', () => {
    describe('RUNES', () => {
        test('keys are singular rune names', () => {
            // Why: asserting the full list re-breaks whenever an altar is added, so pin the shape rather than the census.
            expect(Object.keys(RUNES).length).toBeGreaterThanOrEqual(2);
            for (const key of Object.keys(RUNES)) {
                expect(key).toMatch(/^[A-Z][a-z]+ rune$/);
            }
        });

        test('Air rune route has correct data', () => {
            const air: RuneRoute = RUNES['Air rune'];
            expect(air.rune).toBe('Air rune');
            expect(air.talisman).toBe('Air talisman');
            expect(air.level).toBe(1);
            expect(air.bank).toBe('Falador East');
            expect(air.ruins.x).toBe(2983);
            expect(air.ruins.z).toBe(3288);
        });

        test('Mind rune route has correct data', () => {
            const mind: RuneRoute = RUNES['Mind rune'];
            expect(mind.rune).toBe('Mind rune');
            expect(mind.talisman).toBe('Mind talisman');
            expect(mind.level).toBe(2);
            expect(mind.bank).toBe('Edgeville');
            expect(mind.ruins.x).toBe(2980);
            expect(mind.ruins.z).toBe(3511);
        });

        test('every route names a bank that resolves to a real tile', () => {
            // `bank` became a BANK_LOCATIONS name rather than a Tile; this is what that
            // indirection has to guarantee, and it catches a typo in any new row.
            for (const route of Object.values(RUNES) as RuneRoute[]) {
                expect(() => bankTile(route.bank)).not.toThrow();
            }
        });
    });

    describe('RUNE_OPTIONS', () => {
        test('matches RUNES keys', () => {
            expect(RUNE_OPTIONS).toEqual(Object.keys(RUNES));
        });
    });

    describe('DEFAULT_RUNE', () => {
        test('returns false for null name', () => {
            expect(isConfiguredPartner(null, ['Player1'])).toBe(false);
        });

        test('returns false for empty configured partners', () => {
            expect(isConfiguredPartner('Player1', [])).toBe(false);
        });

        test('exact match returns true', () => {
            expect(isConfiguredPartner('Player1', ['Player1'])).toBe(true);
        });

        test('case insensitive match', () => {
            expect(isConfiguredPartner('player1', ['Player1'])).toBe(true);
            expect(isConfiguredPartner('PLAYER1', ['Player1'])).toBe(true);
        });

        test('underscore normalization', () => {
            expect(isConfiguredPartner('Player_One', ['Player One'])).toBe(true);
            expect(isConfiguredPartner('Player One', ['Player_One'])).toBe(true);
        });

        test('non-breaking space normalization', () => {
            expect(isConfiguredPartner('Player\u00A0One', ['Player One'])).toBe(true);
        });

        test('multiple partners - matches any', () => {
            expect(isConfiguredPartner('Player2', ['Player1', 'Player2', 'Player3'])).toBe(true);
        });

        test('no match returns false', () => {
            expect(isConfiguredPartner('PlayerX', ['Player1', 'Player2'])).toBe(false);
        });
    });

    describe('classifyMuleState', () => {
        test('has essence returns has-essence', () => {
            const offer: TradeItem[] = [{ id: 1436, name: 'Rune essence', count: 10 }];
            expect(classifyMuleState(offer)).toBe('has-essence');
        });

        test('multiple essence items sums correctly', () => {
            const offer: TradeItem[] = [
                { id: 1436, name: 'Rune essence', count: 5 },
                { id: 1436, name: 'Rune essence', count: 5 },
            ];
            expect(classifyMuleState(offer)).toBe('has-essence');
        });

        test('no essence returns empty', () => {
            const offer: TradeItem[] = [{ id: 556, name: 'Air rune', count: 27 }];
            expect(classifyMuleState(offer)).toBe('empty');
        });

        test('empty offer returns empty', () => {
            expect(classifyMuleState([])).toBe('empty');
        });

        test('case insensitive essence name', () => {
            const offer: TradeItem[] = [{ id: 1436, name: 'rune essence', count: 10 }];
            expect(classifyMuleState(offer)).toBe('has-essence');
        });

        test('mixed case essence name', () => {
            const offer: TradeItem[] = [{ id: 1436, name: 'Rune Essence', count: 10 }];
            expect(classifyMuleState(offer)).toBe('has-essence');
        });

        test('zero count essence returns empty', () => {
            const offer: TradeItem[] = [{ id: 1436, name: 'Rune essence', count: 0 }];
            expect(classifyMuleState(offer)).toBe('empty');
        });
    });
});