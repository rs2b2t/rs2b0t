import { DROP_DB } from '../../src/bot/data/dropdb.js';

export interface KqItem { id: number; count: number; name?: string | null; bankId?: number }
export interface KqTile { x: number; z: number; level: number }
export interface KqAction { kind: 'eat' | 'attack'; tick: number; at: number; food: number; hp: number; xp: number }
export interface KqRopeClick { id: number; at: number; tile: KqTile }
interface KqVisitor { id: number; name: string | null; tile: KqTile; targetsMe: boolean }
interface KqEmergency { player: number; emergencyAt: number; hp: number; food: number; visitor?: KqVisitor; departedAt?: number }
type RopeGate = 'surface' | 'chamber';
interface RopeAttempt { departedAt: number; consumed: Record<RopeGate, number>; shared: RopeGate[]; crossings: Record<RopeGate, number[]> }
export interface KqSample {
    actions?: KqAction[];
    ropeClicks?: KqRopeClick[];
    at: number; tile: KqTile | null; serverTile?: KqTile | null; hp: number; sceneReady: boolean;
    pack: KqItem[]; gear: KqItem[]; bank: KqItem[]; bankOpen: boolean; restocking: boolean;
    mode: number; protectMagic: boolean; protectMelee?: boolean; prayers?: number[];
    xp: { melee: number; ranged: number };
    queens: { id: number; hp: number; total: number; tile: KqTile }[];
    visitors?: KqVisitor[];
    ground: (KqItem & { tile: KqTile })[];
    ropes?: number[];
    boosts?: Record<'attack' | 'strength' | 'defence', { base: number; effective: number }>;
}

export const CHECKLIST = {
    waitedForFourth: 'Wait for the fourth member', sharedKit: 'Prepare full kits; only leader carries ropes', passes: 'Carry four Shantay passes', bankPass: 'Use a pass from the bank', buyPass: 'Buy a pass and bank the change',
    surface: 'Descend the first rope together', ropes: 'Use both entrances; only the leader supplies missing ropes', entered: 'Enter the queen chamber together',
    corner: 'Stack near spawn with maces ready and all prayers off', search: 'Find an unseen queen after moving through the chamber, then resume combat', participation: 'All four gain melee and ranged combat XP',
    formation: 'Hold four cardinal melee positions', ranged: 'Spread into the ranged cross', killed: 'Damage and defeat both forms',
    looted: 'Pick up a boss drop', repeatFight: 'Re-engage the respawn within six seconds', bankedLoot: 'Deposit the boss drop',
    boosts: 'Sip super attack, strength and defence', eatAttack: 'Each member eats and attacks in one tick, consumes food and continues combat', escape: 'Cast Camelot, then use a dueling ring to reach the arena', independentRestock: 'Bank one depleted member while the others keep fighting',
    restocked: 'Restock all four accounts', reentered: 'Start another trip together', soak: 'Complete the requested trips and kills', pauseRetreat: 'Recover from the announced deliberate pause probe'
} as const;
export const CHECKS = Object.keys(CHECKLIST) as (keyof typeof CHECKLIST)[];
export const count = (items: KqItem[], id: number) => items.filter(item => item.id === id).reduce((n, item) => n + item.count, 0);
export const chamber = (s: KqSample) => s.tile?.level === 0 && s.tile.x >= 3456 && s.tile.x < 3520 && s.tile.z >= 9472 && s.tile.z < 9536;

