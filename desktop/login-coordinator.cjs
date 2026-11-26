const LOGIN_BATCH_SIZE = 4;
const LOGIN_ATTEMPT_SPACING_MS = 1000;
const LOGIN_BATCH_COOLDOWN_MS = 16000;

class LoginCoordinator {
    constructor(options = {}) {
        this.permitsInBatch = 0;
        this.lastPermitAt = null;
        this.blockedUntil = 0;
        this.queue = [];
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

    register() {
        const request = {};
        return {
            requestPermit: () => this.requestPermit(request),
            queueStatus: () => this.queueStatus(request),
            leaveQueue: () => this.cancel(request),
            holdFor: delayMs => this.holdFor(delayMs)
        };
    }

    requestPermit(request) {
        if (!this.queue.includes(request)) {
            this.queue.push(request);
        }

        const now = this.readNow();
        if (now === null || now < this.blockedUntil || this.queue[0] !== request) {
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

        this.queue.shift();
        this.permitsInBatch++;
        this.lastPermitAt = now;
        return true;
    }

    queueStatus(request) {
        const index = this.queue.indexOf(request);
        if (index < 0) {
            return null;
        }
        return { position: index + 1, total: this.queue.length };
    }

    cancel(request) {
        const index = this.queue.indexOf(request);
        if (index >= 0) {
            this.queue.splice(index, 1);
        }
    }

    holdFor(delayMs) {
        const now = this.readNow();
        if (now === null || !Number.isFinite(delayMs) || delayMs <= 0) {
            return;
        }
        this.blockedUntil = Math.max(this.blockedUntil, now + delayMs);
        this.permitsInBatch = 0;
        this.lastPermitAt = null;
    }

    readNow() {
        try {
            const now = this.now();
            return Number.isFinite(now) ? now : null;
        } catch {
            return null;
        }
    }
}

module.exports = { LoginCoordinator };
