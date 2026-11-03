import type { AccountSnapshot, Box, JiveSettings, JiveSite, JiveTarget, Point, SessionState } from './types.js';

const point = (x: number, z: number, level = 0): Point => ({ x, z, level });
const box = (minX: number, maxX: number, minZ: number, maxZ: number, level = 0): Box => ({ minX, maxX, minZ, maxZ, level });
const target = (id: number, name: string, denominator: number, tiles: number[][], level = 0): JiveTarget => ({ ids: [id], name, defences: id === 49 || id === 83 ? { stab: 0, slash: 0, crush: 0 } : { stab: 50, slash: 70, crush: 70 }, clueChance: 1 / denominator, spawnTiles: tiles.map(([x, z]) => point(x, z, level)) });
const base = { bank: point(2946, 3369), staging: point(2884, 3398), escapeTeleportId: 'falador', entry: [point(2884, 3398), point(2924, 9803), point(2911, 9809)], exit: [point(2924, 9803), point(2884, 3398)], requirements: { skills: { attack: 60, defence: 60, prayer: 43, magic: 37 }, quests: [], items: [1590, 1540], entryCoins: 0, antifire: true, antipoison: true }, validation: null, capacity: 1, weight: 1 };
const brim = { ...base, bank: point(2655, 3283), staging: point(2747, 3152), escapeTeleportId: 'ardougne', entry: [point(2747, 3152), point(2691, 9564), point(2649, 9562), point(2672, 9499)], exit: [point(2713, 9564), point(2745, 3152)], requirements: { skills: { attack: 60, defence: 60, prayer: 43, magic: 51, woodcutting: 34, agility: 12 }, quests: ['Plague City'], access: ['brimhaven-axe-route'], items: [1540], entryCoins: 1000, antifire: true, antipoison: true } };

export const SITES: JiveSite[] = [
    { ...base, id: 'taverley-hellhounds', label: 'Taverley hellhounds', targets: [target(49, 'Hellhound', 64, [[2856,9847],[2857,9841],[2861,9837],[2864,9851],[2867,9840]])], region: box(2849,2877,9832,9863), weight: 4 },
    { ...base, id: 'witchaven-hellhounds', label: 'Witchaven hellhounds', targets: [target(49, 'Hellhound', 64, [[2734,9688],[2734,9693]])], region: box(2728,2740,9682,9699), bank: point(2655,3283), staging: point(2721,3372), entry: [point(2721,3372),point(2734,9688)], exit: [point(2721,3372)], requirements: { skills: { attack: 60, defence: 60, prayer: 43, magic: 37 }, quests: [], access: ['witchaven-hellhound-barriers'], items: [], entryCoins: 0, antifire: false, antipoison: false }, weight: 3 },
    { ...base, id: 'taverley-greater', label: 'Taverley greater demons', targets: [target(83, 'Greater demon', 128, [[2861,9747],[2862,9751]])], region: box(2853,2870,9740,9758), weight: 3 },
    { ...brim, id: 'brimhaven-greater', label: 'Brimhaven greater demons', targets: [target(83, 'Greater demon', 128, [[2630,9482],[2631,9505],[2633,9491],[2635,9477],[2638,9501],[2642,9506],[2646,9476]], 2)], region: box(2624,2654,9470,9513,2), weight: 3 },
    { ...base, id: 'taverley-blue', dragonSiteKey: 'taverley-blue', label: 'Taverley blue dragons', targets: [target(55, 'Blue dragon', 128, [[2897,9797],[2899,9802],[2904,9802]])], region: box(2888,2913,9790,9816), requirements: { ...base.requirements, antipoison: false }, weight: 2,
        validation: { revision: '289', evidence: 'docs/e2e/jivett/taverley-blue.json + README.md: jivett-hunt-probe-mvzugyz3; bundle 1c89329b9ca7a9dc2a377d47ad98d5d4adf042ae4a305a47d3ac30f1e4d20a7a; 300ms ticks; melee prayer, shield and antifire confirmed', entry: true, melee: true, loot: true, exit: true, npcIds: [55] } },
    { ...base, id: 'heroes-blue', dragonSiteKey: 'heroes-blue', label: "Heroes' Guild", targets: [target(55, 'Blue dragon', 128, [[2908,9905]])], region: box(2903,2916,9900,9914), staging: point(2892,3512), entry: [point(2892,3512),point(2892,9908),point(2909,9910)], exit: [point(2909,9910),point(2892,9908),point(2892,3512)], requirements: { ...base.requirements, quests: ["Heroes' Quest"], items: [1540], antipoison: false }, weight: 1 },
    { ...base, id: 'gutanoth', dragonSiteKey: 'gutanoth-blue', label: "Gu'Tanoth/Ogre Enclave", targets: [target(55, 'Blue dragon', 128, [[2568,9437],[2579,9445],[2590,9461],[2592,9431],[2604,9443],[2609,9459]]), target(83, 'Greater demon', 128, [[2586,9458]])], region: box(2560,2611,9428,9471), bank: point(2612,3092), staging: point(2508,3038), entry: [point(2508,3038),point(2588,9432)], exit: [point(2597,9468),point(2540,3054)], escapeTeleportId: 'watchtower', requirements: { ...base.requirements, quests: ['Watch Tower'], skills: { ...base.requirements.skills, magic: 58 }, items: [1540], antipoison: false }, weight: 2 },
    { ...brim, id: 'brimhaven-red', label: 'Brimhaven red dragons', targets: [target(53, 'Red dragon', 128, [[2697,9506],[2705,9522],[2706,9507],[2707,9516],[2714,9526],[2723,9517]])], region: box(2690,2730,9500,9533) },
    { ...brim, id: 'brimhaven-bronze', label: 'Brimhaven bronze dragons', targets: [target(1590, 'Bronze dragon', 128 * 1024 / 1023, [[2731,9482],[2731,9491],[2740,9492]])], region: box(2724,2748,9475,9499) },
    { ...brim, id: 'brimhaven-metals', dragonSiteKey: 'brimhaven-iron', label: 'Brimhaven iron and steel dragons', targets: [target(1591, 'Iron dragon', 128 * 512 / 511, [[2704,9431],[2704,9457],[2705,9424],[2714,9420],[2714,9449],[2714,9460],[2722,9424],[2724,9435],[2730,9437],[2732,9459],[2736,9424],[2738,9440],[2739,9450]]),target(1592, 'Steel dragon', 64 * 256 / 255, [[2702,9447],[2712,9435],[2723,9458],[2726,9445]])], region: box(2696,2746,9413,9467), weight: 0.8 },
    { ...base, id: 'taverley-black', dragonSiteKey: 'taverley-black', label: 'Taverley black dragons', targets: [target(54, 'Black dragon', 128, [[2829,9826],[2835,9824]])], region: box(2818,2850,9815,9832), weight: 0.25 }
];

