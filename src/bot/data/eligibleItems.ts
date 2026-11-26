export function eligibleItems<T extends { name: string; level: number }>(
    catalog: readonly T[],
    skillLevel: number,
    selected: readonly string[]
): T[] {
    return catalog
        .filter(item => item.level <= skillLevel)
        .filter(item => selected.length === 0 || selected.some(name => name.toLowerCase() === item.name.toLowerCase()))
        .sort((a, b) => a.level - b.level);
}
