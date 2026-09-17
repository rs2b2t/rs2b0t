import { reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Special } from '../../api/combat/Special.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Players } from '../../api/players/Players.js';
import { Prayer, PROTECT_FROM_MAGIC } from '../../api/prayer/Prayer.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { COMBAT_SKILLS, XpTracker } from '../../paint/jive.js';
import { CombatStats } from './stats.js';
import { paintKq } from './paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { Party, normalizeName, parseRoster, type Gate, type Member, type Release, type Stage } from './party.js';
import { combatFormation, combatMode, inLair, inNest, near, QueenTracker, queenPhase, retreatReason, SIDES, WAIT_CORNER, type Point } from './policy.js';
import { approachQueen, pullQueen, QueenSearch, type QueenSighting } from './search.js';
import { LootCollector } from './loot.js';
import { recoveryDrops, type DeathReport } from './recovery.js';
import { camelot, descend, duelArena, gateTile, pass, placeRope, ropeReady, step, walk } from './route.js';
import { BOW, FOOD, MACE, RECOIL, boost, boostsReady, doses, drink, eat, equip, provision, supplies, worn } from './supply.js';

export const SETTINGS: SettingsSchema = {
    team: { type: 'string', default: '', label: 'Four account names', help: 'The same comma-separated roster on all four clients in one browser profile and origin. First account places ropes; accounts stand west, east, north and south.' }
};

