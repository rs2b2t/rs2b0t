export type RenderMode = 'focused' | 'background' | 'hidden';

class RenderGateImpl {
    mode: RenderMode = 'focused';
    drawn = 0;
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