export function inSite(site: JiveSite, tile: Point | null): boolean {
    const b = site.region;
    return tile !== null && tile.level === b.level && tile.x >= b.minX && tile.x <= b.maxX && tile.z >= b.minZ && tile.z <= b.maxZ;
}

export function siteRequirements(site: JiveSite, snapshot: AccountSnapshot): string[] {
    const missing: string[] = [];
    const validation = site.validation;
    if (!validation || !validation.entry || !validation.melee || !validation.loot || !validation.exit || !validation.evidence || !validation.revision || site.targets.some(target => target.ids.some(id => !validation.npcIds.includes(id)))) missing.push('local entry, melee, loot and exit validation');
    for (const [skill, level] of Object.entries(site.requirements.skills)) if ((snapshot.levels[skill] ?? 0) < level) missing.push(`${skill} ${level}`);
    for (const quest of site.requirements.quests) if (!snapshot.quests.includes(quest)) missing.push(quest);
    for (const access of site.requirements.access ?? []) if (!snapshot.access?.includes(access)) missing.push(access);
    const stock = [...snapshot.inventory, ...snapshot.bank, ...snapshot.equipment];
    for (const id of site.requirements.items) if (!stock.some(item => item.id === id && item.count > 0)) missing.push(`item ${id}`);
    if (stock.filter(item => item.id === 995).reduce((n, item) => n + item.count, 0) < site.requirements.entryCoins) missing.push(`${site.requirements.entryCoins} entry/travel coins`);
    if (!snapshot.weaponId) missing.push('usable owned melee weapon');
    if (!snapshot.escapeReady) missing.push('verified escape');
    return missing;
}

export function eligibleSites(snapshot: AccountSnapshot, settings: JiveSettings, session: SessionState, now: number, sites = SITES): JiveSite[] {
    if (!settings.allowedWorlds.includes(snapshot.world) || !snapshot.bankFresh) return [];
    return sites.filter(site => settings.allowedSites.includes(site.id) && (session.cooldowns[site.id] ?? 0) <= now && siteRequirements(site, snapshot).length === 0);
}
