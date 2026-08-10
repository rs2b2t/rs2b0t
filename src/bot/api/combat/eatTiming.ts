/**
 * When to spend a tick eating.
 *
 * Eating consumes the tick it happens on. Land it on the tick your weapon
 * swings and you lose that attack; land it anywhere in the cooldown that
 * follows and it costs nothing. So the rule is narrow: hold for exactly the tick
 * an attack started on, and eat on any other.
 *
 * Safety wins over DPS — an unknown attack tick, or health low enough that a
 * single hit could kill, both eat immediately. A missed attack is cheap; a
 * missed meal is a death.
 */
export interface EatTimingInput {
    /** True only on the tick the attack animation began. */
    attackedThisTick: boolean;
    /** 0–1. */
    hpFraction: number;
    /** At or below this fraction, eat now whatever the tick. */
    urgentAt: number;
}

export const URGENT_HP_FRACTION = 0.35;

/** Whether to hold this tick and eat on the next one instead. */
export function shouldHoldEat(input: EatTimingInput): boolean {
    if (input.hpFraction <= input.urgentAt) {
        return false;
    }
    return input.attackedThisTick;
}

/**
 * Tracks the tick our attack animation started on.
 *
 * Keyed on animation *changes*, not on "an animation is playing": a swing
 * animation spans several ticks, so treating the whole span as the attack tick
 * would hold eating almost permanently.
 */
export class AttackClock {
    private lastAnim = -1;
    private startedTick = -1;

    /** Feed the local player's primary animation once per tick. */
    observe(anim: number, tick: number): void {
        if (anim !== this.lastAnim) {
            this.lastAnim = anim;
            if (anim !== -1) {
                this.startedTick = tick;
            }
        }
    }

    /** True only on the tick a new animation began. */
    attackedThisTick(tick: number): boolean {
        return this.startedTick === tick;
    }

    reset(): void {
        this.lastAnim = -1;
        this.startedTick = -1;
    }
}