const drops = new Set(DROP_DB['Kalphite Queen']);
const nest = (s: KqSample) => !!s.tile && s.tile.x >= 3456 && s.tile.x < 3520 && s.tile.z >= 9472 && s.tile.z < 9536;
const atGate = (s: KqSample | undefined, x: number, z: number, level: number) => s?.tile?.level === level && Math.abs(s.tile.x - x) <= 4 && Math.abs(s.tile.z - z) <= 4;
const atBank = (s: KqSample) => s.tile?.level === 0 && Math.abs(s.tile.x - 3308) <= 3 && Math.abs(s.tile.z - 3120) <= 3;
const deathWitness = (s: KqSample) => s.sceneReady && chamber({ ...s, tile: s.serverTile === undefined ? s.tile : s.serverTile });
const ringCharges = (s: KqSample) => s.pack.reduce((n, i) => n + ([2552, 2554, 2556, 2558, 2560, 2562, 2564, 2566].includes(i.id) ? (8 - (i.id - 2552) / 2) * i.count : 0), 0);
const kit = (s: KqSample, slot: number) => atBank(s)
    && !s.pack.some(i => [995, 557, 1823, 1825, 1827, 1829, 1831].includes(i.id))
    && [1434, 1163, 2503, 2497, 2491, 1731, 1061, 2550].every(id => count(s.gear, id) === 1)
    && count(s.gear, 892) >= 250
    && ringCharges(s) > 0 && count(s.pack, 954) === (slot === 0 ? 2 : 0)
    && [[861, 1], [2434, 2], [2448, 1], [2436, 1], [2440, 1], [2442, 1], [2550, 1], [1854, 1], [556, 5], [563, 1], [385, slot === 0 ? 14 : 16]].every(([id, n]) => count(s.pack, id) === n);

export class KqEvidence {
    milestones: Record<string, number> = {};
    crossings = { surface: [[], [], [], []] as number[][], chamber: [[], [], [], []] as number[][] };
    kills: { at: number; entries: number[] }[] = [];
    trips: { number: number; enteredAt: number; returnedAt: number; kills: number; minimumHp: number[]; foodRemaining: number[]; xpGains: KqSample['xp'][]; excusedPlayers: (KqEmergency & { departedAt: number })[] }[] = [];
    private activeTrip: { number: number; enteredAt: number; minimumHp: number[]; xpBaseline: KqSample['xp'][]; emergencies: KqEmergency[] } | null = null;
    private respawnAt = 0;
    private restarting: { since: number[]; entries: number[]; attempted: boolean; attacks: Map<number, KqAction> } | null = null;
    restarts: { spawnedAt: number; player: number; attackedAt: number; damagedAt: number }[] = [];
    ropeCounts = { surface: [] as number[], chamber: [] as number[] };
    sharedRopes: ('surface' | 'chamber')[] = [];
    ropeAttempts: RopeAttempt[] = [];
    private ropePrepared = false;
    private ropeAttempt: { proof: RopeAttempt; count: number; gate: RopeGate } | null = null;
    eatAttacks: { player: number; input: KqAction; attackAt: number; consumedAt: number; combatAt: number }[] = [];
    private eating = new Map<number, { input: KqAction; attackAt?: number; consumedAt?: number; consumedXp?: number }[]>();
    searches: { player: number; startedAt: number; foundAt: number; combatAt: number; from: KqTile; queen: KqTile; xpGained: number }[] = [];
    private searching = new Map<number, { at: number; tile: KqTile; xp: number; foundAt?: number; queen?: KqTile; moved: boolean }>();
    kits = new Set<number>();
    restocked = new Set<number>();
    passes = new Set<number>();
    private boosted = new Set<number>();
    private escaped = new Set<number>();
    escapes: { player: number; camelotAt: number; arenaAt: number }[] = [];
    private escapeSupply = new Map<number, { air: number; law: number; ring: number; camelotAt: number }>();
    independentRestocks: { player: number; combatPlayer: number; departedAt: number; bankedAt: number; combatAt: number; xpGains: KqSample['xp']; queenDamage: number }[] = [];
    private absences = new Map<number, { departedAt: number; bankedAt: number; witnesses: Map<number, { xp: KqSample['xp']; queenDamage: number; combatAt: number }> }>();
    xpGains = { melee: [0, 0, 0, 0], ranged: [0, 0, 0, 0] };
    loot: { player: number; id: number; bankId: number; deathAt: number; name?: string | null; count: number; inventoryBefore: number; bankBefore: number; pickedAt?: number; bankedAt?: number }[] = [];
    private previous: KqSample[] | null = null;
    private xpBaseline: KqSample['xp'][] = [];
    private bankBaseline: KqItem[][] = [];
    private passStock = [0, 0, 0, 0];
    private purchases = new Map<number, { change: number; bankBefore: number }>();
    private latestBank: KqItem[][] = [[], [], [], []];
    private bare = { surface: false, chamber: false };
    private phaseHp = new Map<number, number>();
    private damaged = new Set<number>();
    private flyingAlive = false;
    private deadAt = 0;
    private pendingDeath: { entries: number[]; witnesses: number[] } | null = null;
    private queenTile: KqTile | null = null;
    private beforeDeath: Set<string> = new Set();
    private groundKey = (g: KqItem & { tile: KqTile }) => `${g.id}:${g.tile.x}:${g.tile.z}:${g.count}`;

