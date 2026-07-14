import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { AbstractBot, Task } from '../Bot.js';
import { Execution } from '../Execution.js';
import { Game } from '../Game.js';
import { AcquireTask, hasAll, type ItemNeed } from '../ItemAcquisition.js';
import { Traversal } from '../Traversal.js';

const DEATH_RE = /oh dear.*you are dead/i;

export interface DeathRecoveryOptions {
    /** Tile to return to once the respawn settles. */
    anchor: WorldTile;
    /** Chebyshev radius counted as "back home" (default 6). */
    radius?: number;
    /** Items to re-acquire before walking back (e.g. lost consumables). Omit if the script has none. */
    needs?: ItemNeed[];
    /** Fires once per death, right when the chat line is matched — e.g. to bump a script's own death counter/status line. */
    onDeath?: () => void;
    /** Fires once recovery completes (back at anchor, needs re-acquired) — e.g. to clear a script's own `died` flag that other tasks (mid-fight abort checks) read. */
    onRecovered?: () => void;
    /**
     * Overrides the default `Traversal.walkResilient(anchor)` leg. Use when
     * the anchor sits behind a transport the web-walker can't cross on its
     * own (a scripted ladder/trapdoor climb, like ChaosDruidKiller's dungeon)
     * — supply the script's own climb-then-walk sequence instead.
     */
    walkBack?: () => Promise<boolean>;
}

/**
 * Generalized death & stuck recovery: lifts the copy-pasted
 * per-script death task (ChaosDruidKiller/RockCrab/ChickenKiller all had
 * their own identical-shaped one) into shared machinery every quest module
 * installs.
 *
 * Install FIRST among the script's own tasks. Arms on the death chat
 * message ("Oh dear, you are dead!" — matched loosely so upstream
 * punctuation drift can't silently break recovery, same regex every prior
 * script already used); stays valid from that point until the bot is back at
 * `anchor` with `needs` (if any) re-acquired.
 */
export class DeathRecovery implements Task {
    private died = false;
    private readonly reacquire: AcquireTask | null;

    constructor(
        private bot: AbstractBot,
        private opts: DeathRecoveryOptions
    ) {
        this.reacquire = opts.needs?.length ? new AcquireTask(bot, opts.needs) : null;
        bot.on('chat.message', e => {
            if (DEATH_RE.test(e.text)) {
                this.died = true;
                this.opts.onDeath?.();
            }
        });
    }

    validate(): boolean {
        if (!this.died) {
            return false;
        }

        const home = Game.tile();
        const done = !!home && near(home, this.opts.anchor, this.opts.radius ?? 6) && (!this.opts.needs || hasAll(this.opts.needs));
        if (done) {
            this.died = false;
            this.opts.onRecovered?.();
        }
        return this.died;
    }

    async execute(): Promise<void> {
        // same respawn-wait condition every prior per-script death task used:
        // wait for the respawn scene to load, then let it settle a few ticks.
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 20000);
        await Execution.delayTicks(3);

        if (this.reacquire && this.reacquire.validate()) {
            await this.reacquire.execute();
            return;
        }

        if (this.opts.walkBack) {
            await this.opts.walkBack();
        } else {
            await Traversal.walkResilient(this.opts.anchor, {
                radius: this.opts.radius ?? 6,
                log: msg => this.bot.log(`  ${msg}`)
            });
        }
    }
}

function near(a: WorldTile, b: WorldTile, r: number): boolean {
    return a.level === b.level && Math.abs(a.x - b.x) <= r && Math.abs(a.z - b.z) <= r;
}
