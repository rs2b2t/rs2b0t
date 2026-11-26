import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const baker = join(import.meta.dir, '../../tools/nav/build-collision.ts');
let root: string;
let pack: string;
let out: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'build-collision-'));
    pack = join(root, 'engine/data/pack');
    out = join(root, 'out/collision.lcnav');
    mkdirSync(join(pack, 'client'), { recursive: true });
    mkdirSync(join(pack, 'server/maps'), { recursive: true });
    mkdirSync(join(root, 'out'));
    writeFileSync(join(pack, 'server/loc.dat'), Buffer.from([0, 0]));
    writeFileSync(join(pack, 'client/config'), Buffer.from('AAAOAAAwMUFZJlNZf9pbxQAAAlEKcAAAQAAIAgAAAiAAIhkzUIYBpDzeKeLuSKcKEg/7S3ig', 'base64'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function bake(...args: string[]) {
    return Bun.spawnSync([process.execPath, '--no-install', baker, '--engine', join(root, 'engine'), '--out', out, ...args], { cwd: root });
}

function expectRejectedBake() {
    const result = bake();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('verification check(s) failed');
}

test('rejected bake leaves a clean output directory empty', () => {
    expectRejectedBake();
    expect(readdirSync(join(root, 'out'))).toEqual([]);
});

test('rejected bake preserves both cached outputs', () => {
    const raw = Buffer.from('previous raw pack');
    const gz = Buffer.from('previous gzip');
    writeFileSync(out, raw);
    writeFileSync(out + '.gz', gz);

    expectRejectedBake();
    expect(readFileSync(out)).toEqual(raw);
    expect(readFileSync(out + '.gz')).toEqual(gz);
});

function expectPack(mapsquares: number) {
    const raw = readFileSync(out);
    expect(raw.toString('ascii', 0, 4)).toBe('LCNV');
    expect(raw.readUInt16LE(8)).toBe(mapsquares);
    expect(gunzipSync(readFileSync(out + '.gz'))).toEqual(raw);
}

test('--no-verify emits both outputs for an empty bake', () => {
    const result = bake('--no-verify');
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expectPack(0);
});

test('verified bake emits both outputs', () => {
    const locs = Buffer.concat([Buffer.from([0, 2, 14, 2, 15, 2, 19, 1, 250]), Buffer.from('tree\n\0'), Buffer.from([250]), Buffer.from('treestump\n\0')]);
    writeFileSync(join(pack, 'server/loc.dat'), locs);
    writeFileSync(join(pack, 'client/config'), Buffer.from('AAAQAAAyMUFZJlNZOvU4cAAAAlEKdAAAQAAIAgAAAiAAIh6TRoQwIRGgq3Oni7kinChIHXqcOAA=', 'base64'));

    for (const mz of [50, 51]) {
        const tiles = new Array<number>(4 * 64 * 64).fill(0);
        if (mz === 50) {
            tiles[64 * 64 + 5 * 64 + 9] = 82; // Castle first-floor underlay.
        } else {
            tiles.fill(50, 0, 64 * 64); // Block the river and fence crossings.
            tiles[32 * 64 + 34] = 0; // Open the chicken pen tile.
        }
        writeFileSync(join(pack, 'server/maps', `m50_${mz}`), Buffer.from(tiles.flatMap(op => (op ? [op, 0] : [0]))));
        writeFileSync(join(pack, 'server/maps', `l50_${mz}`), Buffer.from([0]));
    }

    const result = bake();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expectPack(2);
});
