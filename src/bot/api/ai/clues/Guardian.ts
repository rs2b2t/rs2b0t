import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import Tile from '#/bot/geometry/Tile.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Game } from '#/bot/api/game/Game.js';
import { PROTECT_FROM_MAGIC, Prayer } from '#/bot/api/prayer/Prayer.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Npcs } from '#/bot/api/npcs/Npcs.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Special } from '#/bot/api/combat/Special.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import type { Npc } from '#/bot/api/model/Npc.js';
import { guardianWeaponWorn } from './hardCluePreparation.js';
import { GuardianProtection } from './guardianKit.js';
import { GUARDIAN_FOOD_RESERVE } from './hardClueKit.js';

const SPAWN_RADIUS = 12;
const OWNED_RADIUS = 32;
const SPAWN_WAIT_TICKS = 10;
const FIGHT_MS = 180_000;
const REATTACK_TICKS = 8;
const NOT_YOURS = /not after you|someone else is fighting/i;
export const GUARDIAN_DEATH = /oh dear.*you are dead/i;
export type GuardianStop = 'supplies-needed' | 'dead' | 'guardian-lost';
export type GuardianOutcome = 'killed' | 'yield' | GuardianStop;

interface SustainWaitDeps {
    now: () => number;
    pump: () => Promise<void>;
    tick: () => Promise<void>;
}
const LIVE_WAIT: SustainWaitDeps = {
    now: () => Date.now(), pump: () => Sustain.run(), tick: () => Execution.delayTicks(1)
};

export async function sustainUntil(cond: () => boolean, ms: number, deps: SustainWaitDeps = LIVE_WAIT): Promise<boolean> {
    const until = deps.now() + ms;
    for (;;) {
        await deps.pump();
        if (cond()) return true;
        if (deps.now() >= until) return false;
        await deps.tick();
    }
}

function findGuardian(name: string): Npc | null {
    const candidates = Npcs.query().name(name).action('Attack')
        .where(n => (n.distance() <= SPAWN_RADIUS || (n.targetsMe() && n.distance() <= OWNED_RADIUS)) && !n.targetsAnotherPlayer()).results();
    return candidates.find(n => n.targetsMe()) ?? candidates[0] ?? null;
}

export async function fightGuardian(
    name: string, log: (m: string) => void, protection = new GuardianProtection(name)
): Promise<GuardianOutcome> {
    return new GuardianEncounter(name, protection).fight(log);
}

export class GuardianEncounter {
    private readonly mark = GameMessages.mark();
    private first: Npc | null = null;
    private spawnTicks = 0;
    private sawDeath = false;
    private owned = false;

    constructor(private readonly name: string, private readonly protection = new GuardianProtection(name)) {}

