import { DROP_DB } from '../../src/bot/data/dropdb.js';

export interface KqItem { id: number; count: number; name?: string | null; bankId?: number }
export interface KqTile { x: number; z: number; level: number }
export interface KqSample {
    at: number; tile: KqTile | null; hp: number; sceneReady: boolean;
    pack: KqItem[]; gear: KqItem[]; bank: KqItem[]; bankOpen: boolean;
    mode: number; protectMagic: boolean; protectMelee?: boolean; prayers?: number[];
    xp: { melee: number; ranged: number };
    queens: { id: number; hp: number; total: number; tile: KqTile }[];
    ground: (KqItem & { tile: KqTile })[];
    ropes?: number[];
    boosts?: Record<'attack' | 'strength' | 'defence', { base: number; effective: number }>;
}

export const CHECKLIST = {
    waitedForFourth: 'Wait for the fourth member', sharedKit: 'Prepare full kits; only leader carries ropes', passes: 'Carry four Shantay passes', bankPass: 'Use a pass from the bank', buyPass: 'Buy a pass and bank the change',
    surface: 'Descend the first rope together', ropes: 'Place both missing ropes', entered: 'Enter the queen chamber together',
    corner: 'Stack near spawn with maces ready and all prayers off', participation: 'All four gain melee and ranged combat XP',
    formation: 'Hold four cardinal melee positions', ranged: 'Spread into the ranged cross', killed: 'Damage and defeat both forms',
    looted: 'Pick up a boss drop', repeatFight: 'Re-engage the respawn within six seconds', bankedLoot: 'Deposit the boss drop',
    boosts: 'Sip super attack, strength and defence', escape: 'Use dueling rings to escape to the arena',
    restocked: 'Restock all four accounts', reentered: 'Start another trip together', soak: 'Complete the requested trips and kills', pauseRetreat: 'Retreat when a member pauses'
} as const;
export const CHECKS = Object.keys(CHECKLIST) as (keyof typeof CHECKLIST)[];
export const count = (items: KqItem[], id: number) => items.filter(item => item.id === id).reduce((n, item) => n + item.count, 0);
export const chamber = (s: KqSample) => s.tile?.level === 0 && s.tile.x >= 3456 && s.tile.x < 3520 && s.tile.z >= 9472 && s.tile.z < 9536;

const drops = new Set(DROP_DB['Kalphite Queen']);
const nest = (s: KqSample) => !!s.tile && s.tile.x >= 3456 && s.tile.x < 3520 && s.tile.z >= 9472 && s.tile.z < 9536;
const atGate = (s: KqSample | undefined, x: number, z: number, level: number) => s?.tile?.level === level && Math.abs(s.tile.x - x) <= 4 && Math.abs(s.tile.z - z) <= 4;
const atBank = (s: KqSample) => s.tile?.level === 0 && Math.abs(s.tile.x - 3308) <= 3 && Math.abs(s.tile.z - 3120) <= 3;
const ringCharges = (s: KqSample) => s.pack.reduce((n, i) => n + ([2552, 2554, 2556, 2558, 2560, 2562, 2564, 2566].includes(i.id) ? (8 - (i.id - 2552) / 2) * i.count : 0), 0);
const kit = (s: KqSample, slot: number) => atBank(s)
    && !s.pack.some(i => [995, 556, 557, 563, 1823, 1825, 1827, 1829, 1831].includes(i.id))
    && [1434, 1163, 2503, 2497, 2491, 1731, 1061, 2550].every(id => count(s.gear, id) === 1)
    && count(s.gear, 892) >= 250
    && ringCharges(s) > 0 && count(s.pack, 954) === (slot === 0 ? 2 : 0)
    && [[861, 1], [2434, 2], [2448, 1], [2436, 1], [2440, 1], [2442, 1], [2550, 1], [1854, 1], [385, slot === 0 ? 16 : 18]].every(([id, n]) => count(s.pack, id) === n);

export class KqEvidence {
    milestones: Record<string, number> = {};
    crossings = { surface: [[], [], [], []] as number[][], chamber: [[], [], [], []] as number[][] };
    kills: { at: number; entries: number[] }[] = [];
    trips: { number: number; enteredAt: number; returnedAt: number; kills: number; minimumHp: number[]; foodRemaining: number[]; xpGains: KqSample['xp'][] }[] = [];
    private activeTrip: { number: number; enteredAt: number; minimumHp: number[]; xpBaseline: KqSample['xp'][] } | null = null;
    private respawnAt = 0;
    restarts: { spawnedAt: number; damagedAt: number }[] = [];
    ropeCounts = { surface: [] as number[], chamber: [] as number[] };
    kits = new Set<number>();
    restocked = new Set<number>();
    passes = new Set<number>();
    private boosted = new Set<number>();
    private escaped = new Set<number>();
    private nestRings: (number | null)[] = [null, null, null, null];
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
    private queenTile: KqTile | null = null;
    private beforeDeath: Set<string> = new Set();
    private groundKey = (g: KqItem & { tile: KqTile }) => `${g.id}:${g.tile.x}:${g.tile.z}:${g.count}`;

