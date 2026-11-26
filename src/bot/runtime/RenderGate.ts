export type RenderMode = 'focused' | 'background' | 'hidden';

export class RenderGateController {
    mode: RenderMode = 'focused';
    drawn = 0;
    backgroundIntervalMs = 300;

    private rendererEnabled = true;
    private lastDrawAt = 0;

    get enabled(): boolean {
        return this.rendererEnabled;
    }

    shouldDraw(now: number, lastDrawAt = this.lastDrawAt): boolean {
        if (!this.rendererEnabled || this.mode === 'hidden') {
            return false;
        }
        if (this.mode === 'focused') {
            return true;
        }
        return now - lastDrawAt >= this.backgroundIntervalMs;
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
    }
}

export const RenderGate = new RenderGateController();
