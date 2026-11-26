import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const generator = join(import.meta.dir, '../../tools/nav/derive-ladders.py');
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'derive-ladders-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('unpacked maps generate the same ladder edges as the preferred cache ZIP', () => {
    const pack = join(root, 'engine/data/pack');
    const cache = join(pack, '.cache');
    const maps = join(pack, 'server/maps');
    const data = join(root, 'src/bot/event/webwalk/data');
    const scripts = join(root, 'content/scripts');
    for (const dir of [cache, data, scripts, join(root, 'content/pack')]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'content/pack/loc.pack'), '42=ladder\n');
    writeFileSync(join(scripts, 'ladder.loc'), '[ladder]\nname=Ladder\nop1=Climb-up\n');
    writeFileSync(join(scripts, 'ladder.rs2'), '[oploc1,ladder]\np_telejump(movecoord(loc_coord,0,1,0));\n');
    writeFileSync(join(root, 'collision.lcnav'), Buffer.concat([
        Buffer.from('LCNV'), Buffer.from([1, 0, 0, 0, 1, 0, 1, 1, 3]), Buffer.alloc(2 * (4096 + 512), 0xff)
    ]));

    function derive() {
        const stairs = join(data, 'stairEdges.json');
        const transports = join(data, 'transports.json');
        writeFileSync(stairs, '[]');
        writeFileSync(transports, '[]');
        const result = Bun.spawnSync(['python3', '-B', generator, '--engine', 'engine', '--content', 'content', '--pack', 'collision.lcnav'], { cwd: root });
        expect(result.exitCode, result.stderr.toString()).toBe(0);
        return { stairs: readFileSync(stairs), transports: readFileSync(transports) };
    }

    const square = { m1_1: Buffer.alloc(4 * 64 * 64), l1_1: Buffer.from([43, 0x80, 0x84, 40, 0, 0]) };
    const archive = join(cache, 'maps-server.zip');
    writeFileSync(archive, zipSync(square));
    const zipped = derive();
    const edges = JSON.parse(zipped.stairs.toString());
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
        locId: 42, action: 'Climb-up', from: { x: 66, z: 67, level: 0 }, to: { x: 66, z: 67, level: 1 }
    });
    expect(edges[0]).not.toHaveProperty('disabledReason');

    mkdirSync(maps, { recursive: true });
    writeFileSync(join(maps, 'm1_1'), square.m1_1);
    writeFileSync(join(maps, 'l1_1'), Buffer.from([43, 0x80, 0x85, 40, 0, 0]));
    expect(derive()).toEqual(zipped);

    rmSync(archive);
    writeFileSync(join(maps, 'l1_1'), square.l1_1);
    expect(derive()).toEqual(zipped);
});
