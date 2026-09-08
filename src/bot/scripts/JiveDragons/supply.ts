import { reader } from '../../adapter/ClientAdapter.js';
import { driveDialog } from '../../api/ai/quests/exec/primitives.js';
import { GameMessages } from '../../api/chatbox/gameMessages.js';
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
import { Modals } from '../../api/ui/widgets/Modals.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { Npcs, talkOp, type Npc } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { SPELL_TELEPORTS } from '../../event/webwalk/teleportCatalog.js';
import Tile from '../../geometry/Tile.js';
import { keyStatus, nextApproachIndex, shieldGate, type Style } from './logic.js';
import { needsShield, type DragonSite } from './sites.js';

/** What supply and combat need from the bot, so neither imports JiveDragons.ts. */
export interface JiveHost {
    log(m: string): void;
    /** Suppressed unless the panel asks for it; a host without one logs nothing extra. */
    vlog?(m: string): void;
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
    /** Walk out through the gate rather than casting the escape teleport. */
    leaveByWalk(): boolean;
}

export interface FlaskPlan {
    /** The dose form the bank run draws. */
    flask: string;
    /** Every dose form, so a part-used flask still counts as one in the pack. */
    doses: readonly string[];
    /** Flasks to carry per trip. */
    want: number;
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
    /** Dose families topped up by count, antipoison and the like. */
    flasks?: FlaskPlan[];
    /** Gear worn every trip on top of the weapon and the ammo. */
    wear?: string[];
    /** Items carried in the pack every trip, an axe for the vines. */
    carry?: string[];
    /** How the trip leaves the lair; leaveLair when absent. */
    leave?: (h: JiveHost, site: DragonSite) => Promise<boolean>;
}

export interface EscapeSpell {
    runes: { rune: string; count: number }[];
    level: number;
    label: string;
}

export type KeyState = 'held' | 'bank' | 'fetch';

export const SHIELD = 'Dragonfire shield';

/** poison_player's opening line, printed once per fresh poisoning. */
export const POISONED = /you have been poisoned/i;

export const ANTIPOISON_LABEL = 'Superantipoison';
export const ANTIPOISON_DOSES: readonly string[] = [4, 3, 2, 1].map(d => `${ANTIPOISON_LABEL}(${d})`);

export function antipoisonPlan(want: number): FlaskPlan {
    return { flask: ANTIPOISON_DOSES[0]!, doses: ANTIPOISON_DOSES, want };
}

export const ANTIFIRE_LABEL = 'Antifire potion';
export const ANTIFIRE_DOSES: readonly string[] = [4, 3, 2, 1].map(d => `${ANTIFIRE_LABEL}(${d})`);

export function antifirePlan(want: number): FlaskPlan {
    return { flask: ANTIFIRE_DOSES[0]!, doses: ANTIFIRE_DOSES, want };
}

/** The first dose form held, smallest flask first so a part-used one goes before a full one. */
export function doseToDrink(count: (name: string) => number, doses: readonly string[] = ANTIPOISON_DOSES): string | null {
    for (const name of [...doses].reverse()) {
        if (count(name) > 0) {
            return name;
        }
    }
    return null;
}

export const COINS = 'Coins';
const BOOTH = 'Bank booth';
const BOOTH_OP = 'Use-quickly';

const JAIL_DOOR = new Tile(2931, 9690, 0);
/** The cell side of the door, where it lands you on the way in. */
const JAIL_DOOR_INSIDE = new Tile(2931, 9689, 0);
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

const APPROACH_LEG_MS = 120_000;

// Why: the stops are one obstacle apart on a site like Brimhaven, so a walk that always began at the first would recross every obstacle whenever the bot drifted past the last; and a stand the loaded scene already reaches needs no stop at all.

