import assert from 'node:assert/strict';
import process from 'node:process';
import { constants, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const candidateRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export const privateEngine = resolve(candidateRoot, '../shilo-private/engine');

export function assertEngineCwd(engine, cwd) {
    assert.equal(realpathSync(cwd), realpathSync(engine), 'cwd must be the validated private engine');
}

export function assertPrivatePorts(config) {
    assert.equal(config?.web?.port, 8891, 'private web port required');
    assert.equal(config?.node?.port, 43596, 'private node port required');
    assert.equal(config?.web?.managementPort, 8899, 'private management port required');
}

export function validatePrivateEngine(engine) {
    assert(engine, 'explicit private engine required');
    assert.equal(realpathSync(engine), realpathSync(privateEngine));
    const config = JSON.parse(readFileSync(resolve(engine, 'data/config/world.json'), 'utf8'));
    assertPrivatePorts(config);
    return realpathSync(engine);
}

export function privateEvidencePath(root, path) {
    assert(isAbsolute(path), 'absolute evidence path required');
    const tree = resolve(realpathSync(root), 'out/e2e');
    const suffix = relative(tree, resolve(path));
    assert(suffix && !suffix.startsWith(`..${sep}`) && suffix !== '..' && !isAbsolute(suffix), 'outside private evidence tree');
    let parent = realpathSync(root);
    for (const part of relative(parent, dirname(resolve(path))).split(sep)) {
        parent = resolve(parent, part);
        assert(!lstatSync(parent).isSymbolicLink() && lstatSync(parent).isDirectory(), 'symlink evidence parent rejected');
    }
    return resolve(path);
}

export function openPrivateTrace(root, path) {
    assert(typeof path === 'string', 'BLACK_SERVER_TRACE required');
    return openSync(privateEvidencePath(root, path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
}

export function assertPrivateUrl(value, protocol = 'http:') {
    const url = new URL(value);
    assert.equal(url.protocol, protocol);
    assert.equal(url.hostname, 'localhost');
    assert.equal(url.port, '8891');
    assert(!url.username && !url.password, 'URL credentials rejected');
    return url;
}

export function privateRunOutput(env) {
    assert.equal(realpathSync(process.cwd()), candidateRoot, 'runner cwd must be candidate worktree');
    assert.equal(env.RUNTIME_AUTHORIZED, '1');
    assert.equal(env.TARGET, 'local');
    assert.equal(env.BASE, 'http://localhost:8891');
    validatePrivateEngine(env.ENGINE_DIR);
    assert(env.RUN_TAG && /^[A-Za-z0-9_-]+$/.test(env.RUN_TAG), 'safe explicit RUN_TAG required');
    const trace = privateEvidencePath(candidateRoot, env.BLACK_SERVER_TRACE ?? '');
    assert(lstatSync(trace).isFile() && !lstatSync(trace).isSymbolicLink(), 'regular private trace required');
    return privateEvidencePath(candidateRoot, resolve(candidateRoot, 'out/e2e', env.RUN_TAG));
}
