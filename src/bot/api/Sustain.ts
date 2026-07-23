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
