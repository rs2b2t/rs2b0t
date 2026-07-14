/**
 * Curated v1 route. Stand tiles are validated by the offline nav-coverage
 * gate (tools/nav/coverage.ts) — if it FAILs a tile, use its printed
 * `nearest connected` replacement. Deferred clusters (shopdb has the data;
 * add when the blockers fall): Magic Guild Yanille (upstairs + magic 66),
 * Shilo (non-booth bank + Shilo Village quest), Mage Arena (deep wild),
 * Ardougne/Gnome general stores (baselines ≤ 30).
 */
import type { Route } from '#/bot/shops/types.js';

const BOOTH = { boothName: 'Bank booth', boothOp: 'Use-quickly' };
// buys[] is the planner's PRIORITY order: the gp cap is allocated greedily
// down each list, so the valuable/slow-restock items must come FIRST — the
// original cheapest-first ordering spent the whole cap on elemental runes and
// death/chaos got zero units every leg (found live). Descending item cost;
// test/shops/route.test.ts gates the ordering.
const RUNES = ['deathrune', 'chaosrune', 'firerune', 'waterrune', 'airrune', 'earthrune', 'mindrune', 'bodyrune'].map(obj => ({ obj }));

export const ROUTE: Route = {
    clusters: [
        {
            id: 'varrock',
            bank: { stand: { x: 3251, z: 3420, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'runeshop', keeperNpc: 'Aubury', stand: { x: 3253, z: 3401, level: 0 }, buys: RUNES },
                { shopId: 'archeryshop', keeperNpc: 'Lowe', stand: { x: 3231, z: 3421, level: 0 }, buys: [{ obj: 'steel_arrow' }, { obj: 'iron_arrow' }, { obj: 'bronze_arrow' }] }
            ],
            gates: []
        },
        {
            id: 'portsarim',
            bank: { stand: { x: 3092, z: 3243, level: 0 }, ...BOOTH }, // Draynor — nearest bank to Port Sarim
            shops: [
                { shopId: 'magicshop', keeperNpc: 'Betty', stand: { x: 3012, z: 3258, level: 0 }, buys: RUNES },
                { shopId: 'fishingshop', keeperNpc: 'Gerrant', stand: { x: 3013, z: 3224, level: 0 }, buys: [{ obj: 'feather' }] }
            ],
            gates: []
        },
        {
            id: 'catherby',
            bank: { stand: { x: 2809, z: 3441, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'archeryshop2', keeperNpc: 'Hickton', stand: { x: 2821, z: 3442, level: 0 }, buys: [{ obj: 'rune_arrowheads' }, { obj: 'adamant_arrowheads' }, { obj: 'mithril_arrowheads' }, { obj: 'steel_arrowheads' }, { obj: 'iron_arrow' }, { obj: 'iron_arrowheads' }, { obj: 'bronze_arrow' }, { obj: 'bronze_arrowheads' }] }
            ],
            gates: [{ members: true }]
        },
        {
            id: 'fishingguild',
            bank: { stand: { x: 2586, z: 3420, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'fishingguild', keeperNpc: 'Roachey', stand: { x: 2596, z: 3399, level: 0 }, buys: [{ obj: 'feather' }] }
            ],
            gates: [{ members: true }, { skill: { name: 'fishing', level: 68 } }]
        },
        {
            id: 'rangingguild',
            bank: { stand: { x: 2725, z: 3493, level: 0 }, ...BOOTH }, // Seers — nearest bank to the Ranging Guild
            shops: [
                {
                    shopId: 'ranging_guild_bowshop', keeperNpc: 'Bow and Arrow salesman', stand: { x: 2678, z: 3440, level: 0 },
                    buys: [{ obj: 'rune_arrow' }, { obj: 'rune_arrowheads' }, { obj: 'adamant_arrow' }, { obj: 'adamant_arrowheads' }, { obj: 'mithril_arrow' }, { obj: 'mithril_arrowheads' }, { obj: 'steel_arrow' }, { obj: 'steel_arrowheads' }, { obj: 'iron_arrow' }, { obj: 'iron_arrowheads' }, { obj: 'bronze_arrow' }, { obj: 'bronze_arrowheads' }]
                }
            ],
            gates: [{ members: true }, { skill: { name: 'ranged', level: 40 } }]
        }
    ],
    ring: ['varrock', 'portsarim', 'catherby', 'fishingguild', 'rangingguild']
};

/** Smoke route: Aubury only, so buying him out un-qualifies the whole cluster. */
export const SMOKE_ROUTE: Route = {
    clusters: [{ ...ROUTE.clusters[0], shops: [ROUTE.clusters[0].shops[0]] }],
    ring: ['varrock']
};
