export type LootEvent = {
    readonly at: number;
    readonly action: 'death' | 'Drop' | 'Take' | 'Bury' | 'Attack' | 'tick';
    readonly item: string;
    readonly tile: { readonly x: number; readonly z: number };
    readonly anchor: { readonly x: number; readonly z: number };
    readonly used: number;
    readonly sharks: number;
    readonly prayerXp: number;
    readonly hideCount: number;
    readonly groundSharks: number;
    readonly danger?: boolean;
    readonly ownedAlive?: boolean;
};

export function assessLootSequence(events: readonly LootEvent[]): { violations: string[]; completed: number } {
    const violations = new Set<string>();
    let completed = 0;
    for (const [i, death] of events.entries()) {
        if (death.action !== 'death' || death.used !== 28) continue;
        const rest = events.slice(i + 1);
        const end = rest.findIndex(e => e.action === 'Attack' || e.action === 'death');
        const run = end < 0 ? rest : rest.slice(0, end + 1);
        const last = run.at(-1);
        if (!last) continue;
        const onAnchor = (e: LootEvent) => e.tile.x === e.anchor.x && e.tile.z === e.anchor.z;
        const dropped = run.find(e => e.action === 'Drop' && e.item === 'Shark');
        const bones = run.find(e => e.action === 'Take' && e.item === 'Dragon bones');
        const buried = run.find(e => e.action === 'Bury' && e.item === 'Dragon bones');
        const hide = run.find(e => e.action === 'Take' && e.item === 'Dragonhide');
        const reclaimed = run.find(e => e.action === 'Take' && e.item === 'Shark');
        if (reclaimed && !run.some(e => e.at > reclaimed.at && e.sharks > reclaimed.sharks)) violations.add('food-reclaim-unconfirmed');
        if (reclaimed && !onAnchor(reclaimed)) violations.add('food-reclaim-before-return');
        if (reclaimed && run.some(e => e.at > reclaimed.at && e.action === 'Drop' && e.item === 'Shark')) violations.add('food-drop-reclaim-loop');
        for (const e of run) {
            if (e.action === 'Drop' && e.item === 'Shark' && !onAnchor(e)) violations.add('unsafe-food-drop');
            if (e.action === 'Drop' && e.item === 'Shark' && e.danger) violations.add('dangerous-food-drop');
            if ((e.action === 'Drop' || e.action === 'Take') && e.ownedAlive) violations.add('fight-preemption');
            if (e.action === 'Take' && e.item === 'Shark' && e.used === 28) violations.add('full-food-reclaim');
        }
        if (hide && (!buried || hide.at < buried.at)) violations.add('hide-before-bury');
        if (hide && !run.some(e => e.at > hide.at && e.hideCount > hide.hideCount)) violations.add('hide-unconfirmed');
        if (run.some(e => e.action === 'Take' && !['Dragon bones', 'Dragonhide', 'Shark'].includes(e.item) && (!hide || e.at < hide.at))) violations.add('other-before-hide');
        if (buried && (!bones || buried.at < bones.at)) violations.add('bury-before-bones');
        if (buried && !run.some(e => e.at > buried.at && e.prayerXp > buried.prayerXp)) violations.add('burial-unconfirmed');
        if (end >= 0 || last.at - death.at >= 20000) {
            if (!bones || !buried || !hide) violations.add('corpse-starvation');
            if (hide && !onAnchor(last)) violations.add('missing-return');
            const reclaim = run.find(e => e.action === 'Take' && e.item === 'Shark');
            if (dropped && dropped.groundSharks === 0 && hide && onAnchor(last) && last.used < 28 && !reclaim) violations.add('missing-food-reclaim');
            if (bones && buried && hide && onAnchor(last)) completed++;
        }
    }
    return { violations: [...violations], completed };
}
