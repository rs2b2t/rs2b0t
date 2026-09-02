import type { Task } from '../../api/bot/Bot.js';
import { buryOneInFight } from '../../api/combat/fightUpkeep.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import Tile from '../../geometry/Tile.js';
import { SAFESPOT_BLIND_MS, attackRangeFor, nextSafespot, retreatAim, retreatDue, type Style } from './logic.js';
import type { DragonSite } from './sites.js';
import { waitFed, type JiveHost } from './supply.js';

/** What a fight needs from the bot on top of what supply needs. */
export interface CombatHost extends JiveHost {
    died: boolean;
    targetIdx: number | null;
    countKill(): void;
    countBurial(): void;
    hpFraction(): number;
    panicHp(): number;
    retreatHp(): number;
    hasFood(): boolean;
    needEat(): boolean;
    eatOnce(): Promise<boolean>;
    buryBones(): boolean;
    boneName(): string;
    safespotIndex(): number;
    setSafespotIndex(n: number): void;
    /** Arm the spec bar before the next attack. Optional: a host without one never specials. */
    armSpecial?(): Promise<void>;
}

const ATTACK = 'Attack';

const FIELD_RADIUS = 10;
const APPROACH_RADIUS = 12;

// Why: Npc.distance() measures to the centre of a multi-tile footprint, so a size-4 dragon reads 2 at its north and east faces and 3 at its south and west, never the 1 attackRangeFor('melee') asks for.
const MELEE_CENTRE_REACH = 3;

const FIGHT_MS = 120_000;
const FIGHT_PASSES = 600;
const LEASH_MS = 12_000;
const LEASH_PASSES = 60;

const RE_ENGAGE_MS = 4000;
const ENGAGE_SETTLE_MS = 1200;
const KILL_GRACE_MS = 6000;

const TAKEN_SKIP_MS = 15_000;
const LEASH_SKIP_MS = 20_000;
const PULL_SKIP_MS = 8000;
const REFUSED_SKIP_MS = 5000;

const HOP_ATTEMPTS = 4;
const HOP_MS = 2000;
const RETURN_MS = 60_000;
const APPROACH_MS = 120_000;

const RETREAT_HOPS = 4;
const RETREAT_HOP_MS = 3000;
const RETREAT_RETRY_MS = 5000;

/** Whether the ladder ran, and whether the bot is back on a tile it can fight from. */
type Step = 'held' | 'moved' | 'stuck';

interface Engagement {
    isOurs: boolean;
    inCombat: boolean;
    targetsMe: boolean;
    targetsAnother: boolean;
}

// Why: an npc's faceEntity clears between its own attacks, so a dragon another player is mid-fight with reads as free for a tick, and "in combat but not facing us" closes that gap.
// Why: our own target is exempt, since its faceEntity flickers the same way and dropping it would churn targets every few ticks.

/** Whether a dragon already belongs to someone else's fight. */
function takenByAnother(e: Engagement): boolean {
    if (e.isOurs) {
        return false;
    }
    return e.targetsAnother || (e.inCombat && !e.targetsMe);
}

export function anchorFor(site: DragonSite, style: Style, index: number): Tile {
    if (style === 'melee') {
        return site.meleeAnchor;
    }
    // Why: nextSafespot holds its index unclamped, so the clamp lives here where the tile is read.
    return site.safespots[Math.min(index, site.safespots.length - 1)] ?? site.meleeAnchor;
}

function usesSafespot(style: Style): boolean {
    return style !== 'melee';
}

// Why: only the ladder is safespot-only. Every style fights from a fixed tile, melee included, since the anchor is the tile bordering the most adult body tiles that no baby can reach, and the leash pulls a dragon in rather than the bot walking out. A click that does walk us off it is caught below and the dragon skipped.
function holdsAnchor(_style: Style): boolean {
    return true;
}

/** How far a target may read and still be reachable without the server walking us. */
function reachFor(style: Style): number {
    return style === 'melee' ? MELEE_CENTRE_REACH : attackRangeFor(style);
}

function spotName(style: Style, index: number): string {
    return usesSafespot(style) ? `safespot ${index}` : 'the melee anchor';
}

function label(site: DragonSite): string {
    return site.target.toLowerCase();
}

