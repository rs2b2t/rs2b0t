export const RATE_LIMIT_FIRST_MS = 20000;
export const RATE_LIMIT_STEP_MS = 45000;

export class LoginBackoff {
    private hits = 0;

    next(): number {
        return RATE_LIMIT_FIRST_MS + RATE_LIMIT_STEP_MS * this.hits++;
    }

    reset(): void {
        this.hits = 0;
    }
}
