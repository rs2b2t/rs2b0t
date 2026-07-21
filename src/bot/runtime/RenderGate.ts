/**
 * Per-instance draw throttle (MultiBox). Gates ONLY the pixel draw
 * (mainredraw); mainloop/onFrame (logic, events, scheduler) are never gated —
 * a backgrounded bot keeps acting at full logic rate, just drawn at ~3 fps.
 */
export type RenderMode = 'focused' | 'background' | 'hidden';

class RenderGateImpl {
    // Default 'focused' so a standalone bot.html renders at full rate; the
    // MultiBox manager downgrades each embedded iframe to background/hidden.
    // (A 'background' default would silently throttle every standalone client
    // to ~3 fps and fail the existing tools/desktop-test.ts.)
    mode: RenderMode = 'focused';
    /** Monotonic count of frames actually drawn — the render-rate probe. */
    drawn = 0;
    /** Minimum gap between background draws, ms (~3 fps default). */
    backgroundIntervalMs = 300;

    private lastDrawAt = 0;

    shouldDraw(now: number): boolean {
        if (this.mode === 'focused') return true;
        if (this.mode === 'hidden') return false;
        return now - this.lastDrawAt >= this.backgroundIntervalMs;
    }

    markDrawn(now: number): void {
        this.drawn++;
        this.lastDrawAt = now;
    }

    setMode(mode: RenderMode): void {
        this.mode = mode;
    }
}

export const RenderGate = new RenderGateImpl();
