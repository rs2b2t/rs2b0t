/**
 * Build ~10 transport-heavy OD pairs from curated 2004 travel + known hubs,
 * pack-probe with full WorldState, write a live-friendly JSON list.
 *
 *   bun tools/nav/transport-heavy-routes.ts
 *   bun tools/nav/transport-heavy-routes.ts --write --n=12 --explain
 *
 * Output: tools/nav/transport-heavy.routes.json (gitignored optional — not in .gitignore by default)
 *
 * Live (after redeploy): HEADED=1 can walk these by feeding the JSON into a harness,
 * or copy ids into nav-script-routes-live LIMIT list manually.
 */
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/nav/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/nav/loadTransportGraph.js';
import { formatHops } from '#/bot/nav/v2/hops.js';
import type { PathPolicy } from '#/bot/nav/v2/types.js';
import type { WorldStateData } from '#/bot/nav/v2/worldStateData.js';
import {
    SPIRIT_TREE,
    GLIDER_PAD,
    ENTRANA_LAND,
    CART_BRIMHAVEN,
    CART_SHILO,
    ESSENCE_RETURN,
    ESSENCE_MINE_PAD,
    WILDY_LEVER,
    TRAVEL_STANDS
} from '#/bot/nav/v2/travelCatalog.js';
import {
    richTransportQuestMap,
    TRANSPORT_QUEST_SEEDS
} from '#/bot/nav/v2/transportQuestReqs.js';

const packPath =
    process.argv.find(a => a.startsWith('--pack='))?.split('=')[1]
    ?? 'out/collision.lcnav.gz';
const n =
    Number(process.argv.find(a => a.startsWith('--n='))?.split('=')[1] ?? 12) || 12;
const write = process.argv.includes('--write');
const explain = process.argv.includes('--explain');
const outPath =
    process.argv.find(a => a.startsWith('--out='))?.split('=')[1]
    ?? path.join(process.cwd(), 'tools/nav/transport-heavy.routes.json');

interface Seed {
    id: string;
    family: string;
    note: string;
    from: NavPoint;
    to: NavPoint;
}

/** Hand-picked OD pairs that should prefer ships / hubs / levers over pure walk. */
const SEEDS: Seed[] = [
    {
        id: 'TH-spirit-stronghold-varrock',
        family: 'spirit_tree',
        note: 'Grand Tree spirit → Varrock forest spirit',
        from: SPIRIT_TREE.stronghold,
        to: SPIRIT_TREE.varrock
    },
    {
        id: 'TH-spirit-varrock-village',
        family: 'spirit_tree',
        note: 'Varrock young spirit → Gnome Village tree',
        from: SPIRIT_TREE.varrock,
        to: SPIRIT_TREE.village
    },
    {
        id: 'TH-glider-gandius-hub',
        family: 'gnome_glider',
        note: 'Karamja glider pad → Grand Tree hub',
        from: GLIDER_PAD.gandius,
        to: GLIDER_PAD.taQuirPriw
    },
    {
        id: 'TH-glider-hub-karhewo',
        family: 'gnome_glider',
        note: 'Grand Tree hub → Al Kharid glider pad',
        from: GLIDER_PAD.taQuirPriw,
        to: GLIDER_PAD.karHewo
    },
    {
        id: 'TH-entrana-out',
        family: 'entrana_ferry',
        note: 'Port Sarim monk stand → Entrana deck landing',
        from: TRAVEL_STANDS.portSarimMonk,
        to: ENTRANA_LAND
    },
    {
        id: 'TH-entrana-back',
        family: 'entrana_ferry',
        note: 'Entrana monk stand → Port Sarim deck landing',
        from: TRAVEL_STANDS.entranaMonk,
        to: { x: 3048, z: 3231, level: 1 }
    },
    {
        id: 'TH-cart-shilo-brim',
        family: 'shilo_cart',
        note: 'Shilo cart stand → Brimhaven cart landing',
        from: TRAVEL_STANDS.shiloCart,
        to: CART_BRIMHAVEN
    },
    {
        id: 'TH-cart-brim-shilo',
        family: 'shilo_cart',
        note: 'Brimhaven cart → Shilo landing',
        from: TRAVEL_STANDS.brimhavenCart,
        to: CART_SHILO
    },
    {
        id: 'TH-ess-aubury',
        family: 'essence_entry',
        note: 'Aubury → essence mine pad',
        from: ESSENCE_RETURN.aubury,
        to: ESSENCE_MINE_PAD
    },
    {
        id: 'TH-ess-sedridor',
        family: 'essence_entry',
        note: 'Sedridor (tower basement) → essence mine',
        from: ESSENCE_RETURN.sedridor,
        to: ESSENCE_MINE_PAD
    },
    {
        id: 'TH-lever-to-wild',
        family: 'wildy_lever',
        note: 'Ardougne lever → deep wild',
        from: TRAVEL_STANDS.ardyLever,
        to: WILDY_LEVER.deepWild
    },
    {
        id: 'TH-lever-from-wild',
        family: 'wildy_lever',
        note: 'Deep wild lever → Ardougne',
        from: TRAVEL_STANDS.wildLever,
        to: WILDY_LEVER.ardougne
    },
    {
        id: 'TH-ship-sarim-musa',
        family: 'karamja_ferry',
        note: 'Port Sarim pier → Musa Point deck (pre-existing ship)',
        from: { x: 3027, z: 3218, level: 0 },
        to: { x: 2956, z: 3143, level: 1 }
    },
    {
        id: 'TH-ship-ardy-brim',
        family: 'brimhaven_ferry',
        note: 'Ardougne pier → Brimhaven deck (pre-existing ship)',
        from: { x: 2683, z: 3272, level: 0 },
        to: { x: 2775, z: 3234, level: 1 }
    },
    {
        id: 'TH-combo-lumby-entrana',
        family: 'combo',
        note: 'Lumbridge → Entrana (should ship + walk)',
        from: { x: 3222, z: 3218, level: 0 },
        to: ENTRANA_LAND
    },
    {
        id: 'TH-combo-varrock-shilo',
        family: 'combo',
        note: 'Varrock square → Shilo cart landing (ship/cart/tele mix)',
        from: { x: 3213, z: 3424, level: 0 },
        to: CART_SHILO
    }
];

