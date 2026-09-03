/** Derive where JiveShilo can stand for each tile a Shilo fishing spot teleports to.
 *  Why: `fishing_movement.enum` moves a spot to any of ten river tiles every 280 to 530 ticks, and only the ones with a walkable bank tile beside them on the village side can be fished, so the script carries the pairs this prints. */

//   bun tools/nav/shilo-fishing-stands.ts [--content ~/code/rs2b2t-content] [--pack out/collision.lcnav.gz] [--from 2870,2971,0]
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';

const SQUARE = { mx: 44, mz: 46 };
/** The spot npc placed on the Shilo map, whose spawns the enum never lists. */
const SPOT_NPC = 317;
/** A stand the pack paths to for more than this is on the far bank. */
const FAR_BANK_COST = 60;

function parseTile(s: string): NavPoint {
    const [x, z, level] = s.split(',').map(Number);
    if ([x, z, level].some(n => Number.isNaN(n))) {
        throw new Error(`bad tile ${s}`);
    }
    return { x: x!, z: z!, level: level! };
}

const args = process.argv.slice(2);
let content = path.join(homedir(), 'code/rs2b2t-content');
let packPath = 'out/collision.lcnav.gz';
let from: NavPoint = { x: 2870, z: 2971, level: 0 };
for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--content') {
        content = args[++i]!;
    } else if (a === '--pack') {
        packPath = args[++i]!;
    } else if (a === '--from') {
        from = parseTile(args[++i]!);
    }
}

const baseX = SQUARE.mx << 6;
const baseZ = SQUARE.mz << 6;
const tiles = new Map<string, NavPoint>();
const enumText = fs.readFileSync(path.join(content, 'scripts/skill_fishing/configs/fishing_movement.enum'), 'utf8');
for (const hit of enumText.matchAll(new RegExp(`^val=\\d+,0_${SQUARE.mx}_${SQUARE.mz}_(\\d+)_(\\d+)$`, 'gm'))) {
    const t = { x: baseX + Number(hit[1]), z: baseZ + Number(hit[2]), level: 0 };
    tiles.set(`${t.x},${t.z}`, t);
}
const mapText = fs.readFileSync(path.join(content, `maps/m${SQUARE.mx}_${SQUARE.mz}.jm2`), 'utf8');
const npcSection = mapText.split('==== NPC ====')[1]?.split('====')[0] ?? '';
for (const hit of npcSection.matchAll(new RegExp(`^0 (\\d+) (\\d+): ${SPOT_NPC}$`, 'gm'))) {
    const t = { x: baseX + Number(hit[1]), z: baseZ + Number(hit[2]), level: 0 };
    tiles.set(`${t.x},${t.z}`, t);
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
loadDefaultNavEdges(finder);

const SIDES = [{ dx: 0, dz: -1, name: 'south' }, { dx: -1, dz: 0, name: 'west' }, { dx: 1, dz: 0, name: 'east' }, { dx: 0, dz: 1, name: 'north' }];

console.log(`${tiles.size} spot tiles on square ${SQUARE.mx}_${SQUARE.mz}, stands costed from ${from.x},${from.z}`);
for (const t of [...tiles.values()].sort((a, b) => a.x - b.x || a.z - b.z)) {
    const stands: string[] = [];
    for (const side of SIDES) {
        const n = { x: t.x + side.dx, z: t.z + side.dz, level: 0 };
        if (!finder.walkable(n.x, n.z, 0)) {
            continue;
        }
        const outcome = finder.findPath(from, n, { policy: { useTeleports: false } });
        const cost = outcome.ok ? outcome.cost : -1;
        const verdict = cost < 0 ? 'unreachable' : cost > FAR_BANK_COST ? 'far bank' : 'village';
        stands.push(`${side.name} (${n.x},${n.z}) cost ${cost} ${verdict}`);
    }
    console.log(`spot (${t.x},${t.z}): ${stands.length === 0 ? 'no walkable neighbour' : stands.join('; ')}`);
}
