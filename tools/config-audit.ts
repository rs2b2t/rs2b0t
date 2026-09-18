// Why: an unknown config opcode desyncs every entry after it, so decode every entry under STRICT_CONFIG=1.

import { readFileSync } from 'node:fs';

import LocType from '../src/client/config/LocType.js';
import NpcType from '../src/client/config/NpcType.js';
import ObjType from '../src/client/config/ObjType.js';
import SeqType from '../src/client/config/SeqType.js';
import JagFile from '../src/client/io/JagFile.js';

const idx = process.argv.indexOf('--config');
if (idx === -1) {
    console.error('usage: bun tools/config-audit.ts --config <path-to-config-jag>');
    process.exit(2);
}

const jag = new JagFile(new Uint8Array(readFileSync(process.argv[idx + 1])));

LocType.init(jag);
ObjType.init(jag, true);
NpcType.init(jag);
SeqType.init(jag);

let failures = 0;

// Loc/obj/npc decode lazily in list(id); seq decodes eagerly in init, so every id must be visited.
const families: [string, number, (id: number) => unknown][] = [
    ['loc', LocType.numDefinitions, id => LocType.list(id)],
    ['obj', ObjType.numDefinitions, id => ObjType.list(id)],
    ['npc', NpcType.numDefinitions, id => NpcType.list(id)]
];

for (const [name, count, get] of families) {
    for (let id = 0; id < count; id++) {
        try {
            get(id);
        } catch (err) {
            console.error(`${name} ${id}: ${(err as Error).message}`);
            failures++;
        }
    }
    console.log(`${name}: ${count} decoded`);
}

console.log(`seq: ${SeqType.numDefinitions} decoded eagerly in init`);
console.log(failures === 0 ? 'CONFIG AUDIT CLEAN' : `CONFIG AUDIT FAILED: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
