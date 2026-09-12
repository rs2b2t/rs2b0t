// docs/decisions/multibox-telemetry-honesty.md
// Why: kept out of main.ts so the sampler can be tested without a DOM.

import { FreezeWatch } from '../runtime/diag/FreezeWatch.js';
import { InputLatency, browserObserverFactory } from '../runtime/diag/InputLatency.js';
import type { FrameSample } from '../runtime/diag/BotDiag.js';
import { installWorkerClockHub } from '../runtime/WorkerClock.js';
import { DiagSampler } from './DiagSampler.js';

/** The subset of a bot frame this needs; the wall owns the iframes. */
interface DiagFrame {
    contentWindow: (Window & { rs2b0t?: { diag?: () => FrameSample } }) | null;
}

export interface Diagnostics {
    sampler: DiagSampler;
    dump(): Record<string, unknown>;
    compare(agoMs: number): unknown;
    download(): void;
}

/** Missing diagnostics are valid before boot; drain failures still propagate. */
function collectFrames(frames: () => Iterable<DiagFrame>): () => FrameSample[] {
    return () => {
        const out: FrameSample[] = [];
        for (const frame of frames()) {
            const api = frame.contentWindow?.rs2b0t;
            if (!api?.diag) {
                continue;
            }
            out.push(api.diag());
        }
        return out;
    };
}

export function installDiagnostics(window: Window & typeof globalThis, frames: () => Iterable<DiagFrame>): Diagnostics {
    const input = new InputLatency(browserObserverFactory(window));
    input.start();

    const clock = installWorkerClockHub(window);
    const freeze = new FreezeWatch({ sleep: ms => clock.sleep(ms) });
    void freeze.run();

    const sampler = new DiagSampler({ collect: collectFrames(frames), freeze, input });
    sampler.start();

    const dump = (): Record<string, unknown> => ({
        ...sampler.snapshot(),
        worstInputEvent: input.worstEvent
    });

    return {
        sampler,
        dump,
        compare: (agoMs: number) => sampler.compare(agoMs),
        download: (): void => {
            const blob = new Blob([JSON.stringify(dump())], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = window.document.createElement('a');
            a.href = url;
            a.download = `rs2b0t-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };
}
