// Why: eating consumes the tick it happens on, so landing it on the tick the weapon swings loses that attack while landing it anywhere in the cooldown costs nothing.
// Why: the rule is therefore narrow — hold for the one tick an attack started on, and eat on any other.
// Why: safety wins over DPS, so an unknown attack tick or health low enough that a single hit could kill both eat immediately.
interface EatTimingInput {
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
 * Tracks the tick our attack animation started on, keyed on animation changes.
 * Why: a swing animation spans several ticks, so treating its span as the attack tick would hold eating almost permanently.
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
