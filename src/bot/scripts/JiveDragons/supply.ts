import { driveDialog } from '../../api/ai/quests/exec/primitives.js';
import { Bank } from '../../api/bank/Bank.js';
import { depositAllExcept } from '../../api/bank/bankRules.js';
import type { PotionPlan } from '../../api/combat/boostPotions.js';
import { castsAvailable, runeWithdrawList } from '../../api/combat/CombatStyleLogic.js';
import { foodCount as foodCountIn, foodForms } from '../../api/combat/food.js';
import { combatKeepNames } from '../../api/combat/keepList.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs, type Loc } from '../../api/locs/Locs.js';
import { Npcs, talkOp, type Npc } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { SPELL_TELEPORTS } from '../../event/webwalk/teleportCatalog.js';
import Tile from '../../geometry/Tile.js';
import { keyStatus, meleeShieldGate, type Style } from './logic.js';
import type { DragonSite } from './sites.js';

/** What supply and combat need from the bot, so neither imports JiveDragons.ts. */
export interface JiveHost {
    log(m: string): void;
    setStatus(s: string): void;
    parkFor(reason: string): void;
    countBankTrip(): void;
    style(): Style;
    foodName(): string;
    foodWithdraw(): number;
    weaponName(): string;
    ammoName(): string;
    spellName(): string;
    keepExtra(): string[];
}

export interface BankOpts {
    withdrawFood: boolean;
    /** Casts of spell runes to withdraw. */
    runeCasts?: number;
    /** Spare runes per type, on top of the cast budget. */
    runeBuffer?: number;
    ammo?: number;
    /** Escape casts carried on top of the one needed to leave. */
    escapeStock?: number;
    /** Fraction of max hp to eat back to before walking in. */
    healTo?: number;
    /** Boost flasks to top up, empty for a run that carries none. */
    potions?: PotionPlan[];
}

export interface EscapeSpell {
    runes: { rune: string; count: number }[];
    level: number;
    label: string;
}

export type KeyState = 'held' | 'bank' | 'fetch';

const SHIELD = 'Dragonfire shield';
const BOOTH = 'Bank booth';
const BOOTH_OP = 'Use-quickly';

const JAIL_DOOR = new Tile(2931, 9690, 0);
const JAIL_KEY = 'Jail key';
const JAIL_KEY_ID = 1591;
const JAIL_DOOR_LOC = 2631;
const JAILER = 'Jailer';
const VELRAK = 'Velrak the explorer';
const VELRAK_PREFER = ['So... do you know anywhere good to explore?', 'Yes please!'];
const CELL = { minX: 2928, maxX: 2934, minZ: 9683, maxZ: 9689 };

const WALK_MS = 300_000;
const KILL_MS = 90_000;
const DOOR_MS = 8000;
const HEAL_TO = 0.9;
const RUNE_CASTS = 150;
const RUNE_BUFFER = 300;
const AMMO_WITHDRAW = 500;
const ESCAPE_STOCK = 2;

const say = (h: JiveHost) => (m: string): void => h.log(`  ${m}`);

/** The runes and magic level a catalog teleport needs. */
export function escapeRunesFor(teleportId: string): EscapeSpell {
    const dest = SPELL_TELEPORTS.find(t => t.teleportId === teleportId);
    const items = dest?.requires?.items ?? [];
    const skill = dest?.requires?.skills?.find(s => s.name === 'magic');
    return {
        runes: items.map(i => ({ rune: i.name, count: i.count })),
        level: skill?.level ?? 0,
        label: dest?.label ?? teleportId
    };
}

/** Why the escape teleport cannot be cast right now, or null when it can. */
function escapeShortfall(esc: EscapeSpell): string | null {
    const magic = Skills.level('magic');
    if (magic < esc.level) {
        return `magic ${magic} is below the ${esc.level} it needs`;
    }
    const short = esc.runes.filter(r => Inventory.count(r.rune) < r.count);
    return short.length > 0 ? `no ${short.map(r => r.rune).join(' and ')}` : null;
}

function hpFrac(): number {
    return Skills.hpFraction();
}

function foodCount(h: JiveHost): number {
    return foodCountIn(Inventory.items(), h.foodName());
}

function wieldedNames(): string[] {
    return Equipment.items().map(i => i.name ?? '');
}

function castsLeft(h: JiveHost): number {
    return castsAvailable(h.spellName(), wieldedNames(), rune => Inventory.count(rune));
}

