import DirectInputDriver from './DirectInputDriver.js';
import type { InputDriver } from './InputDriver.js';

/**
 * Single entry point for everything that emits input. rs2b0t is direct-only:
 * one driver, byte-identical OP packets via the client's own doAction/tryMove,
 * no mouse/click telemetry (spec §5.3, ADR-0003).
 */
class ActionRouterImpl {
    private readonly directDriver = new DirectInputDriver();

    get driver(): InputDriver {
        return this.directDriver;
    }

    /** ScriptRunner.start lifecycle hook. Direct input keeps no per-run state. */
    beginRun(_log: (level: 'info' | 'warn', msg: string) => void): void {}

    /** ScriptRunner teardown hook. Nothing to cancel in direct mode. */
    endRun(): void {}
}

export const ActionRouter = new ActionRouterImpl();
