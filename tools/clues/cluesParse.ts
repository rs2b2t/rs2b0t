/**
 * Pure parsers for the easy-clue answer DB, over the 2004scape content pack's
 * game_trail configs + the NPC-handler scripts. Client-free and IO-free: the
 * generator (gen-cluedb.ts) does the file IO and resolves obj ids / npc display
 * names from the pack, then feeds the text and lookups in here.
 *
 * Sources (rs2b2t-content):
 *   trail_easy.enum : `val=<idx>,<objName>`  — the 66 easy-clue objs, in order.
 *   trail_easy.obj  : `[objName]` blocks with `param=trail_coord,<coord>`,
 *                     `param=trail_loc,^true` (search) and
 *                     `param=trail_casket,<casketObj>` (dig).
 *   scripts/**.rs2  : `[opnpc<N>,<npc>]` handlers whose body reaches a
 *                     `~progress_clue_easy(trail_clue_easy_<id>, ...)` (talk).
 *
 * Classification (buildClueDb): dig if trail_casket, else search if
 * trail_loc=^true, else talk — one type per clue. `vague003` has no coord in
 * the config; the generator passes it in as a `specials` search-loc override.
 */
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import type { ClueRow, ClueType } from '#/bot/clues/types.js';

import { decodeCoord } from '../nav/stairsParse.js';

export type { ClueRow, ClueType } from '#/bot/clues/types.js';

/** Raw params of one clue obj block; coord is left as the level_mx_mz_lx_lz
 *  literal for buildClueDb to decode. */
export interface ParsedClueObj {
    coord?: string;
    loc?: string;
    casket?: string;
    desc?: string;
}

/** A talk clue → the debugname of the opnpc block that completes it. */
export interface TalkMapping {
    obj: string; // full obj name, e.g. trail_clue_easy_simple021
    npc: string; // opnpc block debugname, e.g. ned
}

export interface BuildInput {
    clueNames: string[]; // parseEnum result — the objs to emit
    objs: Record<string, ParsedClueObj>; // parseClueObjs result
    objIds: Map<string, number>; // objName → id (obj.pack), covers caskets too
    talk: TalkMapping[]; // parseTalkMappings result (obj → debugname)
    npcDisplay: Map<string, string>; // debugname → display name (npc configs)
    specials?: Record<string, { type: ClueType; coord: NavPoint }>; // e.g. vague003
}

export interface ClueDb {
    db: Record<number, ClueRow>; // keyed by obj id
    caskets: Record<number, string>; // casket obj id → casket obj name
}

// --- block parser (mirrors tools/shops/parse.ts) ---

interface Block {
    id: string;
    lines: string[];
}

function blocks(text: string): Block[] {
    const out: Block[] = [];
    let cur: Block | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const head = /^\[([a-z0-9_]+)\]$/.exec(line);
        if (head) {
            cur = { id: head[1], lines: [] };
            out.push(cur);
        } else if (cur && line.length > 0 && !line.startsWith('//')) {
            cur.lines.push(line);
        }
    }
    return out;
}

function param(lines: string[], key: string): string | undefined {
    const prefix = `param=${key},`;
    return lines.find(l => l.startsWith(prefix))?.slice(prefix.length);
}

/** `val=<idx>,<objName>` → array indexed by enum val. */
export function parseEnum(text: string): string[] {
    const out: string[] = [];
    for (const raw of text.split('\n')) {
        const m = /^val=(\d+),(\S+)$/.exec(raw.trim());
        if (m) {
            out[Number(m[1])] = m[2];
        }
    }
    return out;
}

/** `[objName]` blocks → their trail_* params (coord/loc/casket/desc). */
export function parseClueObjs(text: string): Record<string, ParsedClueObj> {
    const out: Record<string, ParsedClueObj> = {};
    for (const b of blocks(text)) {
        out[b.id] = {
            coord: param(b.lines, 'trail_coord'),
            loc: param(b.lines, 'trail_loc'),
            casket: param(b.lines, 'trail_casket'),
            desc: param(b.lines, 'trail_desc')
        };
    }
    return out;
}

// [opnpc<digits>,<debugname>] — the op number must be numeric so [opnpcu,...]
// (use-item handlers) are ignored; no trailing anchor, since some blocks put the
// handler body on the same line (`[opnpc1,x] @label;`).
const OPNPC_RE = /^\[opnpc\d+,([a-z0-9_]+)\]/;
const PROGRESS_RE = /~progress_clue_easy\(\s*(trail_clue_easy_[a-z0-9]+)/;

/**
 * Scan one .rs2 file for easy-clue completions. Each
 * `~progress_clue_easy(trail_clue_easy_<id>, ...)` call is attributed to the
 * nearest preceding `[opnpc<N>,<npc>]` block — the call itself usually lives in
 * a `[label,...]` reached from that handler. Calls with no preceding opnpc block
 * are skipped.
 */
export function parseTalkMappings(scriptText: string): TalkMapping[] {
    const out: TalkMapping[] = [];
    let npc = '';
    for (const raw of scriptText.split('\n')) {
        const line = raw.trim();
        const h = OPNPC_RE.exec(line);
        if (h) {
            npc = h[1];
        }
        const c = PROGRESS_RE.exec(line);
        if (c && npc) {
            out.push({ obj: c[1], npc });
        }
    }
    return out;
}

/**
 * Join the parsed enum + obj blocks + talk mappings + id/name lookups into the
 * id-keyed answer DB. Throws on any clue that can't be resolved (missing id,
 * missing block, talk clue with no handler) so gaps fail the generator loudly.
 */
export function buildClueDb(input: BuildInput): ClueDb {
    const talkByObj = new Map(input.talk.map(t => [t.obj, t.npc]));
    const db: Record<number, ClueRow> = {};
    const caskets: Record<number, string> = {};

    for (const obj of input.clueNames) {
        if (!obj) {
            continue;
        }
        const id = input.objIds.get(obj);
        if (id === undefined) {
            throw new Error(`no obj id for ${obj}`);
        }
        const parsed = input.objs[obj];
        if (!parsed) {
            throw new Error(`no obj block for ${obj}`);
        }

        const special = input.specials?.[obj];
        const row: ClueRow = { obj, id, type: 'talk' };

        if (special) {
            row.type = special.type;
            row.coord = special.coord;
        } else if (parsed.casket) {
            row.type = 'dig';
            row.casketObj = parsed.casket;
            const cid = input.objIds.get(parsed.casket);
            if (cid === undefined) {
                throw new Error(`no casket id for ${parsed.casket}`);
            }
            row.casketId = cid;
            caskets[cid] = parsed.casket;
            if (parsed.coord) {
                row.coord = decodeCoord(parsed.coord);
            }
        } else if (parsed.loc === '^true') {
            row.type = 'search';
            if (parsed.coord) {
                row.coord = decodeCoord(parsed.coord);
            }
        } else {
            row.type = 'talk';
            const dbg = talkByObj.get(obj);
            if (dbg === undefined) {
                throw new Error(`talk clue ${obj} has no NPC handler mapping`);
            }
            const display = input.npcDisplay.get(dbg);
            if (display === undefined) {
                throw new Error(`no display name for npc debugname ${dbg} (clue ${obj})`);
            }
            row.npc = display;
        }

        db[id] = row;
    }

    return { db, caskets };
}