function ammoLeft(h: JiveHost): number {
    const wanted = h.ammoName().toLowerCase();
    const worn = Equipment.items().find(i => (i.name ?? '').toLowerCase() === wanted);
    return Inventory.count(h.ammoName()) + (worn?.count ?? 0);
}

function locById(id: number, within = 5): Loc | null {
    return Locs.query().where(l => l.id === id).within(within).nearest();
}

// Why: Sustain is call-driven, so a wait that stands still in hostile ground never eats unless it pumps the hook itself.

/** Wait for `cond`, feeding the sustain hook every tick. */
export async function waitFed(cond: () => boolean, ms: number): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
        if (cond()) {
            return true;
        }
        await Sustain.run();
        await Execution.delayTicks(1);
    }
    return cond();
}

async function walkNear(dest: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const me = Game.tile();
    if (me !== null && dest.distanceTo(me) <= radius) {
        return true;
    }
    return Traversal.walkResilient(dest, { radius, attempts: 4, timeoutMs: WALK_MS, log });
}

// Why: walkResilient's arrival probe accepts the closest reachable point when the destination is sealed or an npc stands on it, so an exact stand is only proved by reading the position back.

/** Walk onto `dest` itself, not near it. */
async function walkExact(dest: Tile, log: (m: string) => void): Promise<boolean> {
    await walkNear(dest, 0, log);
    const me = Game.tile();
    return me !== null && dest.distanceTo(me) === 0;
}

export async function enterLair(h: JiveHost, site: DragonSite): Promise<boolean> {
    if (site.inArea(Game.tile())) {
        return true;
    }
    const gate = site.gate;
    if (!gate) {
        return true;
    }
    h.setStatus('walking to the dungeon gate');
    if (!(await Traversal.walkResilient(gate.outside, { radius: 0, attempts: 5, timeoutMs: 300_000, log: m => h.log(`  ${m}`) }))) {
        return false;
    }
    await Execution.delayTicks(2);
    const door = Locs.query().where(l => l.id === gate.locId).within(5).nearest();
    const key = site.keyItem === null ? null : Inventory.items().find(i => i.id === site.keyItem!.id);
    if (!door || (site.keyItem !== null && !key)) {
        h.log('the gate is not in the scene yet, or the key is gone. Retrying.');
        return false;
    }
    h.setStatus('unlocking the dungeon gate');
    if (!(await (key ? key.useOn(door) : door.interact(gate.op)))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => site.inArea(Game.tile()), 8000))) {
        h.log('the gate did not let us through. Retrying.');
        return false;
    }
    h.log('inside the dragon lair');
    for (const stop of site.approach) {
        await Traversal.walkResilient(stop, { radius: 0, attempts: 3, timeoutMs: 60_000, log: m => h.log(`  ${m}`) });
    }
    return true;
}

/** Teleport out of the lair, or walk out through the gate when the cast will not fire. */
export async function leaveLair(h: JiveHost, site: DragonSite): Promise<boolean> {
    if (!site.inArea(Game.tile())) {
        return true;
    }
    const esc = escapeRunesFor(site.escapeTeleportId);
    let why = escapeShortfall(esc);
    for (let i = 0; why === null && i < 3 && site.inArea(Game.tile()); i++) {
        h.setStatus(`teleporting to ${esc.label}`);
        if (await Game.teleport(site.escapeTeleportId) && await waitFed(() => !site.inArea(Game.tile()), DOOR_MS)) {
            h.log(`teleported out to ${esc.label}`);
            return true;
        }
        await Execution.delayTicks(3);
        why = escapeShortfall(esc);
    }
    if (!site.inArea(Game.tile())) {
        return true;
    }
    h.log(`the ${esc.label} will not fire (${why ?? 'the cast never landed'}). Walking out through the gate instead.`);
    return walkOutOfLair(h, site);
}

// Why: the gate takes the key on the way in only, and answers a plain Open from the inside.

