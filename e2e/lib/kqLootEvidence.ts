import { chamber, count, type KqAction, type KqItem, type KqSample, type KqTile } from './kqEvidence.js';

export const LOOT_FIXTURE = [
    { id: 3140, name: 'Dragon chainbody', debugName: 'dragon_chainbody', count: 1 },
    { id: 1113, name: 'Rune chainbody', debugName: 'rune_chainbody', count: 1 },
    { id: 1731, name: 'Amulet of power', debugName: 'amulet_of_power', count: 1 },
    { id: 892, name: 'Rune arrow', debugName: 'rune_arrow', count: 137 }
] as const;
export const LOOT_CHECKLIST = {
    waitedForFourth: 'Wait for the fourth member', sharedKit: 'Prepare the ordinary four-player kit', surface: 'Descend the first rope together', entered: 'Enter the chamber together',
    lootDonor: 'Drop fixture items with a separate donor and verify its safe logout', lootPublic: 'See all four public fixture drops during active queen combat',
    lootPicked: 'Collect all three valuables during active combat', lootArrows: 'Leave public Rune arrows untouched during combat',
    lootArrowsRecovered: 'Recover ground Rune arrows during a verified respawn wait',
    lootSustain: 'Observe normal eating, food consumption and continued own combat XP', lootBanked: 'Deposit all three extra items at Shantay'
} as const;
export interface KqLootTake { id: number; tile: KqTile; at: number; tick: number; owned: number; food: number; hp: number }
export interface LootSample extends KqSample { tick: number; stage?: string; runner: string; chat: string[]; lootTakes: KqLootTake[] }
const same = (a: KqTile | null | undefined, b: KqTile) => !!a && a.level === b.level && a.x === b.x && a.z === b.z;
const owned = (s: KqSample, id: number) => count(s.pack, id) + count(s.gear, id);
const physical = (s: KqSample) => s.serverTile === undefined ? s.tile : s.serverTile;
const inside = (s: KqSample) => s.sceneReady && chamber({ ...s, tile: physical(s) });
const living = (s: KqSample) => inside(s) && s.queens.some(q => [1158, 1160].includes(q.id) && (q.hp > 0 || q.total === 0));
const active = (s: LootSample) => living(s) && s.stage === 'fight' && !s.restocking;
const valuables = LOOT_FIXTURE.filter(i => i.id !== 892);
interface RespawnWait { deathAt: number; confirmedAt: number; players: number[] }

export class KqLootEvidence {
    readonly milestones: Record<string, number> = {};
    fixture: { tile: KqTile; at: number; afterDeathAt: number; ownedBefore: Record<number, number>[]; bankBefore: Record<number, number>[]; xpBefore: number[] } | null = null;
    readonly publicDrops: { id: number; count: number; at: number; players: number[]; queenIds: number[] }[] = [];
    readonly pickups: { player: number; id: number; count: number; takeAt: number; pickedAt: number; ownedBefore: number; ownedAfter: number; bankBefore: number; bankedAt?: number; bankAfter?: number; ownedAfterBank?: number }[] = [];
    readonly takes: (KqLootTake & { player: number })[] = [];
    readonly eating: { player: number; inputAt: number; consumedAt: number; duringPickup: boolean; combatAt?: number }[] = [];
    readonly waits: RespawnWait[] = [];
    readonly arrowRecoveries: { player: number; tile: KqTile; source: 'fixture-tile' | 'other-ground'; groundCount: number; deathAt: number; waitAt: number; takeAt: number; pickedAt: number; count: number; ownedBefore: number; ownedAfter: number }[] = [];
    private readonly banks: (KqItem[] | undefined)[] = [];
    private readonly xpBaseline: number[] = [];
    private readonly pending = new Map<string, KqLootTake>();
    private readonly meals = new Map<number, { input: KqAction; duringPickup: boolean; proof?: number; xp?: number }>();
    private readonly foodDroppedAt = [-Infinity, -Infinity, -Infinity, -Infinity];
    private wait: RespawnWait | null = null;
    private flyingWitnesses: number[] = [];
    private pendingDeath: { deathAt: number; players: number[] } | null = null;
    private readonly arrowPending = new Map<number, { take: KqLootTake; groundCount: number; wait: RespawnWait }>();
    private previous: { at: number; ground: LootSample['ground'] }[] = [];

    ready(samples: LootSample[], killedAt: number): boolean {
        const now = Math.max(...samples.map(s => s.at));
        return !this.fixture && killedAt > 0 && now >= killedAt && now - killedAt <= 5000 && samples.length === 4
            && samples.every((s, i) => inside(s) && s.stage === 'fight' && !s.restocking && !s.queens.some(q => [1158, 1160].includes(q.id)) && s.runner === 'running' && s.hp > 0 && this.banks[i]
            && s.xp.melee + s.xp.ranged > this.xpBaseline[i]);
    }

