import { count, type KqItem, type KqTile } from './kqEvidence.js';

export interface GateDelaySample { at: number; tick: number; sceneReady: boolean; serverTile: KqTile | null; pack: KqItem[]; runner: string; stage?: string; restocking: boolean; gateDelayHeld: boolean }
interface GateAttempt { departedAt: number; crossings: { surface: number[]; chamber: number[] } }

export class KqGateDelay {
    proof: { player: number; holdTicks: number; departedAt?: number; startedAt?: number; startTick?: number; releasedAt?: number; releaseTick?: number; completedAt?: number } = { player: 3, holdTicks: 225 };

    observe(samples: GateDelaySample[], attempts: GateAttempt[]): boolean {
        if (this.proof.completedAt) return false;
        const now = Math.max(...samples.map(s => s.at));
        const attempt = attempts.at(-1);
        if (this.proof.startedAt && attempt?.departedAt !== this.proof.departedAt) throw new Error('Gate-delay original departure aborted');
        if (this.proof.releasedAt) {
            if (samples.some(s => s.sceneReady && (s.stage === 'retreat' || s.stage === 'bank' || s.restocking))) throw new Error('Gate-delay original departure aborted');
            const crossings = [attempt!.crossings.surface, attempt!.crossings.chamber];
            if (crossings.every(c => [0, 1, 2, 3].every(i => Number.isFinite(c[i])))) {
                if (crossings.some(c => Math.min(...c) < this.proof.releasedAt! || Math.max(...c) - Math.min(...c) > 3000)) throw new Error('Gate-delay descent was not synchronized after release');
                this.proof.completedAt = now;
            }
            return false;
        }
        const near = (s: GateDelaySample, x: number, z: number) => s.sceneReady && s.serverTile?.level === 0 && Math.abs(s.serverTile.x - x) <= 4 && Math.abs(s.serverTile.z - z) <= 4;
        const positioned = samples.length === 4 && samples.every(s => s.runner === 'running') && samples.slice(0, 3).every(s => near(s, 3226, 3108)) && samples[3].gateDelayHeld && samples[3].stage === 'travel' && near(samples[3], 3308, 3120);
        if (!this.proof.startedAt) {
            if (!positioned) return false;
            if (!attempt) throw new Error('Gate-delay fixture lacks a verified bank departure');
            this.proof.departedAt = attempt.departedAt;
            this.proof.startedAt = now;
            this.proof.startTick = samples[0].tick;
        }
        if (!positioned) throw new Error('Gate-delay fixture lost its waiting positions');
        if (count(samples[0].pack, 954) !== 2) throw new Error('Gate-delay leader consumed a rope while South was held');
        if (now - this.proof.startedAt > 160_000) throw new Error('Gate-delay fixture exceeded 160 seconds');
        if (samples[0].tick - this.proof.startTick! < this.proof.holdTicks) return false;
        this.proof.releasedAt = now;
        this.proof.releaseTick = samples[0].tick;
        return true;
    }
}
