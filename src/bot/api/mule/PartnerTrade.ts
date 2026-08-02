/**
 * Shared partner + trade-screen policy for mule/runner scripts
 * (NatureCrafter, FlaxRunner, GatheringBot mule modes).
 *
 * HUD actions stay on {@link Trade}; this module is pure name matching and
 * offer-screen decisions so scripts do not re-copy partner filters.
 */

export const DEFAULT_TRADE_RANGE = 2;

/** Split a settings string into partner names (comma-separated, trimmed). */
export function parsePartnerList(raw: string): string[] {
    return raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

export function namesMatch(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** True when `name` is one of the configured partners (case-insensitive). */
export function isConfiguredPartner(name: string | null | undefined, partners: readonly string[]): boolean {
    if (name == null || name.trim() === '' || partners.length === 0) {
        return false;
    }
    const n = name.trim().toLowerCase();
    return partners.some(p => p.trim().toLowerCase() === n);
}

/** Sum counts for items whose name equals `itemName` (case-insensitive). */
export function countOfferByName(
    items: readonly { name: string | null; count: number }[],
    itemName: string
): number {
    const want = itemName.trim().toLowerCase();
    return items
        .filter(o => (o.name ?? '').trim().toLowerCase() === want)
        .reduce((s, o) => s + Math.max(1, o.count), 0);
}

/** True if any offer slot matches a product predicate (name contains keyword, etc.). */
export function countOfferMatching(
    items: readonly { name: string | null; count: number }[],
    match: (name: string) => boolean
): number {
    return items
        .filter(o => o.name != null && match(o.name))
        .reduce((s, o) => s + Math.max(1, o.count), 0);
}

export type ReceiverOfferDecision =
    | { action: 'wait-header' }
    | { action: 'decline'; reason: string }
    | { action: 'wait-offer' }
    | { action: 'accept' };

/**
 * Receiver side on the first trade screen (empty own offer; expect product in).
 * Nature master / Flax spinner / GatheringBot mule.
 */
export function decideReceiverOfferScreen(opts: {
    partnerHeader: string | null;
    partners: readonly string[];
    myOfferSlots: number;
    theirProductCount: number;
}): ReceiverOfferDecision {
    if (opts.partnerHeader === null) {
        return { action: 'wait-header' };
    }
    if (!isConfiguredPartner(opts.partnerHeader, opts.partners)) {
        return { action: 'decline', reason: `not a configured partner (${opts.partnerHeader})` };
    }
    if (opts.myOfferSlots > 0) {
        return { action: 'decline', reason: 'safety: own offer not empty' };
    }
    if (opts.theirProductCount <= 0) {
        return { action: 'wait-offer' };
    }
    return { action: 'accept' };
}

export type GiverOfferDecision = 'offer' | 'accept' | 'wait';

/**
 * Giver side on the first trade screen (offer haul, then accept).
 * Nature runner / Flax runner / GatheringBot gatherer.
 */
export function decideGiverOfferScreen(myOfferSlots: number): GiverOfferDecision {
    if (myOfferSlots <= 0) {
        return 'offer';
    }
    return 'accept';
}

/**
 * GatheringBot partner roles:
 * - gatherer: produce haul → trade at camp meet (no bank)
 * - mule: accept haul → bank (demo for ore/logs; processors should replace this)
 * - cooker: accept raw fish → cook at camp range → bank cooked (burntPolicy)
 * - supplier: withdraw raw from bank when N ready → trade at meet (bank-raw feeder)
 */
export type MuleMode = 'off' | 'gatherer' | 'mule' | 'cooker' | 'supplier';

export function parseMuleMode(raw: string): MuleMode {
    switch (raw.trim().toLowerCase()) {
        case 'gatherer':
            return 'gatherer';
        case 'mule':
            return 'mule';
        case 'cooker':
            return 'cooker';
        case 'supplier':
            return 'supplier';
        default:
            return 'off';
    }
}

/** UI labels for settings dropdowns. */
export const MULE_MODE_OPTIONS = ['Off', 'Gatherer', 'Mule', 'Cooker', 'Supplier'] as const;

/**
 * Whether gatherer should hand off instead of banking when the pack is full.
 * Power/drop mode forces bank/drop path (mule disabled).
 */
export function muleGathererHandoffActive(mode: MuleMode, partners: readonly string[], powerMode: boolean): boolean {
    return mode === 'gatherer' && partners.length > 0 && !powerMode;
}

/** Bank-side accept → bank (ore/logs demo mule). */
export function muleReceiverActive(mode: MuleMode, partners: readonly string[]): boolean {
    return mode === 'mule' && partners.length > 0;
}

/** Fish cooker: accept raw → cook → bank cooked. */
export function muleCookerActive(mode: MuleMode, partners: readonly string[]): boolean {
    return mode === 'cooker' && partners.length > 0;
}

/** Bank feeder: withdraw raw → meet → trade (pairs with Cooker). */
export function muleSupplierActive(mode: MuleMode, partners: readonly string[], powerMode: boolean): boolean {
    return mode === 'supplier' && partners.length > 0 && !powerMode;
}

/** Any non-gathering partner role (skips Gather task / tool restock). */
export function muleNonGathererActive(mode: MuleMode, partners: readonly string[]): boolean {
    return (
        muleReceiverActive(mode, partners)
        || muleCookerActive(mode, partners)
        || (mode === 'supplier' && partners.length > 0)
    );
}