    readyForPause(samples: (KqSample & { stage?: string; runner?: string })[]): boolean {
        const trip = this.activeTrip;
        return !!trip && trip.number > 1 && samples.length === 4 && samples.every((s, i) => s.sceneReady && chamber(s)
            && s.runner === 'running' && s.stage === 'fight' && !s.restocking
            && s.xp.melee + s.xp.ranged > trip.xpBaseline[i].melee + trip.xpBaseline[i].ranged);
    }

    observe(samples: KqSample[]): void {
        if (samples.length !== 4) throw new Error('Expected four client observations');
        const now = Math.max(...samples.map(s => s.at));
        if (samples.some(s => s.hp <= 0)) throw new Error('A team member died');
        this.retainDeathWitnesses(samples);
        this.observeRopes(samples);
        const observedQueens = samples.filter(s => s.sceneReady && chamber(s)).flatMap(s => s.queens);
        const waiting = observedQueens.some(q => q.id === 1160 && q.hp === 0 && q.total > 0 && this.flyingAlive)
            || this.deadAt > this.respawnAt && !observedQueens.some(q => q.id === 1158 && (q.hp > 0 || q.total === 0));
        samples.forEach((s, i) => {
            const visible = s.queens.find(q => [1158, 1160].includes(q.id) && (q.hp > 0 || q.total === 0));
            const previous = this.previous?.[i];
            if (waiting || !chamber(s) || s.restocking || (!visible && s.queens.some(q => [1158, 1160].includes(q.id) && q.total > 0))) this.searching.delete(i);
            else if (s.sceneReady && !visible && previous?.sceneReady && (!chamber(previous) || previous.queens.some(q => [1158, 1160].includes(q.id) && (q.hp > 0 || q.total === 0))) && !this.searching.has(i)) {
                this.searching.set(i, { at: s.at, tile: { ...s.tile! }, xp: s.xp.melee + s.xp.ranged, moved: false });
            }
            const search = this.searching.get(i);
            if (search && s.sceneReady && chamber(s)) {
                if (!visible) search.moved ||= Math.max(Math.abs(s.tile!.x - search.tile.x), Math.abs(s.tile!.z - search.tile.z)) >= 4;
                if (visible && !search.foundAt) {
                    if (search.moved) {
                        search.foundAt = s.at;
                        search.queen = visible.tile;
                        search.xp = s.xp.melee + s.xp.ranged;
                    } else this.searching.delete(i);
                }
                if (search.foundAt && search.queen && s.xp.melee + s.xp.ranged > search.xp) {
                    this.searches.push({ player: i, startedAt: search.at, foundAt: search.foundAt, combatAt: s.at, from: search.tile, queen: search.queen, xpGained: s.xp.melee + s.xp.ranged - search.xp });
                    this.milestones.search ??= s.at;
                    this.searching.delete(i);
                }
            }
            const candidates = this.eating.get(i) ?? [];
            for (const action of s.actions ?? []) {
                if (action.kind === 'eat' && chamber(s)) candidates.push({ input: action });
                const pending = candidates.at(-1);
                if (pending && action.kind === 'attack' && action.tick === pending.input.tick && action.at >= pending.input.at) pending.attackAt = action.at;
            }
            this.eating.set(i, candidates.filter(eating => {
                if (s.at - eating.input.at > 10_000 || !chamber(s)) return false;
                if (eating.consumedAt === undefined && count(s.pack, 385) < eating.input.food) {
                    eating.consumedAt = s.at;
                    eating.consumedXp = s.xp.melee + s.xp.ranged;
                }
                if (eating.attackAt !== undefined && eating.consumedAt !== undefined && s.xp.melee + s.xp.ranged > eating.consumedXp!) {
                    this.eatAttacks.push({ player: i, input: eating.input, attackAt: eating.attackAt, consumedAt: eating.consumedAt, combatAt: s.at });
                    return false;
                }
                return true;
            }));
            if (s.bankOpen && s.bank.length) this.latestBank[i] = structuredClone(s.bank);
            if (s.bankOpen && count(s.pack, 1854) === 0) this.passStock[i] = count(s.bank, 1854);
            if (s.bankOpen && count(s.pack, 1854) > 0 && count(s.pack, 995) === 0 && this.passStock[i] > count(s.bank, 1854)) this.milestones.bankPass ??= now;
            if (count(s.pack, 1854) > 0 && count(s.pack, 995) === 95 && !this.purchases.has(i)) this.purchases.set(i, { change: 95, bankBefore: count(this.latestBank[i], 995) });
            const purchase = this.purchases.get(i);
            if (purchase && atBank(s) && s.bankOpen && count(s.pack, 995) === 0 && count(s.bank, 995) >= purchase.bankBefore + purchase.change) this.milestones.buyPass ??= now;
            if (s.sceneReady && nest(s)) {
                const before = this.previous?.[i] && nest(this.previous[i]) ? this.escapeSupply.get(i) : undefined;
                this.escapeSupply.set(i, { air: Math.max(before?.air ?? 0, count(s.pack, 556)), law: Math.max(before?.law ?? 0, count(s.pack, 563)), ring: Math.max(before?.ring ?? 0, ringCharges(s)), camelotAt: 0 });
            }
            const escape = this.escapeSupply.get(i);
            if (escape && s.sceneReady && atGate(s, 2757, 3478, 0) && escape.air - count(s.pack, 556) === 5 && escape.law - count(s.pack, 563) === 1 && escape.ring === ringCharges(s)) escape.camelotAt ||= now;
            if (escape?.camelotAt && s.sceneReady && atGate(s, 3315, 3235, 0) && escape.ring - ringCharges(s) === 1) {
                this.escaped.add(i);
                this.escapes.push({ player: i, camelotAt: escape.camelotAt, arenaAt: now });
                this.escapeSupply.delete(i);
            }
            if (nest(s) && s.boosts && Object.values(s.boosts).every(b => b.effective > b.base)
                && [[145, 147, 149], [157, 159, 161], [163, 165, 167]].every(ids => ids.some(id => count(s.pack, id) > 0))) this.boosted.add(i);
            if (kit(s, i)) {
                this.passes.add(i);
                if (!this.kits.has(i)) {
                    this.xpBaseline[i] = { ...s.xp };
                }
                this.bankBaseline[i] = structuredClone(this.latestBank[i]);
                this.kits.add(i);
                if (this.milestones.killed && !s.bankOpen) this.restocked.add(i);
            }
            if (this.xpBaseline[i]) {
                this.xpGains.melee[i] = s.xp.melee - this.xpBaseline[i].melee;
                this.xpGains.ranged[i] = s.xp.ranged - this.xpBaseline[i].ranged;
            }
            if (!this.crossings.surface[i].length && s.ropes?.includes(3827)) this.bare.surface = true;
            if (!this.crossings.chamber[i].length && s.ropes?.includes(3830)) this.bare.chamber = true;
            for (const gate of ['surface', 'chamber'] as const) {
                const crossed = gate === 'surface' ? nest(s) && s.tile?.level === 2 && atGate(previous, 3226, 3108, 0) : chamber(s) && atGate(previous, 3508, 9497, 2);
                if (!crossed || !s.sceneReady) continue;
                this.crossings[gate][i].push(s.at);
                const attempt = this.ropeAttempt?.proof;
                if (attempt) {
                    attempt.crossings[gate][i] = s.at;
                    if (i === 0 && attempt.consumed[gate] === 0) {
                        const usable = gate === 'surface' ? 3828 : 3831;
                        const clicked = s.ropeClicks?.some(c => c.id === usable && c.at >= attempt.departedAt && s.at >= c.at && s.at - c.at <= 4000
                            && (gate === 'surface' ? atGate({ ...s, tile: c.tile }, 3226, 3108, 0) : atGate({ ...s, tile: c.tile }, 3508, 9497, 2)));
                        if (!previous?.ropes?.includes(usable) && !clicked) throw new Error(`Unexpected rope consumption: unverified shared ${gate} rope`);
                        attempt.shared.push(gate);
                    }
                }
                if (this.crossings[gate][i].length === 1) {
                    this.ropeCounts[gate][i] = count(s.pack, 954);
                    const usable = gate === 'surface' ? 3828 : 3831;
                    const clicked = s.ropeClicks?.some(c => c.id === usable && s.at >= c.at && s.at - c.at <= 4000
                        && (gate === 'surface' ? atGate({ ...s, tile: c.tile }, 3226, 3108, 0) : atGate({ ...s, tile: c.tile }, 3508, 9497, 2)));
                    if (i === 0 && count(s.pack, 954) === (gate === 'surface' ? 2 : this.ropeCounts.surface[0])
                        && (previous?.ropes?.includes(usable) || clicked)) this.sharedRopes.push(gate);
                }
            }
        });
        if (this.kits.size === 4) this.milestones.sharedKit ??= now;
        if (new Set(this.eatAttacks.map(e => e.player)).size === 4) this.milestones.eatAttack ??= now;
        if (this.passes.size === 4) this.milestones.passes ??= now;
        if (this.boosted.size === 4) this.milestones.boosts ??= now;
        if (this.escaped.size === 4) this.milestones.escape ??= now;
        if (this.xpGains.melee.every(n => n > 0) && this.xpGains.ranged.every(n => n > 0)) this.milestones.participation ??= now;
        if (this.restocked.size === 4) this.milestones.restocked ??= now;
        for (const gate of ['surface', 'chamber'] as const) {
            const crossings = this.crossings[gate];
            const completed = Math.min(...crossings.map(times => times.length));
            for (let n = 0; n < completed; n++) {
                const times = crossings.map(t => t[n]);
                if (Math.max(...times) - Math.min(...times) > 3000) throw new Error(`${gate} entry ${n + 1} exceeded three seconds`);
            }
            if (completed) this.milestones[gate === 'surface' ? 'surface' : 'entered'] ??= now;
            if (gate === 'chamber' && completed > 1 && this.milestones.restocked && samples.every(chamber)) this.milestones.reentered ??= now;
        }
        if (this.milestones.entered && this.milestones.surface) {
            const surface = this.ropeCounts.surface;
            const lower = this.ropeCounts.chamber;
            if (surface.slice(1).some(n => n !== 0) || lower.slice(1).some(n => n !== 0)
                || ![0, 1].includes(2 - surface[0]) || ![0, 1].includes(surface[0] - lower[0])
                || (this.bare.surface && surface[0] !== 1 && !this.sharedRopes.includes('surface'))
                || (this.bare.chamber && lower[0] !== surface[0] - 1 && !this.sharedRopes.includes('chamber'))) throw new Error('Unexpected rope consumption');
            this.milestones.ropes ??= now;
        }
        this.observeRestocks(samples, now);
        const observers = samples.filter(s => s.sceneReady && chamber(s));
        const active = samples.filter(s => !s.restocking);
        const activeInChamber = active.length > 0 && active.every(s => s.sceneReady && chamber(s));
        const queens = observers.flatMap(s => s.queens);
        const queen = queens.find(q => q.id === 1158 || q.id === 1160);
        if (queen) this.queenTile = queen.tile;
        if (!this.milestones.formation && samples.every((s, i) => chamber(s) && s.protectMagic && s.mode === 1 && count(s.gear, 1434) === 1
            && s.queens.some(q => q.id === 1158 && s.tile?.x === q.tile.x + [-3, 3, 0, 0][i] && s.tile.z === q.tile.z + [0, 0, 3, -3][i]))) this.milestones.formation = now;
        if (queen?.id === 1158 && this.deadAt && this.respawnAt < this.deadAt) {
            this.respawnAt = now;
            const lastKill = this.kills.at(-1);
            this.restarting = lastKill?.entries.every((n, i) => n === this.crossings.chamber[i].length) ? {
                since: samples.map((s, i) => Math.max(this.deadAt, this.previous?.[i]?.at ?? s.at)),
                entries: [...lastKill.entries], attempted: false, attacks: new Map()
            } : null;
            this.phaseHp.clear();
            this.damaged.clear();
            if (queen.total > 0 && queen.hp < queen.total) this.damaged.add(1158);
        }
        if (queen) {
            const before = this.phaseHp.get(queen.id);
            if (before !== undefined && queen.total > 0 && queen.hp < before) this.damaged.add(queen.id);
            if (queen.hp > 0) {
                this.phaseHp.set(queen.id, queen.hp);
                if (queen.id === 1160) this.flyingAlive = true;
            }
            if (queen.id === 1160 && queen.hp > 0 && samples.every((s, i) => {
                if (!s.tile || !chamber(s) || !s.protectMagic || s.mode !== 1 || count(s.gear, 861) !== 1) return false;
                const dx = s.tile.x - queen.tile.x;
                const dz = s.tile.z - queen.tile.z;
                const radius = Math.max(Math.abs(dx), Math.abs(dz));
                return radius >= 3 && radius <= 9 && [dx < 0 && dz === 0, dx > 0 && dz === 0, dx === 0 && dz > 0, dx === 0 && dz < 0][i]
                    && samples.every((other, j) => i === j || !!other.tile && Math.max(Math.abs(s.tile!.x - other.tile.x), Math.abs(s.tile!.z - other.tile.z)) > 5);
            })) this.milestones.ranged ??= now;
            if (queen.id === 1160 && queen.hp === 0 && queen.total > 0 && this.flyingAlive) {
                this.deadAt = now;
                this.pendingDeath = { entries: this.crossings.chamber.map(t => t.length), witnesses: samples.flatMap((s, i) => deathWitness(s) && s.queens.some(q => q.id === 1160 && q.hp === 0 && q.total > 0) ? [i] : []) };
                this.flyingAlive = false;
                this.beforeDeath = new Set(this.previous?.flatMap(s => s.ground.map(this.groundKey)) ?? []);
            }
        }
        this.retainDeathWitnesses(samples);
        if (this.pendingDeath && !queen && this.damaged.has(1160)) {
            if (this.damaged.has(1158)) this.milestones.killed ??= now;
            this.kills.push({ at: this.deadAt, entries: this.pendingDeath.entries });
            this.pendingDeath = null;
        }
        if (this.kills.length && !queen && activeInChamber && active.every(s => s.tile?.x === 3470 && s.tile.z === 9503 && s.prayers?.length === 0 && count(s.gear, 1434) === 1)) this.milestones.corner ??= now;
        const restarting = this.restarting;
        if (restarting) {
            samples.forEach((s, player) => {
                if (!chamber(s) || s.restocking || restarting.entries[player] !== this.crossings.chamber[player].length) {
                    restarting.attacks.delete(player);
                    return;
                }
                if (!s.sceneReady) return;
                for (const action of s.actions ?? []) {
                    if (action.kind !== 'attack' || action.at < restarting.since[player] || action.at > this.respawnAt + 6000 || action.at > s.at) continue;
                    if (!restarting.attacks.has(player)) restarting.attacks.set(player, action);
                    restarting.attempted = true;
                }
                const attack = restarting.attacks.get(player);
                if (attack && s.at >= attack.at && s.xp.melee + s.xp.ranged > attack.xp && !this.restarts.some(r => r.spawnedAt === this.respawnAt)) {
                    this.restarts.push({ spawnedAt: this.respawnAt, player, attackedAt: attack.at, damagedAt: s.at });
                    this.milestones.repeatFight ??= now;
                }
            });
            if (this.deadAt >= this.respawnAt || !samples.some(s => chamber(s) && !s.restocking)) this.restarting = null;
            else if (queen?.id === 1158 && activeInChamber && now - this.respawnAt > 6000 && !restarting.attempted) {
                throw new Error('The team did not re-engage within six seconds of the queen respawning');
            }
        }
        if (this.kills.some(k => k.at === this.deadAt) && this.queenTile && now - this.deadAt < 5000) {
            samples.forEach((s, player) => {
                for (const item of s.ground) {
                    if (!drops.has(item.name ?? '')) continue;
                    if (item.id === 892 && item.count < 100) continue;
                    if (item.tile.level !== 0 || Math.abs(item.tile.x - this.queenTile!.x) > 3 || Math.abs(item.tile.z - this.queenTile!.z) > 3) continue;
                    if (this.beforeDeath.has(this.groundKey(item)) || this.loot.some(l => l.player === player && l.id === item.id && l.deathAt === this.deadAt)) continue;
                    this.loot.push({ player, id: item.id, deathAt: this.deadAt, bankId: item.bankId ?? item.id, name: item.name, count: item.count, inventoryBefore: count(s.pack, item.id), bankBefore: count(this.bankBaseline[player] ?? [], item.bankId ?? item.id) });
                }
            });
        }
        for (const item of this.loot) {
            const s = samples[item.player];
            if (chamber(s) && count(s.pack, item.id) >= item.inventoryBefore + item.count) {
                item.pickedAt ??= now;
                this.milestones.looted ??= now;
            }
            if (item.pickedAt && atBank(s) && s.bankOpen && count(s.pack, item.id) < item.inventoryBefore + item.count && count(s.bank, item.bankId) >= item.bankBefore + item.count) {
                item.bankedAt ??= now;
                this.milestones.bankedLoot ??= now;
            }
        }
        const entries = Math.min(...this.crossings.chamber.map(t => t.length));
        if (!this.activeTrip && entries > this.trips.length && samples.every(chamber)) {
            this.activeTrip = { number: entries, enteredAt: Math.min(...this.crossings.chamber.map(t => t[entries - 1])), minimumHp: samples.map(s => s.hp), xpBaseline: samples.map(s => ({ ...s.xp })), emergencies: [] };
        }
        if (this.activeTrip) {
            const trip = this.activeTrip;
            trip.minimumHp = samples.map((s, i) => Math.min(trip.minimumHp[i], s.hp));
            samples.forEach((s, player) => {
                if (!s.sceneReady) return;
                const index = trip.emergencies.findIndex(e => e.player === player);
                const emergency = trip.emergencies[index];
                const visitor = s.visitors?.find(v => v.targetsMe && ['genie', 'mysterious old man'].includes(v.name?.toLowerCase() ?? '')
                    && s.tile?.level === v.tile.level && Math.max(Math.abs(s.tile.x - v.tile.x), Math.abs(s.tile.z - v.tile.z)) <= 6);
                if (chamber(s) && (count(s.pack, 385) <= 1 || visitor) && emergency?.departedAt === undefined) {
                    const observed = { player, emergencyAt: s.at, hp: s.hp, food: count(s.pack, 385), ...(visitor ? { visitor: structuredClone(visitor) } : {}) };
                    if (index < 0) trip.emergencies.push(observed);
                    else trip.emergencies[index] = observed;
                }
                if (emergency && s.restocking && !chamber(s) && this.previous?.[player] && chamber(this.previous[player])
                    && s.at - emergency.emergencyAt >= 0 && s.at - emergency.emergencyAt <= 10_000) emergency.departedAt ??= s.at;
            });
            if (samples.every(atBank)) {
                const { xpBaseline, emergencies, ...details } = trip;
                const xpGains = samples.map((s, i) => ({ melee: s.xp.melee - xpBaseline[i].melee, ranged: s.xp.ranged - xpBaseline[i].ranged }));
                const kills = this.kills.filter(k => k.entries.every(n => n === trip.number)).length;
                const excusedPlayers = emergencies.flatMap(e => kills > 0 && e.departedAt !== undefined && xpGains[e.player].melee + xpGains[e.player].ranged <= 0 ? [{ ...e, departedAt: e.departedAt }] : []);
                this.trips.push({ ...details, returnedAt: now, kills, foodRemaining: samples.map(s => count(s.pack, 385)), xpGains, excusedPlayers });
                this.activeTrip = null;
                if (kills > 0 && xpGains.some((xp, i) => xp.melee + xp.ranged <= 0 && !excusedPlayers.some(e => e.player === i))) throw new Error(`A member did not contribute combat XP on trip ${trip.number}`);
            }
        }
        this.previous = structuredClone(samples.map((s, i) => s.sceneReady ? s : this.previous?.[i] ?? s));
    }