function atTile(t: Tile): boolean {
    const here = Game.tile();
    return here !== null && here.x === t.x && here.z === t.z && here.level === t.level;
}

// Why: the query name match is exact, so 'Baby blue dragon' never matches 'Blue dragon' and the babies stay untargeted.

/** Adults inside `radius` that no other player is fighting. `ours` is exempt. */
function adultsNear(site: DragonSite, ours: number | null, radius: number): Npc[] {
    return Npcs.query()
        .name(site.target)
        .action(ATTACK)
        .within(radius)
        .where(n => site.inArea(n.tile()) && !takenByAnother({
            isOurs: n.index === ours,
            inCombat: n.inCombat,
            targetsMe: n.targetsMe(),
            targetsAnother: n.targetsAnotherPlayer()
        }))
        .results();
}

function stillThere(site: DragonSite, idx: number): boolean {
    return Npcs.all().some(n => n.index === idx && n.name === site.target);
}

/** Whether to break off and heal on a safespot rather than where the bot stands. */
function retreatNeeded(host: CombatHost, site: DragonSite): boolean {
    const here = Game.tile();
    return here !== null && retreatDue({
        inLair: site.inArea(here),
        onSafespot: site.safespots.some(spot => atTile(spot)),
        hpFrac: host.hpFraction(),
        retreatHp: host.retreatHp(),
        hasFood: host.hasFood(),
        spots: site.safespots.length
    });
}

export class Fight implements Task {
    private engaged: number | null = null;
    private seenAt = 0;
    private engagedAt = 0;
    private engagedHealth = -1;
    private lastHp = -1;
    private blindSince = performance.now();
    private readonly skip = new Map<number, number>();

    constructor(private readonly host: CombatHost, private readonly site: DragonSite) {}

    validate(): boolean {
        if (!this.site.inArea(Game.tile()) || this.host.hpFraction() < this.host.panicHp()) {
            return false;
        }
        if (holdsAnchor(this.host.style()) && !atTile(this.anchor())) {
            return false;
        }
        return this.field(FIELD_RADIUS).length > 0 || this.blindDue();
    }

    // Why: the ladder only turns inside execute(), so a spot that sees nothing at all would never rotate if an empty field kept the task from running.

    /** Whether the safespot has gone blind long enough to owe a rotation. */
    private blindDue(): boolean {
        return usesSafespot(this.host.style())
            && this.site.safespots.length > 1
            && performance.now() - this.blindSince >= SAFESPOT_BLIND_MS;
    }

    async execute(): Promise<void> {
        const style = this.host.style();
        const name = label(this.site);
        this.host.setStatus(`fighting ${name}s`);
        const deadline = performance.now() + FIGHT_MS;
        for (let pass = 0; pass < FIGHT_PASSES && performance.now() < deadline; pass++) {
            if (EventSignal.pending() || this.host.died || ChatDialog.canContinue()) {
                return;
            }
            // Why: eating in dragonfire loses the race, so the fight hands the loop back at the retreat line the same way the task order puts Retreat above Eat.
            if (retreatNeeded(this.host, this.site)) {
                return;
            }
            // Why: an eat that never lands means an empty pack, and looping on it burns every pass without pumping Sustain or reaching the panic check below.
            if (this.host.needEat() && !(await this.host.eatOnce())) {
                return;
            }
            if (this.host.hpFraction() < this.host.panicHp()) {
                return;
            }
            const step = await this.ladder();
            if (step === 'stuck') {
                return;
            }
            if (step === 'moved') {
                continue;
            }
            // Why: the drop rots in the two minutes this loop may hold, and LootCorpse, BuryBones and SolveClue all sit below Fight in the list, so a kill ends the call and the next pass picks up the next dragon.
            if (this.settleKill(name)) {
                return;
            }
            if (holdsAnchor(style) && !atTile(this.anchor()) && !(await this.walkBack())) {
                return;
            }

            const field = this.field(FIELD_RADIUS);
            const live = this.engaged === null ? undefined : field.find(n => n.index === this.engaged);
            if (live && live.targetsAnotherPlayer()) {
                this.host.log(`${name} ${live.index} was taken by another player. Finding another.`);
                this.skip.set(live.index, performance.now() + TAKEN_SKIP_MS);
                this.clearTarget();
                continue;
            }
            // Why: Game.inCombat() reads our own combat bar, which never lights up while safespotting, so a changing target health is the only proof the attack landed.
            if (live) {
                if (live.health !== this.engagedHealth) {
                    this.engagedHealth = live.health;
                    this.engagedAt = performance.now();
                }
                if (performance.now() - this.engagedAt < RE_ENGAGE_MS) {
                    await this.idle();
                    continue;
                }
            }

            const now = performance.now();
            const target = field
                .filter(n => (this.skip.get(n.index) ?? 0) < now)
                .sort((a, b) => a.distance() - b.distance())[0];
            if (!target) {
                await this.idle();
                return;
            }
            if (holdsAnchor(style) && target.distance() > reachFor(style)) {
                if (!(await this.leash(target.index))) {
                    this.skip.set(target.index, now + LEASH_SKIP_MS);
                }
                continue;
            }
            if (!(await this.engage(target, name))) {
                continue;
            }
            if (holdsAnchor(style) && !atTile(this.anchor())) {
                this.skip.set(target.index, performance.now() + PULL_SKIP_MS);
                this.host.log(`${name} ${target.index} pulled us off ${spotName(style, this.host.safespotIndex())}. Skipping it for ${PULL_SKIP_MS / 1000}s.`);
                this.clearTarget();
            }
        }
    }

