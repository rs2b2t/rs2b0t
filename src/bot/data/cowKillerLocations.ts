import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { BankDestination } from '../api/bank/Banking.js';
import Tile from '../geometry/Tile.js';

export interface CowLocation {
    name: string;
    anchor: Tile;
    usesAlKharidToll: boolean;
    bankDestination?: BankDestination;
}

export const DRAYNOR_BANK = new Tile(3093, 3243, 0);
export const FALADOR_EAST_BANK = new Tile(3013, 3355, 0);
export const ARDOUGNE_WEST_BANK = new Tile(2616, 3332, 0);

export const COW_LOCATIONS: CowLocation[] = [
    {
        name: 'Lumbridge cow field',
        anchor: new Tile(3255, 3288, 0),
        usesAlKharidToll: true
    },
    {
        // Why: west of the river, so it banks at Draynor and never pays the toll gate.
        name: 'North-west of Lumbridge',
        anchor: new Tile(3168, 3329, 0),
        usesAlKharidToll: false,
        bankDestination: { name: 'Draynor', tile: DRAYNOR_BANK }
    },
    {
        name: 'South of Falador',
        anchor: new Tile(3033, 3306, 0),
        usesAlKharidToll: false,
        bankDestination: { name: 'Falador East', tile: FALADOR_EAST_BANK }
    },
    {
        name: 'East Ardougne cow field',
        anchor: new Tile(2664, 3347, 0),
        usesAlKharidToll: false,
        // Why: Ardougne East is technically closer, but Ardougne West's booth avoids the crowded Ardougne area.
        bankDestination: { name: 'Ardougne West', tile: ARDOUGNE_WEST_BANK }
    }
];

export const COW_LOCATION_OPTIONS = ['Auto', ...COW_LOCATIONS.map(location => location.name), 'Start tile'];
export const AL_KHARID_BANK = new Tile(3269, 3167, 0);
export const TOLL_COIN_TARGET = 20;

export function isCowFieldLootTile(anchor: WorldTile, leashRadius: number, tile: WorldTile): boolean {
    return tile.level === anchor.level
        && Math.max(Math.abs(tile.x - anchor.x), Math.abs(tile.z - anchor.z)) <= leashRadius;
}

export function resolveCowLocation(setting: string, start: WorldTile): CowLocation | null {
    const normalized = setting.trim().toLowerCase();
    if (normalized === 'start tile') {
        return null;
    }
    if (normalized !== 'auto') {
        return COW_LOCATIONS.find(location => location.name.toLowerCase() === normalized) ?? null;
    }

    return COW_LOCATIONS.reduce((nearest, location) =>
        location.anchor.distanceTo(start) < nearest.anchor.distanceTo(start) ? location : nearest
    );
}

export function nearestCowLocation(tile: WorldTile): CowLocation {
    return COW_LOCATIONS.reduce((nearest, location) =>
        location.anchor.distanceTo(tile) < nearest.anchor.distanceTo(tile) ? location : nearest
    );
}

export function needsTollCoins(location: CowLocation | null, enabled: boolean): boolean {
    return enabled && location?.usesAlKharidToll === true;
}

export function cowBankDestination(location: CowLocation | null, tollEnabled: boolean): BankDestination | null {
    if (needsTollCoins(location, tollEnabled)) {
        return { name: 'Al Kharid', tile: AL_KHARID_BANK };
    }
    return location?.bankDestination ?? null;
}

export function shouldBootstrapTollCoins(location: CowLocation | null, start: WorldTile, coins: number, enabled: boolean): boolean {
    return needsTollCoins(location, enabled)
        && coins < TOLL_COIN_TARGET
        && start.level === AL_KHARID_BANK.level
        && AL_KHARID_BANK.distanceTo(start) <= 80;
}