async function walkOutOfLair(h: JiveHost, site: DragonSite): Promise<boolean> {
    const gate = site.gate;
    if (!gate) {
        return !site.inArea(Game.tile());
    }
    h.setStatus('walking back to the dungeon gate');
    // Why: the inside stand is the one gap in the lair wall, so requiring it would seal the bot in whenever a player or an npc parks on it.
    if (!(await walkExact(gate.inside, say(h)))) {
        h.log('the inside of the gate is occupied. Opening it from wherever the walk stopped.');
        await walkNear(gate.inside, 2, say(h));
    }
    await Execution.delayTicks(2);
    const door = locById(gate.locId);
    if (!door || !(await door.interact(gate.op))) {
        h.log('the gate is not in the scene yet. Retrying.');
        return false;
    }
    if (!(await waitFed(() => !site.inArea(Game.tile()), DOOR_MS))) {
        h.log('the gate did not let us out. Retrying.');
        return false;
    }
    h.log('out of the dragon lair');
    return walkNear(site.walkOut, 3, say(h));
}

function keepNames(h: JiveHost, site: DragonSite): string[] {
    const extra = [SHIELD, JAIL_KEY, ...escapeRunesFor(site.escapeTeleportId).runes.map(r => r.rune), ...h.keepExtra()];
    if (site.keyItem !== null) {
        extra.push(site.keyItem.name);
    }
    return combatKeepNames({
        food: h.foodName(),
        style: h.style(),
        spell: h.spellName(),
        ammo: h.ammoName(),
        weapon: h.weaponName(),
        extra
    });
}

async function openSiteBank(h: JiveHost, site: DragonSite): Promise<boolean> {
    if (!(await walkNear(site.bank, 3, say(h)))) {
        h.log('walk to the bank failed. Will retry.');
        return false;
    }
    if (!(await Bank.openNearest(BOOTH, BOOTH_OP, say(h)))) {
        h.log('could not open the bank. Will retry.');
        return false;
    }
    return true;
}

/** Bank the load, restock, heal, and end the trip ready for the next one. */
export async function bankRoutine(h: JiveHost, site: DragonSite, opts: BankOpts): Promise<void> {
    if (!(await leaveLair(h, site))) {
        return;
    }
    if (!(await openSiteBank(h, site))) {
        return;
    }
    await Bank.depositAllMatching(depositAllExcept(keepNames(h, site)), say(h));
    if (opts.withdrawFood) {
        await withdrawFoodTo(h);
    }
    await withdrawKey(h, site);
    await withdrawGear(h);
    await withdrawStyleSupplies(h, opts);
    await withdrawEscapeRunes(h, site, opts);
    await withdrawPotions(h, opts);
    // Why: Equipment.equip shuts the bank to get the backpack ops back, so every withdrawal has to land before anything is worn.
    await equipGear(h);
    if (await healUp(h, opts.healTo ?? HEAL_TO) && opts.withdrawFood && await openSiteBank(h, site)) {
        await withdrawFoodTo(h);
    }
    await Bank.close();
    h.countBankTrip();
    h.setStatus('restocked, heading back to the dragons');
}

async function withdrawFoodTo(h: JiveHost): Promise<void> {
    h.setStatus(`withdrawing ${h.foodName()}`);
    const want = h.foodWithdraw();
    for (let guard = 0; guard < 12 && foodCount(h) < want && !Inventory.isFull(); guard++) {
        const before = foodCount(h);
        const need = want - before;
        await Bank.withdraw(h.foodName(), need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => foodCount(h) > before, 2500))) {
            break;
        }
    }
    if (foodCount(h) === 0) {
        h.log(`WARNING: no '${h.foodName()}' in the bank. Deposit food to resume eating.`);
    }
}

/** Take the site's key out of the bank when the trip is starting without it. */
async function withdrawKey(h: JiveHost, site: DragonSite): Promise<boolean> {
    const item = site.keyItem;
    if (item === null || Inventory.countById(item.id) > 0) {
        return true;
    }
    if (Bank.countById(item.id) === 0) {
        h.log(`no '${item.name}' in the bank or in the pack. Velrak has to hand out another one.`);
        return false;
    }
    h.setStatus(`withdrawing the ${item.name}`);
    await Bank.withdrawById(item.id, 'Withdraw-1');
    return Execution.delayUntil(() => Inventory.countById(item.id) > 0, 2500);
}

async function needOne(h: JiveHost, name: string): Promise<void> {
    if (name === '' || Equipment.contains(name) || Inventory.first(name) !== null) {
        return;
    }
    if (await withdrawTo(name, 1) > 0) {
        h.log(`withdrew ${name}`);
    } else {
        h.log(`WARNING: no '${name}' in the bank. Carrying on with the gear already worn.`);
    }
}

