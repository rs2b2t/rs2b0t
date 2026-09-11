export type HardClueSample = {
    readonly at: number;
    readonly phase: 'prepared' | 'blocked' | 'dig' | 'spawn' | 'fight' | 'kill' | 'post-kill-dig' | 'restored';
    readonly clueHeld: boolean;
    readonly hp: number;
    readonly sharks: number;
    readonly weaponId: number;
    readonly special: number;
    readonly antipoisonDoses: number;
    readonly guardianLife: string | null;
};
export type HardClueCapture = {
    readonly guardianName: string;
    readonly prep: {
        readonly bankConfirmed: boolean;
        readonly attack: number;
        readonly lostCity: boolean;
        readonly daggerId: number | null;
        readonly antipoisonId: number | null;
        readonly sharksAvailable: number;
        readonly hostWeaponId: number;
    };
    readonly samples: readonly HardClueSample[];
};

export function assessHardClue(capture: HardClueCapture) {
    const { prep } = capture;
    const samples = [...capture.samples].sort((a, b) => a.at - b.at);
    const violations: string[] = [];
    const ready = prep.bankConfirmed && prep.attack >= 60 && prep.lostCity
        && (prep.daggerId === 1215 || prep.daggerId === 1231)
        && prep.antipoisonId !== null && [2448, 181, 183, 185].includes(prep.antipoisonId) && prep.sharksAvailable >= 15;
    if (!ready) {
        const retained = samples.length > 0 && samples.every(s => s.clueHeld && s.hp > 0
            && (s.phase === 'prepared' || s.phase === 'blocked')) && samples.some(s => s.phase === 'blocked');
        return { passed: retained, outcome: 'blocked', violations: retained ? [] : ['unsafe-or-unobserved-block'] };
    }
    if (capture.guardianName !== 'Saradomin Wizard') violations.push('saradomin-wizard-required');
    const prepared = samples.find(s => s.phase === 'prepared');
    const dig = samples.find(s => s.phase === 'dig');
    const spawn = samples.find(s => s.phase === 'spawn');
    const kill = samples.find(s => s.phase === 'kill');
    const postDig = samples.find(s => s.phase === 'post-kill-dig');
    const restored = samples.find(s => s.phase === 'restored');
    if (!prepared || !dig || !spawn || !kill || !postDig || !restored) {
        return { passed: false, outcome: 'incomplete', violations: ['missing-encounter-phase'] };
    }
    if (!(prepared.at < dig.at && dig.at < spawn.at && spawn.at < kill.at && kill.at < postDig.at && postDig.at < restored.at)) violations.push('encounter-order');
    if (prepared.sharks < Math.min(20, prep.sharksAvailable) || dig.sharks < 15 || spawn.sharks < 15) violations.push('pre-encounter-sharks');
    if (prepared.antipoisonDoses <= 0 || dig.antipoisonDoses !== prepared.antipoisonDoses - 1
        || spawn.antipoisonDoses !== dig.antipoisonDoses) violations.push('antidote-before-spawn');
    if (spawn.guardianLife === null || kill.guardianLife !== spawn.guardianLife) violations.push('guardian-life');
    const fight = samples.filter(s => s.at >= spawn.at && s.at < kill.at);
    if (fight.some(s => s.weaponId !== prep.daggerId)) violations.push('dds-equipped');
    if (!fight.some(s => s.special < spawn.special && s.guardianLife === spawn.guardianLife)) violations.push('special-spent');
    if (!fight.some((s, i) => {
        const before = fight[i - 1];
        return before && s.sharks === before.sharks - 1 && s.hp > before.hp;
    })) violations.push('shark-upkeep');
    if (samples.some(s => s.hp <= 0)) violations.push('player-death');
    if (samples.some(s => s.at <= spawn.at && !s.clueHeld)) violations.push('clue-lost-before-spawn');
    if (restored.weaponId !== prep.hostWeaponId) violations.push('host-weapon-restoration');
    return { passed: violations.length === 0, outcome: 'guardian', violations };
}
