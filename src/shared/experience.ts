export const MAX_LEVEL = 99;

export function buildExperienceThresholds(): number[] {
    const thresholds: number[] = [];
    let points = 0;
    for (let level = 1; level <= MAX_LEVEL; level++) {
        points += Math.floor(level + 300 * Math.pow(2, level / 7));
        thresholds.push(Math.floor(points / 4));
    }
    return thresholds;
}
