type Stand = { readonly x: number; readonly z: number; readonly gap: number; readonly los: boolean };
type Selection = { readonly anchor: number; readonly moving: boolean; readonly owned: boolean; readonly stands: readonly Stand[] };
export type AlternateFight = {
    readonly nid: number; readonly life: number; readonly anchorX: number; readonly anchorZ: number;
    readonly authoritativeDeath: boolean; readonly attackWalkouts: number; readonly meleeHits: number;
};

export function assessAlternateFights(fights: readonly AlternateFight[]) {
    const accepted = new Set<string>();
    const anchors = new Map<number, Set<string>>();
    const violations: string[] = [];
    for (const fight of fights) {
        if (fight.anchorZ !== 9817 || ![2835, 2834].includes(fight.anchorX)) violations.push('outside-existing-alternates');
        if (fight.attackWalkouts > 0) violations.push('attack-walkout');
        if (fight.meleeHits > 0) violations.push('melee-hit');
        if (fight.authoritativeDeath) {
            const key = `${fight.nid}:${fight.life}`;
            accepted.add(key);
            const lives = anchors.get(fight.anchorX) ?? new Set<string>();
            lives.add(key);
            anchors.set(fight.anchorX, lives);
        }
    }
    return { passed: accepted.size >= 3 && violations.length === 0 && [...anchors.values()].every(lives => lives.size >= 3),
        fights: accepted.size, anchors: [...anchors].map(([x, lives]) => ({ x, fights: lives.size })), violations };
}

export function assessAdaptiveStand(before: Selection, selected: number): string[] {
    const violations: string[] = [];
    const target = before.stands[selected];
    const current = before.stands[before.anchor];
    const ready = (stand: Stand | undefined) => stand !== undefined && stand.los && stand.gap <= 6;
    if (!target || target.z !== 9817 || ![2836, 2835, 2834].includes(target.x)) violations.push('outside-existing-stands');
    if (selected === before.anchor) return violations;
    if (before.moving) violations.push('anchor-unlatched');
    if (before.owned) violations.push('owned-anchor-changed');
    if (ready(current)) violations.push('ready-anchor-changed');
    if (!ready(target)) violations.push('alternate-not-ready');
    if (current && target && before.stands.some(s => ready(s) && Math.abs(s.x - current.x) < Math.abs(target.x - current.x))) violations.push('nearer-ready-stand');
    return violations;
}
