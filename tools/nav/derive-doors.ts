import fs from 'node:fs';
import path from 'node:path';

import { LocLayer, LocShape, locShapeLayer } from '#/bot/event/webwalk/rsmod/flags.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';

interface DoorEdge {
    x: number;
    z: number;
    level: number;
    locId: number;
    locName: string;
    dir: 'N' | 'E' | 'S' | 'W';
}

const ANGLE_DIR: ('W' | 'N' | 'E' | 'S')[] = ['W', 'N', 'E', 'S'];

function parseArgs(): { engine: string; out: string } {
    const args = process.argv.slice(2);
    let engine = '/Users/elliotninjaone/code/lostcity-dev/engine';
    let out = 'src/bot/event/webwalk/data/doors.json';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--engine') {
            engine = args[++i];
        } else if (args[i] === '--out') {
            out = args[++i];
        } else {
            console.error(`unknown argument: ${args[i]}`);
            process.exit(2);
        }
    }
    return { engine, out };
}

function main(): void {
    const opts = parseArgs();
    const { configs } = loadLocTypes(opts.engine);

    const openable = new Set<number>();
    let lockedSkipped = 0;
    for (let id = 0; id < configs.length; id++) {
        const type = configs[id];
        if (!type.op || !type.op.some(op => op?.toLowerCase() === 'open')) {
            continue;
        }
        // Doors whose script refuses the Open its ops advertise.
        // Why: baked as ordinary edges the pathfinder routes through a wall and the walker repaths forever against "This door is completely sealed".
        const SCRIPT_REFUSED = new Set([
            'closet_door', '1to2', '2to3', '4to5', '5to6', '8to9', '2to5', '3to6', '4to7', '5to8',
            // Rashiliyia's skeletal doors: three bones, or nothing.
            'thzq_tombrooml1', 'thzq_tombrooml2', 'thzq_tombrooml3', 'thzq_tombroomr1', 'thzq_tombroomr2',
            // Her tomb's outer gate: the Beads of the Dead, or she meets you at it.
            'zombiequeengateclosedl', 'zombiequeengateclosedr',
            // McGrubor's Wood: locked from inside, the Forester turns you away from
            // outside. The Loose Railing is the way in, curated in transports.json.
            'mcgruborgatel', 'mcgruborgater',
            // Melzar's Maze. Each opens only to its own coloured key, which the maze hands out one kill at a time, and the key teleports you through rather than leaving the door open.
            // Why: baked as ordinary edges the pathfinder routes straight at them and the walker loops on "This door is securely locked". funexit is the one-way way out.
            'melzardoor', 'reddoor', 'orangedoor', 'yellowdoor', 'bluedoor', 'magentadoor', 'greendoor', 'funexit',
            // The Oracle's door: silk, an unfired bowl, a lobster pot and a mind bomb,
            // and only after she has been asked about the map.
            'dragon_slayer_magic_door',
            // Elvarg's lair, locked until the ship has sailed, and Crandor's secret
            // door, which only opens from the island side.
            'elvarg_gate_right', 'elvarg_gate_left', 'dragonsecretdoor',
            // Family Crest's perfect-gold mine — each answers "This door is locked" unless its own combination of the three levers is set.
            // Why: the combination that opens one shuts another, so the quest drives the chain itself (defs/familycrest/mine.ts).
            'famcrest_doorh2', 'famcrest_doorh2i2', 'famcrest_doorg2h1',
            'famcrest_doori2h1', 'famcrest_doorh2g1',
            // Fight Arena's cell doors never open, and door1 teleports the player into the arena at stages 9-11 rather than opening.
            // Why: baked as edges the pathfinder routes into a cell it cannot leave, or walks a bot mid-errand into a boss fight.
            'arena_prisondoor', 'arena_jeremydoor', 'fightarena_door1',
            // Clock Tower's rat-cage gate: jail_doors.rs2 answers "This door doesn't seem to open from here..." to anyone outside it, and ctlevera is the way in.
            // Why: its only map placement is the cage at 2595,9657 — Fight Arena's copies are loc_add, which no map derivation sees.
            'ctratgatea',
            // West Ardougne's plague house: loc_2534 answers "This door is locked." to everyone, and loc_2535 opens only for a warrant holder with a mourner in earshot, mid-conversation.
            // Why: baked as edges the pathfinder alternates between the two and crosses neither.
            'loc_2534', 'loc_2535',
            // Why: the mourner headquarters' two doors are locked until the stew is poisoned and then open only to a worn doctor's gown behind an "In you go doc." the walker cannot answer, and baked as edges the route to the cauldron runs through the building — which is the one thing the stage needing the cauldron cannot do. The fence at 2541,3331 is the way in.
            'mournerstewdoor',
            // Shield of Arrav's three hideout doors. Why: the weapon store answers Open with "The door is securely locked" and yields only to an oplocu with the key, while the other two refuse until you have joined and then p_teleport you through — none is an edge the walker can step.
            'phoenixdoor', 'phoenixdoor2', 'blackarmdoor'
        ]);
        const label = `${type.name ?? ''} ${type.debugname ?? ''}`.toLowerCase();
        if (label.includes('locked') || (type.debugname ?? '').startsWith('macro_') || SCRIPT_REFUSED.has(type.debugname ?? '')) {
            lockedSkipped++;
            continue;
        }
        openable.add(id);
    }

    const ONE_WAY_EXCLUDED = new Set([
        '3108,3353,0', '3109,3353,0',
        // Handelmort Mansion's inner door: quest_totem.rs2 opens it only for a player north of it, and everything the mansion holds is reached by Cromperty's block instead.
        // Why: baked both ways the pathfinder treats the mansion as a shortcut and the walker loops on "This door is securely locked"; the outward half is curated in travelCatalog.ts.
        '2635,3321,0',
        // Gu'Tanoth's east gate: the ogre guard demands a bar of gold and teleports you down the hill otherwise, and nothing in the game needs that crossing.
        // Why: its north-west twin is left in — that guard refuses only until the relic is shown, after which the gate behaves as an ordinary door and everything west of it depends on the edge.
        '2549,3028,0', '2550,3028,0'
    ]);
    // Why: gates.rs2 hits loc_add(type=-1) for this Duel Arena outer leaf and leaves Gate#3198 closed, so navigation has to detour through its paired Gate#3197 one tile north.
    const BROKEN_ENGINE_EXCLUDED = new Set(['3198@3312,3235,0']);

    const edges: DoorEdge[] = [];
    const skippedShapes = new Map<string, number>();
    const nameCounts = new Map<string, number>();
    let mapsquares = 0;
    let oneWaySkipped = 0;
    let brokenEngineSkipped = 0;

    for (const { mx, mz, land, loc } of loadMapsquares(opts.engine)) {
        mapsquares++;
        const baseX = mx << 6;
        const baseZ = mz << 6;
        const lands = parseLands(new Reader(land));

        forEachLoc(new Reader(loc), instance => {
            if (!openable.has(instance.locId) || locShapeLayer(instance.shape) !== LocLayer.WALL) {
                return;
            }

            const type = configs[instance.locId];
            const level = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
            if (level < 0) {
                return;
            }

            if (instance.shape !== LocShape.WALL_STRAIGHT) {
                const shapeName = Object.entries(LocShape).find(([, value]) => value === instance.shape)?.[0] ?? `${instance.shape}`;
                skippedShapes.set(shapeName, (skippedShapes.get(shapeName) ?? 0) + 1);
                return;
            }

            if (ONE_WAY_EXCLUDED.has(`${baseX + instance.x},${baseZ + instance.z},${level}`)) {
                oneWaySkipped++;
                return;
            }
            if (BROKEN_ENGINE_EXCLUDED.has(`${instance.locId}@${baseX + instance.x},${baseZ + instance.z},${level}`)) {
                brokenEngineSkipped++;
                return;
            }
            const locName = type.name ?? type.debugname ?? `loc_${instance.locId}`;
            edges.push({
                x: baseX + instance.x,
                z: baseZ + instance.z,
                level,
                locId: instance.locId,
                locName,
                dir: ANGLE_DIR[instance.angle]
            });
            nameCounts.set(locName, (nameCounts.get(locName) ?? 0) + 1);
        });
    }

    edges.sort((a, b) => a.level - b.level || a.x - b.x || a.z - b.z || a.locId - b.locId);

    const json = '[\n' + edges.map(edge => '    ' + JSON.stringify(edge)).join(',\n') + '\n]\n';
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, json);

    console.log(`openable wall loc types: ${openable.size} (skipped ${lockedSkipped} locked/macro types, ${oneWaySkipped} one-way instances -> curated transports, ${brokenEngineSkipped} broken Engine instances)`);
    console.log(`mapsquares scanned: ${mapsquares}`);
    console.log(`door edges derived: ${edges.length} -> ${opts.out}`);
    console.log('by name:');
    for (const [name, count] of [...nameCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}\t${name}`);
    }
    if (skippedShapes.size > 0) {
        console.log('skipped non-straight wall shapes with Open op:');
        for (const [shape, count] of skippedShapes) {
            console.log(`  ${count}\t${shape}`);
        }
    }

    const expect: [number, number, string][] = [
        [3236, 3296, 'E'],
        [3236, 3295, 'E'],
        [3208, 3211, 'N']
    ];
    for (const [x, z, dir] of expect) {
        const hit = edges.find(edge => edge.x === x && edge.z === z && edge.level === 0);
        const ok = hit && hit.dir === dir;
        console.log(`${ok ? 'PASS' : 'FAIL'}  expected ${dir}-edge at (${x},${z},0): ${hit ? `${hit.locName} dir=${hit.dir}` : 'missing'}`);
        if (!ok) {
            process.exitCode = 1;
        }
    }
}

main();
