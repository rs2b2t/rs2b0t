import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { stableClosedPoll } from '#/bot/api/trade/drivePartnerTrade.js';

// Mock Trade module
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
        
        // First call starts the timer
        expect(poll()).toBe(false);
        
        // 500ms later - still not enough
        time = 1500;
        expect(poll()).toBe(false);
    });

    test('returns true when inactive time reaches minMs', () => {
        let time = 1000;
        const poll = stableClosedPoll(600, () => time);
        
        // First call starts the timer
        expect(poll()).toBe(false);
        
        // 600ms later - should return true
        time = 1600;
        expect(poll()).toBe(true);
    });

    test('resets timer when Trade.active() becomes true', () => {
        let time = 1000;
        const poll = stableClosedPoll(600, () => time);
        
        // First call starts the timer
        expect(poll()).toBe(false);
        
        // 300ms later
        time = 1300;
        expect(poll()).toBe(false);
        
        // Trade becomes active
        mockTradeActive.mockReturnValue(true);
        expect(poll()).toBe(false);
        
        // Trade becomes inactive again
        mockTradeActive.mockReturnValue(false);
        time = 1600;
        expect(poll()).toBe(false); // Timer was reset, only 300ms since reset
        
        // 600ms after reset
        time = 2200;
        expect(poll()).toBe(true);
    });

    test('edge case: exactly at minMs boundary', () => {
        let time = 1000;
        const poll = stableClosedPoll(600, () => time);
        
        // First call starts the timer
        expect(poll()).toBe(false);
        
        // Exactly 600ms later
        time = 1600;
        expect(poll()).toBe(true);
    });
});
