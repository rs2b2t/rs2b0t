import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function clueSequenceEngine(users: readonly string[]): Promise<{ log: string; stop(): Promise<void> }> {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
    const base = 'http://localhost:8890';
    if (await fetch(base, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)) {
        throw new Error('Port 8890 is already serving a world; this harness needs its own local engine');
    }
    const dir = mkdtempSync(join(tmpdir(), 'clue-sequence-'));
    const entry = join(dir, 'engine.mts');
    const moduleUrl = (name: string): string => JSON.stringify(pathToFileURL(join(engine, 'src', name)).href);
    writeFileSync(entry, `
await import(${moduleUrl('app.ts')});
const { default: ScriptRunner } = await import(${moduleUrl('engine/script/ScriptRunner.ts')});
const { ScriptOpcode } = await import(${moduleUrl('engine/script/ScriptOpcode.ts')});
const { default: EnumType } = await import(${moduleUrl('cache/config/EnumType.ts')});
const { default: VarPlayerType } = await import(${moduleUrl('cache/config/VarPlayerType.ts')});
const pending = new Set(${JSON.stringify(users)});
const original = ScriptRunner.HANDLERS[ScriptOpcode.ENUM];
ScriptRunner.HANDLERS[ScriptOpcode.ENUM] = state => {
    const hard = state.intStack[state.isp - 2] === EnumType.getId('trail_hard_enum');
    original(state);
    if (!hard || !pending.delete(state.activePlayer.username)) return;
    state.popInt();
    state.pushInt(3534);
    const progress = VarPlayerType.getId('trail_status');
    state.activePlayer.setVar(progress, (Number(state.activePlayer.getVar(progress)) & ~15) | 6);
    console.log('[clue-sequence]', state.activePlayer.username, 'next clue 3534; final leg');
};
console.log('[clue-sequence] fixture ready');
`);
    const log = join(tmpdir(), `clue-sequence-engine-${Date.now()}.log`);
    const fd = openSync(log, 'w');
    const child = spawn('node', [join(engine, 'node_modules/tsx/dist/cli.mjs'), entry], { cwd: engine, stdio: ['ignore', fd, fd], detached: true });
    closeSync(fd);
    let startupError: Error | null = null;
    child.once('error', error => { startupError = error; });
    const running = (): boolean => child.pid !== undefined && child.exitCode === null && child.signalCode === null;
    const signal = (name: NodeJS.Signals): void => {
        if (!running()) return;
        try { process.kill(-child.pid!, name); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
    };
    const stop = async (): Promise<void> => {
        if (running()) {
            const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
            signal('SIGTERM');
            const timer = setTimeout(() => signal('SIGKILL'), 15_000);
            await exited;
            clearTimeout(timer);
        }
        rmSync(dir, { recursive: true, force: true });
    };
    try {
        for (let attempt = 0; attempt < 120; attempt++) {
            if (startupError) throw startupError;
            if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Local engine exited; see ${log}`);
            if (await fetch(base, { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false)) return { log, stop };
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`Local engine did not start; see ${log}`);
    } catch (error) {
        await stop();
        throw error;
    }
}
