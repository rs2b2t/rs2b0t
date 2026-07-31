import { BANK_LOCATIONS } from '../api/BankLocations.js';
import Tile from '../api/Tile.js';
import { type TradeItem } from '../api/hud/Trade.js';
import { RUNES, RUNE_OPTIONS, DEFAULT_RUNE, type RuneRoute, type RuneType } from '../api/RuneCraftLocations.js';

export { RUNES, RUNE_OPTIONS, DEFAULT_RUNE, type RuneRoute, type RuneType };

export function bankTile(bankName: string): Tile {
    const loc = BANK_LOCATIONS.find(b => b.name === bankName);
    if (!loc) {
        throw new Error(`bankTile: unknown bank '${bankName}'`);
    }
    return loc.tile;
}

export const TRADE_CAP: number = 27;
export type MuleTradeState = 'has-essence' | 'empty';

export function essencePerTrade(_invSize: number = 28, _holdsTalisman: boolean = true): number {
    return TRADE_CAP;
}

export function isConfiguredPartner(name: string | null, configuredPartners: string[]): boolean {
    if (!name || configuredPartners.length === 0) return false;
    const cleanName = name.toLowerCase().replace(/[\u00A0_]/g, ' ').trim();
    return configuredPartners.some(p => p.toLowerCase().replace(/[\u00A0_]/g, ' ').trim() === cleanName);
}

export function classifyMuleState(theirOffer: TradeItem[]): MuleTradeState {
    const totalEssence = theirOffer
        .filter(item => item.name?.toLowerCase() === 'rune essence')
        .reduce((sum, item) => sum + item.count, 0);

    return totalEssence > 0 ? 'has-essence' : 'empty';
}