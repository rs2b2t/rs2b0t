import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import { BANK_LOCATIONS, bankDistance } from '#/bot/api/bank/BankLocations.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { secondaryById } from '#/bot/scripts/HerbloreSecondaries/HerbloreSecondariesLogic.js';

const pack = 'out/collision.lcnav.gz';
const snape = secondaryById('snape_grass');
const east = BANK_LOCATIONS.find(bank => bank.name === 'Falador East')!;
const west = BANK_LOCATIONS.find(bank => bank.name === 'Falador West')!;

test('snape grass uses the Falador bank nearest the south entrance', () => {
    expect(snape.bankName).toBe(east.name);
    expect(snape.bank).toMatchObject(east.tile);
});

test.skipIf(!existsSync(pack))('the snape bank minimizes walking both ways despite the nearer western coordinates', () => {
    const finder = new PathFinder(gunzipSync(readFileSync(pack)));
    loadDefaultNavEdges(finder);
    const anchor = snape.anchor!;
    expect(bankDistance(anchor, west.tile)).toBeLessThan(bankDistance(anchor, east.tile));
    for (const returning of [false, true]) {
        const routes = [east, west].map(bank => finder.findPath(returning ? bank.tile : anchor, returning ? anchor : bank.tile, {
            useTeleportCatalog: false, maxExpansions: 100_000
        }));
        for (const route of routes) expect(route.ok).toBe(true);
        if (!routes[0].ok || !routes[1].ok) throw new Error('Falador bank route unavailable');
        expect(routes[0].cost).toBeLessThan(routes[1].cost);
        expect(snape.bankName).toBe(east.name);
    }
});
