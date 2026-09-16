import { parseArgs } from './harness.js';

export function kqOptions(argv: string[]) {
    const rest = [...argv];
    const index = rest.indexOf('--trips');
    const trips = index < 0 ? 10 : Number(rest[index + 1]);
    if (index >= 0) rest.splice(index, 2);
    const args = parseArgs(rest, { base: 'http://localhost:8890', minutes: 60 });
    if (!Number.isInteger(trips) || trips < 2 || trips > 100) throw new Error('--trips must be an integer between 2 and 100');
    if (args.minutes <= 0) throw new Error('--minutes must be positive');
    return { ...args, trips };
}
