import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { stableClosedPoll } from '#/bot/api/trade/drivePartnerTrade.js';

const mockTradeActive = mock(() => false);

mock.module('#/bot/api/trade/Trade.js', () => ({
    Trade: {
        active: mockTradeActive,
        onOfferScreen: () => false,
        onConfirmScreen: () => false
    }
}));

describe('stableClosedPoll', () => {
    beforeEach(() => {
        mockTradeActive.mockReset();
        mockTradeActive.mockReturnValue(false);
    });

    test('returns false when Trade.active() is true', () => {
        mockTradeActive.mockReturnValue(true);
        const poll = stableClosedPoll(600, () => 1000);
        expect(poll()).toBe(false);
    });

    test('returns false when inactive time is less than minMs', () => {
        let time = 1000;
        const poll = stableClosedPoll(600, () => time);
        
        expect(poll()).toBe(false);
        
        time = 1500;
        expect(poll()).toBe(false);
    });

    test('returns true when inactive time reaches minMs', () => {
        let time = 1000;
        const poll = stableClosedPoll(600, () => time);
        
        expect(poll()).toBe(false);
        
        time = 1600;
        expect(poll()).toBe(true);
    });

    test('resets timer when Trade.active() becomes true', () => {
        let time = 1000;
        const poll = stableClosedPoll(600, () => time);
        
        expect(poll()).toBe(false);
        
        time = 1300;
        expect(poll()).toBe(false);
        
        mockTradeActive.mockReturnValue(true);
        expect(poll()).toBe(false);
        
        mockTradeActive.mockReturnValue(false);
        time = 1600;
        expect(poll()).toBe(false);
        
        time = 2200;
        expect(poll()).toBe(true);
    });

    test('edge case: exactly at minMs boundary', () => {
        let time = 1000;
        const poll = stableClosedPoll(600, () => time);
        
        expect(poll()).toBe(false);
        
        time = 1600;
        expect(poll()).toBe(true);
    });
});
