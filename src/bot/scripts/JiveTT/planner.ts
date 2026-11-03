import { CASKET_IDS, CLUE_DB } from '../../api/ai/clues/data/cluedb.js';
import { eligibleSites, SITES, siteRequirements } from './sites.js';
import type { AccountSnapshot, ClueTier, ItemStack, JiveSettings, JiveSite, SessionState } from './types.js';

export function clueBlocker(items: readonly ItemStack[]): { id: number; tier: ClueTier; casket: boolean } | null {
    const clues = items.flatMap(item => {
        if (item.count <= 0) return [];
        const obj = CLUE_DB[item.id]?.obj ?? CASKET_IDS[item.id];
        const tier = /_(easy|medium|hard)_/.exec(obj ?? '')?.[1] as ClueTier | undefined;
        return tier ? [{ id: item.id, tier, casket: CASKET_IDS[item.id] !== undefined }] : [];
    });
    return clues.find(clue => clue.tier !== 'hard') ?? clues.find(clue => clue.casket) ?? clues[0] ?? null;
}

function seeded(value: string): number {
    let hash = 2166136261;
    for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
    return ((hash >>> 0) + 1) / 4294967297;
}

export function selectSite(snapshot: AccountSnapshot, settings: JiveSettings, session: SessionState, now: number, sites = SITES): { site: JiveSite; reason: string; score: number } | null {
    const candidates = eligibleSites(snapshot, settings, session, now, sites);
    const selected = candidates.map(site => {
        const observation = session.observations[site.id];
        const observed = observation && observation.kills > 0 ? (observation.huntingMs + observation.idleMs + observation.bankingMs) / observation.kills : 90000;
        const roll = site.targets.reduce((sum, target) => sum + target.clueChance, 0) / site.targets.length;
        const throughput = observation && observation.completed > 0 ? observation.completed / Math.max(1, observation.elapsedMs ?? observation.huntingMs + observation.idleMs + observation.bankingMs) : roll / Math.max(1000, observed);
        const score = -Math.log(seeded(`${snapshot.account.toLowerCase()}|${settings.shard}|${snapshot.world}|${site.id}`)) / (site.weight * throughput);
        return { site, score, reason: observation?.kills ? `${observation.kills} observed kills; account-seeded distribution` : 'Initial estimate; account-seeded distribution' };
    }).sort((a, b) => a.score - b.score);
    return selected[0] ?? null;
}

export type NextPlan = { kind: 'audit' } | { kind: 'clue'; id: number; casket: boolean } | { kind: 'resupply'; reason: string } | { kind: 'hunt'; site: JiveSite; reason: string } | { kind: 'park'; reason: string };

export function planNext(snapshot: AccountSnapshot, settings: JiveSettings, session: SessionState, now: number, sites = SITES): NextPlan {
    if (settings.clueTier !== 'hard') return { kind: 'park', reason: `${settings.clueTier[0].toUpperCase()}${settings.clueTier.slice(1)} clues are not implemented in JiveTT` };
    if (!snapshot.bankFresh) return { kind: 'audit' };
    const clue = clueBlocker([...snapshot.inventory, ...snapshot.bank]);
    if (clue && clue.tier !== 'hard') return { kind: 'park', reason: `Existing ${clue.tier} clue or casket ${clue.id} prevents hard clue drops` };
    if (clue) return { kind: 'clue', id: clue.id, casket: clue.casket };
    if (!settings.allowedWorlds.includes(snapshot.world)) return { kind: 'park', reason: `World ${snapshot.world} is not an allowed hunting world` };
    const selection = selectSite(snapshot, settings, session, now, sites);
    if (!selection) return { kind: 'park', reason: sites.filter(site => settings.allowedSites.includes(site.id)).map(site => `${site.label}: ${siteRequirements(site, snapshot).join(', ') || 'site cooldown'}`).join('; ') || 'No validated hunting sites are enabled' };
    if (!snapshot.suppliesReady) return { kind: 'resupply', reason: 'Next safe trip cannot be packed from current stock' };
    return { kind: 'hunt', site: selection.site, reason: selection.reason };
}