    private retainDeathWitnesses(samples: KqSample[]): void {
        if (!this.pendingDeath) return;
        this.pendingDeath.witnesses = this.pendingDeath.witnesses.filter(i => deathWitness(samples[i]) && this.pendingDeath!.entries[i] === this.crossings.chamber[i].length);
        if (this.pendingDeath.witnesses.length) return;
        this.pendingDeath = null;
        this.deadAt = 0;
        this.flyingAlive = false;
        this.phaseHp.clear();
        this.damaged.clear();
        this.beforeDeath.clear();
        this.queenTile = null;
        this.restarting = null;
    }

    private observeRopes(samples: KqSample[]): void {
        const leader = samples[0];
        if (leader.sceneReady && atBank(leader)) {
            if (this.ropeAttempt) this.ropePrepared = false;
            this.ropeAttempt = null;
            this.ropePrepared ||= kit(leader, 0);
        } else if (leader.sceneReady && leader.tile && this.ropePrepared) {
            const proof: RopeAttempt = { departedAt: leader.at, consumed: { surface: 0, chamber: 0 }, shared: [], crossings: { surface: [], chamber: [] } };
            this.ropeAttempts.push(proof);
            this.ropeAttempt = { proof, count: 2, gate: 'surface' };
            this.ropePrepared = false;
        }
        const attempt = this.ropeAttempt;
        if (!attempt) return;
        if (samples.slice(1).some(s => s.sceneReady && !atBank(s) && count(s.pack, 954) !== 0)) throw new Error('Unexpected rope consumption: a follower carries ropes');
        if (!leader.sceneReady) return;
        const remaining = count(leader.pack, 954);
        const used = attempt.count - remaining;
        if (used < 0) throw new Error('Unexpected rope consumption: ropes increased outside the bank');
        attempt.proof.consumed[attempt.gate] += used;
        if (attempt.proof.consumed[attempt.gate] > 1) throw new Error(`Unexpected rope consumption: more than one ${attempt.gate} rope used`);
        if (used) attempt.proof.shared = attempt.proof.shared.filter(gate => gate !== attempt.gate);
        attempt.count = remaining;
        if (atGate(leader, 3508, 9497, 2)) attempt.gate = 'chamber';
    }

