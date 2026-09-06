// Decode every loc, obj, npc and seq in a client config archive with STRICT_CONFIG on,
// so an opcode our decoders do not know throws instead of silently misaligning the
// reader. A revision bump is exactly when a new config opcode appears, and a desync in
// one entry corrupts every entry after it in the same stream.
//
//   STRICT_CONFIG=1 bun tools/config-audit.ts --config /tmp/pack/client/config

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

// Loc, Obj and Npc decode lazily in list(id), so every id has to be visited to force the
// read. SeqType decodes eagerly in init and exposes list as a plain array, so reaching
// this line at all means its whole stream already decoded.
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
