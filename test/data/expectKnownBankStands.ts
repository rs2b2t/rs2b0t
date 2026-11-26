import { expect } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import type { GatheringLocation } from '#/bot/data/gatheringLocations.js';
import type Tile from '#/bot/geometry/Tile.js';

function tileKey({ x, z, level }: Tile): string {
    return `${x},${z},${level}`;
}

const bankTiles = new Set(BANK_LOCATIONS.map(bank => tileKey(bank.tile)));

export function expectKnownBankStands(camps: readonly GatheringLocation[]): void {
    for (const camp of camps) {
        const key = tileKey(camp.bankStand);
        expect(bankTiles.has(key), `${camp.name} bank ${key}`).toBe(true);
    }
}
