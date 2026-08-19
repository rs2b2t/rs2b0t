import { Game } from '../../../../game/Game.js';
import { ArravConfig, resolveGang, type ArravGang } from '../shieldofarrav/config.js';

export type HeroGang = ArravGang;

/** Host-set at script start, read at decide time. */
export const HeroConfig: { partner: string } = { partner: '' };

let cached: HeroGang | null = null;
let cachedFor = '';

// Why: Grip refuses a Black Arm attacker and Katrine a Phoenix candlestick, so the gang here is the one
// the character joined for Shield of Arrav rather than a second roll.

// Why: the name lands a few ticks after login, so re-resolving every tick would flip the gang mid-run.
export function heroGang(): HeroGang {
    const name = Game.myName() ?? '';
    const fingerprint = `${ArravConfig.gang}|${name}`;
    if (cached === null || (cachedFor !== fingerprint && name.length > 0)) {
        cached = resolveGang(ArravConfig.gang, name.length > 0 ? name : null);
        cachedFor = fingerprint;
    }
    return cached;
}

/** Test seam: the gang is memoised for the process, and a test that changes the setting has to clear it. */
export function resetHeroGangCache(): void {
    cached = null;
    cachedFor = '';
}

export function partnerConfigured(): boolean {
    return HeroConfig.partner.trim().length > 0;
}
