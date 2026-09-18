import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { bankUnlocked, BANK_LOCATIONS, nearestBank } from '#/bot/api/bank/BankLocations.js';
import { cookLocation } from '#/bot/api/cooking/CookLocations.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';

const key = 'rs2b0t:set:Global:useZanarisBank';

afterEach(() => { mock.restore(); localStorage.removeItem(key); sessionStorage.removeItem(key); });

test('Zanaris requires both Lost City and the explicit bank opt-in', () => {
    const bank = BANK_LOCATIONS.find(bank => bank.name === 'Zanaris');
    expect(bank).toBeDefined();
    if (!bank) return;
    spyOn(Quests, 'status').mockReturnValue('complete');
    expect(bankUnlocked(bank)).toBe(false);
    expect(nearestBank({ x: 3153, z: 9576, level: 0 })?.name).not.toBe('Zanaris');
    localStorage.setItem(key, 'true');
    expect(bankUnlocked(bank)).toBe(true);
    spyOn(Quests, 'status').mockReturnValue('notStarted');
    expect(bankUnlocked(bank)).toBe(false);
});

test('Zanaris cooking derives the nearby range and direct NPC banking', () => {
    const location = cookLocation('Zanaris');
    expect(location).not.toBeNull();
    expect(location?.bank.npcAccess).toEqual({ name: 'Banker', op: 'Bank' });
    expect(location?.surface?.loc.x).toBe(3151);
    expect(location?.surface?.loc.z).toBe(9558);
});
