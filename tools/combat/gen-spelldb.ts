/**
 * Regenerates src/bot/api/combat/data/spelldb.ts from the content pack — the
 * autocast spell table (staff_spells ssbN button order, level, per-cast rune
 * costs) and the staff→provided-rune table, both keyed by DISPLAY names so
 * bots can match settings/Equipment/Inventory strings directly.
 *   bun tools/combat/gen-spelldb.ts            # rewrite the file
 *   bun tools/combat/gen-spelldb.ts --check    # exit 1 if the committed file is stale
 * Content root: $CONTENT_DIR or ~/code/rs2b2t-content.
 *
 * Sources:
 *   scripts/skill_combat/configs/magic/magic_combat_spells.dbrow — name,
 *     levelrequired, runesrequired (debugname,count triples, 'null' padded).
 *   scripts/skill_magic/configs/magic_staff.dbrow — staff debugnames + the
 *     rune each provides for free.
 *   scripts/** *.obj — debugname → display name (canonical configs win over
 *     the _unpack dumps, same as gen-cluedb's npc loader).
 *   The ssbN button order is the staff_spells interface layout, fixed in
 *     skill_combat/scripts/player/auto_cast.rs2 (ssb0..ssb15).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONTENT = process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content');
const OUT = 'src/bot/api/combat/data/spelldb.ts';

// staff_spells:ssb0..ssb15 → spell debugname (auto_cast.rs2 if_button order)
const SSB_ORDER = [
    'wind_strike', 'water_strike', 'earth_strike', 'fire_strike',
    'wind_bolt', 'water_bolt', 'earth_bolt', 'fire_bolt',
    'wind_blast', 'water_blast', 'earth_blast', 'fire_blast',
    'wind_wave', 'water_wave', 'earth_wave', 'fire_wave'
];

function filesUnder(root: string, ext: string): string[] {
    return (readdirSync(root, { recursive: true }) as string[])
        .filter(f => f.endsWith(ext))
        .map(f => join(root, f))
        .sort();
}

/** obj debugname → display name; canonical configs override _unpack dumps. */
function loadObjDisplayNames(): Map<string, string> {
    const files = filesUnder(join(CONTENT, 'scripts'), '.obj');
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
    return names;
}

interface DbBlock {
    header: string;
    data: Map<string, string[]>; // field → every data=field,... payload
}

function parseDbrows(path: string): DbBlock[] {
    const blocks: DbBlock[] = [];
    let cur: DbBlock | null = null;
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
        const line = raw.trim();
        const head = /^\[([a-z0-9_]+)\]$/.exec(line);
        if (head) {
            cur = { header: head[1], data: new Map() };
            blocks.push(cur);
        } else if (cur && line.startsWith('data=')) {
            const [field, ...rest] = line.slice('data='.length).split(',');
            const list = cur.data.get(field);
            if (list) {
                list.push(rest.join(','));
            } else {
                cur.data.set(field, [rest.join(',')]);
            }
        }
    }
    return blocks;
}

function generate(): string {
    const display = loadObjDisplayNames();
    const displayOf = (debug: string): string => {
        const name = display.get(debug);
        if (!name) {
            throw new Error(`no display name for obj '${debug}'`);
        }
        return name;
    };

    // ---- spells ----
    const spellRows = parseDbrows(join(CONTENT, 'scripts', 'skill_combat', 'configs', 'magic', 'magic_combat_spells.dbrow'));
    const byDebug = new Map<string, DbBlock>();
    for (const block of spellRows) {
        const spellRef = block.data.get('spell')?.[0]; // "^wind_strike"
        if (spellRef?.startsWith('^')) {
            byDebug.set(spellRef.slice(1), block);
        }
    }

    const spells: string[] = [];
    for (let i = 0; i < SSB_ORDER.length; i++) {
        const debug = SSB_ORDER[i];
        const block = byDebug.get(debug);
        if (!block) {
            throw new Error(`spell '${debug}' missing from magic_combat_spells.dbrow`);
        }
        const name = block.data.get('name')?.[0];
        const level = Number(block.data.get('levelrequired')?.[0]);
        const runesRaw = block.data.get('runesrequired')?.[0]; // "mindrune,1,airrune,1,null,null"
        if (!name || !Number.isFinite(level) || !runesRaw) {
            throw new Error(`spell '${debug}' missing name/level/runes`);
        }
        const parts = runesRaw.split(',');
        const runes: { rune: string; count: number }[] = [];
        for (let p = 0; p + 1 < parts.length; p += 2) {
            if (parts[p] !== 'null' && parts[p] !== '') {
                runes.push({ rune: displayOf(parts[p]), count: Number(parts[p + 1]) });
            }
        }
        spells.push(`    ${JSON.stringify(name)}: ${JSON.stringify({ ssb: i, level, runes })}`);
    }

    // ---- staves ----
    const staffRows = parseDbrows(join(CONTENT, 'scripts', 'skill_magic', 'configs', 'magic_staff.dbrow'));
    // a staff can appear in several rows (Lava battlestaff provides earth AND
    // fire — the engine reads two db_findnext rows) — group runes per staff
    const byStaff = new Map<string, string[]>();
    for (const block of staffRows) {
        const rune = block.data.get('rune')?.[0];
        if (!rune) {
            continue;
        }
        for (const staff of block.data.get('staff') ?? []) {
            const name = displayOf(staff);
            const list = byStaff.get(name) ?? [];
            list.push(displayOf(rune));
            byStaff.set(name, list);
        }
    }
    const staves = [...byStaff.entries()].sort().map(([staff, runes]) => `    ${JSON.stringify(staff)}: ${JSON.stringify(runes)}`);

    return [
        '/* eslint-disable */',
        '// GENERATED by tools/combat/gen-spelldb.ts — do not edit.',
        '// Regenerate: bun tools/combat/gen-spelldb.ts   (drift gate: --check)',
        '',
        'export interface SpellRow {',
        '    /** staff_spells:ssbN autocast button index (com id 1830 + ssb). */',
        '    ssb: number;',
        '    level: number;',
        '    /** Per-cast rune costs by display name, before staff substitution. */',
        '    runes: { rune: string; count: number }[];',
        '}',
        '',
        '/** Autocastable combat spells by display name (staff_spells layout). */',
        'export const SPELL_DB: Record<string, SpellRow> = {',
        spells.join(',\n'),
        '};',
        '',
        '/** Staff display name → the rune(s) it provides for free while wielded. */',
        'export const STAFF_RUNES: Record<string, string[]> = {',
        staves.join(',\n'),
        '};',
        ''
    ].join('\n');
}

const text = generate();
if (process.argv.includes('--check')) {
    const current = readFileSync(OUT, 'utf8');
    if (current !== text) {
        console.error(`${OUT} is stale — regenerate with: bun tools/combat/gen-spelldb.ts`);
        process.exit(1);
    }
    console.log(`${OUT} is up to date`);
} else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
}
