import type { NavPoint } from '#/bot/nav/PathFinder.js';
import type { ClueRow, ClueType } from '#/bot/clues/types.js';

import { decodeCoord } from '../nav/stairsParse.js';

export type { ClueRow, ClueType } from '#/bot/clues/types.js';

export interface ParsedClueObj {
    coord?: string;
    loc?: string;
    casket?: string;
    desc?: string;
    sextant?: string;
}

export interface TalkMapping {
    obj: string;
    npc: string;
}

export interface BuildInput {
    clueNames: string[];
    objs: Record<string, ParsedClueObj>;
    objIds: Map<string, number>;
    talk: TalkMapping[];
    npcDisplay: Map<string, string>;
    specials?: Record<string, { type: ClueType; coord: NavPoint }>;
    killForKey?: Record<string, { npc: string; keyObj: string; keyId: number }>;
}

export interface ClueDb {
    db: Record<number, ClueRow>;
    caskets: Record<number, string>;
}

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

const OPNPC_RE = /^\[opnpc\d+,([a-z0-9_]+)\]/;
const progressRe = (tier: 'easy' | 'medium'): RegExp => new RegExp(`~progress_clue_${tier}\\(\\s*(trail_clue_${tier}_[a-z0-9]+)`);

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

export function parseKillForKey(scriptText: string): Record<string, { npc: string; keyObj: string }> {
    const out: Record<string, { npc: string; keyObj: string }> = {};
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

        const kfk = input.killForKey?.[obj];
        if (kfk) {
            row.keyFrom = { npc: kfk.npc, keyObj: kfk.keyObj, keyId: kfk.keyId };
        }

        db[id] = row;
    }

    return { db, caskets };
}
