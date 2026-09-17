import { parseArgs } from './harness.js';

export function kqOptions(argv: string[]) {
    const rest = [...argv];
    const recoveryProbe = rest.includes('--recovery-probe');
    if (recoveryProbe) rest.splice(rest.indexOf('--recovery-probe'), 1);
    const gateDelayProbe = rest.includes('--gate-delay-probe');
    if (gateDelayProbe) rest.splice(rest.indexOf('--gate-delay-probe'), 1);
    const lootProbe = rest.includes('--loot-probe');
    if (lootProbe) rest.splice(rest.indexOf('--loot-probe'), 1);
    if (lootProbe && (recoveryProbe || gateDelayProbe)) throw new Error('--loot-probe cannot be combined with another probe');
    const takeNumber = (flag: string, fallback: number) => {
        const index = rest.indexOf(flag);
        if (index < 0) return fallback;
        const value = Number(rest[index + 1]);
        rest.splice(index, 2);
        return value;
    };
    const trips = takeNumber('--trips', 10);
    const level = takeNumber('--level', lootProbe ? 70 : 99);
    const args = parseArgs(rest, { base: 'http://localhost:8890', minutes: lootProbe ? 15 : 60 });
    if (!Number.isInteger(trips) || trips < 2 || trips > 100) throw new Error('--trips must be an integer between 2 and 100');
    if (!Number.isInteger(level) || level < 70 || level > 99) throw new Error('--level must be an integer between 70 and 99');
    if (args.minutes <= 0) throw new Error('--minutes must be positive');
    return { ...args, trips, level, recoveryProbe, gateDelayProbe, lootProbe };
}
