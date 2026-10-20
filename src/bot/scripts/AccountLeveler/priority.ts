const MELEE = ['attack', 'strength', 'defence'];
const COMBAT = [...MELEE, 'hitpoints', 'ranged', 'magic', 'prayer'];

export function trainingPriority(levels: Record<string, number>, target: number): { label: string; skills: string[]; balance: boolean } {
    const melee = MELEE.filter(skill => levels[skill] < target);
    if (melee.length) return { label: `Build melee stats to ${target}`, skills: melee, balance: true };
    const combat = COMBAT.filter(skill => levels[skill] < target);
    if (combat.length) return { label: `Finish combat stats to ${target}`, skills: combat, balance: false };
    return { label: `Train remaining skills to ${target}`, skills: Object.keys(levels).filter(skill => levels[skill] < target), balance: false };
}

export function canResumeObjective(levels: Record<string, number>, target: number, objective: string): boolean {
    const priority = trainingPriority(levels, target);
    return priority.skills.includes(objective) && (!priority.balance || levels[objective] === Math.min(...priority.skills.map(skill => levels[skill])));
}
