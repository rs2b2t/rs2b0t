// Dev utility: print packed loc instances near a world tile — for verifying
// door/transport coordinates when curating src/bot/nav/data/transports.json.
//
// Usage: bun tools/nav/probe-locs.ts <x> <z> [radius=5] [--engine <dir>] [--ops]
//   --ops  only locs that have at least one op

import { LocShape, locShapeLayer } from '#/bot/nav/rsmod/flags.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';

const args = process.argv.slice(2);
const positional: number[] = [];
let engine = '/Users/elliotninjaone/code/lostcity-dev/engine';
let opsOnly = false;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--engine') {
        engine = args[++i];
    } else if (args[i] === '--ops') {
        opsOnly = true;
    } else {
        positional.push(Number(args[i]));
    }
}

const [cx, cz, radius = 5] = positional;
if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
    console.error('usage: bun tools/nav/probe-locs.ts <x> <z> [radius] [--engine <dir>] [--ops]');
    process.exit(2);
}

const shapeNames = new Map<number, string>(Object.entries(LocShape).map(([name, value]) => [value, name]));
const { configs } = loadLocTypes(engine);

for (const { mx, mz, land, loc } of loadMapsquares(engine)) {
    const baseX = mx << 6;
    const baseZ = mz << 6;
    if (cx + radius < baseX || cx - radius >= baseX + 64 || cz + radius < baseZ || cz - radius >= baseZ + 64) {
        continue;
    }

    const lands = parseLands(new Reader(land));
    forEachLoc(new Reader(loc), instance => {
        const x = baseX + instance.x;
        const z = baseZ + instance.z;
        if (Math.abs(x - cx) > radius || Math.abs(z - cz) > radius) {
            return;
        }

        const type = configs[instance.locId];
        const ops = (type.op ?? []).filter(op => op !== null);
        if (opsOnly && ops.length === 0) {
            return;
        }

        const actual = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
        console.log(
            `(${x},${z}) level=${instance.level}${actual !== instance.level ? `->${actual}` : ''} ` +
                `id=${instance.locId} '${type.name ?? '?'}' [${type.debugname ?? '?'}] ` +
                `shape=${shapeNames.get(instance.shape) ?? instance.shape}(${locShapeLayer(instance.shape) === 0 ? 'WALL' : 'non-wall'}) angle=${instance.angle} ` +
                `size=${type.width}x${type.length} ops=[${ops.join(', ')}]`
        );
    });
}
