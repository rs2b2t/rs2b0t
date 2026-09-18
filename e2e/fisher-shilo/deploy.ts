import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { deployIsolatedClient } from '../lib/harness.js';

export function isolatedDeployment(tag: string) {
    const engine = process.env.ENGINE_DIR;
    assert(engine, 'ENGINE_DIR must explicitly identify the engine serving --base');
    assert(/^[a-z0-9-]+$/.test(tag), 'invalid isolated deployment tag');
    const directory = resolve(engine);
    const cleanup = () => {
        rmSync(`${directory}/public/bot/${tag}`, { recursive: true, force: true });
        rmSync(`${directory}/public/bot-${tag}.html`, { force: true });
    };
    try {
        const result = Bun.spawnSync(['bun', import.meta.path, tag, directory], { stdout: 'inherit', stderr: 'inherit' });
        assert.equal(result.exitCode, 0, 'isolated client deployment failed');
        return { page: `/bot-${tag}.html`, cleanup };
    } catch (error) {
        cleanup();
        throw error;
    }
}

if (import.meta.main) {
    const [tag, engine] = process.argv.slice(2);
    assert(tag && engine, 'deployment requires tag and engine');
    deployIsolatedClient(tag, engine);
}