    observe(samples: KqSample[]): void {
        if (samples.length !== 4) throw new Error('Expected four client observations');
        const now = Math.max(...samples.map(s => s.at));
        if (samples.some(s => s.hp <= 0)) throw new Error('A team member died');
        samples.forEach((s, i) => {
            if (s.bankOpen && s.bank.length) this.latestBank[i] = structuredClone(s.bank);
            if (s.bankOpen && count(s.pack, 1854) === 0) this.passStock[i] = count(s.bank, 1854);
            if (s.bankOpen && count(s.pack, 1854) > 0 && count(s.pack, 995) === 0 && this.passStock[i] > count(s.bank, 1854)) this.milestones.bankPass ??= now;
            if (count(s.pack, 1854) > 0 && count(s.pack, 995) === 95 && !this.purchases.has(i)) this.purchases.set(i, { change: 95, bankBefore: count(this.latestBank[i], 995) });
            const purchase = this.purchases.get(i);
            if (purchase && atBank(s) && s.bankOpen && count(s.pack, 995) === 0 && count(s.bank, 995) >= purchase.bankBefore + purchase.change) this.milestones.buyPass ??= now;
            if (nest(s)) this.nestRings[i] = Math.max(this.nestRings[i] ?? 0, ringCharges(s));
            if (s.tile?.level === 0 && Math.abs(s.tile.x - 3315) <= 4 && Math.abs(s.tile.z - 3235) <= 4 && this.nestRings[i] !== null && this.nestRings[i]! - ringCharges(s) === 1) {
                this.escaped.add(i);
                this.nestRings[i] = null;
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
            const previous = this.previous?.[i];
            for (const gate of ['surface', 'chamber'] as const) {
                const crossed = gate === 'surface' ? nest(s) && s.tile?.level === 2 && atGate(previous, 3226, 3108, 0) : chamber(s) && atGate(previous, 3508, 9497, 2);
                if (!crossed || !s.sceneReady) continue;
                this.crossings[gate][i].push(s.at);
                if (this.crossings[gate][i].length === 1) this.ropeCounts[gate][i] = count(s.pack, 954);
            }
        });
        if (this.kits.size === 4) this.milestones.sharedKit ??= now;
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
        if (this.milestones.entered) {
            const surface = this.ropeCounts.surface;
            const lower = this.ropeCounts.chamber;
            if (surface.slice(1).some(n => n !== 0) || lower.slice(1).some(n => n !== 0)
                || (this.bare.surface && surface[0] !== 1) || (this.bare.chamber && lower[0] !== surface[0] - 1)) throw new Error('Unexpected rope consumption');
            this.milestones.ropes ??= now;
        }
        const queens = samples.flatMap(s => s.queens);
        const queen = queens.find(q => q.id === 1158 || q.id === 1160);
        if (queen) this.queenTile = queen.tile;
        if (!this.milestones.formation && samples.every((s, i) => chamber(s) && s.protectMagic && s.mode === 1 && count(s.gear, 1434) === 1
            && s.queens.some(q => q.id === 1158 && s.tile?.x === q.tile.x + [-3, 3, 0, 0][i] && s.tile.z === q.tile.z + [0, 0, 3, -3][i]))) this.milestones.formation = now;
        if (queen?.id === 1158 && this.deadAt && this.respawnAt < this.deadAt) {
            this.respawnAt = now;
            this.phaseHp.clear();
            this.damaged.clear();
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
                this.flyingAlive = false;
                this.beforeDeath = new Set(this.previous?.flatMap(s => s.ground.map(this.groundKey)) ?? []);
            }
        }
        if (this.deadAt && !queen && samples.every(s => s.sceneReady && chamber(s)) && this.damaged.has(1160)) {
            if (this.damaged.has(1158)) this.milestones.killed ??= now;
            if (!this.kills.some(k => k.at === this.deadAt)) this.kills.push({ at: this.deadAt, entries: this.crossings.chamber.map(t => t.length) });
        }
        if (this.kills.length && !queen && samples.every(s => s.tile?.x === 3470 && s.tile.z === 9503 && s.tile.level === 0 && s.prayers?.length === 0 && count(s.gear, 1434) === 1)) this.milestones.corner ??= now;
        const lastKill = this.kills.at(-1);
        if (lastKill && queen?.id === 1158 && this.respawnAt > lastKill.at && samples.every(chamber)
            && lastKill.entries.every((n, i) => n === this.crossings.chamber[i].length) && !this.restarts.some(r => r.spawnedAt === this.respawnAt)) {
            if (now - this.respawnAt > 6000) throw new Error('The team did not re-engage within six seconds of the queen respawning');
            if (this.damaged.has(1158)) {
                this.restarts.push({ spawnedAt: this.respawnAt, damagedAt: now });
                this.milestones.repeatFight ??= now;
            }
        }
        if (this.kills.length && this.queenTile && now - this.deadAt < 5000) {
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
            this.activeTrip = { number: entries, enteredAt: Math.min(...this.crossings.chamber.map(t => t[entries - 1])), minimumHp: samples.map(s => s.hp), xpBaseline: samples.map(s => ({ ...s.xp })) };
        }
        if (this.activeTrip) {
            const trip = this.activeTrip;
            trip.minimumHp = samples.map((s, i) => Math.min(trip.minimumHp[i], s.hp));
            if (samples.every(atBank)) {
                const { xpBaseline, ...details } = trip;
                const xpGains = samples.map((s, i) => ({ melee: s.xp.melee - xpBaseline[i].melee, ranged: s.xp.ranged - xpBaseline[i].ranged }));
                const kills = this.kills.filter(k => k.entries.every(n => n === trip.number)).length;
                this.trips.push({ ...details, returnedAt: now, kills, foodRemaining: samples.map(s => count(s.pack, 385)), xpGains });
                this.activeTrip = null;
                if (kills > 0 && xpGains.some(xp => xp.melee + xp.ranged <= 0)) throw new Error(`A member did not contribute combat XP on trip ${trip.number}`);
            }
        }
        this.previous = structuredClone(samples.map((s, i) => s.sceneReady ? s : this.previous?.[i] ?? s));
    }
}