/** Rich state so requires-gated edges open (quests, members, runes, coins). */
const RICH_STATE: WorldStateData = {
    members: true,
    skills: {
        magic: 99,
        Magic: 99,
        agility: 99,
        Agility: 99,
        prayer: 99,
        Prayer: 99
    },
    // Journal display names + aliases — see transportQuestReqs.ts
    quests: richTransportQuestMap(),
    items: {
        'Law rune': 200,
        'Air rune': 500,
        'Fire rune': 200,
        'Water rune': 200,
        'Earth rune': 200,
        Coins: 5000,
        'Ring of dueling(8)': 1,
        'Games necklace(8)': 1,
        'Amulet of glory(4)': 1
    },
    freeSlots: 20
};

const policy: PathPolicy = {
    useTeleports: true,
    distanceBeforeTeleport: 40
};

if (!fs.existsSync(packPath)) {
    console.error(`missing ${packPath}`);
    process.exit(2);
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
loadDefaultNavEdges(finder);

type Row = Seed & {
    ok: boolean;
    cost?: number;
    hops?: number;
    transportHops?: number;
    hopKinds?: string[];
    reason?: string;
    ms: number;
};

const rows: Row[] = [];

for (const s of SEEDS) {
    const t0 = performance.now();
    const outcome = finder.findPath(s.from, s.to, {
        policy,
        state: RICH_STATE,
        useTeleportCatalog: true
    });
    const ms = performance.now() - t0;
    if (!outcome.ok) {
        rows.push({ ...s, ok: false, reason: outcome.reason, ms });
        console.log(`FAIL ${s.id}  ${s.note}: ${outcome.reason} (${ms.toFixed(1)}ms)`);
        continue;
    }
    const hopKinds = outcome.hops.map(h => h.kind ?? h.locName ?? '?');
    const transportHops = outcome.hops.filter(
        h => h.kind && h.kind !== 'walk' && h.kind !== undefined
    ).length;
    // hops array is transport hops only in v2 — length is the count
    const th = outcome.hops.length;
    rows.push({
        ...s,
        ok: true,
        cost: outcome.cost,
        hops: th,
        transportHops: th,
        hopKinds,
        ms
    });
    console.log(
        `PASS ${s.id}  cost=${outcome.cost} hops=${th} kinds=[${[...new Set(hopKinds)].join(',')}]  ${s.note}  (${ms.toFixed(1)}ms)`
    );
    if (explain && outcome.hops.length) {
        console.log(formatHops(outcome.hops));
    }
}

// Prefer OK routes with at least one hop; fill with zero-hop if needed.
const ok = rows.filter(r => r.ok);
const heavy = [...ok].sort((a, b) => (b.hops ?? 0) - (a.hops ?? 0) || (b.cost ?? 0) - (a.cost ?? 0));
const pick = heavy.slice(0, n);

console.log(`\n── quest seeds (live: setvar then relog) ──`);
for (const s of TRANSPORT_QUEST_SEEDS) {
    console.log(`  setvar ${s.varp} ${s.complete}  # ${s.journal} — ${s.usedBy.join('; ')}`);
}

console.log(`\n── top ${pick.length} transport-heavy (of ${ok.length} ok / ${rows.length} seeds) ──`);
for (let i = 0; i < pick.length; i++) {
    const r = pick[i]!;
    console.log(
        `  ${String(i + 1).padStart(2)}. hops=${r.hops} cost=${r.cost}  ${r.id}  — ${r.note}`
    );
}

const failed = rows.filter(r => !r.ok);
if (failed.length) {
    console.log(`\n── ${failed.length} FAIL ──`);
    for (const r of failed) {
        console.log(`  ${r.id}: ${r.reason}`);
    }
}

if (write) {
    const payload = {
        description:
            'Transport-heavy OD pairs for pack/live stress. Generated by transport-heavy-routes.ts. '
            + 'WorldState assumes members, transport quests complete (see questSeeds), full runes, coins.',
        generatedAt: new Date().toISOString(),
        pack: packPath,
        questSeeds: TRANSPORT_QUEST_SEEDS.map(s => ({
            journal: s.journal,
            varp: s.varp,
            complete: s.complete,
            usedBy: s.usedBy
        })),
        count: pick.length,
        routes: pick.map(r => ({
            id: r.id,
            family: r.family,
            note: r.note,
            from: r.from,
            to: r.to,
            source: 'transport-heavy-routes',
            cost: r.cost,
            hops: r.hops,
            hopKinds: r.hopKinds
        }))
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`\nwrote ${pick.length} routes → ${outPath}`);
}

process.exit(failed.length === rows.length ? 1 : 0);