    private anchor(): Tile {
        return anchorFor(this.site, this.host.style(), this.host.safespotIndex());
    }

    private field(radius: number): Npc[] {
        return adultsNear(this.site, this.engaged, radius);
    }

    private setTarget(idx: number): void {
        this.engaged = idx;
        this.host.targetIdx = idx;
        this.seenAt = performance.now();
    }

    private clearTarget(): void {
        this.engaged = null;
        this.host.targetIdx = null;
        this.engagedHealth = -1;
    }

    // Why: a target index that vanished while the loop was away at the bank is a respawn rather than a kill, so a vanish only counts near the last sighting.

    /** True when the engaged dragon went down on this pass. */
    private settleKill(name: string): boolean {
        if (this.engaged === null) {
            return false;
        }
        if (stillThere(this.site, this.engaged)) {
            this.seenAt = performance.now();
            return false;
        }
        const killed = performance.now() - this.seenAt < KILL_GRACE_MS;
        if (killed) {
            this.host.countKill();
            this.host.log(`${name} ${this.engaged} down`);
        }
        this.clearTarget();
        return killed;
    }

    // Why: the safespots are derived as melee-proof, so a hit landing there means the derivation missed an angle and a blind stretch means a dragon body is parked across it.

    /** Advance the safespot ladder, walking back onto the new tile when it turns. */
    private async ladder(): Promise<Step> {
        const style = this.host.style();
        const hp = Skills.effective('hitpoints');
        const onSpot = atTile(this.anchor());
        const hurt = onSpot && this.lastHp >= 0 && hp < this.lastHp;
        this.lastHp = hp;
        if (!usesSafespot(style)) {
            return 'held';
        }
        const index = this.host.safespotIndex();
        if (this.field(attackRangeFor(style)).length > 0) {
            this.blindSince = performance.now();
        }
        const blindMs = performance.now() - this.blindSince;
        const next = nextSafespot({ index, spots: this.site.safespots.length, hurt, blindMs });
        if (next === index) {
            return 'held';
        }
        this.host.setSafespotIndex(next);
        // Why: resetting the clock with the index stops one rotation from tripping the next on the same pass.
        this.blindSince = performance.now();
        this.skip.clear();
        const why = hurt ? 'a hit landed' : `nothing in range for ${Math.round(SAFESPOT_BLIND_MS / 1000)}s`;
        this.host.log(`rotating to safespot ${next} at ${anchorFor(this.site, style, next)} (${why})`);
        return (await this.walkBack()) ? 'moved' : 'stuck';
    }

    // Why: walkResilient's arrival probe accepts the closest reachable point, so an exact stand is only proved by reading the position back.

