import { afterEach, beforeEach, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const generator = join(import.meta.dir, '../../tools/nav/derive-stairs.ts');
const previous = Buffer.from('[ { "from": {"x":1,"z":2,"level":0}, "to": {"x":1,"z":2,"level":1}, "locName":"Old stairs", "action":"Climb-up", "kind":"stair" } ]\r\n');
let root: string;
let stairs: string;
let out: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'derive-stairs-'));
    const pack = join(root, 'engine/data/pack');
    mkdirSync(join(pack, 'client'), { recursive: true });
    mkdirSync(join(pack, 'server/maps'), { recursive: true });
    writeFileSync(join(pack, 'server/loc.dat'), Buffer.concat([Buffer.from([0, 1, 250]), Buffer.from('stairs\n'), Buffer.from([30]), Buffer.from('Climb-up\n\0')]));
    writeFileSync(join(pack, 'client/config'), Buffer.from('AAAPAAAxMUFZJlNZ8nQWawAAAlEKaAAAQAAIAgAAAiAAMQwBGj1HqWlEg8+LuSKcKEh5Ogs1gA==', 'base64'));

    const squares = [[50, 50], [50, 53], [43, 53]];
    const levels = Buffer.alloc(2 * (4096 + 512), 0xff);
    writeFileSync(join(root, 'collision.lcnav'), Buffer.concat([
        Buffer.from('LCNV'), Buffer.from([1, 0, 0, 0, squares.length, 0]),
        ...squares.flatMap(([mx, mz]) => [Buffer.from([mx, mz, 3]), levels])
    ]));

    const scripts = join(root, 'content/scripts/ladders+stairs/scripts');
    mkdirSync(scripts, { recursive: true });
    stairs = join(scripts, 'stairs.rs2');
    writeFileSync(stairs, `[oploc1,stairs]
case 0_50_50_5_9 : p_telejump(1_50_50_5_9);
case 0_50_53_55_28 : p_telejump(1_50_53_55_28);
case 0_50_50_29_13 : p_telejump(1_50_50_29_13);
`);

    const data = join(root, 'src/bot/event/webwalk/data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'transports.json'), '[]');
    out = join(data, 'stairEdges.json');
    writeFileSync(out, previous);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function derive(...args: string[]) {
    return Bun.spawnSync([process.execPath, '--no-install', generator, '--engine', 'engine', '--content', 'content', '--pack', 'collision.lcnav', ...args], { cwd: root });
}

test('missing Catherby exits 1 and preserves the previous stair graph byte for byte', () => {
    const result = derive();
    expect(result.exitCode, result.stderr.toString()).toBe(1);
    expect(result.stdout.toString().match(/^PASS /gm)).toHaveLength(3);
    expect(result.stdout.toString()).toContain('FAIL Catherby');
    expect(readFileSync(out).equals(previous), result.stdout.toString()).toBe(true);
});

test('restoring Catherby writes all eight directed edges and passes --check', () => {
    appendFileSync(stairs, 'case 0_43_53_55_62 : p_telejump(1_43_53_55_62);\n');
    expect(derive('--check').exitCode).toBe(1);
    expect(readFileSync(out)).toEqual(previous);
    const result = derive();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const locations = [[2807, 3454], [3205, 3209], [3229, 3213], [3255, 3420]];
    const expected = [0, 1].flatMap(level => locations.map(([x, z]) => ({
        from: { x, z, level },
        to: { x, z, level: 1 - level },
        locName: 'stairs',
        action: level === 0 ? 'Climb-up' : 'Climb-down',
        kind: 'stair'
    })));
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(expected);
    expect(derive('--check').exitCode).toBe(0);
});
