import { USE_MAGE_BANK } from '#/bot/api/bank/BankLocations.js';

const MAGE_KEY = `rs2b0t:set:Global:${USE_MAGE_BANK}`;

export function setMageBankSetting(on: boolean | null): void {
    if (on === null) {
        localStorage.removeItem(MAGE_KEY);
        sessionStorage.removeItem(MAGE_KEY);
        return;
    }
    localStorage.setItem(MAGE_KEY, String(on));
}
