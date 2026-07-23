import DirectInputDriver from './DirectInputDriver.js';
import type { InputDriver } from './InputDriver.js';

class ActionRouterImpl {
    private readonly directDriver = new DirectInputDriver();

    get driver(): InputDriver {
        return this.directDriver;
    }

    beginRun(_log: (level: 'info' | 'warn', msg: string) => void): void {}

    endRun(): void {}
}

export const ActionRouter = new ActionRouterImpl();
