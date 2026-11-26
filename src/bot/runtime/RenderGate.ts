export type RenderMode = 'focused' | 'background' | 'hidden';

export class RenderGateController {
    private currentMode: RenderMode = 'focused';
    drawn = 0;
    private backgroundInterval = 300;
    private readonly listeners = new Set<() => void>();

    private rendererEnabled = true;
    private lastDrawAt = 0;

    get enabled(): boolean {
        return this.rendererEnabled;
    }

    get mode(): RenderMode {
        return this.currentMode;
    }

    set mode(mode: RenderMode) {
        if (mode === this.currentMode) return;
        this.currentMode = mode;
        this.notify();
    }

    get backgroundIntervalMs(): number {
        return this.backgroundInterval;
    }

    set backgroundIntervalMs(ms: number) {
        if (ms === this.backgroundInterval) return;
        this.backgroundInterval = ms;
        this.notify();
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }

    delayUntilDraw(now: number, lastDrawAt: number): number {
        if (!this.rendererEnabled || this.mode === 'hidden') {
            return Infinity;
        }
        if (this.mode === 'focused') {
            return 0;
        }
        const elapsed = now - lastDrawAt;
        return elapsed >= this.backgroundIntervalMs ? 0 : this.backgroundIntervalMs - elapsed;
    }

    shouldDraw(now: number, lastDrawAt = this.lastDrawAt): boolean {
        return this.delayUntilDraw(now, lastDrawAt) === 0;
    }

    markDrawn(now: number): void {
        this.drawn++;
        this.lastDrawAt = now;
    }

    setMode(mode: RenderMode): void {
        this.mode = mode;
    }

    setEnabled(enabled: boolean): void {
        if (enabled === this.rendererEnabled) {
            return;
        }
        this.rendererEnabled = enabled;
        if (enabled) {
            this.lastDrawAt = Number.NEGATIVE_INFINITY;
        }
        this.notify();
    }
}

export const RenderGate = new RenderGateController();
