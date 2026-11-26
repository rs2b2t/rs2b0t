import type { LoginCoordination, LoginCoordinationRegistry } from '../src/bot/runtime/LoginCoordination.js';

interface LoginCoordinatorOptions {
    now?: () => number;
    batchSize?: number;
    spacingMs?: number;
    cooldownMs?: number;
}

export class LoginCoordinator implements LoginCoordinationRegistry {
    constructor(options?: LoginCoordinatorOptions);
    register(): LoginCoordination;
    holdFor(delayMs: number): void;
}