    async fight(log: (m: string) => void): Promise<GuardianOutcome> {
        const { name, mark, protection } = this;
        for (; this.first === null && this.spawnTicks < SPAWN_WAIT_TICKS; this.spawnTicks++) {
            if (GameMessages.sawSince(mark, GUARDIAN_DEATH) || Skills.effective('hitpoints') <= 0) return 'dead';
            this.first = findGuardian(name);
            if (EventSignal.pending()) return 'yield';
            if (this.first) break;
            await Sustain.run();
            await Execution.delayTicks(1);
        }
        if (GameMessages.sawSince(mark, GUARDIAN_DEATH) || Skills.effective('hitpoints') <= 0) return 'dead';
        this.first ??= findGuardian(name);
        if (EventSignal.pending()) return 'yield';
        const first = this.first;
        if (!first) return 'guardian-lost';
        const prayed = await Prayer.set(PROTECT_FROM_MAGIC, true);
        this.owned ||= first.targetsMe();
        let attackedAt = -Infinity;
        try {
            const deadline = Date.now() + FIGHT_MS;
            while (Date.now() < deadline) {
                if (GameMessages.sawSince(mark, GUARDIAN_DEATH) || Skills.effective('hitpoints') <= 0) return 'dead';
                if (EventSignal.pending()) return 'yield';
                const target = Npcs.query().name(name).where(n => n.index === first.index && n.id === first.id).results()[0];
                if (!target) return this.sawDeath && this.owned ? 'killed' : 'guardian-lost';
                if (target.targetsAnotherPlayer() || target.distance() > (this.owned || target.targetsMe() ? OWNED_RADIUS : SPAWN_RADIUS) || GameMessages.sawSince(mark, NOT_YOURS)) return 'guardian-lost';
                this.owned ||= target.targetsMe();
                this.sawDeath ||= this.owned && target.health === 0 && target.snap.totalHealth > 0;
                if (this.sawDeath) {
                    await Sustain.run();
                    await Execution.delayTicks(1);
                    continue;
                }
                if (!guardianWeaponWorn() || Inventory.count('Shark') <= GUARDIAN_FOOD_RESERVE) return 'supplies-needed';
                await Sustain.run();
                await Execution.delayTicks(1);
                if (GameMessages.sawSince(mark, GUARDIAN_DEATH) || Skills.effective('hitpoints') <= 0) return 'dead';
                if (EventSignal.pending()) return 'yield';
                switch (await protection.maintain()) {
                    case 'supplies-needed': return 'supplies-needed';
                    case 'drank': continue;
                    case 'ready': break;
                }
                if (EventSignal.pending()) return 'yield';
                const current = Npcs.query().name(name).where(n => n.index === first.index && n.id === first.id).results()[0];
                if (!current || current.targetsAnotherPlayer() || current.distance() > (this.owned || current.targetsMe() ? OWNED_RADIUS : SPAWN_RADIUS)) continue;
                if (current.targetsMe() && current.health === 0 && current.snap.totalHealth > 0) {
                    this.owned = true;
                    this.sawDeath = true;
                    continue;
                }
                if (!guardianWeaponWorn() || Inventory.count('Shark') <= GUARDIAN_FOOD_RESERVE) return 'supplies-needed';
                const tile = current.tile();
                const here = Game.tile();
                const probeable = here !== null && Reachability.probeable(tile);
                const blockedAdjacent = current.distance() === 1 && probeable && !Reachability.canStep(here!, tile);
                if (current.distance() > 1 || blockedAdjacent) {
                    const stand = probeable
                        ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
                            .map(([dx, dz]) => new Tile(tile.x + dx!, tile.z + dz!, tile.level))
                            .filter(p => Reachability.canStep(p, tile) && Reachability.canReach(p, { maxSteps: 2048 }))
                            .sort((a, b) => a.distanceTo(here!) - b.distanceTo(here!))[0]
                        : tile;
                    if (!stand) {
                        log(`${name}: no reachable melee tile beside (${tile.x},${tile.z},${tile.level})`);
                        return 'guardian-lost';
                    }
                    log(`${name}: approaching guardian at (${tile.x},${tile.z},${tile.level}), ${current.distance()} tiles away`);
                    const reached = await Traversal.walkTo(stand, {
                        radius: probeable ? 0 : 1, timeoutMs: 10_000, log, ...Traversal.pureWalk
                    });
                    if (GameMessages.sawSince(mark, GUARDIAN_DEATH) || Skills.effective('hitpoints') <= 0) return 'dead';
                    if (EventSignal.pending()) return 'yield';
                    if (!reached) return 'guardian-lost';
                    continue;
                }
                if (Special.ready(Special.wielded()) && !Special.armed()) {
                    if (await Special.arm()) {
                        await Execution.delayTicks(1);
                        continue;
                    }
                }
                if (Game.tick() - attackedAt >= REATTACK_TICKS || !(Game.inCombat() && current.targetsMe())) {
                    if (await current.interact('Attack')) attackedAt = Game.tick();
                }
            }
            log(`${name}: encounter timed out; stopping without another dig`);
            return 'guardian-lost';
        } finally {
            if (prayed) await Prayer.set(PROTECT_FROM_MAGIC, false);
        }
    }
}
