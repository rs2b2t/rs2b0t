import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { AbstractBot, Task } from '../bot/Bot.js';
import { Execution } from '../execution/Execution.js';
import { Game, waitForPlayerTile } from '../game/Game.js';
import { AcquireTask, hasAll, type ItemNeed } from '../acquisition/ItemAcquisition.js';
import { Traversal } from '../walking/Traversal.js';

const DEATH_RE = /oh dear.*you are dead/i;

interface DeathRecoveryOptions {
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
        await waitForPlayerTile(20000);
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
