import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

export function options(argv: string[]) {
    const { values } = parseArgs({ args: argv, strict: true, options: {
        base: { type: 'string', default: process.env.BASE ?? 'http://localhost:8888' },
        minutes: { type: 'string', default: '8' },
        scenario: { type: 'string', default: 'all' },
        'no-deploy': { type: 'boolean', default: false },
        tick200: { type: 'boolean', default: false },
        'set-tick200': { type: 'boolean', default: false }
    } });
    const url = new URL(values.base);
    assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:' &&
        !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'only a local HTTP engine origin is allowed');
    const minutes = Number(values.minutes);
    assert(Number.isFinite(minutes) && minutes > 0, '--minutes must be positive');
    const scenario = values.scenario;
    assert(scenario === 'all' || scenario === 'full' || scenario === 'empty' || scenario === 'limited',
        '--scenario must be all, full, empty, or limited');
    return { base: url.origin, minutes, scenario, deploy: !values['no-deploy'], tick200: values.tick200,
        setTick200: values['set-tick200'] } as const;
}
