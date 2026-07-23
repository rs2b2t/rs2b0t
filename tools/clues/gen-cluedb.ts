import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { NavPoint } from '#/bot/nav/PathFinder.js';

import { decodeCoord } from '../nav/stairsParse.js';
import { buildClueDb, parseChallengeTalk, parseClueObjs, parseEnum, parseKillForKey, parseTalkMappings, type ClueType, type TalkMapping } from './cluesParse.js';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const OUT = 'src/bot/clues/data/cluedb.ts';
const TRAIL = join(CONTENT, 'scripts', 'minigames', 'game_trail', 'configs');
const MEDIUM_SCRIPT = join(CONTENT, 'scripts', 'minigames', 'game_trail', 'scripts', 'medium', 'trail_clue_medium.rs2');

const VAGUE003_COORD = '1_40_51_14_62';

const RIDDLE_KEY_COORDS: Record<string, string> = {
    trail_clue_medium_riddle001: '0_50_54_56_31',
    trail_clue_medium_riddle002: '1_40_51_14_62',
    trail_clue_medium_riddle003: '1_40_51_51_60',
    trail_clue_medium_riddle004: '0_42_54_21_22',
    trail_clue_medium_riddle005: '1_40_48_33_36',
    trail_clue_medium_riddle007: '1_43_49_57_29',
    trail_clue_medium_riddle008: '0_45_55_41_57'
};

const NPC_ALIAS: Record<string, string> = { _sailor: 'captain_tobias' };

function filesUnder(root: string, ext: string): string[] {
    return (readdirSync(root, { recursive: true }) as string[])
        .filter(f => f.endsWith(ext))
        .map(f => join(root, f))
        .sort();
}

function loadObjIds(): Map<string, number> {
    const text = readFileSync(join(CONTENT, 'pack', 'obj.pack'), 'utf8');
    const out = new Map<string, number>();
    for (const raw of text.split('\n')) {
        const m = /^(\d+)=(\S+)$/.exec(raw.trim());
        if (m) {
            out.set(m[2], Number(m[1]));
        }
    }
    return out;
}

function loadNpcDisplayNames(): Map<string, string> {
    const files = filesUnder(join(CONTENT, 'scripts'), '.npc');
    const unpack = files.filter(f => f.includes('/_unpack/'));
    const canonical = files.filter(f => !f.includes('/_unpack/'));
    const names = new Map<string, string>();
    for (const f of [...unpack, ...canonical]) {
        let cur: string | null = null;
        for (const raw of readFileSync(f, 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-z0-9_]+)\]$/.exec(line);
            if (head) {
                cur = head[1];
            } else if (cur && line.startsWith('name=')) {
                names.set(cur, line.slice('name='.length));
            }
        }
    }
    for (const [from, to] of Object.entries(NPC_ALIAS)) {
        const display = names.get(to);
        if (display !== undefined) {
            names.set(from, display);
        }
    }
    return names;
}

function generate(): string {
    const objIds = loadObjIds();
    const npcDisplay = loadNpcDisplayNames();
    const rs2Files = filesUnder(join(CONTENT, 'scripts'), '.rs2');

    const easyTalk: TalkMapping[] = rs2Files.flatMap(f => parseTalkMappings(readFileSync(f, 'utf8'), 'easy'));
    const easy = buildClueDb({
        clueNames: parseEnum(readFileSync(join(TRAIL, 'trail_easy.enum'), 'utf8')),
        objs: parseClueObjs(readFileSync(join(TRAIL, 'trail_easy.obj'), 'utf8')),
        objIds,
        talk: easyTalk,
        npcDisplay,
        specials: { trail_clue_easy_vague003: { type: 'search', coord: decodeCoord(VAGUE003_COORD) } }
    });

    const mediumTalk: TalkMapping[] = rs2Files.flatMap(f => {
        const text = readFileSync(f, 'utf8');
        return [...parseTalkMappings(text, 'medium'), ...parseChallengeTalk(text)];
    });
    const killForKey: Record<string, { npc: string; keyObj: string; keyId: number }> = {};
    const riddleSpecials: Record<string, { type: ClueType; coord: NavPoint }> = {};
    for (const [riddle, { npc, keyObj }] of Object.entries(parseKillForKey(readFileSync(MEDIUM_SCRIPT, 'utf8')))) {
        const keyId = objIds.get(keyObj);
        if (keyId === undefined) {
            throw new Error(`no obj id for ${keyObj}`);
        }
        const coord = RIDDLE_KEY_COORDS[riddle];
        if (coord === undefined) {
            throw new Error(`no key-chest coord for ${riddle} (add to RIDDLE_KEY_COORDS)`);
        }
        killForKey[riddle] = { npc: npcDisplay.get(npc) ?? npc, keyObj, keyId };
        riddleSpecials[riddle] = { type: 'search', coord: decodeCoord(coord) };
    }
    const medium = buildClueDb({
        clueNames: parseEnum(readFileSync(join(TRAIL, 'trail_medium.enum'), 'utf8')),
        objs: parseClueObjs(readFileSync(join(TRAIL, 'trail_medium.obj'), 'utf8')),
        objIds,
        talk: mediumTalk,
        npcDisplay,
        specials: riddleSpecials,
        killForKey
    });

    const db = { ...easy.db, ...medium.db };
    const caskets = { ...easy.caskets, ...medium.caskets };

    const ids = Object.keys(db).map(Number).sort((a, b) => a - b);
    const talkCount = ids.filter(id => db[id].type === 'talk').length;
    const sextantCount = ids.filter(id => db[id].needsSextant).length;
    const keyCount = ids.filter(id => db[id].keyFrom).length;
    console.log(`clues=${ids.length} talk=${talkCount} caskets=${Object.keys(caskets).length} sextant=${sextantCount} keyfor=${keyCount}`);

    const clueLines = ids.map(id => `    ${id}: ${JSON.stringify(db[id])}`);
    const casketLines = Object.keys(caskets)
        .map(Number)
        .sort((a, b) => a - b)
        .map(id => `    ${id}: ${JSON.stringify(caskets[id])}`);

    return [
        '/* eslint-disable */',
        '// GENERATED by tools/clues/gen-cluedb.ts — do not edit.',
        '// Regenerate: bun tools/clues/gen-cluedb.ts   (drift gate: --check)',
        "import type { ClueRow } from '#/bot/clues/types.js';",
        '',
        'export const CLUE_DB: Record<number, ClueRow> = {',
        clueLines.join(',\n'),
        '};',
        '',
        '// casket obj id → casket obj name; lets the solver recognise a held casket.',
        'export const CASKET_IDS: Record<number, string> = {',
        casketLines.join(',\n'),
        '};',
        ''
    ].join('\n');
}

const fresh = generate();
if (process.argv.includes('--check')) {
    let current = '';
    try {
        current = readFileSync(OUT, 'utf8');
    } catch {
    }
    if (current !== fresh) {
        console.error(`STALE: ${OUT} does not match the content pack — run: bun tools/clues/gen-cluedb.ts`);
        process.exit(1);
    }
    console.log(`ok: ${OUT} matches the content pack`);
} else {
    writeFileSync(OUT, fresh);
    console.log(`wrote ${OUT}`);
}