export default class JiveKQ extends LoopingBot {
    status = 'starting';
    stage: Stage = 'bank';
    trip = 0;
    kills = 0;
    looted = 0;
    entries = 0;
    retreats = 0;
    restocking = false;
    tripKills = 0;
    stats = new CombatStats();
    recoveredItems: { owner: string; id: number; count: number; at: number }[] = [];
    private xp = new XpTracker(COMBAT_SKILLS, Skills);
    private startedAt = 0;
    private lastKillMs = 0;
    private collector = new LootCollector();
    private lootCounts = new Map<string, number>();
    private party: Party | null = null;
    private channel: BroadcastChannel | null = null;
    private prepared = false;
    private paused = false;
    private release: Release | null = null;
    private entryAt = 0;
    private gateAt = 0;
    private descent: Gate | null = null;
    private walkTile: Point | null = null;
    private lastDose = 0;
    private poisoned = false;
    private queenTracker = new QueenTracker();
    private slot = 0;
    private lastAttack = -10;
    private nextEatTick = 0;
    private pendingFood: { tick: number; count: number } | null = null;
    private prayerRequests = new Map<string, { on: boolean; pending: boolean; retryTick: number }>();
    private protectionFailures = 0;
    private weaponRequest: { id: number; pending: boolean; retryTick: number } | null = null;
    private queenDead = false;
    private blocked = false;
    private lure: Point | null = null;
    private lureAt = 0;
    private sighting: QueenSighting | null = null;
    private search = new QueenSearch();
    private searching = false;
    private lastKillTick = 0;
    private lureAttempt = 0;
    private lurePosition: Point | null = null;
    private death: DeathReport | null = null;
    private lastAlive: DeathReport | null = null;
    private recoveryMessage = '';
    private recoveries = new Map<string, { first: number; last: number; done: boolean }>();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.sceneReady(), 0);
        const roster = parseRoster(this.settings.str('team', ''));
        const self = normalizeName(Game.myName() ?? '');
        this.slot = roster.indexOf(self);
        if (this.slot < 0) throw new Error('This account is not in the KQ team roster');
        const requirements: [string, number][] = [['attack', 60], ['defence', 40], ['ranged', 70], ['hitpoints', 70], ['prayer', 37], ['magic', 45]];
        for (const [skill, level] of requirements) {
            if (Skills.level(skill) < level) throw new Error(`KQ requires ${level} ${skill}`);
        }
        this.startedAt = Date.now();
        this.xp.begin();
        this.party = new Party(roster, self, crypto.randomUUID(), message => this.log(`team: ${message}`));
        this.channel = new BroadcastChannel(`rs2b0t:kq:v1:${roster.join(',')}`);
        this.channel.onmessage = event => {
            const message: unknown = event.data;
            if (!message || typeof message !== 'object') return;
            if ('member' in message) this.party?.receive(message.member, Date.now());
            if ('release' in message && 'sender' in message && message.sender === roster[0]) this.party?.accept(message.release, Date.now());
        };
        this.on('tick', () => { this.observeDeath(); this.observeFood(); this.observeDescent(); this.observeQueen(); this.observeStats(); this.checkSafety(); this.heartbeat(); });
        this.on('chat.message', line => { if (/you have been poisoned/i.test(line.text)) this.poisoned = true; });
        Game.setAutoRetaliate(false);
        Sustain.set(async () => { this.checkSafety(); if (this.stage !== 'retreat') await this.upkeep(true); });
        EventSignal.setInterrupt(() => this.stage === 'retreat');
        if (inNest(Game.tile())) this.stage = 'retreat';
        this.heartbeat();
    }

    private heartbeat(): void {
        if (!this.party) return;
        const member: Member = {
            blocked: this.blocked, lure: this.lure ?? undefined, queen: this.sighting ?? undefined, name: this.party.self, session: this.party.session, trip: this.trip, stage: this.stage,
            tile: Game.ingame() ? Game.tile() : null,
            playerSlot: reader.selfSlot(),
            death: this.death ?? undefined,
            loot: this.collector.claim ?? undefined,
            recoverySpace: Inventory.free() + Inventory.items().filter(i => i.name === 'Vial').length,
            ready: this.prepared && !this.paused && Game.ingame() && Skills.effective('hitpoints') > 0 && this.stage !== 'retreat',
            restocking: this.restocking && !this.paused && (Game.ingame() && Skills.effective('hitpoints') > 0 || !!this.death),
            reason: this.paused ? 'paused' : this.stage === 'retreat' ? this.status : this.recoveryMessage || undefined,
            stats: { hp: Math.max(0, Skills.effective('hitpoints')), prayer: Prayer.points(), food: Inventory.countById(FOOD), damage: this.stats.damage, dps: this.stats.dps, kills: this.kills }
        };
        this.party.receive(member, Date.now());
        this.channel?.postMessage({ member });
        if (this.release && Date.now() - this.release.at < 12_000) this.channel?.postMessage({ release: this.release, sender: this.party.self });
    }

    private retreat(reason: string, restocking = false): void {
        if (this.stage === 'retreat') return;
        this.log(`${restocking ? 'restocking' : 'group retreat'}: ${reason}`);
        this.restocking = restocking;
        this.collector.clear();
        this.stage = 'retreat';
        this.descent = null;
        this.status = reason;
        this.retreats++;
        this.heartbeat();
        const tile = reader.serverTile();
        if (tile && inNest(tile)) step(tile);
    }

    requestRetreat(reason: string): void { this.retreat(reason); }

    private observeDeath(): void {
        if (!Game.ingame() || !Game.sceneReady() || this.death) return;
        const tile = reader.serverTile();
        if (!tile) return;
        const items = [...Inventory.items(), ...Equipment.items()].map(i => ({ id: i.id, count: i.count }));
        const ground = reader.groundItems().filter(i => near(i.tile, tile, 0)).map(i => ({ id: i.id, count: i.count }));
        if (Skills.effective('hitpoints') > 0) { this.lastAlive = { at: Date.now(), tile, items, ground }; return; }
        this.death = { at: Date.now(), tile, items: this.lastAlive?.items ?? items, ground: near(this.lastAlive?.tile ?? null, tile, 0) ? this.lastAlive!.ground : ground };
        this.restocking = true;
        this.prepared = false;
        this.retreat('died; teammates can recover my dropped items', true);
        this.heartbeat();
    }

    private checkSafety(): boolean {
        if (this.stage === 'retreat') return true;
        if (!this.prepared || this.stage === 'bank' || !this.party || !Game.sceneReady()) return false;
        if (this.stage === 'fight' && !inLair(Game.tile())) { this.retreat('left the queen chamber unexpectedly', true); return true; }
        if (!inNest(Game.tile())) return false;
        const visitor = Npcs.query().within(6).where(n => ['genie', 'mysterious old man'].includes(n.name?.toLowerCase() ?? '') && n.targetsMe()).nearest();
        if (visitor) { this.retreat(`${visitor.name} needs attention outside combat`, this.stage === 'fight'); return true; }
        const reason = retreatReason(supplies());
        if (reason) { this.retreat(reason, this.stage === 'fight'); return true; }
        if (!this.party.unsafe(this.trip, Date.now())) return false;
        const peers = this.party.members(Date.now());
        const missing = this.party.roster.filter(name => !peers.some(m => m.name === name));
        const unready = peers.filter(m => !m.restocking && (!m.ready || m.trip !== this.trip || m.stage === 'retreat' || m.stage === 'bank'));
        this.retreat(missing.length ? `missing heartbeat: ${missing.join(', ')}` : `team not ready: ${unready.map(m => `${m.name} (${m.reason ?? m.stage})`).join(', ')}`);
        return true;
    }

    private observeQueen(): void {
        if (this.stage !== 'fight' || !inLair(Game.tile()) || !Game.sceneReady()) return;
        const queen = Npcs.query().where(n => queenPhase(n.id) !== null).nearest();
        const { dead, killed } = this.queenTracker.observe(queen?.snap ?? null);
        this.queenDead = dead;
        if (queen && !dead) {
            const peers = this.party?.members(Date.now()).filter(m => m.trip === this.trip && m.stage === 'fight' && !m.restocking) ?? [];
            this.sighting = { id: queen.id, tile: queen.networkTile(), at: Date.now(), engaged: queen.targetsMe() || peers.some(m => m.playerSlot === queen.snap.faceEntity - 32768) };
            this.searching = false;
        }
        if (dead || killed) this.sighting = null;
        if (dead || killed || queen && this.formation(queen)) {
            this.blocked = false;
            this.lure = null;
        } else if (queen) {
            this.blocked = true;
        }
        if (killed) {
            this.kills++;
            this.tripKills++;
            this.lastKillMs = this.queenTracker.lastKillMs;
            this.lastKillTick = Game.tick();
            this.search = new QueenSearch();
            this.log(`Kalphite Queen killed (${this.kills})`);
        }
    }

    private observeStats(): void {
        this.stats.observe(Date.now(), Skills.xp('strength') + Skills.xp('ranged'), !this.paused && this.stage === 'fight' && this.queenTracker.startedAt > 0 && !this.queenTracker.killedAt);
    }

    private leaveRendezvous(): void {
        if (this.stage === 'surface' || this.stage === 'upper') {
            this.stage = 'travel';
            this.heartbeat();
        }
    }

    private requestPrayer(name: string, on: boolean): boolean {
        const previous = this.prayerRequests.get(name);
        if (previous?.pending) return previous.on === on && Prayer.active(name) === on;
        if (Prayer.active(name) === on) {
            if (name === PROTECT_FROM_MAGIC) this.protectionFailures = 0;
            return true;
        }
        if (previous && Game.tick() < previous.retryTick) return false;
        const request = { on, pending: true, retryTick: Game.tick() + 10 };
        this.prayerRequests.set(name, request);
        const completed = (ok: boolean) => {
            request.pending = false;
            request.retryTick = Math.max(request.retryTick, Game.tick() + 1);
            if (name === PROTECT_FROM_MAGIC && on) this.protectionFailures = ok ? 0 : this.protectionFailures + 1;
        };
        void Prayer.set(name, on).then(completed, () => completed(false));
        return false;
    }

    private protect(): boolean {
        const request = this.prayerRequests.get(PROTECT_FROM_MAGIC);
        if (!Prayer.active(PROTECT_FROM_MAGIC) && this.protectionFailures >= 2 && request && !request.pending && Game.tick() >= request.retryTick) {
            this.retreat('could not restore magic protection after retrying', true);
            return false;
        }
        return this.requestPrayer(PROTECT_FROM_MAGIC, true);
    }

    private clearPrayers(): boolean {
        return [PROTECT_FROM_MAGIC, 'Ultimate strength', 'Incredible reflexes'].map(name => this.requestPrayer(name, false)).every(Boolean);
    }

    private equipWeapon(id: number): boolean {
        const previous = this.weaponRequest;
        const waiting = previous && !worn(previous.id) && (previous.pending || Game.tick() < previous.retryTick);
        if (!waiting && worn(id)) { this.weaponRequest = null; return true; }
        this.status = id === MACE ? 'equipping dragon mace' : 'equipping magic shortbow';
        if (waiting) return false;
        if (Inventory.countById(id) === 0) { this.retreat('phase weapon missing', true); return false; }
        const request = { id, pending: true, retryTick: Game.tick() + 10 };
        this.weaponRequest = request;
        const completed = () => {
            request.pending = false;
            request.retryTick = Math.max(request.retryTick, Game.tick() + 1);
        };
        void equip(id).then(completed, completed);
        return false;
    }

    private async upkeep(walking = false): Promise<boolean> {
        if (!Game.sceneReady() || this.stage === 'bank') return false;
        const tile = reader.serverTile() ?? Game.tile();
        const moving = walking && tile?.level === 2 && this.walkTile !== null && !near(tile, this.walkTile, 0);
        if (walking) this.walkTile = tile;
        this.observeFood();
        const hp = Skills.effective('hitpoints');
        const queen = this.stage === 'fight' && !this.queenDead ? Npcs.query().where(n => queenPhase(n.id) !== null).nearest() : null;
        if (queen && hp > 31 && Prayer.points() > 0 && !Prayer.active(PROTECT_FROM_MAGIC)) {
            this.protect();
        }
        const waiting = this.stage === 'fight' && this.queenTracker.killedAt > 0 && !queen && !this.searching;
        if (waiting) await this.clearPrayers();
        const food = Inventory.countById(FOOD);
        const tick = Game.tick();
        const canConsume = tick >= this.nextEatTick && (!this.pendingFood || tick - this.pendingFood.tick >= 4);
        if (this.stage === 'fight' && hp > 31 && Prayer.points() <= 10 && doses('Prayer potion') > 0) {
            return canConsume ? drink('Prayer potion') : false;
        }
        if ((hp <= 31 || hp <= Skills.level('hitpoints') - 20) && food > 0) {
            this.leaveRendezvous();
            if (!canConsume) return false;
            if (this.stage !== 'fight') return eat();
            await this.queueCombatFood();
            return false;
        }
        if (this.stage === 'fight' && !canConsume) return false;
        if (inNest(Game.tile())) {
            if (Prayer.points() <= Math.min(35, Prayer.max() - 15) && doses('Prayer potion') > 0) { this.leaveRendezvous(); return drink('Prayer potion'); }
            if ((this.poisoned || Date.now() - this.lastDose > 240_000 && (this.stage === 'fight' || this.stage === 'upper' || moving)) && doses('Superantipoison') > 0) {
                this.leaveRendezvous();
                if (await drink('Superantipoison')) { this.lastDose = Date.now(); this.poisoned = false; return true; }
            }
            if (!worn(RECOIL) && Inventory.countById(RECOIL) > 0) { this.leaveRendezvous(); return equip(RECOIL); }
            const upper = Game.tile()?.level === 2;
            if (this.stage === 'upper' || this.stage === 'fight' || moving) {
                const melee = upper || waiting || Npcs.query().where(n => n.id === 1158).nearest() !== null;
                if (this.stage === 'upper' && !boostsReady()) this.leaveRendezvous();
                if (await boost(melee)) return true;
            }
        }
        return false;
    }

    private async queueCombatFood(): Promise<boolean> {
        const tick = Game.tick(), count = Inventory.countById(FOOD);
        if (!count || tick < this.nextEatTick || this.pendingFood && tick - this.pendingFood.tick < 4) return false;
        const previous = this.pendingFood, next = this.nextEatTick, pending = { tick, count };
        this.pendingFood = pending;
        this.nextEatTick = tick + 3;
        let sent = false;
        try {
            sent = await eat(false);
            if (sent) this.lastAttack = -10;
            return sent;
        } finally {
            if (!sent && this.pendingFood === pending) { this.pendingFood = previous; this.nextEatTick = next; }
        }
    }

    private observeFood(): void {
        if (!Game.sceneReady() || !this.pendingFood || Inventory.countById(FOOD) >= this.pendingFood.count) return;
        this.nextEatTick = Math.max(this.nextEatTick, Game.tick() + 2);
        this.pendingFood = null;
    }

    override async loop(): Promise<void> {
        if (!Game.sceneReady() || !this.party) return;
        try {
            this.observeDeath();
            this.observeDescent();
            if (Skills.effective('hitpoints') <= 0) return;
            if (this.stage === 'retreat') { await this.escape(); return; }
            if (this.checkSafety()) { await this.escape(); return; }
            if (await this.enterReleasedGate()) return;
            if (await this.upkeep()) return;
            if (!Game.sceneReady() || this.checkSafety()) return;
            if (ChatDialog.canContinue()) { await ChatDialog.continue(); return; }
            if (this.stage === 'bank') {
                this.status = 'banking the shared KQ loadout';
                if (!this.prepared) {
                    if (!(await provision(this.slot, s => this.log(s), !!this.death))) {
                        if (this.death) this.status = 'returning to Shantay; waiting for replacement gear';
                        return;
                    }
                    this.prepared = true;
                }
                this.status = 'waiting for four supplied players at Shantay bank';
                this.heartbeat();
                const release = this.party.release('bank', Math.max(this.trip, ...this.party.members(Date.now()).map(m => m.trip)) + 1, Date.now());
                if (release) { this.release = release; this.party.accept(release, Date.now()); this.heartbeat(); }
                const trip = this.party.departure(this.trip, Date.now());
                if (trip === null) return;
                this.trip = trip;
                this.stage = 'travel';
                this.restocking = false;
                this.queenTracker = new QueenTracker();
                this.queenDead = false;
                this.blocked = false;
                this.lure = null;
                this.lureAt = 0;
                this.sighting = null;
                this.search = new QueenSearch();
                this.searching = false;
                this.lureAttempt = 0;
                this.lurePosition = null;
                this.death = null;
                this.lastAlive = null;
                this.recoveries.clear();
                this.recoveryMessage = '';
                this.tripKills = 0;
                this.collector.clear();
                this.gateAt = 0;
                this.descent = null;
                this.log(`trip ${this.trip}: shared loadout ready`);
                this.heartbeat();
                return;
            }
            if (inLair(Game.tile())) { if (!(await this.recoverLoot())) await this.fight(); return; }
            if (inNest(Game.tile())) { await this.gate('upper'); return; }
            if (!(await pass(s => this.log(s)))) return;
            await this.gate('surface');
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.retreat(reason);
            if (inNest(Game.tile())) await this.escape();
            else ScriptRunner.stop(reason);
        }
    }

    private async gate(gate: Gate): Promise<void> {
        const party = this.party;
        if (!party) return;
        const target = gateTile(gate);
        if (!near(Game.tile(), target, 0)) {
            this.stage = 'travel';
            this.status = `walking to ${gate} entrance`;
            this.walkTile = reader.serverTile() ?? Game.tile();
            await walk(target, 0, s => this.log(s));
            this.walkTile = null;
            return;
        }
        if (!this.gateAt) this.gateAt = Date.now();
        if (Date.now() - this.gateAt > 180_000) { this.retreat('party rendezvous timed out'); return; }
        if (gate === 'upper' && !boostsReady()) {
            this.stage = 'travel';
            this.status = 'drinking super potions before entering';
            await boost(true);
            return;
        }
        if (gate === 'upper' && !Prayer.active(PROTECT_FROM_MAGIC)) {
            this.stage = 'travel';
            this.status = 'enabling protection before entering';
            await Prayer.set(PROTECT_FROM_MAGIC, true);
            return;
        }
        if (gate === 'upper' && Date.now() - this.lastDose > 240_000) {
            this.stage = 'travel';
            this.status = 'drinking antipoison before entering';
            if (!(await drink('Superantipoison'))) { this.retreat('antipoison unavailable'); return; }
            this.lastDose = Date.now();
            return;
        }
        this.stage = gate;
        this.status = `waiting for four at ${gate} entrance`;
        this.heartbeat();
        const together = () => {
            const visible = new Set([party.self, ...Players.query().within(8).results().map(p => normalizeName(p.name ?? ''))]);
            return party.roster.every(name => visible.has(name));
        };
        let release = party.release(gate, this.trip, Date.now());
        if (release && together() && await placeRope(gate, s => this.log(s))) {
            release = party.release(gate, this.trip, Date.now());
            if (!release || !together()) return;
            this.release = release;
            party.accept(release, Date.now());
            this.heartbeat();
        }
        await this.enterReleasedGate();
    }

    private async enterReleasedGate(): Promise<boolean> {
        for (const gate of ['surface', 'upper'] as const) {
            if (!near(Game.tile(), gateTile(gate), 0) || !this.party?.released(gate, this.trip, Date.now()) || !ropeReady(gate)) continue;
            this.stage = gate;
            this.status = `descending ${gate} entrance with team`;
            this.descent = gate;
            await descend(gate);
            this.observeDescent();
            return true;
        }
        return false;
    }

    private observeDescent(): void {
        if (!Game.sceneReady()) return;
        const gate = this.descent;
        if (!(gate === 'surface' && inNest(Game.tile()) && Game.tile()?.level === 2 || gate === 'upper' && inLair(Game.tile()))) return;
        this.descent = null;
        if (this.checkSafety()) return;
        this.log(`trip ${this.trip}: descended ${gate}`);
        this.stage = gate === 'surface' ? 'travel' : 'fight';
        this.gateAt = 0;
        this.entryAt = Date.now();
        if (gate === 'upper') this.entries++;
        this.heartbeat();
    }

    private async fight(): Promise<void> {
        if (!this.party) return;
        const peers = this.party.members(Date.now()).filter(m => !m.restocking);
        if (peers.some(m => m.stage !== 'fight' || !inLair(m.tile))) {
            this.status = 'waiting for the team to finish descending';
            if (Date.now() - this.entryAt > 12_000) this.retreat('the team did not arrive together');
            return;
        }
        if (this.loot()) return;
        const queen = Npcs.query().where(n => queenPhase(n.id) !== null).nearest();
        const sighting = this.latestSighting();
        if (!this.queenDead && (this.blocked || peers.some(m => m.blocked)) && (!queen || !this.formation(queen))) {
            await this.repositionQueen(queen, sighting);
            return;
        }
        this.lureAt = 0;
        if (!queen || this.queenDead) {
            if (this.queenTracker.killedAt && Game.tick() - this.lastKillTick <= 120 && !sighting) {
                if (!(await this.clearPrayers())) return;
                this.status = near(Game.tile(), WAIT_CORNER, 0) ? 'stacked near spawn; prayers off' : 'regrouping in the northwest corner';
                if (!near(Game.tile(), WAIT_CORNER, 0)) { step(WAIT_CORNER); return; }
                if (!this.equipWeapon(MACE)) return;
                if (Game.combatMode() !== 1) Game.setCombatMode(1);
            } else {
                this.requestPrayer('Ultimate strength', false);
                this.requestPrayer('Incredible reflexes', false);
                if (!queen) await this.searchQueen(sighting);
            }
            return;
        }
        if (Prayer.points() === 0 && doses('Prayer potion') > 0) { this.status = 'restoring prayer before attacking'; return; }
        if (!this.protect()) { if (this.stage !== 'retreat') this.status = 'restoring magic protection'; return; }
        if (this.checkSafety()) return;
        const phase = queenPhase(queen.id)!;
        const formation = this.formation(queen);
        if (!formation) {
            this.blocked = true;
            this.heartbeat();
            await this.repositionQueen(queen, sighting);
            return;
        }
        const tile = formation[this.slot];
        this.status = `${phase}: ${SIDES[this.slot]}`;
        if (!near(Game.tile(), tile, 0)) { step(tile); return; }
        const weapon = phase === 'melee' ? MACE : BOW;
        if (!this.equipWeapon(weapon)) return;
        const mode = combatMode(phase, Game.combatStyles());
        if (mode === null) { this.retreat('required crush or rapid combat style unavailable'); return; }
        if (Game.combatMode() !== mode) Game.setCombatMode(mode);
        if (this.checkSafety()) return;
        this.requestPrayer('Ultimate strength', phase === 'melee');
        this.requestPrayer('Incredible reflexes', phase === 'melee');
        const special = Special.ready(phase === 'melee' ? 'Dragon mace' : 'Magic shortbow') ? Special.arm() : Promise.resolve(false);
        if (Game.tick() - this.lastAttack >= 4 || reader.selfFaceEntity() !== queen.index) {
            if (await queen.interact('Attack')) this.lastAttack = Game.tick();
        }
        await special;
    }

    private formation(queen: Npc) {
        return this.formationAt(queen.networkTile(), queen.size, queenPhase(queen.id)!);
    }

    private formationAt(centre: Point, size: number, phase: 'melee' | 'ranged') {
        const origin = { ...centre, x: centre.x - Math.floor(size / 2), z: centre.z - Math.floor(size / 2) };
        return combatFormation(centre, size, phase, p => Reachability.walkable(p) && Reachability.lineOfSight(p, origin, size));
    }

    private latestSighting(): QueenSighting | null {
        return [this.sighting, ...this.party?.members(Date.now()).filter(m => m.trip === this.trip && m.stage === 'fight' && !m.restocking).map(m => m.queen) ?? []]
            .filter((s): s is QueenSighting => !!s && Date.now() - s.at <= 8000 && s.at > this.queenTracker.killedAt)
            .sort((a, b) => b.at - a.at)[0] ?? null;
    }

    private usable(tile: Point): boolean {
        return Reachability.walkable(tile) && Reachability.canReach(tile, { maxSteps: 2048 });
    }

    private async searchQueen(sighting: QueenSighting | null): Promise<void> {
        const here = Game.tile();
        if (!here) return;
        this.searching = true;
        this.blocked = false;
        this.lure = null;
        if (Prayer.points() > 0 && !this.protect()) return;
        if (this.checkSafety()) return;
        const target = this.search.next(here, sighting, Date.now(), p => this.usable(p));
        this.status = sighting ? 'searching the last reported queen position' : 'searching the queen chamber';
        if (target) step(target);
    }

    private async repositionQueen(queen: Npc | null, sighting: QueenSighting | null): Promise<void> {
        const controller = this.party?.members(Date.now()).find(m => m.trip === this.trip && m.stage === 'fight' && !m.restocking && m.ready);
        const leading = !controller || controller.name === this.party?.self;
        if (!leading && controller.lure && sighting?.engaged) {
            this.lure = controller.lure;
            this.status = 'following the team pull route';
            step(this.lure);
            return;
        }
        if (!queen && sighting?.engaged && this.lure && Date.now() - sighting.at < 3000) {
            this.status = 'waiting for the queen to follow';
            step(this.lure);
            return;
        }
        if (!queen || !sighting) { await this.searchQueen(sighting); return; }
        if (Prayer.points() > 0 && !this.protect()) return;
        if (this.checkSafety()) return;
        const now = Date.now();
        const centre = queen.networkTile();
        if (leading && (!this.lureAt || !near(this.lurePosition, centre, 0))) { this.lurePosition = centre; this.lureAt = now; }
        if (leading && this.lureAt && now - this.lureAt > 15_000) {
            this.lure = null;
            this.lureAttempt++;
            this.lureAt = now;
        }
        if (!sighting.engaged) {
            this.lure = null;
            this.status = 'approaching and tagging the queen';
            const here = Game.tile();
            if (!here) return;
            const origin = { ...centre, x: centre.x - 2, z: centre.z - 2 };
            const target = approachQueen(centre, here, p => this.usable(p) && Reachability.lineOfSight(p, origin, 5));
            if (!target) { await this.searchQueen(null); return; }
            if (!near(here, target, 0)) { step(target); return; }
            if (!this.equipWeapon(BOW)) return;
            if (Game.combatMode() !== 1) Game.setCombatMode(1);
            if (Game.tick() - this.lastAttack >= 4 && await queen.interact('Attack')) this.lastAttack = Game.tick();
            return;
        }
        if (!leading) { this.lure = null; this.status = 'waiting for the team pull route'; return; }
        this.lure ??= pullQueen(centre, queenPhase(queen.id)!, p => !!this.formationAt(p, 5, queenPhase(queen.id)!), (from, to) => {
            for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
                if (!Reachability.canStep({ ...from, x: from.x + x, z: from.z + z }, { ...to, x: to.x + x, z: to.z + z })) return false;
            }
            return true;
        }, p => this.usable(p), this.lureAttempt);
        if (!this.lure) { await this.searchQueen(sighting); return; }
        this.status = 'pulling the queen along an open route';
        this.heartbeat();
        step(this.lure);
    }

    private async recoverLoot(): Promise<boolean> {
        if (!this.party || this.death || !inLair(Game.tile())) return false;
        const deaths = this.party.deaths(this.trip).filter(c => c.name !== this.party!.self && inLair(c.death.tile));
        if (!deaths.length) return false;
        const tick = Game.tick();
        for (const c of deaths) {
            const key = `${c.name}:${c.session}:${c.death.at}`;
            if (!this.recoveries.has(key)) this.recoveries.set(key, { first: tick, last: tick, done: false });
        }
        const casualty = deaths.find(c => {
            const r = this.recoveries.get(`${c.name}:${c.session}:${c.death.at}`)!;
            return !r.done && tick - r.first < 60;
        });
        if (!casualty) { this.retreat('teammate recovery finished; banking recovered items', true); return true; }
        if (Inventory.isFull() && !Inventory.first('Vial')) {
            this.retreat('no recovery space; banking recovered items', true);
            return true;
        }
        const collector = this.party.members(Date.now()).find(m => m.trip === this.trip && m.stage === 'fight' && m.ready && !m.death && (m.recoverySpace ?? 0) > 0 && inLair(m.tile));
        if (collector?.name !== this.party.self) return false;
        if (this.collector.claim) { this.collector.clear(); this.heartbeat(); }
        const recovery = this.recoveries.get(`${casualty.name}:${casualty.session}:${casualty.death.at}`)!;
        this.status = `recovering ${casualty.name}'s dropped items`;
        if (Prayer.points() === 0 || !this.protect()) return true;
        if (this.checkSafety()) return true;
        if (!near(Game.tile(), casualty.death.tile, 1)) { step(casualty.death.tile); return true; }
        const items = recoveryDrops(casualty.death, reader.groundItems()).filter(i => i.id !== 229);
        if (!items.length) {
            if (tick - recovery.first >= 12 && tick - recovery.last >= 3) recovery.done = true;
            return true;
        }
        recovery.last = tick;
        if (Inventory.isFull()) {
            const vial = Inventory.first('Vial');
            if (vial) await vial.interact('Drop');
            else recovery.done = true;
            return true;
        }
        const item = items[0];
        const drop = GroundItems.query().where(g => g.id === item.id && near(g.tile(), casualty.death.tile, 0)).first();
        if (!drop) return true;
        const before = Inventory.countById(drop.id);
        if (await drop.interact('Take') && await Execution.delayUntilTicks(() => Inventory.countById(drop.id) > before, 2)) {
            const count = Inventory.countById(drop.id) - before;
            const name = drop.name ?? String(drop.id);
            this.recoveredItems.push({ owner: casualty.name, id: drop.id, count, at: Date.now() });
            const key = `Recovered for ${casualty.name}: ${name}`;
            this.lootCounts.set(key, (this.lootCounts.get(key) ?? 0) + count);
            this.recoveryMessage = `recovered ${count} ${name} for ${casualty.name}; banking after recovery`;
            this.log(this.recoveryMessage);
            this.heartbeat();
        }
        return true;
    }

    private loot(): boolean {
        if (!this.party) return false;
        const previous = this.collector.claim;
        const result = this.collector.step(this.party, this.trip, this.party.deaths(this.trip).map(c => c.death.tile), () => {
            const waiting = this.queenTracker.killedAt > 0 && !this.latestSighting()
                && !Npcs.query().where(n => queenPhase(n.id) !== null && (n.health > 0 || n.snap.totalHealth === 0)).nearest();
            return waiting ? this.clearPrayers() : Prayer.points() > 0 && this.protect();
        }, () => this.queueCombatFood());
        if (this.stage === 'retreat') return true;
        if (result.collected) {
            this.looted++;
            const { name, count } = result.collected;
            this.lootCounts.set(name, (this.lootCounts.get(name) ?? 0) + count);
            this.log(`looted ${count} ${name}`);
        }
        if (previous !== this.collector.claim) this.heartbeat();
        if (result.busy) { this.lastAttack = -10; this.status = `collecting ${this.collector.claim?.name ?? 'queen loot'}`; }
        return result.busy;
    }

    private async escape(): Promise<void> {
        this.heartbeat();
        if (this.death && !inNest(Game.tile())) {
            await Prayer.clear();
            this.prepared = false;
            this.stage = 'bank';
            this.release = null;
            this.heartbeat();
            return;
        }
        if (inNest(Game.tile()) || (Game.tile()?.z ?? 9999) < 3117) {
            this.status = 'escaping to Camelot';
            await this.upkeep();
            if (Skills.effective('hitpoints') <= Math.max(31, Skills.level('hitpoints') - 20) && Inventory.countById(FOOD) > 0) return;
            await camelot();
            if (inNest(Game.tile()) || (Game.tile()?.z ?? 9999) < 3117) return;
        }
        if (Skills.effective('hitpoints') <= 62 && Inventory.countById(FOOD) > 0) { await eat(); return; }
        if (!near(Game.tile(), { x: 3315, z: 3235, level: 0 }, 4)) {
            this.status = 'teleporting to Duel Arena';
            if (!(await duelArena())) return;
        }
        await Prayer.clear();
        this.prepared = false;
        this.stage = 'bank';
        this.release = null;
        this.heartbeat();
    }

    override onPause(): void { this.collector.clear(); this.paused = true; this.observeStats(); this.heartbeat(); }
    override onResume(): void { this.paused = false; if (inNest(Game.tile())) this.retreat('resumed after party pause'); }
    override onStop(): void {
        this.collector.clear();
        this.restocking = !!this.death;
        this.stage = 'retreat';
        this.heartbeat();
        this.channel?.close();
        this.channel = null;
        Sustain.set(null);
        EventSignal.setInterrupt(null);
    }

    override recoveryAnchor() { return null; }

    override ignoredRandoms(): string[] {
        return inNest(Game.tile()) || this.stage === 'retreat'
            ? ['genie', 'drunken dwarf', 'mysterious old man', 'sandwich lady', 'frog', 'strange plant', 'lamp', 'strange box']
            : [];
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const queen = Npcs.query().where(n => queenPhase(n.id) !== null).nearest();
        paintKq(ctx, {
            status: this.status, startedAt: this.startedAt, kills: this.kills, trip: this.trip, tripKills: this.tripKills,
            retreats: this.retreats, lastKillMs: this.lastKillMs, slot: this.slot, stats: this.stats, xp: this.xp,
            phase: queen ? queenPhase(queen.id) : null, queenHp: queen?.snap.totalHealth ? queen.health : null,
            messages: this.party?.messages ?? [], roster: this.party?.roster ?? [], members: this.party?.members(Date.now()) ?? [], loot: this.lootCounts
        });
    }
}
