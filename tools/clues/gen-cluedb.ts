/**
 * Regenerates src/bot/clues/data/cluedb.ts from the content pack — the id-keyed
 * answer DB for the 66 easy clues (all named "Clue scroll"; only the obj id
 * distinguishes them, and params aren't client-readable, so this table is
 * load-bearing).
 *   bun tools/clues/gen-cluedb.ts            # rewrite the file
 *   bun tools/clues/gen-cluedb.ts --check    # exit 1 if the committed file is stale
 * Content root: $CONTENT_DIR or ~/code/rs2b2t-content.
 *
 * Resolution:
 *   obj ids  — pack/obj.pack (`<id>=<name>`), covers the 6 dig caskets too.
 *   npc names — `name=` in scripts/**.npc configs; canonical files win over the
 *               scripts/_unpack/<rev> decompiled dumps.
 * Hard cases (see the maps below): vague003 (no coord in config) and _sailor
 * (abstract base; the completing npc is captain_tobias via an npc_type guard).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { NavPoint } from '#/bot/nav/PathFinder.js';

import { decodeCoord } from '../nav/stairsParse.js';
import { buildClueDb, parseChallengeTalk, parseClueObjs, parseEnum, parseKillForKey, parseTalkMappings, type ClueType, type TalkMapping } from './cluesParse.js';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const OUT = 'src/bot/clues/data/cluedb.ts';
const TRAIL = join(CONTENT, 'scripts', 'minigames', 'game_trail', 'configs');
// trail_checkmediumdrop lives here (the kill-for-key riddle→npc/key map).
const MEDIUM_SCRIPT = join(CONTENT, 'scripts', 'minigames', 'game_trail', 'scripts', 'medium', 'trail_clue_medium.rs2');

// vague003 ("search the drawers upstairs") carries no trail_coord; drawers.rs2
// handles it as a search-loc at this tile — decodes to (2574,3326,1), the Fishing
// Guild area (matches the navTargets 'vague003 Fishing Guild' label).
const VAGUE003_COORD = '1_40_51_14_62';

// The 7 medium "kill-for-key" riddles carry no trail_coord in trail_medium.obj —
// their locked chest/drawers live in the shared general_use handlers, matched by
// loc_coord. These are those coords (from chests.rs2 / drawers.rs2), the exact
// tile the trail script compares against; they feed a `specials` search override
// (like vague003). Comments summarise the riddle_desc landmark for verification.
const RIDDLE_KEY_COORDS: Record<string, string> = {
    trail_clue_medium_riddle001: '0_50_54_56_31', // chapel chest, town w/ central fountain — chests.rs2 → (3256,3487,0)
    trail_clue_medium_riddle002: '1_40_51_14_62', // East Ardougne pub-upstairs drawers — drawers.rs2 (= vague003 drawer) → (2574,3326,1)
    trail_clue_medium_riddle003: '1_40_51_51_60', // drawers upstairs of a house near the bank — drawers.rs2 → (2611,3324,1)
    trail_clue_medium_riddle004: '0_42_54_21_22', // drawers opposite a workshop — drawers.rs2 → (2709,3478,0)
    trail_clue_medium_riddle005: '1_40_48_33_36', // large-house chest, wizards' town — chests.rs2 → (2593,3108,1)
    trail_clue_medium_riddle007: '1_43_49_57_29', // pirate-village house drawers — drawers.rs2 → (2809,3165,1)
    trail_clue_medium_riddle008: '0_45_55_41_57' // troll-attacked village drawers — drawers.rs2 → (2921,3577,0)
};

// _sailor is an abstract base npc with no config name; the sailor that hands over
// vague012 is guarded by `npc_type = captain_tobias` in sailors.rs2.
const NPC_ALIAS: Record<string, string> = { _sailor: 'captain_tobias' };

function filesUnder(root: string, ext: string): string[] {
    return (readdirSync(root, { recursive: true }) as string[])
        .filter(f => f.endsWith(ext))
        .map(f => join(root, f))
        .sort();
}

/** pack/obj.pack: `<id>=<name>` → name → id. */
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

/** debugname → display name from every .npc config. Canonical configs are
 *  applied after the _unpack dumps so they win; the abstract-npc aliases are
 *  folded in last. */
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

    // --- easy (66 clues) ---
    const easyTalk: TalkMapping[] = rs2Files.flatMap(f => parseTalkMappings(readFileSync(f, 'utf8'), 'easy'));
    const easy = buildClueDb({
        clueNames: parseEnum(readFileSync(join(TRAIL, 'trail_easy.enum'), 'utf8')),
        objs: parseClueObjs(readFileSync(join(TRAIL, 'trail_easy.obj'), 'utf8')),
        objIds,
        talk: easyTalk,
        npcDisplay,
        specials: { trail_clue_easy_vague003: { type: 'search', coord: decodeCoord(VAGUE003_COORD) } }
    });

    // --- medium (56 clues) ---
    // Talk = the 14 anagrams with a literal progress_clue_medium call + the 6
    // "challenge" anagrams (progress via $clue variable, keyed off the inv_total
    // holder-gate). The riddle progress calls in trail_clue_medium.rs2 sit in
    // opnpc-less labels, so parseTalkMappings skips them (they're search clues).
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
        // npc_type/npc_category debugnames resolve to a display name; a quoted
        // npc_name ("Man") or a bare category token (pirate) passes through.
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
        // missing file = drift
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
