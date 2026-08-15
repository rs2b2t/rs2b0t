/** Scan Server content scripts for travel systems and compare them to the bot graph data.
 *  CONTENT_DIR=~/experiments/Server/content, optional --json. No engine pack required. */

//   CONTENT_DIR=~/experiments/Server/content \
//     bun tools/nav/content-transport-audit.ts
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import transportsJson from '../../src/bot/event/webwalk/data/transports.json';
import stairsJson from '../../src/bot/event/webwalk/data/stairEdges.json';
import {
    TRAVEL_FAMILIES,
    curatedTravelEdges,
    spiritTreeEdges,
    gliderEdges,
    entranaFerryEdges,
    shiloCartEdges,
    essenceEntryEdges,
    wildyLeverEdges,
    agilityShortcutEdges
} from '../../src/bot/event/webwalk/travelCatalog.js';
import { SPELL_TELEPORTS, JEWELLERY_TELEPORTS, LEVER_TELEPORTS } from '../../src/bot/event/webwalk/teleportCatalog.js';

const contentRoot =
    process.argv.find(a => a.startsWith('--content='))?.split('=')[1]
    ?? process.env.CONTENT_DIR
    ?? path.join(homedir(), 'experiments/Server/content');

const asJson = process.argv.includes('--json');

type Hit = { family: string; path: string; note: string };

function walkRs2(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) {
        return out;
    }
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === '_unpack' || ent.name === 'node_modules') {
                continue;
            }
            walkRs2(p, out);
        } else if (ent.name.endsWith('.rs2') || ent.name.endsWith('.constant')) {
            out.push(p);
        }
    }
    return out;
}

