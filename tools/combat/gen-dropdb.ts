/**
 * Regenerates src/bot/api/combat/data/dropdb.ts from the content pack — each
 * monster's OFFICIAL drop table (the item display names it can drop), so bots
 * can offer a loot multi-select drawn from real data instead of free text.
 *   bun tools/combat/gen-dropdb.ts            # rewrite the file
 *   bun tools/combat/gen-dropdb.ts --check    # exit 1 if the committed file is stale
 * Content root: $CONTENT_DIR or ~/code/rs2b2t-content.
 *
 * Sources:
 *   scripts/drop tables/scripts/ ** *.rs2 — one file per monster. A monster's
 *     entry is an [ai_queueN,<npcdebug>] block; drops are obj_add(npc_coord,
 *     <obj>, ...) calls. The always-drop obj_add(npc_coord, npc_param(death_drop))
 *     resolves via the npc's death_drop param; ~randomherb/~randomjewel/etc.
 *     resolve against the [proc,*] sub-tables in the same directory.
 *   scripts/ ** *.npc  — npc debugname → display name + death_drop param.
 *   scripts/ ** *.obj  — obj debugname → display name (canonical wins over _unpack).
 *
 * Best-effort across all monsters: a file that can't be parsed is skipped with a
 * warning, never aborting the run — the bots that consume DROP_DB verify their
 * own monster's list.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const OUT = 'src/bot/api/combat/data/dropdb.ts';
const DROP_DIR = join(CONTENT, 'scripts', 'drop tables', 'scripts');

function filesUnder(root: string, ext: string): string[] {
    return (readdirSync(root, { recursive: true }) as string[])
        .filter(f => f.endsWith(ext))
        .map(f => join(root, f))
        .sort();
}

/** debugname → display name; canonical configs override the _unpack dumps. */
function loadConfigNames(ext: string, extra?: (cur: string, line: string) => void): Map<string, string> {
    const files = filesUnder(join(CONTENT, 'scripts'), ext);
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
            } else if (cur) {
                extra?.(cur, line);
            }
        }
    }
    return names;
}

interface Block {
    type: string; // ai_queue3, proc, label, ...
    name: string; // mossgiant, randomherb, ...
    body: string;
}

/** Every [type,name] block across the drop-table scripts, keyed 'type:name'. */
function loadBlocks(): Map<string, Block> {
    const blocks = new Map<string, Block>();
    for (const f of filesUnder(DROP_DIR, '.rs2')) {
        let cur: Block | null = null;
        const lines: string[] = [];
        const flush = (): void => { if (cur) { cur.body = lines.join('\n'); blocks.set(`${cur.type}:${cur.name}`, cur); lines.length = 0; } };
        for (const raw of readFileSync(f, 'utf8').split('\n')) {
            const head = /^\[([a-z0-9_]+)\s*,\s*([a-z0-9_]+)\]/.exec(raw.trim());
            if (head) {
                flush();
                cur = { type: head[1], name: head[2], body: '' };
            } else if (cur) {
                lines.push(raw);
            }
        }
        flush();
    }
    return blocks;
}

const objNames = loadConfigNames('.obj');
const deathDrops = new Map<string, string>();
const npcNames = loadConfigNames('.npc', (cur, line) => {
    if (line.startsWith('param=death_drop,')) {
        deathDrops.set(cur, line.slice('param=death_drop,'.length).split(',')[0].trim());
    }
});
const blocks = loadBlocks();

/** Item debugnames a block can yield, resolving proc refs + the death drop. */
function itemsIn(key: string, deathDrop: string | undefined, seen: Set<string>): Set<string> {
    const out = new Set<string>();
    const block = blocks.get(key);
    if (!block || seen.has(key)) {
        return out;
    }
    seen.add(key);
    // Tokens fed to obj_add(npc_coord, TOKEN, …) or returned from a proc: return (TOKEN, …).
    const tokens: string[] = [];
    for (const m of block.body.matchAll(/obj_add\s*\(\s*npc_coord\s*,\s*(~?[a-z0-9_]+)/g)) { tokens.push(m[1]); }
    for (const m of block.body.matchAll(/return\s*\(\s*(~?[a-z0-9_]+)/g)) { tokens.push(m[1]); }
    for (const tok of tokens) {
        if (tok.startsWith('~')) {
            // proc sub-table (~randomherb, ~randomjewel, ~megararetable, …)
            for (const it of itemsIn(`proc:${tok.slice(1)}`, deathDrop, seen)) { out.add(it); }
        } else if (tok === 'npc_param') {
            if (deathDrop) { out.add(deathDrop); }
        } else if (objNames.has(tok)) {
            out.add(tok);
        }
        // else: not an obj (a keyword/var) — ignore
    }
    return out;
}

function generate(): string {
    // Monster entry = an [ai_queue*,<npcdebug>] block whose name is a known npc.
    const byDisplay = new Map<string, Set<string>>();
    for (const block of blocks.values()) {
        if (!/^ai_queue/.test(block.type) || !npcNames.has(block.name)) {
            continue;
        }
        const items = itemsIn(`${block.type}:${block.name}`, deathDrops.get(block.name), new Set());
        if (items.size === 0) {
            continue;
        }
        const display = npcNames.get(block.name)!;
        const set = byDisplay.get(display) ?? new Set<string>();
        for (const it of items) {
            const name = objNames.get(it);
            if (name) { set.add(name); }
        }
        byDisplay.set(display, set);
    }

    const rows = [...byDisplay.entries()]
        .filter(([, set]) => set.size > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([monster, set]) => `    ${JSON.stringify(monster)}: ${JSON.stringify([...set].sort())}`);

    return [
        '/* eslint-disable */',
        '// GENERATED by tools/combat/gen-dropdb.ts — do not edit.',
        '// Regenerate: bun tools/combat/gen-dropdb.ts   (drift gate: --check)',
        '',
        '/** Monster display name → the item display names its official drop table can',
        ' *  yield (direct drops + always-drop + resolved herb/gem/jewel sub-tables).',
        " *  Powers bots' loot multi-select. */",
        'export const DROP_DB: Record<string, string[]> = {',
        rows.join(',\n'),
        '};',
        ''
    ].join('\n');
}

const text = generate();
if (process.argv.includes('--check')) {
    const current = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return ''; } })();
    if (current !== text) {
        console.error(`${OUT} is stale — regenerate with: bun tools/combat/gen-dropdb.ts`);
        process.exit(1);
    }
    console.log(`${OUT} is up to date`);
} else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT} (${(text.match(/^    "/gm) ?? []).length} monsters)`);
}