async function withdrawGear(h: JiveHost): Promise<void> {
    if (h.style() === 'melee') {
        await needOne(h, SHIELD);
    } else {
        await needOne(h, h.weaponName());
    }
    // Why: reader.bankItems() is empty whenever the bank modal is shut, so a count of zero only carries a fact with the bank open.
    const gate = meleeShieldGate(h.style(), Equipment.contains(SHIELD) || Inventory.count(SHIELD) > 0 || Bank.count(SHIELD) > 0);
    if (gate !== null) {
        h.parkFor(gate);
    }
}

async function equipGear(h: JiveHost): Promise<void> {
    const wear = h.style() === 'melee' ? [SHIELD] : [h.weaponName(), h.style() === 'range' ? h.ammoName() : ''];
    for (const name of wear) {
        if (name !== '' && !Equipment.contains(name) && Inventory.first(name) !== null && await Equipment.equip(name)) {
            h.log(`wearing ${name}`);
        }
    }
}

async function withdrawStyleSupplies(h: JiveHost, opts: BankOpts): Promise<void> {
    if (h.style() === 'mage') {
        h.setStatus('withdrawing runes');
        for (const { rune, count } of runeWithdrawList(h.spellName(), wieldedNames(), opts.runeCasts ?? RUNE_CASTS)) {
            const target = count + (opts.runeBuffer ?? RUNE_BUFFER);
            if (Inventory.count(rune) < target) {
                const got = await withdrawTo(rune, target);
                h.log(`withdrew ${got} ${rune} (${Inventory.count(rune)}/${target})`);
            }
        }
        if (castsLeft(h) < 1) {
            h.log(`WARNING: the bank cannot supply a single '${h.spellName()}' cast. Deposit runes to resume.`);
        }
    } else if (h.style() === 'range') {
        h.setStatus(`withdrawing ${h.ammoName()}`);
        const got = await withdrawTo(h.ammoName(), opts.ammo ?? AMMO_WITHDRAW);
        if (got > 0) {
            h.log(`withdrew ${got} ${h.ammoName()}`);
        } else if (ammoLeft(h) === 0) {
            h.log(`WARNING: no '${h.ammoName()}' in the bank. Deposit ammo to resume.`);
        }
    }
}

async function withdrawEscapeRunes(h: JiveHost, site: DragonSite, opts: BankOpts): Promise<void> {
    const esc = escapeRunesFor(site.escapeTeleportId);
    for (const { rune, count } of esc.runes) {
        const target = count * ((opts.escapeStock ?? ESCAPE_STOCK) + 1);
        if (Inventory.count(rune) < target) {
            await withdrawTo(rune, target);
        }
    }
    const why = escapeShortfall(esc);
    if (why !== null) {
        h.log(`WARNING: the ${esc.label} cannot be cast (${why}). The next trip walks out through the gate.`);
    }
}

function potionsHeld(plan: PotionPlan): number {
    return plan.potion.doses.reduce((n, dose) => n + Inventory.count(dose), 0);
}

// Why: a flask is counted across every dose form, so a part-used one carried back from the last trip is topped up rather than stocked on top of.

/** Top each planned boost up to its flask count. */
async function withdrawPotions(h: JiveHost, opts: BankOpts): Promise<void> {
    for (const plan of opts.potions ?? []) {
        const start = potionsHeld(plan);
        for (let guard = 0; guard < 12 && potionsHeld(plan) < plan.want && !Inventory.isFull(); guard++) {
            const before = potionsHeld(plan);
            await Bank.withdraw(plan.flask, 'Withdraw-1');
            if (!(await Execution.delayUntil(() => potionsHeld(plan) > before, 2500))) {
                break;
            }
        }
        const got = potionsHeld(plan) - start;
        if (got > 0) {
            h.log(`withdrew ${got} ${plan.flask}`);
        } else if (potionsHeld(plan) === 0) {
            h.log(`WARNING: no '${plan.flask}' in the bank. Fighting unboosted.`);
        }
    }
}

async function eatOnce(h: JiveHost): Promise<boolean> {
    const forms = foodForms(h.foodName());
    const food = Inventory.items().find(i => forms.includes((i.name ?? '').toLowerCase()));
    if (!food) {
        return false;
    }
    const before = Skills.effective('hitpoints');
    if (!(await food.interact('Eat'))) {
        return false;
    }
    return Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
}

// Why: the walk back is long, so the heal happens at the booth and the food it spends is topped up before leaving.

