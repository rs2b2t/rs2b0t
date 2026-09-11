import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export const scenarioNames = ['missing-dds', 'missing-superanti', 'sharks14', 'guardian', 'reward'] as const;
export type PrivateScenario = typeof scenarioNames[number];

export function privateScenario(name: PrivateScenario) {
    const casketOnly = name === 'reward';
    return { name, casketOnly, clueId: 3544, casketId: 3545, clue: 'trail_clue_hard_sextant023',
        trailStatus: (4 << 5) | 5, bankSharks: 0, sharks: casketOnly ? 27 : name === 'sharks14' ? 14 : name === 'guardian' ? 15 : 20,
        dds: !casketOnly && name !== 'missing-dds', superanti: !casketOnly && name !== 'missing-superanti', lostCity: !casketOnly,
        levels: { attack: casketOnly ? 1 : 75, strength: casketOnly ? 1 : 75, defence: casketOnly ? 1 : 75,
            hitpoints: 77, prayer: 70, ranged: 85, magic: 80, agility: 40 },
        bank: { x: 2946, z: 3369, level: 0 }, dig: { x: 3441, z: 3419, level: 0 } } as const;
}

export function assertPrivateEnvironment(env: Readonly<Record<string, string | undefined>>) {
    assert.equal(env.RUNTIME_AUTHORIZED, '1', 'parent runtime handoff required');
    assert.equal(env.TARGET, 'local');
    assert.equal(env.BASE, 'http://localhost:8891', 'private server only');
    assert.equal(env.HEADED, '1');
    assert.equal(env.SLOWMO, '0');
    assert.equal(resolve(env.ENGINE_DIR ?? ''), resolve('../shilo-private/engine'));
    const { E2E_CLIENT_PAGE: pagePath, BLACK_BUNDLE: bundle, BLACK_SERVER_TRACE: server, RUN_TAG: tag } = env;
    assert(pagePath && pagePath.startsWith('/') && !pagePath.startsWith('//'));
    assert(bundle && server && tag && /^[A-Za-z0-9_-]+$/.test(tag));
    const scenario = scenarioNames.find(name => name === env.JIVE_SCENARIO);
    assert(scenario, 'JIVE_SCENARIO required');
    return { base: env.BASE, pagePath, bundle, server, tag, scenario, engine: resolve(env.ENGINE_DIR ?? '') };
}
