// Shared offline nav-tooling pieces (Slice 5): the minimal byte reader,
// jagfile reader, LocType decoder and mapsquare enumeration that both
// build-collision.ts and derive-doors.ts replay from Engine-TS@274.
//
// Everything here mirrors engine semantics exactly (src/io/Packet.ts,
// src/io/Jagfile.ts, src/cache/config/LocType.ts, src/engine/GameMap.ts);
// deviations are bugs.

import fs from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';

import { bunzip2 } from '#/io/BZip2.js';

// ---- minimal big-endian byte reader (Engine-TS@274 src/io/Packet.ts semantics) ----

export class Reader {
    readonly data: Uint8Array;
    readonly view: DataView;
    pos = 0;

    constructor(data: Uint8Array) {
        this.data = data;
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    get available(): number {
        return this.view.byteLength - this.pos;
    }

    g1(): number {
        return this.view.getUint8(this.pos++);
    }

    g1b(): number {
        return this.view.getInt8(this.pos++);
    }

    g2(): number {
        const result: number = this.view.getUint16(this.pos);
        this.pos += 2;
        return result;
    }

    g2s(): number {
        const result: number = this.view.getInt16(this.pos);
        this.pos += 2;
        return result;
    }

    g3(): number {
        this.pos += 3;
        return (this.data[this.pos - 3] << 16) + (this.data[this.pos - 2] << 8) + this.data[this.pos - 1];
    }

    g4s(): number {
        const result: number = this.view.getInt32(this.pos);
        this.pos += 4;
        return result;
    }

    gbool(): boolean {
        return this.g1() === 1;
    }

    gjstr(terminator: number = 10): string {
        const length: number = this.view.byteLength;
        let str: string = '';
        let b: number;
        while ((b = this.view.getUint8(this.pos++)) !== terminator && this.pos < length) {
            str += String.fromCharCode(b);
        }
        return str;
    }

    // 1-or-2-byte smart: first byte < 0x80 reads u8, else u16 - 0x8000
    gsmarts(): number {
        return this.view.getUint8(this.pos) < 0x80 ? this.g1() : this.g2() - 0x8000;
    }
}

// ---- minimal jagfile reader (Engine-TS@274 src/io/Jagfile.ts semantics) ----
// Needed only to pull loc.dat out of the client config archive; per-file
// streams are headerless bzip2 (decompressed with the client's own bunzip2).

export class JagArchive {
    private readonly data: Uint8Array;
    private readonly compressWhole: boolean;
    private readonly fileHash: number[] = [];
    private readonly filePackedSize: number[] = [];
    private readonly filePos: number[] = [];

    constructor(src: Uint8Array) {
        let reader = new Reader(src);
        const unpackedSize: number = reader.g3();
        const packedSize: number = reader.g3();

        if (unpackedSize === packedSize) {
            this.data = src;
            this.compressWhole = false;
        } else {
            // whole-archive compression: re-read the table from the decompressed stream
            this.data = bunzip2(src.subarray(6));
            reader = new Reader(this.data);
            this.compressWhole = true;
        }

        const fileCount: number = reader.g2();
        let pos: number = reader.pos + fileCount * 10;
        for (let i: number = 0; i < fileCount; i++) {
            this.fileHash[i] = reader.g4s();
            reader.g3(); // unpacked size
            this.filePackedSize[i] = reader.g3();
            this.filePos[i] = pos;
            pos += this.filePackedSize[i];
        }
    }

    static genHash(name: string): number {
        let hash: number = 0;
        name = name.toUpperCase();
        for (let i: number = 0; i < name.length; i++) {
            hash = (hash * 61 + name.charCodeAt(i) - 32) | 0;
        }
        return hash;
    }

    read(name: string): Uint8Array | null {
        const hash: number = JagArchive.genHash(name);
        const index: number = this.fileHash.indexOf(hash);
        if (index === -1) {
            return null;
        }
        const src: Uint8Array = this.data.subarray(this.filePos[index], this.filePos[index] + this.filePackedSize[index]);
        return this.compressWhole ? src : bunzip2(src);
    }
}

// ---- minimal LocType decoder (Engine-TS@274 src/cache/config/LocType.ts) ----
// Decodes only what nav tooling needs (width, length, blockwalk, blockrange,
// active, name, ops — plus models/shapes for the active postDecode rule);
// every other opcode is consumed per the format and discarded.

export class LocDef {
    models: Uint16Array | null = null;
    shapes: Uint8Array | null = null;
    name: string | null = null;
    width = 1;
    length = 1;
    blockwalk = true;
    blockrange = true;
    active = -1;
    op: (string | null)[] | null = null;
    debugname: string | null = null;

