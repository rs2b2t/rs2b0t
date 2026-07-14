/**
 * Global sustain hook — a bot-registered callback (typically "eat when HP is
 * low") awaited at the long-running loops a bot's own task loop can't reach:
 * every walker follow iteration, every resilient-walk ladder pass, and every
 * clue-solve step. Without this, a multi-minute walk or clue trail past
 * aggressive spawns runs with food in the pack and nothing eating it.
 *
 * Register in onStart, clear in onStop (the runner does not clear it for
 * you). Re-entrancy is guarded: a hook that itself walks or waits can't
 * recurse into another sustain call.
 */
export const Sustain = {
    hook: null as (() => Promise<void>) | null,
    running: false,

    set(hook: (() => Promise<void>) | null): void {
        this.hook = hook;
    },

    async run(): Promise<void> {
        if (!this.hook || this.running) {
            return;
        }
        this.running = true;
        try {
            await this.hook();
        } finally {
            this.running = false;
        }
    }
};
