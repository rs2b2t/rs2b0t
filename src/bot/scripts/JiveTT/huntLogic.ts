export interface TargetCandidate {
    index: number;
    id: number;
    distance: number;
    chance: number;
    killSeconds: number;
    reachable: boolean;
    engaged: boolean;
    valid: boolean;
}

export function selectTarget<T extends TargetCandidate>(targets: readonly T[], current: number | null): T | null {
    const eligible = targets.filter(t => t.valid && t.reachable && (!t.engaged || t.index === current));
    const held = eligible.find(t => t.index === current);
    return held ?? eligible.sort((a, b) => b.chance / (b.killSeconds + b.distance * 0.6) - a.chance / (a.killSeconds + a.distance * 0.6) || a.index - b.index)[0] ?? null;
}

export function lootPriority(item: { clue: boolean; selected: boolean; bones: boolean; rare: boolean }): number {
    return item.clue ? 1000 : item.selected ? item.rare ? 900 : 500 : item.bones ? 100 : 0;
}

export function meleeEdges(origin: { x: number; z: number }, size: number, level: number) {
    return Array.from({ length: size }, (_, n) => [
        { stand: { x: origin.x - 1, z: origin.z + n, level }, body: { x: origin.x, z: origin.z + n, level } },
        { stand: { x: origin.x + size, z: origin.z + n, level }, body: { x: origin.x + size - 1, z: origin.z + n, level } },
        { stand: { x: origin.x + n, z: origin.z - 1, level }, body: { x: origin.x + n, z: origin.z, level } },
        { stand: { x: origin.x + n, z: origin.z + size, level }, body: { x: origin.x + n, z: origin.z + size - 1, level } }
    ]).flat();
}
