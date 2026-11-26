import type { PlayerSnapshot, WorldTile } from '../../adapter/ClientAdapter.js';
import { TAVERLEY_BLUE } from '../../api/combat/hunting/sites.js';
import { cookLocation } from '../../api/cooking/CookLocations.js';
import { FIRE_SPOTS } from '../../api/firemaking/Firemaking.js';
import { MINING_LOCATIONS } from '../../data/miningLocations.js';
import { WOODCUTTING_LOCATIONS } from '../../data/woodcuttingLocations.js';
import { CENTRE_PLATFORM, PILLARS } from '../BrimhavenAgility/BrimhavenAgilityLogic.js';
import { RUNES } from '../JiveRC/logic.js';
import { COURSE_CENTRE } from '../WildyAgility/WildyAgilityLogic.js';
import type { ActivityPlan, SessionMemory } from './types.js';

export const CROWD_PREFIX = 'crowd:';
export const CROWD_COOLDOWN = 30 * 60000;

interface TrainingArea {
    spot: WorldTile;
    radius: number;
    bank?: WorldTile;
    bounds?: { x0: number; x1: number; z0: number; z1: number };
}

const elementalTemples: Record<string, number> = { 'Water runes': 42, 'Earth runes': 41, 'Fire runes': 40 };
const resources = { Miner: MINING_LOCATIONS, Woodcutter: WOODCUTTING_LOCATIONS };
function templeArea(mapX: number): TrainingArea {
    const x0 = mapX * 64;
    const z0 = 75 * 64;
    return { spot: { x: x0 + 32, z: z0 + 32, level: 0 }, radius: 32, bounds: { x0, x1: x0 + 63, z0, z1: z0 + 63 } };
}

const fixed: Record<string, TrainingArea | undefined> = {
    EssMiner: templeArea(45),
    TannerBot: { spot: { x: 3277, z: 3191, level: 0 }, radius: 4 },
    JiveDragons: { spot: TAVERLEY_BLUE.meleeAnchor, radius: 16 },
    FlaxAIO: { spot: { x: 2741, z: 3444, level: 0 }, radius: 8 },
    EdgevilleMonkeyBars: { spot: { x: 3121, z: 9964, level: 0 }, radius: 10 },
    GnomeCourse: { spot: { x: 2474, z: 3436, level: 0 }, radius: 20 },
    WildyAgility: { spot: COURSE_CENTRE, radius: 20 },
    BrimhavenAgility: { spot: { ...PILLARS[CENTRE_PLATFORM], level: 3 }, radius: 25 },
    SmithingBot: { spot: { x: 3188, z: 3425, level: 0 }, radius: 4 }
};

export function trainingArea(plan: ActivityPlan): TrainingArea | undefined {
    const location = String(plan.settings.location);
    switch (plan.script) {
        case 'RuneCrafter': case 'JiveRC': {
            const elemental = elementalTemples[String(plan.settings.rune)];
            if (elemental) return templeArea(elemental);
            const rune = RUNES[String(plan.settings.rune)];
            return rune && templeArea(rune.templeMapX);
        }
        case 'Miner': case 'Woodcutter': {
            const camp = resources[plan.script].find(c => c.name === location);
            return camp && { spot: camp.spot, radius: camp.campRadius ?? 16, bank: camp.bankStand };
        }
        case 'AutoFighter': case 'Thiever': case 'RangingGuild':
            return plan.travel && { spot: plan.travel, radius: Number(plan.settings.leashRadius ?? 10) };
        case 'CookBot': {
            const site = cookLocation(location);
            return site?.surface ? { spot: site.surface.stand, bank: site.bank.tile, radius: 4 } : undefined;
        }
        case 'Firemaker': {
            const plot = FIRE_SPOTS[location];
            return plot && { spot: { x: (plot.x0 + plot.x1) >> 1, z: (plot.z0 + plot.z1) >> 1, level: 0 }, bank: plot.bank, bounds: plot, radius: (plot.x1 - plot.x0) / 2 + 1 };
        }
        case 'SmelterBot': {
            const spot = plan.settings.furnaceStand as WorldTile | undefined;
            return spot && { spot, radius: 4 };
        }
        default: return fixed[plan.script];
    }
}

export function crowdKey(tile: { x: number; z: number; level?: number }): string {
    return CROWD_PREFIX + [tile.x, tile.z, tile.level ?? 0].join(',');
}

export function spotCrowded(tile: { x: number; z: number; level?: number }, memory: SessionMemory, now: number): boolean {
    return Object.entries(memory.cooldowns).some(([key, until]) => {
        if (until <= now || !key.startsWith(CROWD_PREFIX)) return false;
        const [x, z, level] = key.slice(CROWD_PREFIX.length).split(',').map(Number);
        return level === (tile.level ?? 0) && Math.max(Math.abs(x - tile.x), Math.abs(z - tile.z)) <= 8;
    });
}

export function crowdBlocked(plan: ActivityPlan, memory: SessionMemory, now: number): boolean {
    const area = trainingArea(plan);
    return !!area && spotCrowded(area.spot, memory, now);
}

function near(a: WorldTile, b: WorldTile, radius: number): boolean {
    return a.level === b.level && Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= radius;
}

export function onTrainingSite(area: TrainingArea, tile: WorldTile): boolean {
    const bounds = area.bounds;
    return near(area.spot, tile, area.radius) && !(area.bank && near(area.bank, tile, 3))
        && (!bounds || tile.x >= bounds.x0 && tile.x <= bounds.x1 && tile.z >= bounds.z0 && tile.z <= bounds.z1);
}

export class CrowdWatch {
    private seen = new Map<string, number>();
    private site = '';
    private last = 0;

    reset(): void {
        this.seen.clear();
    }

    observe(now: number, area: TrainingArea, here: WorldTile, self: string | null, players: Pick<PlayerSnapshot, 'tile' | 'name'>[]): boolean {
        const site = crowdKey(area.spot);
        if (site !== this.site || now - this.last > 2500) this.seen.clear();
        this.site = site;
        this.last = now;
        const present = new Map<string, number>();
        if (onTrainingSite(area, here)) {
            for (const player of players) {
                const name = player.name?.toLowerCase();
                if (name && name !== self?.toLowerCase() && onTrainingSite(area, player.tile) && near(here, player.tile, 8)) {
                    present.set(name, this.seen.get(name) ?? now);
                }
            }
        }
        this.seen = present;
        return [...present.values()].filter(since => now - since >= 10000).length >= 2;
    }
}