    arm(samples: LootSample[], tile: KqTile, at: number, killedAt: number): void {
        if (this.fixture) throw new Error('Loot fixture already armed');
        if (samples.some(s => s.ground.some(g => same(g.tile, tile) && LOOT_FIXTURE.some(i => i.id === g.id)))) throw new Error('Fixture tile already contains a test item');
        if (!this.ready(samples, killedAt)) throw new Error('Loot fixture requires a recent verified death and four participating fighters still in the chamber');
        const inventory = (s: KqSample) => Object.fromEntries(LOOT_FIXTURE.map(i => [i.id, owned(s, i.id)]));
        this.fixture = { tile: { ...tile }, at, afterDeathAt: killedAt, ownedBefore: samples.map(inventory), bankBefore: this.banks.map(bank => Object.fromEntries(LOOT_FIXTURE.map(i => [i.id, count(bank!, i.id)]))), xpBefore: samples.map(s => s.xp.melee + s.xp.ranged) };
        this.wait = { deathAt: killedAt, confirmedAt: at, players: [0, 1, 2, 3] };
        this.waits.push({ ...this.wait, players: [...this.wait.players] });
    }

    observe(samples: LootSample[]): void {
        if (samples.length !== 4) throw new Error('Expected four loot-probe observations');
        if (samples.some(s => s.sceneReady && s.hp <= 0 || s.chat.some(line => /oh dear,? you are dead/i.test(line)))) throw new Error('A loot-probe member died');
        samples.forEach((s, i) => {
            if (s.sceneReady && s.bankOpen) this.banks[i] = structuredClone(s.bank);
            this.xpBaseline[i] ??= s.xp.melee + s.xp.ranged;
            this.foodDroppedAt[i] = Math.max(this.foodDroppedAt[i], ...(s.foodDrops ?? []).filter(d => d.at <= s.at).map(d => d.at));
        });
        if (samples.some(living) && samples.some(s => s.lootTakes.some(t => t.id === 892 && t.at <= s.at && s.at - t.at <= 10_000))) throw new Error('Rune arrow Take during active queen combat');
        const fixture = this.fixture;
        if (!fixture) { this.remember(samples); return; }
        const now = Math.max(...samples.map(s => s.at));
        this.observeWait(samples, now);
        for (const item of LOOT_FIXTURE) {
            const players = samples.flatMap((s, player) => inside(s) && count(s.ground.filter(g => same(g.tile, fixture.tile)), item.id) >= item.count ? [player] : []);
            if (players.length >= 2 && players.some(i => active(samples[i])) && !this.publicDrops.some(g => g.id === item.id)) {
                this.publicDrops.push({ id: item.id, count: item.count, at: Math.min(...players.map(i => samples[i].at)), players, queenIds: [...new Set(players.flatMap(i => samples[i].queens.filter(q => q.hp > 0 || q.total === 0).map(q => q.id)))] });
            }
        }
        if (this.publicDrops.length === LOOT_FIXTURE.length) this.milestones.lootPublic ??= now;
        samples.forEach((s, player) => {
            for (const take of s.lootTakes) {
                if (take.at < fixture.at || take.at > s.at || s.at - take.at > 10_000) continue;
                this.takes.push({ ...take, player });
                if (take.id === 892) {
                    const wait = this.wait;
                    if (!wait || !wait.players.includes(player) || take.at < wait.confirmedAt || s.stage !== 'fight' || s.restocking) throw new Error('Rune arrow Take without a verified between-kill wait');
                    const previous = this.previous[player];
                    const source = [s.ground, ...(previous && previous.at <= take.at && take.at - previous.at <= 1500 ? [previous.ground] : [])]
                        .flat().find(g => g.id === 892 && same(g.tile, take.tile) && g.count > 0);
                    if (source) this.arrowPending.set(player, { take, groundCount: source.count, wait });
                    continue;
                }
                if (active(s) && same(take.tile, fixture.tile) && this.publicDrops.some(g => g.id === take.id)
                    && take.owned === fixture.ownedBefore[player][take.id]) this.pending.set(`${player}:${take.id}`, take);
            }
            const arrow = this.arrowPending.get(player);
            if (arrow && (!this.wait || arrow.wait.deathAt !== this.wait.deathAt || !this.wait.players.includes(player) || !inside(s) || s.at - arrow.take.at > 15_000)) this.arrowPending.delete(player);
            else if (arrow && owned(s, 892) > arrow.take.owned) {
                this.arrowRecoveries.push({ player, tile: { ...arrow.take.tile }, source: same(arrow.take.tile, fixture.tile) ? 'fixture-tile' : 'other-ground', groundCount: arrow.groundCount,
                    deathAt: arrow.wait.deathAt, waitAt: arrow.wait.confirmedAt, takeAt: arrow.take.at, pickedAt: s.at, count: owned(s, 892) - arrow.take.owned, ownedBefore: arrow.take.owned, ownedAfter: owned(s, 892) });
                this.arrowPending.delete(player);
                this.milestones.lootArrowsRecovered ??= s.at;
            }
            for (const item of valuables) {
                const key = `${player}:${item.id}`;
                const pending = this.pending.get(key);
                if (pending && (!active(s) || s.at - pending.at > 15_000)) this.pending.delete(key);
                else if (pending && owned(s, item.id) >= pending.owned + item.count && !this.pickups.some(p => p.id === item.id)) {
                    this.pickups.push({ player, id: item.id, count: item.count, takeAt: pending.at, pickedAt: s.at, ownedBefore: pending.owned, ownedAfter: owned(s, item.id), bankBefore: fixture.bankBefore[player][item.id] });
                    this.pending.delete(key);
                }
                const pickup = this.pickups.find(p => p.id === item.id && p.player === player);
                const bank = count(s.bank, item.id);
                const position = physical(s);
                if (pickup && s.sceneReady && s.bankOpen && position?.level === 0 && Math.abs(position.x - 3308) <= 3 && Math.abs(position.z - 3120) <= 3
                    && owned(s, item.id) < pickup.ownedAfter && bank >= pickup.bankBefore + pickup.count
                    && bank + owned(s, item.id) >= pickup.bankBefore + pickup.ownedBefore + pickup.count) {
                    pickup.bankedAt ??= s.at; pickup.bankAfter = bank; pickup.ownedAfterBank = owned(s, item.id);
                }
            }
            const eat = s.actions?.find(a => a.kind === 'eat' && a.at >= fixture.at && a.at <= s.at);
            if (eat && inside(s)) this.meals.set(player, { input: eat, duringPickup: this.arrowPending.has(player) || [...this.pending.keys()].some(key => key.startsWith(`${player}:`)) });
            const meal = this.meals.get(player);
            if (!meal) return;
            if (meal.proof === undefined && this.foodDroppedAt[player] >= meal.input.at - 10_000) { this.meals.delete(player); return; }
            if (!inside(s) || s.at - meal.input.at > 15_000) { this.meals.delete(player); return; }
            if (meal.proof === undefined && count(s.pack, 385) < meal.input.food) {
                meal.proof = this.eating.length; meal.xp = s.xp.melee + s.xp.ranged;
                this.eating.push({ player, inputAt: meal.input.at, consumedAt: s.at, duringPickup: meal.duringPickup });
            }
            if (meal.proof !== undefined && s.xp.melee + s.xp.ranged > meal.xp!) {
                this.eating[meal.proof].combatAt ??= s.at;
                this.milestones.lootSustain ??= s.at;
            }
        });
        if (this.pickups.length === valuables.length) this.milestones.lootPicked ??= now;
        const arrows = this.publicDrops.find(g => g.id === 892);
        if (arrows && now - arrows.at >= 6000 && this.milestones.lootPicked && samples.some(s => active(s) && count(s.ground.filter(g => same(g.tile, fixture.tile)), 892) >= 137)) this.milestones.lootArrows ??= now;
        if (this.pickups.length === valuables.length && this.pickups.every(p => p.bankedAt)) this.milestones.lootBanked ??= now;
        this.remember(samples);
    }