    /** Hop onto the current anchor. False hands the walk to HoldSafespot. */
    private async walkBack(): Promise<boolean> {
        const spot = this.anchor();
        if (atTile(spot)) {
            return true;
        }
        const where = spotName(this.host.style(), this.host.safespotIndex());
        this.host.setStatus(`returning to ${where}`);
        for (let i = 0; i < HOP_ATTEMPTS && !atTile(spot) && !EventSignal.pending(); i++) {
            await DirectNavigator.walk(spot);
            if (await waitFed(() => atTile(spot), HOP_MS)) {
                break;
            }
        }
        if (atTile(spot)) {
            return true;
        }
        this.host.log(`could not stand on ${where} at ${spot}. Handing back to the walk-back task.`);
        return false;
    }

    // Why: clicking Attack from beyond weapon range makes the server walk us into range, which steps off the safespot.

    /** Hold the tile while the dragon closes. False means it never did. */
    private async leash(idx: number): Promise<boolean> {
        const style = this.host.style();
        const name = label(this.site);
        this.host.setStatus(`waiting for ${name} ${idx} to close`);
        // Why: the outline follows what the loop waits on while `engaged` stays with the dragon we clicked Attack on, so a leash that ends in someone else's kill cannot score one.
        this.host.targetIdx = idx;
        const deadline = performance.now() + LEASH_MS;
        for (let pass = 0; pass < LEASH_PASSES && performance.now() < deadline; pass++) {
            if (EventSignal.pending() || this.host.died || ChatDialog.canContinue()) {
                return true;
            }
            if (this.host.needEat() && !(await this.host.eatOnce())) {
                return true;
            }
            if (this.host.hpFraction() < this.host.panicHp() || (await this.ladder()) !== 'held') {
                return true;
            }
            if (!atTile(this.anchor()) && !(await this.walkBack())) {
                return true;
            }
            const dragon = this.field(FIELD_RADIUS).find(n => n.index === idx);
            if (!dragon || dragon.distance() <= reachFor(style)) {
                return true;
            }
            await this.idle();
        }
        this.host.targetIdx = this.engaged;
        return false;
    }

    /** Send the attack and watch for the drag off the safespot. False means the click was refused. */
    private async engage(target: Npc, name: string): Promise<boolean> {
        const style = this.host.style();
        if (target.index === this.engaged) {
            this.host.log(`${name} ${target.index} stalled. Re-issuing the attack.`);
        } else {
            this.host.log(`engaging ${name} ${target.index} at ${target.tile()} (d=${target.distance()})`);
        }
        // Why: arming is one-shot and the next attack spends it, so the bar is clicked against the swing that is about to go out rather than on an idle tick that may never attack.
        await this.host.armSpecial?.();
        if (!(await target.interact(ATTACK))) {
            this.skip.set(target.index, performance.now() + REFUSED_SKIP_MS);
            this.host.log(`${name} ${target.index} refused the attack click. Skipping it for ${REFUSED_SKIP_MS / 1000}s.`);
            await this.idle();
            return false;
        }
        this.setTarget(target.index);
        this.engagedAt = performance.now();
        this.engagedHealth = -1;
        await waitFed(() => (holdsAnchor(style) && !atTile(this.anchor())) || this.field(FIELD_RADIUS).length === 0, ENGAGE_SETTLE_MS);
        return true;
    }

    // Why: Sustain is call-driven and a safespotting bot never walks, so an idle tick that skips it is a tick the bot cannot eat on.

    /** Spend one idle tick, feeding the sustain hook and burying a bone in the swing cooldown. */
    private async idle(): Promise<void> {
        await Sustain.run();
        if (this.host.buryBones() && (await buryOneInFight(this.host.boneName()))) {
            this.host.countBurial();
            return;
        }
        await Execution.delayTicks(1);
    }
}

// Why: this sits above Eat in the task list, since Eat validates until hp reaches healTo and would otherwise hold the loop for every bite of a heal the dragonfire outpaces.

/** Walk out of the fire and heal on a safespot rather than where the bot stands. */
export class Retreat implements Task {
    private retryAt = 0;
    private rotated: number | null = null;

    constructor(private readonly host: CombatHost, private readonly site: DragonSite) {}