async function healUp(h: JiveHost, to: number): Promise<boolean> {
    if (hpFrac() >= to || foodCount(h) === 0) {
        return false;
    }
    if (Bank.isOpen() && !(await Bank.close())) {
        return false;
    }
    h.setStatus('eating up before the trip back');
    const from = Math.round(hpFrac() * 100);
    // Why: eating has a cooldown, so one refused bite is normal and only a run of them means the food is gone.
    let misses = 0;
    for (let i = 0; i < 24 && hpFrac() < to && foodCount(h) > 0 && misses < 3; i++) {
        if (await eatOnce(h)) {
            misses = 0;
        } else {
            misses++;
            await Execution.delayTicks(2);
        }
    }
    h.log(`healed ${from}% to ${Math.round(hpFrac() * 100)}% before heading back`);
    return true;
}

/** Top the pack up to `target` of `name`, returning how many arrived. */
export async function withdrawTo(name: string, target: number): Promise<number> {
    const start = Inventory.count(name);
    for (let guard = 0; guard < 40 && Inventory.count(name) < target && !Inventory.isFull(); guard++) {
        const before = Inventory.count(name);
        const need = target - before;
        if (need > 10 && (await Bank.withdrawX(name, need))) {
            if (Inventory.count(name) > before) {
                continue;
            }
            break;
        }
        await Bank.withdraw(name, need >= 10 ? 'Withdraw-10' : need >= 5 ? 'Withdraw-5' : 'Withdraw-1');
        if (!(await Execution.delayUntil(() => Inventory.count(name) > before, 2500))) {
            break;
        }
    }
    return Inventory.count(name) - start;
}

/** Standing inside Velrak's cell, which is a dead end. */
export function inCell(): boolean {
    const me = Game.tile();
    return me !== null && me.level === 0
        && me.x >= CELL.minX && me.x <= CELL.maxX
        && me.z >= CELL.minZ && me.z <= CELL.maxZ;
}

// Why: the jail key lies on the floor for 100 ticks against the usual two minutes, so a slow pickup means killing the Jailer again.

async function takeJailKey(h: JiveHost): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const drop = GroundItems.query().where(g => g.id === JAIL_KEY_ID).within(12).nearest();
        if (!drop) {
            await Execution.delayTicks(2);
            continue;
        }
        if (drop.distance() > 1) {
            await Traversal.walkResilient(drop.tile(), { radius: 1, attempts: 2, timeoutMs: 30_000, log: say(h) });
        }
        const again = GroundItems.query().where(g => g.id === JAIL_KEY_ID).within(12).nearest();
        if (again && await again.interact('Take') && await waitFed(() => Inventory.countById(JAIL_KEY_ID) > 0, DOOR_MS)) {
            return true;
        }
    }
    h.log('the jail key was gone before it was picked up. Killing the Jailer again.');
    return false;
}

// Why: the Jailer has no huntmode so he never opens the fight, and nothing polls Sustain for a loop that stands and swings.

async function killJailer(h: JiveHost): Promise<boolean> {
    const jailer = Npcs.query().name(JAILER).action('Attack').within(14).nearest();
    if (!jailer) {
        h.log(`no ${JAILER} in the prison corridor. Waiting out his 100-tick respawn.`);
        await Execution.delayTicks(5);
        return false;
    }
    const index = jailer.index;
    const live = (): boolean => Npcs.all().some(npc => npc.index === index && npc.name === JAILER);
    if (!(await jailer.interact('Attack'))) {
        return false;
    }
    h.setStatus(`fighting the ${JAILER} for his key`);
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline && !EventSignal.pending()) {
        await Sustain.run();
        if (Inventory.countById(JAIL_KEY_ID) > 0) {
            return true;
        }
        if (!live()) {
            return takeJailKey(h);
        }
        await Execution.delayTicks(1);
    }
    h.log(`the ${JAILER} outlived ${KILL_MS / 1000}s of combat.`);
    return false;
}

async function unlockCell(h: JiveHost): Promise<boolean> {
    await Execution.delayTicks(2);
    const door = locById(JAIL_DOOR_LOC);
    const key = Inventory.items().find(i => i.id === JAIL_KEY_ID);
    if (!door || !key) {
        h.log('no cell door in reach, or the jail key is gone. Retrying.');
        return false;
    }
    h.setStatus('unlocking the cell');
    if (!(await key.useOn(door))) {
        return false;
    }
    if (!(await waitFed(() => inCell(), DOOR_MS))) {
        h.log('the cell door did not let us in. Retrying.');
        return false;
    }
    return true;
}