    private remember(samples: LootSample[]): void { this.previous = samples.map(s => ({ at: s.at, ground: structuredClone(s.ground) })); }

    private observeWait(samples: LootSample[], now: number): void {
        const queens = samples.filter(inside).flatMap(s => s.queens.filter(q => [1158, 1160].includes(q.id)));
        this.flyingWitnesses = this.flyingWitnesses.filter(i => inside(samples[i]));
        if (this.wait) {
            this.wait.players = this.wait.players.filter(i => inside(samples[i]));
            if (!this.wait.players.length || now - this.wait.confirmedAt > 60_000 || queens.length) this.wait = null;
        }
        if (!this.wait) this.arrowPending.clear();
        if (this.pendingDeath) {
            this.pendingDeath.players = this.pendingDeath.players.filter(i => inside(samples[i]));
            if (!this.pendingDeath.players.length || queens.some(q => q.id === 1158)) this.pendingDeath = null;
        }
        const dead = this.flyingWitnesses.filter(i => samples[i].queens.some(q => q.id === 1160 && q.hp === 0 && q.total > 0));
        if (dead.length) {
            this.pendingDeath = { deathAt: now, players: dead };
            this.flyingWitnesses = [];
        } else if (!this.pendingDeath && queens.some(q => q.id === 1160 && q.hp > 0)) this.flyingWitnesses = samples.flatMap((s, i) => inside(s) && s.queens.some(q => q.id === 1160 && q.hp > 0) ? [i] : []);
        if (this.pendingDeath && !queens.length) {
            this.wait = { ...this.pendingDeath, confirmedAt: now };
            this.waits.push({ ...this.wait, players: [...this.wait.players] });
            this.pendingDeath = null;
        }
        if (queens.some(q => q.id === 1158)) this.flyingWitnesses = [];
    }

    get complete(): boolean { return ['lootPublic', 'lootPicked', 'lootArrows', 'lootArrowsRecovered', 'lootSustain', 'lootBanked'].every(check => !!this.milestones[check]); }
}
