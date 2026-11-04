export type PotionFamily = 'prayer' | 'attack' | 'strength' | 'defence' | 'antifire' | 'superantipoison';
export interface Hazard {
    phase: 'travel' | 'hunt' | 'guardian' | 'reward' | 'bank';
    dragonfire: boolean;
    antipoison: boolean;
}
export interface SurvivalState {
    ready: boolean;
    inCombat?: boolean;
    hp: number;
    maxHp: number;
    prayer: number;
    maxPrayer: number;
    sharks: number;
    prayerDoses: number;
    shield: boolean;
    poisoned: boolean;
    tick: number;
    boosts: Record<'attack' | 'strength' | 'defence', number>;
}
export interface SurvivalPort {
    state(): SurvivalState;
    eat(): Promise<boolean>;
    drink(family: PotionFamily): Promise<boolean>;
    prayerActive(name: string): boolean;
    setPrayer(name: string): Promise<boolean>;
}
export interface SurvivalSettings {
    offensivePrayers: boolean;
    boostThreshold: number;
    eatHp: number;
    retreatHp: number;
}
export class SurvivalFailure extends Error {}

export function safetyThresholds(maxHp: number, eat: number, retreat: number): { eat: number; retreat: number } {
    return { eat: Math.min(maxHp, Math.max(eat, Math.ceil(maxHp * 65 / 90))), retreat: Math.min(maxHp, Math.max(retreat, Math.ceil(maxHp / 2))) };
}

export class Survival {
    private antifireUntil = 0;
    private antipoisonUntil = 0;
    private busy = false;
    private hazardous = false;
    retreating = false;

    constructor(private readonly port: SurvivalPort, private readonly settings: SurvivalSettings) {}

    reset(): void {
        this.antifireUntil = 0;
        this.antipoisonUntil = 0;
    }

    canStartFight(): boolean {
        const state = this.port.state();
        return state.ready && state.hp >= safetyThresholds(state.maxHp, this.settings.eatHp, this.settings.retreatHp).eat
            && state.sharks > 3 && state.prayerDoses >= 2 && state.prayer > Math.max(10, state.maxPrayer * 0.2);
    }

    async run(hazard: Hazard): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        try { await this.maintain(hazard); }
        finally { this.busy = false; }
    }

    private async maintain(hazard: Hazard): Promise<void> {
        let state = this.port.state();
        if (!state.ready) return;
        this.hazardous = hazard.phase === 'hunt' || hazard.phase === 'guardian' || hazard.dragonfire || state.inCombat === true;
        await this.health();
        state = this.port.state();
        if (hazard.phase === 'bank') return;
        if (state.poisoned || (hazard.antipoison && state.tick >= this.antipoisonUntil - 30)) {
            if (await this.drink('superantipoison')) this.antipoisonUntil = this.port.state().tick + 570;
        }
        if (hazard.dragonfire) {
            if (!state.shield && !this.retreating) throw new SurvivalFailure('Dragonfire shield is not equipped');
            if (state.tick >= this.antifireUntil - 20) {
                if (await this.drink('antifire')) this.antifireUntil = this.port.state().tick + 600;
            }
        }
        const fighting = hazard.phase === 'hunt' || hazard.phase === 'guardian';
        if (fighting || hazard.dragonfire) {
            if (state.prayer <= Math.max(10, Math.ceil(state.maxPrayer * 0.25))) {
                await this.drink('prayer');
                state = this.port.state();
                if (state.prayer <= 10 && !this.retreating) throw new SurvivalFailure('Prayer restoration was not confirmed');
            }
            const prayer = hazard.phase === 'guardian' ? 'Protect from Magic' : 'Protect from Melee';
            if ((!(await this.port.setPrayer(prayer)) || !this.port.prayerActive(prayer)) && !this.retreating) throw new SurvivalFailure(`${prayer} is not active`);
            await this.health();
        }
        if (fighting && !this.retreating && this.settings.offensivePrayers) {
            if (state.maxPrayer >= 34) await this.port.setPrayer('Incredible Reflexes');
            await this.health();
            if (state.maxPrayer >= 31) await this.port.setPrayer('Ultimate Strength');
            await this.health();
        }
        if (fighting && !this.retreating) {
            const families = hazard.phase === 'guardian' ? ['attack', 'strength', 'defence'] as const : ['attack', 'strength'] as const;
            for (const family of families) {
                const boost = this.port.state().boosts[family];
                if (boost >= 0 && boost <= this.settings.boostThreshold) {
                    await this.port.drink(family);
                    await this.health();
                }
            }
        }
    }

    private async drink(family: PotionFamily): Promise<boolean> {
        const consumed = await this.port.drink(family);
        if (!consumed && !this.retreating) throw new SurvivalFailure(`${family} dose consumption was not confirmed`);
        await this.health();
        return consumed;
    }

    private async health(): Promise<void> {
        const state = this.port.state();
        const floors = safetyThresholds(state.maxHp, this.settings.eatHp, this.settings.retreatHp);
        if (!this.retreating && this.hazardous && state.hp <= floors.retreat) throw new SurvivalFailure(`Emergency retreat at ${state.hp} HP`);
        if (state.hp < floors.eat && state.sharks > 0 && !(await this.port.eat()) && !this.retreating) throw new SurvivalFailure('Shark consumption was not confirmed');
    }
}