    private observeRestocks(samples: KqSample[], now: number): void {
        samples.forEach((s, player) => {
            if (!s.restocking || chamber(s)) { this.absences.delete(player); return; }
            let absence = this.absences.get(player);
            if (!absence) {
                if (!s.sceneReady || !this.previous?.[player] || !chamber(this.previous[player])) return;
                absence = { departedAt: now, bankedAt: s.bankOpen && atBank(s) ? now : 0, witnesses: new Map() };
                samples.forEach((other, i) => {
                    if (other.sceneReady && chamber(other) && !other.restocking) absence!.witnesses.set(i, { xp: { ...other.xp }, queenDamage: 0, combatAt: 0 });
                });
                this.absences.set(player, absence);
                return;
            }
            if (s.sceneReady && s.bankOpen && atBank(s)) absence.bankedAt ||= now;
            for (const [i, witness] of absence.witnesses) {
                const other = samples[i];
                if (!other.sceneReady || !chamber(other) || other.restocking) { absence.witnesses.delete(i); continue; }
                const xpGains = { melee: other.xp.melee - witness.xp.melee, ranged: other.xp.ranged - witness.xp.ranged };
                for (const queen of other.queens) {
                    const before = this.previous?.[i].queens.find(q => q.id === queen.id);
                    if ([1158, 1160].includes(queen.id) && queen.total > 0 && before && before.hp > queen.hp) witness.queenDamage += before.hp - queen.hp;
                }
                if (xpGains.melee + xpGains.ranged > 0) witness.combatAt ||= now;
                if (!absence.bankedAt || !witness.combatAt) continue;
                this.independentRestocks.push({ player, combatPlayer: i, departedAt: absence.departedAt, bankedAt: absence.bankedAt, combatAt: witness.combatAt, xpGains, queenDamage: witness.queenDamage });
                this.milestones.independentRestock ??= now;
                this.absences.delete(player);
                break;
            }
        });
    }
}
