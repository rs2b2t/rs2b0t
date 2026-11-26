const RETRY_MS = 500;
const MAX_RETRIES = 12;

export class ItemIconRetry {
    private attempts = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly fillIcons: () => number) {}

    fill(): void {
        if (this.fillIcons() > 0) {
            this.schedule();
        }
    }

    private schedule(): void {
        this.cancel();
        if (this.attempts >= MAX_RETRIES) {
            return;
        }
        this.timer = setTimeout(() => {
            this.attempts++;
            this.fill();
        }, RETRY_MS);
    }

    cancel(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    resetAttempts(): void {
        this.attempts = 0;
    }
}
