import DirectInputDriver from './DirectInputDriver.js';
import type { InputDriver } from './InputDriver.js';
import SyntheticInputDriver from './SyntheticInputDriver.js';
import { VirtualInput } from './VirtualInput.js';

export type InputMode = 'direct' | 'synthetic';

/**
 * Single entry point for everything that emits input. Slice 6: two drivers,
 * mode applied per script run (AbstractBot.inputMode, default 'direct' so
 * existing soaks are untouched) with an optional global force from the page
 * (`bot.html?inputmode=synthetic`, set by main.ts — the additive hook the
 * synthetic e2e uses). No silent fallback between modes — dataset labels
 * stay clean (PLAN.md §humanization, ADR-0003).
 */
class ActionRouterImpl {
    private readonly direct = new DirectInputDriver();
    private readonly synthetic = new SyntheticInputDriver();

    private mode: InputMode = 'direct';
    /** Page-level override (query param); wins over the script's choice. */
    private forced: InputMode | null = null;

    get activeMode(): InputMode {
        return this.forced ?? this.mode;
    }

    get driver(): InputDriver {
        return this.activeMode === 'synthetic' ? this.synthetic : this.direct;
    }

    /** main.ts only (?inputmode=...). */
    force(mode: InputMode): void {
        this.forced = mode;
    }

    /** ScriptRunner.start: apply the script's mode and wire failure logs. */
    beginRun(mode: InputMode, log: (level: 'info' | 'warn', msg: string) => void): void {
        this.mode = mode;
        this.synthetic.reset();
        this.synthetic.logSink = log;
        VirtualInput.setFidgets(this.activeMode === 'synthetic');
    }

    /** ScriptRunner teardown: cancel in-flight gestures, back to default. */
    endRun(): void {
        this.synthetic.cancel();
        this.synthetic.logSink = null;
        this.mode = 'direct';
        VirtualInput.setFidgets(false);
    }
}

export const ActionRouter = new ActionRouterImpl();
