export type RewardItem = { readonly id: number; readonly count: number };
export type RewardSample = {
    readonly at: number;
    readonly holdings: readonly RewardItem[];
    readonly consumed?: readonly RewardItem[];
    readonly hp: number;
    readonly maxHp: number;
    readonly sharks: number;
    readonly used: number;
    readonly left: boolean;
    readonly solved?: boolean;
    readonly action?: string;
};
export type RewardCapture = {
    readonly manifest: { readonly interfaceId: number; readonly modalId: number; readonly items: readonly RewardItem[] } | null;
    readonly before: readonly RewardItem[];
    readonly requireFullHpSpace: boolean;
    readonly samples: readonly RewardSample[];
};

function quantities(items: readonly RewardItem[]): Map<number, number> {
    const totals = new Map<number, number>();
    for (const item of items) totals.set(item.id, (totals.get(item.id) ?? 0) + item.count);
    return totals;
}

export function assessReward(capture: RewardCapture) {
    const { manifest } = capture;
    if (!manifest || manifest.interfaceId !== 6963 || manifest.modalId !== 6960 || manifest.items.length === 0
        || manifest.items.some(i => !Number.isInteger(i.count) || i.count <= 0 || !Number.isInteger(i.id) || i.id < 0)) {
        return { passed: false, violations: ['actual-manifest-required'], outstanding: [] };
    }
    const before = quantities(capture.before), expected = quantities(manifest.items);
    const samples = [...capture.samples].sort((a, b) => a.at - b.at);
    const violations = new Set<string>();
    let complete = false, fullHpSpace = false;
    let outstanding = [...expected].map(([id, count]) => ({ id, count }));
    for (const [i, sample] of samples.entries()) {
        const holdings = quantities([...sample.holdings, ...(sample.consumed ?? [])]);
        outstanding = [...expected].map(([id, count]) => ({ id, count: Math.max(0, count - ((holdings.get(id) ?? 0) - (before.get(id) ?? 0))) }))
            .filter(item => item.count > 0);
        complete = outstanding.length === 0;
        if (sample.left && !complete) violations.add('left-before-accounted');
        if (sample.solved && !complete) violations.add('solved-before-accounted');
        const prior = samples[i - 1];
        if (prior && prior.hp === prior.maxHp && sample.hp === sample.maxHp && prior.used === 28
            && sample.sharks === prior.sharks - 1 && sample.used === 27 && sample.action === 'Eat Shark') fullHpSpace = true;
    }
    if (!complete) violations.add('reward-quantities-outstanding');
    if (capture.requireFullHpSpace && !fullHpSpace) violations.add('full-hp-shark-space');
    return { passed: violations.size === 0, violations: [...violations], outstanding };
}
