interface Point { x: number; z: number; level: number }

export interface NonTargetAttacker { id: number; index: number; name: string | null; distance: number }

interface ExposureSample {
    at: number;
    tile: Point | null;
    adults: number;
    runner: string;
    randomEvent: string | null;
    nonTargetAttackers: NonTargetAttacker[];
}

function same(a: Point | null, b: Point | null): boolean {
    return a !== null && b !== null && a.x === b.x && a.z === b.z && a.level === b.level;
}

export function demonExposure(previous: ExposureSample, current: ExposureSample, spots: readonly Point[], unexplainedHp = 0) {
    const onSpot = (tile: Point | null) => spots.some(spot => same(tile, spot));
    const bothEnds = onSpot(previous.tile) && onSpot(current.tile);
    const stationary = bothEnds && same(previous.tile, current.tile);
    const durationMs = Math.max(0, current.at - previous.at);
    const samples = [previous, current];
    const attackers = [...new Map(samples.flatMap(sample => sample.nonTargetAttackers).map(npc => [npc.index, npc])).values()];
    const reasons = [...new Set([
        ...attackers.map(npc => `non-target:${npc.name ?? '?'}#${npc.index}`),
        ...samples.filter(sample => sample.runner !== 'running').map(sample => `runner:${sample.runner}`),
        ...samples.flatMap(sample => sample.randomEvent === null ? [] : [sample.randomEvent])
    ])];
    const clean = reasons.length === 0;
    return {
        durationMs, clean, reasons, attackers, bothEnds,
        violation: unexplainedHp > 0 && bothEnds && clean,
        eitherEnd: onSpot(previous.tile) || onSpot(current.tile),
        heldMs: stationary && previous.adults > 0 && current.adults > 0 && clean ? durationMs : 0
    };
}