const PATTERNS: { family: string; re: RegExp; note: string }[] = [
    { family: 'spirit_tree', re: /spirit_tree|stronghold_ent|label,spirit_tree/i, note: 'spirit tree dialog' },
    { family: 'gnome_glider', re: /gnomeglider|glidermap|ta_quir_priw/i, note: 'gnome glider' },
    { family: 'entrana_ferry', re: /shipmonk|set_sail\("Entrana|holy Entrana/i, note: 'Entrana monks' },
    { family: 'shilo_cart', re: /shilocartdriver|brimhavencartdriver|calc_shilocart/i, note: 'Shilo/Brimhaven cart' },
    { family: 'karamja_ferry', re: /karamja_sailor|customs.?officer|Pay-fare/i, note: 'Karamja / customs ferry' },
    { family: 'charter_or_sail', re: /set_sail\(/i, note: 'set_sail journey' },
    { family: 'agility_shortcut', re: /oploc1,.*log|stepping.?stone|monkeybars|ropeswing|crumbl/i, note: 'agility shortcut' },
    { family: 'shantay_pass', re: /shantay_pass|shantay_prisondoor/i, note: 'Shantay Pass' },
    { family: 'spell_teleport', re: /magic_spell_teleport|label,.*teleport/i, note: 'spell teleport' },
    { family: 'jewellery', re: /amulet_of_glory|ring_of_dueling|necklace_of_minigames/i, note: 'jewellery rub' },
    { family: 'wildy_lever', re: /wildinlever|wildoutlever|wilderness.?lever/i, note: 'wildy lever' },
    { family: 'essence_portal', re: /essence.?mine|aubury|sedridor/i, note: 'RC essence' },
    { family: 'gangplank', re: /gangplank_board|gangplank_disembark/i, note: 'ship gangplank' }
];

function main(): void {
    const scriptsDir = path.join(contentRoot, 'scripts');
    const files = walkRs2(scriptsDir);
    const hits: Hit[] = [];
    const familyFiles = new Map<string, Set<string>>();

    for (const file of files) {
        let text: string;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        const rel = path.relative(contentRoot, file);
        for (const pat of PATTERNS) {
            if (pat.re.test(text)) {
                hits.push({ family: pat.family, path: rel, note: pat.note });
                if (!familyFiles.has(pat.family)) {
                    familyFiles.set(pat.family, new Set());
                }
                familyFiles.get(pat.family)!.add(rel);
            }
        }
    }

    const transports = transportsJson as {
        kind?: string;
        locName?: string;
        debugName?: string;
        disabledReason?: string;
    }[];
    const stairs = stairsJson as { disabledReason?: string }[];
    const byKind: Record<string, number> = {};
    for (const t of transports) {
        const k = t.kind ?? '?';
        byKind[k] = (byKind[k] ?? 0) + 1;
    }

    const disabledReasons: Record<string, number> = {};
    const bucketDisabled = (reason: string | undefined): void => {
        if (!reason) {
            return;
        }
        const key =
            /state-aware|depends on player|runtime quest/i.test(reason)
                ? 'state_deferred'
                : /up\/down choice|Climb-up or Climb-down/i.test(reason)
                    ? 'multi_choice_climb'
                    : /non-traversable|no statically|no movement destination/i.test(reason)
                        ? 'broken_or_no_dest'
                        : /walkable interaction tile|no walkable/i.test(reason)
                            ? 'pack_stand_gap'
                            : 'other';
        disabledReasons[key] = (disabledReasons[key] ?? 0) + 1;
    };
    for (const t of transports) {
        bucketDisabled(t.disabledReason);
    }
    for (const s of stairs) {
        bucketDisabled(s.disabledReason);
    }

    const curated = curatedTravelEdges();
    const coverage = {
        contentRoot,
        scriptFilesScanned: files.length,
        familiesInContent: [...familyFiles.keys()].sort(),
        familyFileCounts: Object.fromEntries(
            [...familyFiles.entries()].map(([k, v]) => [k, v.size])
        ),
        transportsJson: { count: transports.length, byKind },
        disabledBuckets: disabledReasons,
        disabledTotal:
            transports.filter(t => t.disabledReason).length
            + stairs.filter(s => s.disabledReason).length,
        botCatalog: {
            curatedTravelEdges: curated.length,
            spiritTree: spiritTreeEdges().length,
            glider: gliderEdges().length,
            entrana: entranaFerryEdges().length,
            shiloCart: shiloCartEdges().length,
            essenceEntry: essenceEntryEdges().length,
            wildyLeverEdges: wildyLeverEdges().length,
            agilityShortcuts: agilityShortcutEdges().length,
            spellTeles: SPELL_TELEPORTS.length,
            jewellery: JEWELLERY_TELEPORTS.length,
            levers: LEVER_TELEPORTS.length
        },
        plannedFamilies: [...TRAVEL_FAMILIES],
        sampleHits: hits.slice(0, 40)
    };

    if (asJson) {
        console.log(JSON.stringify(coverage, null, 2));
        return;
    }

    console.log(`content-transport-audit  content=${contentRoot}`);
    console.log(`  scanned ${files.length} script/constant files`);
    console.log(`  families touched in content: ${coverage.familiesInContent.join(', ') || '(none — check CONTENT_DIR)'}`);
    console.log('\n  content file hits by family:');
    for (const [fam, n] of Object.entries(coverage.familyFileCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${fam}: ${n} files`);
    }
    console.log('\n  transports.json kinds:', byKind);
    console.log('  curated travel edges:', curated.length, {
        spirit: spiritTreeEdges().length,
        glider: gliderEdges().length,
        entrana: entranaFerryEdges().length,
        cart: shiloCartEdges().length,
        essence: essenceEntryEdges().length,
        wildyLever: wildyLeverEdges().length,
        agility: agilityShortcutEdges().length
    });
    console.log('  tele catalog:', {
        spell: SPELL_TELEPORTS.length,
        jewellery: JEWELLERY_TELEPORTS.length,
        lever: LEVER_TELEPORTS.length
    });
    console.log(
        `  disabled rows (transports+stairs): ${coverage.disabledTotal}`,
        coverage.disabledBuckets
    );
    if (files.length === 0) {
        console.log('\n  WARN: no scripts found — set CONTENT_DIR to Server/content');
        process.exit(2);
    }
}

main();
