import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { cfg } from './config.js';
import { atField, eatOnce, huntGiants, hpFrac, inHunt, needEat, needEatForLoot, shouldEatNow } from './shared.js';
import { quickReturnToField } from './walkback.js';
import { Phase, getPhase } from './phase.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

/** The kill loop: attack giants and survive. No looting — that's the LOOT phase. */
export class Fight implements Task {
    private targetIdx: number | null = null;
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        const here = Game.tile();
        return (
            getPhase() === Phase.Fight &&
            hpFrac() >= cfg.panicHp &&
            here !== null &&
            inHunt(new Tile(here.x, here.z, here.level)) &&
            (huntGiants().length > 0 || !atField())
        );
    }
    async execute(): Promise<void> {
        this.bot.setStatus('fighting moss giants');
        const deadline = performance.now() + 120_000;
        while (performance.now() < deadline) {
            if (EventSignal.pending() || this.bot.died || ChatDialog.canContinue()) {
                return;
            }
            if (shouldEatNow()) {
                await eatOnce(this.bot, needEatForLoot() && !needEat());
                continue;
            }
            if (hpFrac() < cfg.panicHp) {
                return;
            }

            const giants = huntGiants();
            if (this.targetIdx !== null && !giants.some(g => g.index === this.targetIdx)) {
                this.bot.countKill();
                this.bot.log(`moss giant down — ${this.bot.kills()} kills`);
                this.targetIdx = null;
                // Hand off to the looting phase to clear the drops before the next kill.
                return;
            }

            if (giants.length === 0) {
                // No giants in the hunt area — return to the field and wait there.
                if (!atField()) {
                    if (!(await quickReturnToField(this.bot))) {
                        return;
                    }
                    continue;
                }
                this.bot.setStatus('waiting for moss giants');
                await Execution.delayTicks(4);
                return;
            }

            const target = giants.sort((a, b) => a.distance() - b.distance())[0];
            if (target.distance() > 8) {
                // Out of attack range — walk into range, then re-evaluate.
                await Traversal.walkResilient(target.tile(), {
                    radius: 1,
                    attempts: 4,
                    timeoutMs: 30_000,
                    log: m => this.bot.log(`  ${m}`)
                });
                continue;
            }

            if (Game.inCombat()) {
                await Execution.delayTicks(2);
                continue;
            }

            await target.interact('Attack');
            this.targetIdx = target.index;
            await Execution.delayUntil(() => Game.inCombat() || giants.length === 0 || !inHunt(new Tile(Game.tile()!.x, Game.tile()!.z, Game.tile()!.level)), 3000);
        }
    }
}