/** Open the cell door from the inside. True when the run is back in the corridor. */
export async function leaveCell(h: JiveHost): Promise<boolean> {
    if (!inCell()) {
        return true;
    }
    await Execution.delayTicks(2);
    const door = locById(JAIL_DOOR_LOC);
    if (!door || !(await door.interact('Open'))) {
        h.log('no cell door to open from the inside. Retrying.');
        return false;
    }
    return waitFed(() => !inCell(), DOOR_MS);
}

// Why: Velrak has no wanderrange, so he drifts around a cell whose walls make that a walk, and the shared talk primitives answer an out-of-reach npc by opening the door in front of it, which here is the cell door.

async function talkInCell(h: JiveHost): Promise<boolean> {
    await Execution.delayTicks(2);
    const find = (): Npc | null => Npcs.query().name(VELRAK).where(npc => talkOp(npc.actions()) !== null).nearest();
    let velrak = find();
    if (!velrak) {
        h.log(`no ${VELRAK} in the cell. Retrying.`);
        return false;
    }
    if (velrak.distance() > 1) {
        await DirectNavigator.walkTo(velrak.tile(), 1, 20_000);
        velrak = find();
    }
    const op = velrak === null ? null : talkOp(velrak.actions());
    if (velrak === null || op === null || !(await velrak.interact(op))) {
        h.log(`${VELRAK} refused the talk. Retrying.`);
        return false;
    }
    if (!(await waitFed(() => ChatDialog.isOpen() || ChatDialog.canContinue(), DOOR_MS))) {
        h.log(`${VELRAK} never opened a dialogue. Retrying.`);
        return false;
    }
    return driveDialog(VELRAK_PREFER, say(h));
}

async function fetchFromVelrak(h: JiveHost, keyId: number): Promise<boolean> {
    if (!inCell()) {
        if (!(await walkNear(JAIL_DOOR, 1, say(h)))) {
            return false;
        }
        if (Inventory.countById(JAIL_KEY_ID) === 0 && !(await killJailer(h))) {
            return false;
        }
        // Why: npcs block tiles, and the client's own path search fails every click at a stand the Jailer is standing on.
        if (!(await walkExact(JAIL_DOOR, say(h)))) {
            h.log('could not stand at the cell door. Retrying.');
            return false;
        }
        if (!(await unlockCell(h))) {
            return false;
        }
    }
    const got = await talkInCell(h) && await Execution.delayUntil(() => Inventory.countById(keyId) > 0, DOOR_MS);
    if (!got) {
        h.log('Velrak handed over no key. Retrying.');
    }
    // Why: the cell is a dead end, so the run has to be back in the corridor before anything else routes from here.
    const out = await leaveCell(h);
    return got && out;
}

/** Put the site's key in the pack, from the bank when it is there and from Velrak when it is not. */
export async function acquireKey(h: JiveHost, site: DragonSite): Promise<KeyState> {
    const item = site.keyItem;
    if (item === null) {
        return 'held';
    }
    const state = (): KeyState => keyStatus(Inventory.countById(item.id), Bank.countById(item.id));
    if (state() === 'held') {
        return 'held';
    }
    if (site.inArea(Game.tile()) && !(await leaveLair(h, site))) {
        return state();
    }
    h.setStatus(`fetching the ${item.name}`);
    // Why: reader.bankItems() is empty whenever the bank modal is shut, so a key sitting in the bank reads as no key at all and would cost a needless Jailer kill.
    // Why: the fetch also needs a free slot for the key and walks into a fight, so a bank stop that never happened is a reason to stop rather than press on.
    if (!(await openSiteBank(h, site))) {
        return state();
    }
    await Bank.depositAllMatching(depositAllExcept(keepNames(h, site)), say(h));
    const fromBank = await withdrawKey(h, site);
    if (!fromBank) {
        await withdrawFoodTo(h);
    }
    await Bank.close();
    if (fromBank) {
        h.log(`took the ${item.name} out of the bank`);
        return state();
    }
    h.setStatus(`fetching the ${item.name} from Velrak`);
    // Why: the jail key is already earned and kept, so a failure inside the cell is retried here rather than paid for with another walk and another kill.
    for (let attempt = 0; attempt < 3 && state() !== 'held' && !EventSignal.pending(); attempt++) {
        if (await fetchFromVelrak(h, item.id)) {
            h.log(`Velrak handed over the ${item.name}`);
        }
    }
    return state();
}