    validate(): boolean {
        return Date.now() >= this.retryAt && retreatNeeded(this.host, this.site);
    }

    async execute(): Promise<void> {
        const here = Game.tile();
        if (here === null) {
            return;
        }
        const { index, next } = retreatAim({ rotated: this.rotated, from: here, spots: this.site.safespots });
        this.rotated = null;
        const spot = this.site.safespots[index]!;
        // Why: the ladder reads this to pick the fight tile, so the run resumes on the tile it ran to rather than walking back out to the old one.
        this.host.setSafespotIndex(index);
        this.host.setStatus(`retreating to safespot ${index}`);
        this.host.log(`retreating to safespot ${index} at ${spot} from ${here} at ${Math.round(this.host.hpFraction() * 100)}% hp`);
        // Why: the walk goes out before the bite so the run eats while it moves, since eatOnce waits up to 3s on the heal and every one of those spent still is another breath taken.
        for (let i = 0; i < RETREAT_HOPS && !atTile(spot); i++) {
            if (EventSignal.pending() || this.host.died) {
                return;
            }
            await DirectNavigator.walk(spot);
            if (await waitFed(() => atTile(spot), RETREAT_HOP_MS)) {
                return;
            }
        }
        if (atTile(spot)) {
            return;
        }
        // Why: this task outranks Eat, so a tile a dragon body or another player is sitting on would hold the loop with no bite taken, and the next tile in the ladder is a working fight spot.
        this.host.setSafespotIndex(next);
        this.rotated = next;
        this.retryAt = Date.now() + RETREAT_RETRY_MS;
        this.host.log(`could not reach safespot ${index} at ${spot}. Eating where we stand and trying ${next} in ${RETREAT_RETRY_MS / 1000}s.`);
    }
}

export class HoldSafespot implements Task {
    constructor(private readonly host: CombatHost, private readonly site: DragonSite) {}

    validate(): boolean {
        return this.site.inArea(Game.tile())
            && !atTile(this.spot())
            && this.host.hpFraction() >= this.host.panicHp();
    }

    async execute(): Promise<void> {
        const style = this.host.style();
        const index = this.host.safespotIndex();
        const spot = this.spot();
        this.host.setStatus(`returning to ${spotName(style, index)}`);
        await Traversal.walkResilient(spot, { radius: 0, attempts: 4, timeoutMs: RETURN_MS, log: m => this.host.log(`  ${m}`) });
        if (atTile(spot)) {
            return;
        }
        // Why: an occupied or unreachable tile would otherwise be retried forever, and the next tile in the ladder is a working fight spot.
        const spots = this.site.safespots.length;
        const next = usesSafespot(style) && spots > 1 ? (index + 1) % spots : index;
        this.host.log(`${spotName(style, index)} at ${spot} could not be reached${next === index ? '' : `. Rotating to ${next}`}.`);
        this.host.setSafespotIndex(next);
    }

    private spot(): Tile {
        return anchorFor(this.site, this.host.style(), this.host.safespotIndex());
    }
}

export class WalkToSpot implements Task {
    constructor(private readonly host: CombatHost, private readonly site: DragonSite) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null
            && this.site.inArea(here)
            && this.host.hpFraction() >= this.host.panicHp()
            && this.anchor().distanceTo(here) > APPROACH_RADIUS;
    }

    async execute(): Promise<void> {
        this.host.setStatus('walking to the fight spot');
        const log = (m: string): void => this.host.log(`  ${m}`);
        for (const stop of this.site.approach) {
            const here = Game.tile();
            if (here !== null && stop.distanceTo(here) > 1) {
                await Traversal.walkResilient(stop, { radius: 1, attempts: 3, timeoutMs: APPROACH_MS, log });
            }
        }
        const spot = this.anchor();
        const style = this.host.style();
        await Traversal.walkResilient(spot, { radius: 0, attempts: 5, timeoutMs: APPROACH_MS, log });
        if (!atTile(spot)) {
            this.host.log(`the walk in stopped short of ${spotName(style, this.host.safespotIndex())} at ${spot}. Closing the gap from the walk-back task.`);
        }
    }

    private anchor(): Tile {
        return anchorFor(this.site, this.host.style(), this.host.safespotIndex());
    }
}
