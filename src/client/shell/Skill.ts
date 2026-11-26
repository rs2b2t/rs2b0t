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

export default class Skill {
    static readonly count: number = 25;
    static readonly names: string[] = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving', 'slayer', '-unused-', 'runecraft', '-unused-', '-unused-', '-unused-', '-unused-'];
    static readonly used: boolean[] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false, false, true, false, false, false, false];
}
