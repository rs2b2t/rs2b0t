import { afterEach, expect, test } from 'bun:test';

import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { RunManager, type RunPolicyOverride } from '#/bot/runtime/RunManager.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';

const NAME = 'Run override lifecycle fixture';

afterEach(async () => {
    ScriptRunner.stop('test teardown');
    await Promise.resolve();
    await Promise.resolve();
    ScriptRegistry.unregister(NAME);
    RunManager.override(null);
});

test('ScriptRunner start and stop clear a leftover run override', async () => {
    ScriptRegistry.register({
        name: NAME,
        description: 'test fixture',
        create: () =>
            new (class extends LoopingBot {
                override loop(): void {}
            })()
    });

    const seen: Array<RunPolicyOverride | null> = [];
    const original = RunManager.override.bind(RunManager);
    RunManager.override = (policy: RunPolicyOverride | null) => {
        seen.push(policy);
        original(policy);
    };

    try {
        RunManager.override({ runAuto: false });
        seen.length = 0;

        const meta = ScriptRegistry.get(NAME);
        expect(meta).toBeDefined();
        ScriptRunner.start(meta!);
        expect(seen[0]).toBeNull();
        expect(ScriptRunner.state).toBe('running');

        seen.length = 0;
        ScriptRunner.stop('lifecycle test');
        await Promise.resolve();
        await Promise.resolve();
        expect(seen).toContain(null);
        expect(ScriptRunner.state).toBe('stopped');
    } finally {
        RunManager.override = original;
    }
});
