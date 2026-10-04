import type { WorldTile } from '../../../adapter/ClientAdapter.js';
import { SettingsStore } from '../../../runtime/Settings.js';
import { Game } from '../../game/Game.js';
import { Execution } from '../../execution/Execution.js';
import { EventSignal } from '../../execution/EventSignal.js';
import { Traversal } from '../../walking/Traversal.js';
import { Duel, fightArenaAt } from '../../duel/Duel.js';
import { CLUE_DUEL_LOBBY, ClueDuelHandshake, ClueDuelSearch, clueDuelName, leaveClueDuel } from '../../duel/ClueDuel.js';
import { reader } from '../../../adapter/ClientAdapter.js';

export const DUEL_CLUE_ID = 3554;
export const DUEL_CLUE_TILE = { x: 3374, z: 3250, level: 0 };

const triedPartners = new Map<string, number>();

export function resetClueDuelSearch(): void { triedPartners.clear(); }

export function crossesClueDuel(dest: WorldTile): boolean {
    return (dest.level === 0 && dest.x === DUEL_CLUE_TILE.x && dest.z === DUEL_CLUE_TILE.z) || fightArenaAt(Game.tile()) !== null;
}

export async function walkAcrossClueDuel(dest: WorldTile, radius: number, log: (message: string) => void): Promise<boolean> {
    const target = fightArenaAt(dest);
    if (fightArenaAt(Game.tile()) !== target && fightArenaAt(Game.tile()) && !(await leaveClueDuel(log))) return false;
    if (target && !fightArenaAt(Game.tile())) {
        const configured = SettingsStore.globalBag().str('clueDuelPartner', '').trim();
        const partner = clueDuelName(configured) === clueDuelName(reader.localPlayerName()) ? '' : configured;
        for (let attempt = 0; attempt < 2; attempt++) {
            if (!(await Traversal.walkResilient(CLUE_DUEL_LOBBY, { radius: 3, attempts: 3, timeoutMs: 60_000, log }))) return false;
            const handshake = partner ? new ClueDuelHandshake(partner, true, log) : new ClueDuelSearch(log, triedPartners);
            const deadline = Date.now() + 120_000;
            log(partner ? `waiting for clue helper ${partner}` : 'looking for a lobby player for an unstaked obstacle duel');
            while (!fightArenaAt(Game.tile()) && Date.now() < deadline) {
                if (EventSignal.pending()) {
                    if (Duel.active()) await Duel.cancel();
                    return false;
                }
                if (await handshake.tick() === false) return false;
                await Execution.delayTicks(1);
            }
            if (fightArenaAt(Game.tile()) === target) break;
            if (Duel.active()) await Duel.cancel();
            if (!fightArenaAt(Game.tile())) {
                log('no clue duel completed yet; keeping the clue and waiting in the lobby');
                return false;
            }
            log('assigned a different obstacle arena, retrying');
            if (!(await leaveClueDuel(log))) return false;
        }
        if (fightArenaAt(Game.tile()) !== target) return false;
    }
    return Traversal.walkResilient(dest, { radius, attempts: 3, timeoutMs: 45_000, log });
}
