export class CombatStats {
    damage = 0;
    fightingMs = 0;
    private at: number | null = null;
    private xp: number | null = null;
    private active = false;

    observe(now: number, xp: number, active: boolean): void {
        if (this.at !== null && this.active) {
            this.fightingMs += Math.max(0, now - this.at);
            this.damage += Math.max(0, xp - (this.xp ?? xp)) / 4;
        }
        this.at = now;
        this.xp = xp;
        this.active = active;
    }

    get dps(): number { return this.fightingMs > 0 ? this.damage / (this.fightingMs / 1000) : 0; }
}
