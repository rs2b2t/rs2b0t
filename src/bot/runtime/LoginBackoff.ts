export const RATE_LIMIT_FIRST_MS = 20000;
export const RATE_LIMIT_STEP_MS = 45000;

/**
 * Hold-off policy for "Login attempts exceeded." (login response 16). The
 * server's per-IP counters are SLIDING windows — every attempt (even a
 * rejected one) refreshes their TTL, so retrying on the normal cadence keeps
 * the IP locked forever. Wait 20s on the first hit, then 45s longer on each
 * consecutive hit (20s, 65s, 110s, ...) until a login gets through.
 */
export class LoginBackoff {
    private hits = 0;

    /** Delay (ms) to hold off before the next attempt. */
    next(): number {
        return RATE_LIMIT_FIRST_MS + RATE_LIMIT_STEP_MS * this.hits++;
    }

    reset(): void {
        this.hits = 0;
    }
}
