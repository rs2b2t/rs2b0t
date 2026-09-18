import { Bank } from '../../bank/Bank.js';
import { nearestBank } from '../../bank/BankLocations.js';
import { Game } from '../../game/Game.js';

export function openClueBank(log?: (message: string) => void): Promise<boolean> {
    const here = Game.tile();
    const bank = here ? nearestBank(here) : null;
    if (bank?.npcAccess) return Bank.openNpcAccess(bank.npcAccess, log);
    if (bank?.access) return Bank.openNearestAccess(bank.access, log);
    return Bank.openNearest('Bank booth', 'Use-quickly', log);
}
