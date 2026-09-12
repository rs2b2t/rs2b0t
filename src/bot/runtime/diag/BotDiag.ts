// docs/decisions/multibox-telemetry-honesty.md
// Per-frame diagnostics for one bot, drained by the wall on each sample tick.

import { boxId } from '../box.js';
import { PhaseTimer } from './PhaseTimer.js';
import type { Phase, SlowSpan } from './PhaseTimer.js';

export interface FrameSample {
    box: string;
    ingame: boolean;
    /** Main-thread ms spent in each phase since the last drain. */
    logicMs: number;
    drawMs: number;
    /** Slowest single occurrence, which a mean would hide. */
    logicMaxMs: number;
    drawMaxMs: number;
    logicCount: number;
    drawCount: number;
    /** Long phases with wall-clock windows, so the wall can attribute a stall. */
    slowSpans: SlowSpan[];
}

/** Reads live client state without importing Client, which would be a cycle. */
interface DiagClientView {
    ingame: boolean;
}

class BotDiagnostics {
    readonly timer: PhaseTimer;
    private view: DiagClientView | null = null;

    constructor(private readonly box: string) {
        this.timer = new PhaseTimer(box);
    }

    attach(view: DiagClientView): void {
        this.view = view;
    }

    measure<T>(phase: Phase, body: () => T): T {
        return this.timer.measure(phase, body);
    }

    drain(): FrameSample {
        if (!this.view) {
            throw new Error(`[rs2b0t] diagnostics drained on ${this.box} before a client attached`);
        }
        const totals = this.timer.drain();
        return {
            box: this.box,
            ingame: this.view.ingame,
            logicMs: totals.ms.logic,
            drawMs: totals.ms.draw,
            logicMaxMs: totals.maxMs.logic,
            drawMaxMs: totals.maxMs.draw,
            logicCount: totals.count.logic,
            drawCount: totals.count.draw,
            slowSpans: totals.slowSpans
        };
    }
}

export const BotDiag = new BotDiagnostics(boxId());