    decodeType(dat: Reader): void {
        while (dat.available > 0) {
            const code: number = dat.g1();
            if (code === 0) {
                break;
            }
            this.decode(code, dat);
        }
    }

    private decode(code: number, dat: Reader): void {
        if (code === 1) {
            const count = dat.g1();
            this.models = new Uint16Array(count);
            this.shapes = new Uint8Array(count);
            for (let i = 0; i < count; i++) {
                this.models[i] = dat.g2();
                this.shapes[i] = dat.g1();
            }
        } else if (code === 2) {
            this.name = dat.gjstr();
        } else if (code === 3) {
            dat.gjstr(); // desc
        } else if (code === 5) {
            const count = dat.g1();
            this.models = new Uint16Array(count);
            this.shapes = null;
            for (let i = 0; i < count; i++) {
                this.models[i] = dat.g2();
            }
        } else if (code === 14) {
            this.width = dat.g1();
        } else if (code === 15) {
            this.length = dat.g1();
        } else if (code === 17) {
            this.blockwalk = false;
        } else if (code === 18) {
            this.blockrange = false;
        } else if (code === 19) {
            this.active = dat.g1();
        } else if (code === 21 || code === 22 || code === 23 || code === 25 || code === 62 || code === 64 || code === 73 || code === 74) {
            // hillskew / sharelight / occlude / hasalpha / mirror / !shadow / forcedecor / breakroutefinding
        } else if (code === 24 || code === 60 || code === 61 || code === 65 || code === 66 || code === 67 || code === 68) {
            dat.g2(); // anim / mapfunction / category / resizex/y/z / mapscene
        } else if (code === 28 || code === 69 || code === 75) {
            dat.g1(); // wallwidth / forceapproach / raiseobject
        } else if (code === 29 || code === 39) {
            dat.g1b(); // ambient / contrast
        } else if (code >= 30 && code < 35) {
            if (!this.op) {
                this.op = new Array(5).fill(null);
            }
            this.op[code - 30] = dat.gjstr();
        } else if (code === 40) {
            const count = dat.g1();
            for (let i = 0; i < count; i++) {
                dat.g2(); // recol_s
                dat.g2(); // recol_d
            }
        } else if (code === 70 || code === 71 || code === 72) {
            dat.g2s(); // offsetx / offsety / offsetz
        } else if (code === 249) {
            const count = dat.g1();
            for (let i = 0; i < count; i++) {
                dat.g3(); // param id
                if (dat.gbool()) {
                    dat.gjstr();
                } else {
                    dat.g4s();
                }
            }
        } else if (code === 250) {
            this.debugname = dat.gjstr();
        } else {
            throw new Error(`Unrecognized loc config code: ${code} (packed data out of sync?)`);
        }
    }

