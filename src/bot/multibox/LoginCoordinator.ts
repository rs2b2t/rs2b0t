// docs/MULTIBOX.md#login-coordination
import type { LoginCoordination } from '../runtime/LoginCoordination.js';

export const LOGIN_BATCH_SIZE = 4;
export const LOGIN_ATTEMPT_SPACING_MS = 1000;
export const LOGIN_BATCH_COOLDOWN_MS = 16000;

export interface LoginCoordinatorOptions {
    now?: () => number;
    batchSize?: number;
    spacingMs?: number;
    cooldownMs?: number;
}

/**
 * Coordinates login handshakes across every iframe in one multibox wall.
 *
 * The production server permits four attempts for one client UID, then rejects
 * the fifth until that UID has been idle for 15 seconds. The cooldown is measured
 * from the latest permit because each attempt refreshes the server-side TTL.
 */
export class LoginCoordinator implements LoginCoordination {
    private readonly now: () => number;
    private readonly batchSize: number;
    private readonly spacingMs: number;
    private readonly cooldownMs: number;
    private permitsInBatch = 0;
    private lastPermitAt: number | null = null;
    private blockedUntil = 0;

    constructor(options: LoginCoordinatorOptions = {}) {
        this.now = options.now ?? (() => performance.now());
        this.batchSize = options.batchSize ?? LOGIN_BATCH_SIZE;
        this.spacingMs = options.spacingMs ?? LOGIN_ATTEMPT_SPACING_MS;
        this.cooldownMs = options.cooldownMs ?? LOGIN_BATCH_COOLDOWN_MS;

        if (!Number.isSafeInteger(this.batchSize) || this.batchSize <= 0) {
            throw new RangeError('login batch size must be a positive safe integer');
        }
        if (!Number.isFinite(this.spacingMs) || this.spacingMs < 0) {
            throw new RangeError('login attempt spacing must be finite and non-negative');
        }
        if (!Number.isFinite(this.cooldownMs) || this.cooldownMs <= 0 || this.cooldownMs < this.spacingMs) {
            throw new RangeError('login batch cooldown must be finite and at least the attempt spacing');
        }
    }

    requestPermit(): boolean {
        const now = this.readNow();
        if (now === null || now < this.blockedUntil) {
            return false;
        }

        if (this.lastPermitAt !== null && now - this.lastPermitAt >= this.cooldownMs) {
            this.permitsInBatch = 0;
            this.lastPermitAt = null;
        }

        if (this.permitsInBatch >= this.batchSize) {
            return false;
        }
        if (this.lastPermitAt !== null && now - this.lastPermitAt < this.spacingMs) {
            return false;
        }

        this.permitsInBatch++;
        this.lastPermitAt = now;
        return true;
    }

    holdFor(delayMs: number): void {
        const now = this.readNow();
        if (now === null || !Number.isFinite(delayMs) || delayMs <= 0) {
            return;
        }
        this.blockedUntil = Math.max(this.blockedUntil, now + delayMs);
        this.permitsInBatch = 0;
        this.lastPermitAt = null;
    }

    private readNow(): number | null {
        try {
            const now = this.now();
            return Number.isFinite(now) ? now : null;
        } catch {
            return null;
        }
    }
}
