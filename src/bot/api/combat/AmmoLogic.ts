export interface AmmoStack {
    key: string;
    count: number;
    distance: number;
}

export interface SweepOptions {
    minStack: number;
    range: number;
    force: boolean;
}

export function sweepPlan(stacks: AmmoStack[], opts: SweepOptions): string[] {
    return stacks
        .filter(s => s.distance <= opts.range && (opts.force || s.count >= opts.minStack))
        .sort((a, b) => a.distance - b.distance)
        .map(s => s.key);
}
