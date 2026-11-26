export function castsFromRunes(costs: readonly { rune: string; count: number }[], held: (rune: string) => number): number {
    return Math.min(...costs.map(cost => Math.floor(held(cost.rune) / cost.count)));
}
