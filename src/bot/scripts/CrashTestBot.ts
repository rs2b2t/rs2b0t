import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';

/**
 * Deliberately throws on its third iteration — exists to prove the error
 * firewall (Slice 2 exit criterion): the crash is isolated, logged, the
 * script lands in 'crashed', and the client keeps running.
 */
export default class CrashTestBot extends LoopingBot {
    private iterations = 0;

    async loop(): Promise<void> {
        this.iterations++;
        this.log(`iteration ${this.iterations}`);

        if (this.iterations >= 3) {
            throw new Error('deliberate CrashTestBot explosion');
        }

        await Execution.delay(800);
    }

    override onStop(): void {
        this.log('CrashTestBot onStop ran (cleanup still happens after a crash)');
    }
}
