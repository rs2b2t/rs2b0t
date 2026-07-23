import type { Route } from '#/bot/shops/types.js';

const BOOTH = { boothName: 'Bank booth', boothOp: 'Use-quickly' };
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
            bank: { stand: { x: 3092, z: 3243, level: 0 }, ...BOOTH },
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
            gates: []
        },
        {
            id: 'fishingguild',
            bank: { stand: { x: 2586, z: 3420, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'fishingguild', keeperNpc: 'Roachey', stand: { x: 2596, z: 3399, level: 0 }, buys: [{ obj: 'feather' }] }
            ],
            gates: [{ skill: { name: 'fishing', level: 68 } }]
        },
        {
            id: 'rangingguild',
            bank: { stand: { x: 2725, z: 3493, level: 0 }, ...BOOTH },
            shops: [
                {
                    shopId: 'ranging_guild_bowshop', keeperNpc: 'Bow and Arrow salesman', stand: { x: 2673, z: 3434, level: 0 },
                    buys: [{ obj: 'rune_arrow' }, { obj: 'rune_arrowheads' }, { obj: 'adamant_arrow' }, { obj: 'adamant_arrowheads' }, { obj: 'mithril_arrow' }, { obj: 'mithril_arrowheads' }, { obj: 'steel_arrow' }, { obj: 'steel_arrowheads' }, { obj: 'iron_arrow' }, { obj: 'iron_arrowheads' }, { obj: 'bronze_arrow' }, { obj: 'bronze_arrowheads' }]
                }
            ],
            gates: [{ skill: { name: 'ranged', level: 40 } }]
        },
        {
            id: 'magicguild',
            bank: { stand: { x: 2612, z: 3092, level: 0 }, ...BOOTH },
            shops: [
                { shopId: 'magicguildshop', keeperNpc: 'Magic Store owner', stand: { x: 2594, z: 3087, level: 1 }, buys: [{ obj: 'soulrune' }, { obj: 'firerune' }, { obj: 'waterrune' }, { obj: 'airrune' }, { obj: 'earthrune' }, { obj: 'mindrune' }, { obj: 'bodyrune' }] }
            ],
            gates: [{ skill: { name: 'magic', level: 66 } }]
        },
        {
            id: 'magearena',
            bank: { stand: { x: 3094, z: 3493, level: 0 }, ...BOOTH },
            shops: [
                {
                    shopId: 'magearena_runeshop', keeperNpc: 'Lundail', stand: { x: 2535, z: 4719, level: 0 },
                    buys: [{ obj: 'lawrune' }, { obj: 'deathrune' }, { obj: 'naturerune' }, { obj: 'chaosrune' }, { obj: 'cosmicrune' }, { obj: 'firerune' }, { obj: 'waterrune' }, { obj: 'airrune' }, { obj: 'earthrune' }, { obj: 'mindrune' }, { obj: 'bodyrune' }]
                }
            ],
            gates: [],
            haulBank: { stand: { x: 2533, z: 4714, level: 0 }, banker: 'Gundai' },
            keep: ['Rune scimitar'],
            wield: ['Rune scimitar'],
            waypoints: [{ x: 3092, z: 3760, level: 0 }, { x: 3092, z: 3900, level: 0 }],
            setting: 'mageArena'
        }
    ],
    ring: ['varrock', 'portsarim', 'catherby', 'fishingguild', 'rangingguild', 'magicguild', 'magearena']
};

export const SMOKE_ROUTE: Route = {
    clusters: [{ ...ROUTE.clusters[0], shops: [ROUTE.clusters[0].shops[0]] }],
    ring: ['varrock']
};
