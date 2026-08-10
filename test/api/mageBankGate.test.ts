import { afterEach, describe, expect, test } from 'bun:test';

import { BANK_LOCATIONS, USE_MAGE_BANK, bankUnlocked, nearestBank } from '#/bot/api/BankLocations.js';
import TRANSPORTS from '#/bot/nav/data/transports.json';

const MAGE = BANK_LOCATIONS.find(b => b.name === 'Mage Arena')!;
const KEY = `rs2b0t:set:Global:${USE_MAGE_BANK}`;

/** At the web/ladder entrance in deep Wilderness — Gundai is nearest by far. */
const DEEP_WILDERNESS = { x: 3091, z: 3958, level: 0 };

function setSetting(on: boolean | null): void {
    if (on === null) {
        localStorage.removeItem(KEY);
        sessionStorage.removeItem(KEY);
        return;
    }
    localStorage.setItem(KEY, String(on));
}

afterEach(() => setSetting(null));

describe('Mage Arena bank gate', () => {
    test('sits where the ladder lands, approached from the ladder mouth', () => {
        // transports.json: magearena_ladder_to_cellar (3091,3958) -> (2542,4714).
        // Not Kolodion's arena teleport — that is the minigame, not the bank.
        expect(MAGE.tile.x).toBe(2542);
        expect(MAGE.tile.z).toBe(4714);
        expect(MAGE.approach?.x).toBe(3091);
        expect(MAGE.approach?.z).toBe(3958);
        expect(MAGE.npcAccess?.name).toBe('Gundai');
    });

    test('the surface route it is ranked by is baked into the nav graph', () => {
        const at = (e: { from: { x: number; z: number }; to: { x: number; z: number } }, fx: number, tx: number): boolean =>
            e.from.x === fx && e.from.z === 3957 && e.to.x === tx && e.to.z === 3957;
        // Two slashable webs west along z=3957, then the ladder down.
        expect(TRANSPORTS.some(e => at(e, 3096, 3094))).toBe(true);
        expect(TRANSPORTS.some(e => at(e, 3094, 3092))).toBe(true);
        expect(
            TRANSPORTS.some(
                e => e.from.x === MAGE.approach!.x && e.from.z === MAGE.approach!.z && e.to.x === MAGE.tile.x && e.to.z === MAGE.tile.z
            )
        ).toBe(true);
    });

    test('off by default, so nothing routes through the Wilderness to bank', () => {
        expect(bankUnlocked(MAGE)).toBe(false);
        const near = nearestBank(DEEP_WILDERNESS);
        expect(near?.name).not.toBe('Mage Arena');
    });

    test('stays off when the setting is explicitly false', () => {
        setSetting(false);
        expect(bankUnlocked(MAGE)).toBe(false);
        expect(nearestBank(DEEP_WILDERNESS)?.name).not.toBe('Mage Arena');
    });

    test('opting in makes it selectable, and it wins from inside the Wilderness', () => {
        setSetting(true);
        expect(bankUnlocked(MAGE)).toBe(true);
        expect(nearestBank(DEEP_WILDERNESS)?.name).toBe('Mage Arena');
    });

    test('even opted in, an Ardougne bot still banks in Ardougne', () => {
        setSetting(true);
        const ardy = nearestBank({ x: 2616, z: 3332, level: 0 });
        expect(ardy?.name).toBe('Ardougne West');
    });
});
