import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface EngineLoginKey {
    rsae: string;
    rsan: string;
}

/** OpenSSL `-modulus` line is `Modulus=<hex>`. */
export function parseModulusHex(text: string): string | null {
    const match = /^Modulus=([0-9A-Fa-f]+)\s*$/m.exec(text);
    return match ? BigInt(`0x${match[1]}`).toString() : null;
}

/**
 * OpenSSL `-text` prints `publicExponent: 65537 (0x10001)` or a colon-hex dump
 * (stock LostCity keys use the dump, and Node/Bun refuse to import those keys).
 */
export function parsePublicExponent(text: string): string | null {
    const compact = /^publicExponent: (\d+)/m.exec(text);
    if (compact) {
        return compact[1];
    }

    const lines = text.split('\n');
    const start = lines.findIndex(line => line.startsWith('publicExponent:'));
    if (start < 0) {
        return null;
    }

    let hex = '';
    for (const raw of lines.slice(start + 1)) {
        if (/^\s*[A-Za-z][A-Za-z ]*:/.test(raw)) {
            break;
        }
        const chunk = raw.replace(/[ :]/g, '');
        if (/^[0-9A-Fa-f]+$/.test(chunk)) {
            hex += chunk;
        }
    }
    return hex.length > 0 ? BigInt(`0x${hex}`).toString() : null;
}

function openssl(args: string[]): string {
    const run = Bun.spawnSync(['openssl', ...args], { stdout: 'pipe', stderr: 'pipe' });
    if (run.exitCode !== 0) {
        throw new Error(`openssl ${args.join(' ')} failed: ${run.stderr.toString()}`);
    }
    return run.stdout.toString();
}

/** Public half of `ENGINE_DIR/data/config/private.pem`, same values `deploy-local-key.sh` bakes. */
export function engineLoginKey(engineDir: string): EngineLoginKey {
    if (process.env.LOCAL_RSAE && process.env.LOCAL_RSAN) {
        return { rsae: process.env.LOCAL_RSAE, rsan: process.env.LOCAL_RSAN };
    }

    const pem = join(engineDir, 'data', 'config', 'private.pem');
    if (!existsSync(pem)) {
        throw new Error(`engine login key: ${pem} missing (set ENGINE_DIR to the engine serving this run)`);
    }

    const rsan = parseModulusHex(openssl(['rsa', '-in', pem, '-noout', '-modulus']));
    const rsae = parsePublicExponent(openssl(['rsa', '-in', pem, '-noout', '-text']));
    if (!rsan || !rsae) {
        throw new Error(`engine login key: could not parse ${pem}`);
    }
    return { rsae, rsan };
}
