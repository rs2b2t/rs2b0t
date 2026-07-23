import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { AbstractBot, Task } from '../Bot.js';
import { Execution } from '../Execution.js';
import { Game } from '../Game.js';
import { AcquireTask, hasAll, type ItemNeed } from '../ItemAcquisition.js';
import { Traversal } from '../Traversal.js';

const DEATH_RE = /oh dear.*you are dead/i;

export interface DeathRecoveryOptions {
    anchor: WorldTile;
    radius?: number;
    needs?: ItemNeed[];
    onDeath?: () => void;
    onRecovered?: () => void;
    walkBack?: () => Promise<boolean>;
}

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