/** Walk the site's approach stops from the nearest one on, unless `stand` is already reachable from here. */
export async function walkApproach(h: JiveHost, site: DragonSite, stand?: Tile): Promise<void> {
    const here = Game.tile();
    if (here === null || site.approach.length === 0) {
        return;
    }
    if (stand !== undefined && Reachability.canReach(stand, { adjacentOk: true, maxSteps: 6000 })) {
        return;
    }
    const from = nextApproachIndex(site.approach, here);
    for (const stop of site.approach.slice(from)) {
        const me = Game.tile();
        if (me !== null && stop.distanceTo(me) <= 1) {
            continue;
        }
        await Traversal.walkResilient(stop, { radius: 0, attempts: 3, timeoutMs: APPROACH_LEG_MS, log: m => h.log(`  ${m}`) });
    }
}

const PAY_MS = 20_000;
const DIALOGUE_QUIET_TICKS = 3;

// Why: the varbit the tree reads survives a click that never went through, so a payment the entrance did not follow is kept here, and the next attempt goes to the tree rather than to the bank for a fee it has already paid.
let feePaidFor: string | null = null;

/** Whether the site's fee was paid on an attempt whose entrance did not follow. */
export function feePrepaid(site: DragonSite): boolean {
    return feePaidFor === site.key;
}

// Why: Saniboch's reply is three pages and the coins leave on the first, so a check that stops at the coins clicks the tree behind the last page, where the op waits and times out; the drive runs on until the chat has been shut for a few ticks.
async function settleDialogue(): Promise<void> {
    let quiet = 0;
    for (let i = 0; i < 40 && quiet < DIALOGUE_QUIET_TICKS && !EventSignal.pending(); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            quiet = 0;
        } else if (reader.modals().main !== -1) {
            await Modals.close();
            quiet = 0;
        } else if (ChatDialog.isOpen()) {
            quiet = 0;
        } else {
            quiet++;
        }
        await Execution.delayTicks(1);
    }
}

// Why: the Pay op runs a player line, an objbox and Saniboch's reply before the varbit is set, and the box is a main modal that suspends the script until it is clicked, so the drive answers boxes as well as chat pages and stops on the line the payment prints; a second Pay on a set varbit prints the prepaid line and moves nothing.

/** Pay the doorman, unless the fee is already paid, and take the entrance loc through. */
async function payAndEnter(h: JiveHost, site: DragonSite): Promise<boolean> {
    const fee = site.feeGate!;
    if (!feePrepaid(site) && Inventory.count(COINS) < fee.coins) {
        h.log(`the way in costs ${fee.coins} coins and the pack holds ${Inventory.count(COINS)}. Banking for more.`);
        return false;
    }
    h.setStatus(`walking to ${fee.npc}`);
    if (!(await Traversal.walkResilient(fee.stand, { radius: 2, attempts: 5, timeoutMs: 300_000, log: say(h) }))) {
        return false;
    }
    if (feePrepaid(site)) {
        h.log(`${fee.npc} is already paid from the last attempt, going straight to the entrance`);
    } else {
        const doorman = Npcs.query().name(fee.npc).action(fee.op).nearest();
        if (!doorman) {
            h.log(`no ${fee.npc} in the scene to pay. Retrying.`);
            await Execution.delayTicks(2);
            return false;
        }
        h.setStatus(`paying ${fee.npc}`);
        const mark = GameMessages.mark();
        const before = Inventory.count(COINS);
        if (!(await doorman.interact(fee.op))) {
            return false;
        }
        const paid = (): boolean => GameMessages.sawSince(mark, fee.paidLine) || GameMessages.sawSince(mark, fee.prepaidLine) || Inventory.count(COINS) < before;
        const deadline = performance.now() + PAY_MS;
        while (performance.now() < deadline && !EventSignal.pending() && !paid()) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else if (reader.modals().main !== -1) {
                await Modals.close();
            }
            await Execution.delayTicks(1);
        }
        if (!paid()) {
            h.log(`${fee.npc} took no payment. Retrying.`);
            return false;
        }
        feePaidFor = site.key;
        h.log(GameMessages.sawSince(mark, fee.prepaidLine) ? `${fee.npc} says the fee is already paid` : `paid ${fee.npc} ${fee.coins} coins`);
    }
    await settleDialogue();
    const door = locById(fee.entrance.locId, 8);
    if (!door || !(await door.interact(fee.entrance.op))) {
        h.log('the dungeon entrance is not in the scene yet. Retrying.');
        return false;
    }
    if (!(await waitFed(() => site.inArea(Game.tile()), DOOR_MS))) {
        h.log('the entrance did not let us through. Retrying.');
        return false;
    }
    feePaidFor = null;
    h.log('inside the dungeon');
    h.setStatus('walking in to the dragons');
    await walkApproach(h, site);
    return true;
}

