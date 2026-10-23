import { BANK_LOCATIONS } from '../../api/bank/BankLocations.js';
import Tile from '../../geometry/Tile.js';
import { type TradeItem } from '../../api/trade/Trade.js';
import { RUNES, RUNE_OPTIONS, DEFAULT_RUNE, type RuneRoute, type RuneType } from '../../data/runeCraftLocations.js';

export { RUNES, RUNE_OPTIONS, DEFAULT_RUNE, type RuneRoute, type RuneType };

export const TRADE_CAP = 27;
export const TRADE_REQUEST_INTERVAL_MS = 3_000;
export const MEETING_POINTS = ['Altar (inside)', 'Ruins (outside)'] as const;
export type MeetingPoint = typeof MEETING_POINTS[number];
export const DEFAULT_MEETING_POINT: MeetingPoint = 'Altar (inside)';

type MuleTradeState = 'has-essence' | 'empty';

export interface PartnerCandidate {
    name: string | null;
    distance: number;
}

function normalizeName(name: string): string {
    return name.toLowerCase().replace(/[\u00A0_]/g, ' ').trim();
}

export function parsePartnerNames(raw: string): string[] {
    return raw.split(',').map(normalizeName).filter(Boolean);
}

export function bankTile(bankName: string): Tile {
    const loc = BANK_LOCATIONS.find(b => b.name === bankName);
    if (!loc) {
        throw new Error(`bankTile: unknown bank '${bankName}'`);
    }
    return loc.tile;
}

export function essencePerTrade(_invSize: number = 28, _holdsTalisman: boolean = true): number {
    return TRADE_CAP;
}

export function isConfiguredPartner(name: string | null, configuredPartners: string[]): boolean {
    if (!name || configuredPartners.length === 0) return false;
    const cleanName = normalizeName(name);
    return configuredPartners.some(p => normalizeName(p) === cleanName);
}

export function selectNearestPartner(
    configuredPartners: string[],
    candidates: readonly PartnerCandidate[],
    requestedName: string | null = null
): PartnerCandidate | null {
    const eligible = candidates.filter(candidate => isConfiguredPartner(candidate.name, configuredPartners));
    if (requestedName !== null) {
        const requested = eligible.find(candidate => isConfiguredPartner(candidate.name, [requestedName]));
        if (requested) return requested;
    }
    return eligible.reduce<PartnerCandidate | null>((best, candidate) => {
        if (!best || candidate.distance < best.distance) return candidate;
        return best;
    }, null);
}

export function bankDue(tradesSinceBank: number, tradesPerBank: number, bankVisitsEnabled = true): boolean {
    return bankVisitsEnabled && tradesPerBank > 0 && tradesSinceBank >= tradesPerBank;
}

export function tradeRequestDue(lastRequestAt: number | null, now: number, intervalMs = TRADE_REQUEST_INTERVAL_MS): boolean {
    return lastRequestAt === null || now - lastRequestAt >= intervalMs;
}

export function classifyMuleState(theirOffer: TradeItem[]): MuleTradeState {
    const totalEssence = theirOffer
        .filter(item => item.name?.toLowerCase() === 'rune essence')
        .reduce((sum, item) => sum + item.count, 0);

    return totalEssence > 0 ? 'has-essence' : 'empty';
}
