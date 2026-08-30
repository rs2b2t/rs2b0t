import { BANK_LOCATIONS, approachOf, bankUnlocked } from '../bank/BankLocations.js';
import {
    CUSTOM_LOCATION,
    buildCookLocations,
    findCookLocation,
    type CookLocation
} from '../../data/cookLocations.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { bankDistance } from '../../geometry/distance.js';

/** Every bank, each paired with the cook surface nearest to it. */
export const COOK_LOCATIONS: readonly CookLocation[] = buildCookLocations(BANK_LOCATIONS);

export const COOK_LOCATION_OPTIONS: readonly string[] = [
    'Auto',
    ...COOK_LOCATIONS.map(l => l.name),
    CUSTOM_LOCATION
];

export function cookLocation(name: string): CookLocation | null {
    return findCookLocation(COOK_LOCATIONS, name);
}

/**
 * Resolve the location setting: `Custom` and any unknown name yield null so the caller
 * falls back to its tile settings, `Auto` takes the nearest bank this account can open.
 */
export function resolveCookLocation(
    setting: string,
    from: WorldTile,
    unlocked: (loc: CookLocation) => boolean = loc => bankUnlocked(loc.bank)
): CookLocation | null {
    const wanted = setting.trim().toLowerCase();
    if (wanted === '' || wanted === CUSTOM_LOCATION.toLowerCase()) {
        return null;
    }
    if (wanted !== 'auto') {
        const named = cookLocation(setting);
        return named && unlocked(named) ? named : null;
    }
    let best: { loc: CookLocation; d: number } | null = null;
    for (const loc of COOK_LOCATIONS) {
        if (!unlocked(loc)) {
            continue;
        }
        const d = bankDistance(from, approachOf(loc.bank));
        if (!best || d < best.d) {
            best = { loc, d };
        }
    }
    return best?.loc ?? null;
}