// Why: the guard answers with a two-option chat and only the first option runs the teleport, so the talk is driven to that option rather than clicked through; the reply moves the player, which is what inArea then proves.
async function talkPastGuard(h: JiveHost, site: DragonSite): Promise<boolean> {
    const talk = site.talkGate!;
    h.setStatus(`walking to the ${talk.npc}`);
    if (!(await Traversal.walkResilient(talk.stand, { radius: 2, attempts: 5, timeoutMs: 300_000, log: m => h.log(`  ${m}`) }))) {
        return false;
    }
    for (let attempt = 0; attempt < 3 && !site.inArea(Game.tile()); attempt++) {
        const guard = Npcs.query().name(talk.npc).action(talk.op).nearest();
        if (!guard) {
            h.log(`no ${talk.npc} in the scene to talk past. Retrying.`);
            await Execution.delayTicks(2);
            continue;
        }
        h.setStatus(`talking past the ${talk.npc}`);
        if (!(await guard.interact(talk.op))) {
            continue;
        }
        await driveDialog([talk.choose], say(h));
        if (await waitFed(() => site.inArea(Game.tile()), DOOR_MS)) {
            h.log(`the ${talk.npc} let us past`);
            await walkApproach(h, site);
            return true;
        }
    }
    h.log(`the ${talk.npc} did not let us past. It needs Watch Tower complete. Retrying.`);
    return false;
}

