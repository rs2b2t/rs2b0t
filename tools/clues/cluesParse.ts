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
    sextant?: string; // medium `trail_sextant,yes` — the engine's coordinate-clue flag
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
    specials?: Record<string, { type: ClueType; coord: NavPoint }>; // e.g. vague003, medium key-chest riddles
    /** riddleObj → { npcDisplay, keyObj, keyId } — the medium kill-for-key rows.
     *  Enriches the (search-classified) riddle with the NPC to kill for its key. */
    killForKey?: Record<string, { npc: string; keyObj: string; keyId: number }>;
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
            desc: param(b.lines, 'trail_desc'),
            sextant: param(b.lines, 'trail_sextant')
        };
    }
    return out;
}

// [opnpc<digits>,<debugname>] — the op number must be numeric so [opnpcu,...]
// (use-item handlers) are ignored; no trailing anchor, since some blocks put the
// handler body on the same line (`[opnpc1,x] @label;`).
const OPNPC_RE = /^\[opnpc\d+,([a-z0-9_]+)\]/;
const progressRe = (tier: 'easy' | 'medium'): RegExp => new RegExp(`~progress_clue_${tier}\\(\\s*(trail_clue_${tier}_[a-z0-9]+)`);

/**
 * Scan one .rs2 file for tier-clue completions. Each
 * `~progress_clue_<tier>(trail_clue_<tier>_<id>, ...)` call is attributed to the
 * nearest preceding `[opnpc<N>,<npc>]` block — the call itself usually lives in
 * a `[label,...]` reached from that handler. Calls with no preceding opnpc block
 * are skipped (e.g. the medium riddle key-chest completions, whose progress
 * calls sit in `trail_clue_medium.rs2` labels with no opnpc — those are search
 * clues, not talk).
 */
export function parseTalkMappings(scriptText: string, tier: 'easy' | 'medium' = 'easy'): TalkMapping[] {
    const re = progressRe(tier);
    const out: TalkMapping[] = [];
    let npc = '';
    for (const raw of scriptText.split('\n')) {
        const line = raw.trim();
        const h = OPNPC_RE.exec(line);
        if (h) {
            npc = h[1];
        }
        const c = re.exec(line);
        if (c && npc) {
            out.push({ obj: c[1], npc });
        }
    }
    return out;
}

/**
 * Parse trail_clue_medium.rs2's `trail_checkmediumdrop`: each branch ties a
 * riddle obj to the NPC whose death drops its `_key`. Returns riddleObj →
 * { npc, keyObj }. `npc` is the content token (npc_type/npc_category debugname)
 * or the quoted npc_name (e.g. "Man"); the generator maps it to a display name.
 */
export function parseKillForKey(scriptText: string): Record<string, { npc: string; keyObj: string }> {
    const out: Record<string, { npc: string; keyObj: string }> = {};
    // e.g.  npc_type = black_heather ... inv_total(inv, trail_clue_medium_riddle001) ...
    //  or   compare(npc_name, "Man") ... inv_total(inv, trail_clue_medium_riddle005) ...
    const branch = /(?:npc_type|npc_category)\s*=\s*([a-z0-9_]+)[\s\S]*?(trail_clue_medium_riddle\d+)|compare\(npc_name,\s*"([^"]+)"\)[\s\S]*?(trail_clue_medium_riddle\d+)/g;
    for (const m of scriptText.matchAll(branch)) {
        const riddle = m[2] ?? m[4];
        const npc = m[1] ?? m[3];
        if (riddle && npc) {
            out[riddle] = { npc, keyObj: `${riddle}_key` };
        }
    }
    return out;
}

/**
 * The 6 medium "challenge" anagrams (those with a paired `_challenge` scroll)
 * complete via `trail_challengenpc_prompt(..., $clue, $challenge)` — the proc
 * receives `$clue` as a variable, so the clue obj never appears in a literal
 * `progress_clue_medium(<obj>, ...)` call and parseTalkMappings can't see them.
 * Attribute each such clue to the opnpc that gates on holding it
 * (`inv_total(inv, <clue>)`) — a signal present in every anagram handler and
 * robust to the gnome-ball referee shape where the prompt label precedes the
 * opnpc. Files with no `_challenge` scroll (the 14 direct-progress anagrams)
 * return nothing here.
 */
export function parseChallengeTalk(scriptText: string): TalkMapping[] {
    const challenge = new Set([...scriptText.matchAll(/(trail_clue_medium_anagram\d+)_challenge/g)].map(m => m[1]));
    if (challenge.size === 0) {
        return [];
    }
    const gate = /inv_total\(inv,\s*(trail_clue_medium_anagram\d+)\)/;
    const out: TalkMapping[] = [];
    let npc = '';
    for (const raw of scriptText.split('\n')) {
        const line = raw.trim();
        const h = OPNPC_RE.exec(line);
        if (h) {
            npc = h[1];
        }
        const g = gate.exec(line);
        if (g && npc && challenge.has(g[1])) {
            out.push({ obj: g[1], npc });
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
            // medium sextant clues (`trail_sextant,yes`) need sextant+watch+chart
            // held before the dig yields the casket.
            if (parsed.sextant === 'yes') {
                row.needsSextant = true;
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

        // medium kill-for-key riddles are search rows (coord supplied via
        // `specials`, since the config carries no trail_coord); tag the NPC whose
        // death drops the chest key.
        const kfk = input.killForKey?.[obj];
        if (kfk) {
            row.keyFrom = { npc: kfk.npc, keyObj: kfk.keyObj, keyId: kfk.keyId };
        }

        db[id] = row;
    }

    return { db, caskets };
}
