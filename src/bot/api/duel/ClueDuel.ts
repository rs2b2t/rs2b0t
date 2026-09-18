import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../execution/Execution.js';
import { Game } from '../game/Game.js';
import { Players } from '../players/Players.js';
import { Locs } from '../locs/Locs.js';
import { ChatDialog } from '../ui/dialogue/ChatDialog.js';
import { Traversal } from '../walking/Traversal.js';
import { Duel, fightArenaAt } from './Duel.js';

export const CLUE_DUEL_LOBBY = { x: 3368, z: 3274, level: 0 };
export const CLUE_DUEL_OPTIONS = 1024;
export const clueDuelName = (name: string | null): string => (name ?? '').replace(/_/g, ' ').trim().toLowerCase();

export async function leaveClueDuel(log: (message: string) => void): Promise<boolean> {
    if (!fightArenaAt(Game.tile())) return true;
    log('forfeiting the clue duel');
    const exit = Locs.query().action('Forfeit').nearest();
    if (!exit || !(await exit.interact('Forfeit'))) return false;
    if (!(await Execution.delayUntil(() => ChatDialog.options().some(option => option.trim() === 'Yes'), 6000))) return false;
    await ChatDialog.chooseOption('Yes');
    return Execution.delayUntil(() => fightArenaAt(Game.tile()) === null, 10_000);
}

export class ClueDuelHandshake {
    private openedAt = 0;
    private challengedAt = -Infinity;
    private optionSentAt = -Infinity;

    constructor(readonly partner: string, private readonly initiator: boolean, private readonly log: (message: string) => void) {}

    async tick(): Promise<boolean> {
        if (!Duel.active()) {
            this.openedAt = 0;
            if (Date.now() - this.challengedAt < 5000) return true;
            const other = Players.query().where(player => clueDuelName(player.name) === clueDuelName(this.partner) && !player.inCombat && fightArenaAt(player.tile()) === null).nearest();
            if (!other) return true;
            this.challengedAt = Date.now();
            await Duel.challenge(other);
            return true;
        }
        if (!this.openedAt) this.openedAt = Date.now();
        const offers = reader.duelOffers();
        if (clueDuelName(Duel.partner()) !== clueDuelName(this.partner) || offers.mine.length || offers.theirs.length
            || Date.now() - this.openedAt >= 30_000) {
            this.log('rejecting a mismatched, staked or stalled clue duel');
            await Duel.cancel();
            return false;
        }
        if (!offers.ready) return true;
        const options = reader.varp(286);
        if (Duel.offerOpen() && options === 0) {
            if (this.initiator && Date.now() - this.optionSentAt >= 5000) {
                this.optionSentAt = Date.now();
                actions.ifButton(6732);
            }
            return true;
        }
        if (options !== CLUE_DUEL_OPTIONS) {
            this.log('rejecting unsafe clue duel rules');
            await Duel.cancel();
            return false;
        }
        if (!Duel.waitingForOther()) Duel.accept();
        return true;
    }
}

export class ClueDuelHelper {
    private readonly handshake: ClueDuelHandshake;
    private enteredAt = 0;

    constructor(partner: string, private readonly log: (message: string) => void) {
        this.handshake = new ClueDuelHandshake(partner, false, log);
    }

    validate(): boolean { return true; }

    async execute(): Promise<void> {
        if (fightArenaAt(Game.tile())) {
            if (!this.enteredAt) this.enteredAt = Date.now();
            if (Date.now() - this.enteredAt >= 180_000) await leaveClueDuel(this.log);
            return;
        }
        this.enteredAt = 0;
        if (Duel.winOpen()) {
            await Duel.closeWin();
            return;
        }
        if (Duel.active()) {
            await this.handshake.tick();
            return;
        }
        const here = Game.tile();
        if (!here || Math.max(Math.abs(here.x - CLUE_DUEL_LOBBY.x), Math.abs(here.z - CLUE_DUEL_LOBBY.z)) > 4) {
            await Traversal.walkResilient(CLUE_DUEL_LOBBY, { radius: 3, attempts: 3, timeoutMs: 60_000, log: this.log });
            return;
        }
        await this.handshake.tick();
    }
}