export async function enterLair(h: JiveHost, site: DragonSite): Promise<boolean> {
    if (site.inArea(Game.tile())) {
        return true;
    }
    if (site.talkGate) {
        return talkPastGuard(h, site);
    }
    if (site.feeGate) {
        return payAndEnter(h, site);
    }
    const gate = site.gate;
    // Why: a gateless site is reached by transports and doors the graph already carries, so the approach walk is the way in and inArea is the only proof it landed.
    if (!gate) {
        h.setStatus('walking into the dungeon');
        await walkApproach(h, site);
        if (!site.inArea(Game.tile())) {
            h.log('the walk in did not reach the dungeon. Retrying.');
            return false;
        }
        h.log('inside the dragon lair');
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
    await walkApproach(h, site);
    return true;
}

/** Cast the escape teleport, up to three times. Null once outside the lair, else why the cast will not fire. */
export async function teleportOut(h: JiveHost, site: DragonSite): Promise<string | null> {
    const esc = escapeRunesFor(site.escapeTeleportId);
    let why = escapeShortfall(esc);
    for (let i = 0; why === null && i < 3 && site.inArea(Game.tile()); i++) {
        h.setStatus(`teleporting to ${esc.label}`);
        if (await Game.teleport(site.escapeTeleportId) && await waitFed(() => !site.inArea(Game.tile()), DOOR_MS)) {
            h.log(`teleported out to ${esc.label}`);
            return null;
        }
        await Execution.delayTicks(3);
        why = escapeShortfall(esc);
    }
    return site.inArea(Game.tile()) ? (why ?? 'the cast never landed') : null;
}

/** Teleport out of the lair, or walk out through the gate when the cast will not fire. */
export async function leaveLair(h: JiveHost, site: DragonSite): Promise<boolean> {
    if (!site.inArea(Game.tile())) {
        return true;
    }
    if (h.leaveByWalk()) {
        return walkOutOfLair(h, site);
    }
    const why = await teleportOut(h, site);
    if (why === null) {
        return true;
    }
    h.log(`the ${escapeRunesFor(site.escapeTeleportId).label} will not fire (${why}). Walking out ${site.gate === null ? 'the way we came in' : 'through the gate'} instead.`);
    return walkOutOfLair(h, site);
}

// Why: the gate takes the key on the way in only, and answers a plain Open from the inside.

// Why: no path leaves the Enclave, so the way out is the cave's own op, which teleports to the hillside; walking to walkOut from inside would plan a route the cave does not have.
async function leaveByLoc(h: JiveHost, site: DragonSite): Promise<boolean> {
    const exit = site.exit!;
    h.setStatus('walking to the cave mouth');
    await walkNear(exit.stand, 2, say(h));
    await Execution.delayTicks(1);
    const cave = locById(exit.locId);
    if (!cave || !(await cave.interact(exit.op))) {
        h.log('the cave mouth is not in the scene yet. Retrying.');
        return false;
    }
    if (!(await waitFed(() => !site.inArea(Game.tile()), DOOR_MS))) {
        h.log('the cave mouth did not let us out. Retrying.');
        return false;
    }
    h.log('out of the dragon lair');
    return true;
}

async function walkOutOfLair(h: JiveHost, site: DragonSite): Promise<boolean> {
    if (site.exit) {
        return leaveByLoc(h, site);
    }
    const gate = site.gate;
    // Why: with no gate the way out is the way in run backwards, so walking to walkOut climbs the ladder and opens the doors above it on its own.
    if (!gate) {
        h.setStatus('walking out of the dungeon');
        await walkNear(site.walkOut, 3, say(h));
        if (site.inArea(Game.tile())) {
            h.log('the walk out did not leave the dungeon. Retrying.');
            return false;
        }
        h.log('out of the dragon lair');
        return true;
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
    if (site.coins !== undefined) {
        extra.push(COINS);
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
    if (!(await (opts.leave ?? leaveLair)(h, site))) {
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
    await withdrawGear(h, site, opts.wear, opts.carry);
    await withdrawCoins(h, site);
    await withdrawStyleSupplies(h, opts);
    await withdrawEscapeRunes(h, site, opts);
    await withdrawFlasks(h, [...(opts.potions ?? []).map(asFlask), ...(opts.flasks ?? [])]);
    // Why: Equipment.equip shuts the bank to get the backpack ops back, so every withdrawal has to land before anything is worn.
    await equipGear(h, site, opts.wear);
    if (await healUp(h, opts.healTo ?? HEAL_TO) && opts.withdrawFood && await openSiteBank(h, site)) {
        await withdrawFoodTo(h);
    }
    await Bank.close();
    h.countBankTrip();
    h.setStatus(`restocked, heading back to the ${site.target.toLowerCase()}s`);
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

async function withdrawGear(h: JiveHost, site: DragonSite, wear: readonly string[] = [], carry: readonly string[] = []): Promise<void> {
    if (needsShield(site, h.style())) {
        await needOne(h, SHIELD);
    }
    await needOne(h, h.weaponName());
    for (const name of [...wear, ...carry]) {
        await needOne(h, name);
    }
    // Why: reader.bankItems() is empty whenever the bank modal is shut, so a count of zero only carries a fact with the bank open.
    const gate = shieldGate(h.style(), site.fireAtRange === true, Equipment.contains(SHIELD) || Inventory.count(SHIELD) > 0 || Bank.count(SHIELD) > 0);
    if (gate !== null) {
        h.parkFor(gate);
    }
}

// Why: the fee and the fares are spent every trip, so the pile is topped back up to the site's figure rather than stocked once.
async function withdrawCoins(h: JiveHost, site: DragonSite): Promise<void> {
    if (site.coins === undefined || Inventory.count(COINS) >= site.coins) {
        return;
    }
    h.setStatus('withdrawing coins');
    const got = await withdrawTo(COINS, site.coins);
    if (got > 0) {
        h.log(`withdrew ${got} coins (${Inventory.count(COINS)}/${site.coins})`);
    } else if (Inventory.count(COINS) < (site.feeGate?.coins ?? 0)) {
        h.log(`WARNING: the bank cannot cover the ${site.feeGate?.coins ?? site.coins} coins the way in costs. Deposit coins to resume.`);
    }
}

async function equipGear(h: JiveHost, site: DragonSite, extra: readonly string[] = []): Promise<void> {
    const shield = needsShield(site, h.style()) ? [SHIELD] : [];
    const wear = [...shield, h.weaponName(), h.style() === 'range' ? h.ammoName() : '', ...extra];
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

function asFlask(plan: PotionPlan): FlaskPlan {
    return { flask: plan.flask, doses: plan.potion.doses, want: plan.want };
}

function flasksHeld(plan: FlaskPlan): number {
    return plan.doses.reduce((n, dose) => n + Inventory.count(dose), 0);
}

// Why: a flask is counted across every dose form, so a part-used one carried back from the last trip is topped up rather than stocked on top of.

/** Top each dose family up to its flask count. */
async function withdrawFlasks(h: JiveHost, plans: readonly FlaskPlan[]): Promise<void> {
    for (const plan of plans) {
        const start = flasksHeld(plan);
        for (let guard = 0; guard < 12 && flasksHeld(plan) < plan.want && !Inventory.isFull(); guard++) {
            const before = flasksHeld(plan);
            await Bank.withdraw(plan.flask, 'Withdraw-1');
            if (!(await Execution.delayUntil(() => flasksHeld(plan) > before, 2500))) {
                break;
            }
        }
        const got = flasksHeld(plan) - start;
        if (got > 0) {
            h.log(`withdrew ${got} ${plan.flask}`);
        } else if (flasksHeld(plan) === 0) {
            h.log(`WARNING: no '${plan.flask}' in the bank. The trip goes without.`);
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

/** His respawn is 100 ticks, and a run that starts right after another killed him waits it out. */
const JAILER_RESPAWN_MS = 75_000;

const nearestJailer = (): Npc | null => Npcs.query().name(JAILER).action('Attack').within(14).nearest();

async function killJailer(h: JiveHost): Promise<boolean> {
    let jailer = nearestJailer();
    if (!jailer) {
        h.setStatus(`waiting for the ${JAILER} to respawn`);
        h.log(`no ${JAILER} in the prison corridor. Waiting out his respawn where we stand.`);
        if (!(await waitFed(() => nearestJailer() !== null, JAILER_RESPAWN_MS))) {
            return false;
        }
        jailer = nearestJailer();
    }
    if (!jailer) {
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

// Why: the talk ends wherever Velrak drifted, and 8 of the cell's 33 tiles are further from the door than locById searches, so a query taken from there reads it as absent forever.

/** Open the cell door from the inside. True when the run is back in the corridor. */
export async function leaveCell(h: JiveHost): Promise<boolean> {
    if (!inCell()) {
        return true;
    }
    h.setStatus('walking back to the cell door');
    if (!(await walkExact(JAIL_DOOR_INSIDE, say(h)))) {
        h.log('the inside of the cell door is occupied. Opening it from wherever the walk stopped.');
        await walkNear(JAIL_DOOR_INSIDE, 2, say(h));
    }
    await Execution.delayTicks(2);
    const door = locById(JAIL_DOOR_LOC);
    if (!door || !(await door.interact('Open'))) {
        h.log('no cell door to open from the inside. Retrying.');
        return false;
    }
    if (!(await waitFed(() => !inCell(), DOOR_MS))) {
        h.log('the cell door did not let us out. Retrying.');
        return false;
    }
    return true;
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
    // Why: this leg walks into the Jailer fight and on into the lair, so the gear leaves the booth with the key rather than waiting for a bank run that only comes after the first kill.
    await withdrawGear(h, site);
    if (!fromBank) {
        await withdrawFoodTo(h);
    }
    await Bank.close();
    await equipGear(h, site);
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
