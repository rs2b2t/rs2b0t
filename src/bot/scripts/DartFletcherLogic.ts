export const DARTS_PER_ACTION = 10;

// The engine decodes at most five USER_EVENT packets per player each game tick.
// One item-on-item packet makes up to ten darts, so five is the useful ceiling.
export const DART_ACTIONS_PER_TICK = 5;

export interface DartPlan {
    tier: string;
    tips: string;
    product: string;
    level: number;
    xpPerDart: number;
}

export const DART_PLANS: readonly DartPlan[] = [
    { tier: 'Bronze', tips: 'Bronze dart tip', product: 'Bronze dart', level: 1, xpPerDart: 1.8 },
    { tier: 'Iron', tips: 'Iron dart tip', product: 'Iron dart', level: 22, xpPerDart: 3.8 },
    { tier: 'Steel', tips: 'Steel dart tip', product: 'Steel dart', level: 37, xpPerDart: 7.5 },
    { tier: 'Mithril', tips: 'Mithril dart tip', product: 'Mithril dart', level: 52, xpPerDart: 11.2 },
    { tier: 'Adamant', tips: 'Adamant dart tip', product: 'Adamant dart', level: 67, xpPerDart: 15 },
    { tier: 'Rune', tips: 'Rune dart tip', product: 'Rune dart', level: 81, xpPerDart: 18.8 }
];

export const DART_TIER_OPTIONS = DART_PLANS.map(plan => plan.tier);

export function dartPlanFor(tier: string): DartPlan | null {
    const wanted = tier.trim().toLowerCase();
    return DART_PLANS.find(plan => plan.tier.toLowerCase() === wanted) ?? null;
}

export function dartActionsFor(tips: number, feathers: number): number {
    const available = Math.max(0, Math.min(Math.floor(tips), Math.floor(feathers)));
    return Math.min(DART_ACTIONS_PER_TICK, Math.ceil(available / DARTS_PER_ACTION));
}

export function dartXpCeilingPerHour(plan: DartPlan, tickMs = 600): number {
    if (!Number.isFinite(tickMs) || tickMs <= 0) {
        return 0;
    }
    const ticksPerHour = 3_600_000 / tickMs;
    return plan.xpPerDart * DARTS_PER_ACTION * DART_ACTIONS_PER_TICK * ticksPerHour;
}