    postDecode(): void {
        if (this.active === -1) {
            this.active = 0;
            if (this.models && (!this.shapes || (this.shapes && this.shapes[0] === 10))) {
                this.active = 1;
            }
            if (this.op !== null) {
                this.active = 1;
            }
        }
    }
}

export function loadLocTypes(engineDir: string): { configs: LocDef[]; names: Map<string, number> } {
    const server = new Reader(new Uint8Array(fs.readFileSync(path.join(engineDir, 'data/pack/server/loc.dat'))));
    const jag = new JagArchive(new Uint8Array(fs.readFileSync(path.join(engineDir, 'data/pack/client/config'))));
    const clientDat = jag.read('loc.dat');
    if (!clientDat) {
        throw new Error('loc.dat missing from client config archive');
    }
    const client = new Reader(clientDat);

    const count = server.g2();
    client.pos = 2;

    const configs: LocDef[] = [];
    const names = new Map<string, number>();
    for (let id = 0; id < count; id++) {
        const config = new LocDef();
        config.decodeType(server);
        config.decodeType(client);
        config.postDecode();
        configs[id] = config;
        if (config.debugname) {
            names.set(config.debugname, id);
        }
    }
    return { configs, names };
}

// ---- map data (Engine-TS@274 src/engine/GameMap.ts collision parts) ----

export const OPEN = 0x0;
export const BLOCK_MAP_SQUARE = 0x1;
export const LINK_BELOW = 0x2;
export const REMOVE_ROOFS = 0x4;

export const LEVELS = 4;
export const MAP_X = 64;
export const MAP_Z = 64;
export const MAPSQUARE = MAP_X * LEVELS * MAP_Z;

// ZoneMap.zoneIndex (src/engine/zone/ZoneMap.ts)
export function zoneIndex(x: number, z: number, level: number): number {
    return ((x >> 3) & 0x7ff) | (((z >> 3) & 0x7ff) << 11) | ((level & 0x3) << 22);
}

export function packCoord(x: number, z: number, level: number): number {
    return (z & 0x3f) | ((x & 0x3f) << 6) | ((level & 0x3) << 12);
}

export function unpackCoord(packed: number): { x: number; z: number; level: number } {
    const z: number = packed & 0x3f;
    const x: number = (packed >> 6) & 0x3f;
    const level: number = (packed >> 12) & 0x3;
    return { x, z, level };
}

export interface MapsquareData {
    mx: number;
    mz: number;
    land: Uint8Array;
    loc: Uint8Array;
}

/** Every packed mapsquare, zip cache first like the engine, sorted by mx,mz. */
export function loadMapsquares(engineDir: string): MapsquareData[] {
    const squares: MapsquareData[] = [];
    const zipPath = path.join(engineDir, 'data/pack/.cache/maps-server.zip');
    const dirPath = path.join(engineDir, 'data/pack/server/maps');

    if (fs.existsSync(zipPath)) {
        const mapEntries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
        for (const name of Object.keys(mapEntries).filter(entry => entry[0] === 'm')) {
            const [mx, mz] = name.substring(1).split('_').map(Number);
            squares.push({ mx, mz, land: mapEntries[`m${mx}_${mz}`], loc: mapEntries[`l${mx}_${mz}`] });
        }
    } else if (fs.existsSync(dirPath)) {
        for (const name of fs.readdirSync(dirPath).filter(entry => entry[0] === 'm')) {
            const [mx, mz] = name.substring(1).split('_').map(Number);
            squares.push({
                mx,
                mz,
                land: new Uint8Array(fs.readFileSync(path.join(dirPath, `m${mx}_${mz}`))),
                loc: new Uint8Array(fs.readFileSync(path.join(dirPath, `l${mx}_${mz}`)))
            });
        }
    } else {
        throw new Error(`no maps found (looked at ${zipPath} and ${dirPath})`);
    }

    squares.sort((a, b) => a.mx - b.mx || a.mz - b.mz);
    return squares;
}

/**
 * First pass of GameMap.loadGround: walk the land opcode stream and collect
 * the per-tile flag bytes (BLOCK_MAP_SQUARE/LINK_BELOW/REMOVE_ROOFS),
 * indexed by packCoord.
 */
export function parseLands(packet: Reader): Int8Array {
    const lands = new Int8Array(MAPSQUARE);
    for (let level: number = 0; level < LEVELS; level++) {
        for (let x: number = 0; x < MAP_X; x++) {
            for (let z: number = 0; z < MAP_Z; z++) {
                while (true) {
                    const opcode: number = packet.g1();
                    if (opcode === 0) {
                        break;
                    } else if (opcode === 1) {
                        packet.pos++;
                        break;
                    }

                    if (opcode <= 49) {
                        packet.pos++;
                    } else if (opcode <= 81) {
                        lands[packCoord(x, z, level)] = opcode - 49;
                    }
                }
            }
        }
    }
    return lands;
}

export interface LocInstance {
    locId: number;
    /** mapsquare-local coords + raw (pre-bridge) level */
    x: number;
    z: number;
    level: number;
    /** packed coord (packCoord of x,z,level) for lands[] lookups */
    coord: number;
    shape: number;
    angle: number;
}

/** Walk a loc stream (GameMap.loadLocations encoding) instance by instance. */
export function forEachLoc(packet: Reader, cb: (loc: LocInstance) => void): void {
    let locId: number = -1;
    let locIdOffset: number = packet.gsmarts();
    while (locIdOffset !== 0) {
        locId += locIdOffset;

        let coord: number = 0;
        let coordOffset: number = packet.gsmarts();

        while (coordOffset !== 0) {
            const { x, z, level } = unpackCoord((coord += coordOffset - 1));

            const info: number = packet.g1();
            coordOffset = packet.gsmarts();

            cb({ locId, x, z, level, coord, shape: info >> 2, angle: info & 0x3 });
        }
        locIdOffset = packet.gsmarts();
    }
}

/**
 * GameMap's bridge adjustment: a tile flagged LINK_BELOW on level 1 renders
 * its level-1 content on level 0 and shifts everything above down one level.
 * Returns the effective level, or -1 when the content vanishes (level 0 under
 * a bridge).
 */
export function bridgedLevel(lands: Int8Array, coord: number, x: number, z: number, level: number): number {
    const bridged: boolean = (level === 1 ? lands[coord] & LINK_BELOW : lands[packCoord(x, z, 1)] & LINK_BELOW) === LINK_BELOW;
    return bridged ? level - 1 : level;
}
