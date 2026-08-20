// docs/QUESTS.md
import { Equipment } from '../../../../equipment/Equipment.js';
import { EventSignal } from '../../../../execution/EventSignal.js';
import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { Npcs, type Npc } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Reachability } from '../../../../../event/webwalk/geometry/Reachability.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { heldId } from '../../exec/prompts.js';
import { IKOV_FOODS, IKOV_LOC, IKOV_NAME, IKOV_NPC, IKOV_OBJ, IKOV_TILE, ROOTS_WANTED } from './areas.js';
import { meleeWeaponStep, rangedArmourStep } from './gear.js';

/** Levels the sourcing route needs but the server never gates on the quest. */
const IKOV_SOURCING_SKILLS: readonly { skill: string; level: number }[] = [
    { skill: 'woodcutting', level: 60 },
    { skill: 'fletching', level: 65 },
    { skill: 'crafting', level: 10 }
];

/** Worn right hand: the slot a weapon occupies. */
const WEAPON_SLOT = 3;
/** Worn quiver: the slot arrows occupy. */
const AMMO_SLOT = 13;
/** Lobsters kept in the pack while grinding hobgoblins. */
const FARM_FOOD = 10;
/** Lobsters left in the pack before the farm walks back for more. */
const FARM_FOOD_FLOOR = 5;
/** Quiver below which the bow is not worth farming with; the warrior fight leaves single digits. */
const FARM_ARROWS = 20;
/** Aemad's asking price for an iron axe, with headroom for his stock markup. */
const AXE_GP = 300;
const CHOP_MS = 120_000;
const PICK_MS = 20_000;
const KILL_MS = 60_000;
const HOB_RADIUS = 20;
/** Hitpoints fraction at which an unfed farm walks away rather than finishing the kill. */
const FLEE_HP = 0.45;
const ROOT_RADIUS = 12;
const REACH_STEPS = 20_000;

// Why: a bow in the quiver hand is not a bow the quest has to fletch again, and the pack view cannot see it.
export function heldOrBanked(snap: QuestSnapshot, id: number): number {
    return (snap.invIds?.get(id) ?? 0) + (snap.bankIds?.get(id) ?? 0) + (snap.wornIds?.has(id) === true ? 1 : 0);
}

/** True once the bank or the pack can produce a lit candle for the dark stairs. */
function kitCandleReady(snap: QuestSnapshot): boolean {
    if (heldOrBanked(snap, IKOV_OBJ.LIT_CANDLE) > 0) {
        return true;
    }
    return heldOrBanked(snap, IKOV_OBJ.UNLIT_CANDLE) > 0 && heldOrBanked(snap, IKOV_OBJ.TINDERBOX) > 0;
}

async function chopYew(log: (m: string) => void): Promise<boolean> {
    if (!Inventory.contains(IKOV_NAME.IRON_AXE) && !Inventory.items().some(i => /axe$/i.test(i.name ?? ''))) {
        log('ikov: no axe in the pack for the yew');
        return false;
    }
    const before = Inventory.count(IKOV_NAME.YEW_LOGS);
    const tree = Locs.query().where(l => l.id === IKOV_LOC.YEW_TREE).action('Chop down').within(10).nearest();
    if (!tree) {
        return Traversal.walkResilient(IKOV_TILE.YEW_TREES, { radius: 3, attempts: 3, timeoutMs: 300_000, log });
    }
    if (!(await tree.interact('Chop down'))) {
        return false;
    }
    log('ikov: chopping a yew for the bow stave');
    const deadline = performance.now() + CHOP_MS;
    while (performance.now() < deadline) {
        if (Inventory.count(IKOV_NAME.YEW_LOGS) > before) {
            return true;
        }
        if (EventSignal.pending()) {
            return false;
        }
        await Sustain.run();
        await Execution.delayTicks(2);
    }
    log('ikov: the yew gave nothing in two minutes');
    return false;
}

async function pickFlax(log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count(IKOV_NAME.FLAX);
    const plant = Locs.query().where(l => l.id === IKOV_LOC.FLAX).action('Pick').within(10).nearest();
    if (!plant) {
        return Traversal.walkResilient(IKOV_TILE.FLAX_FIELD, { radius: 3, attempts: 3, timeoutMs: 300_000, log });
    }
    if (!(await plant.interact('Pick'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(IKOV_NAME.FLAX) > before, PICK_MS);
}

// Why: strung and unstrung yew shortbows share the display name, so the product is chosen off the make menu and counted by id.
async function fletchBow(log: (m: string) => void): Promise<boolean> {
    // Why: the first use-on after a bank trip lands while the booth is still closing, and the menu never opens.
    for (let attempt = 0; attempt < 3 && !ChatDialog.isMakeMenu(); attempt++) {
        await Modals.closeIfOpen();
        await Execution.delayTicks(2);
        const knife = Inventory.items().find(i => i.id === IKOV_OBJ.KNIFE);
        const logs = Inventory.items().find(i => i.id === IKOV_OBJ.YEW_LOGS);
        if (!knife || !logs) {
            log('ikov: the pack is short a knife or yew logs');
            return false;
        }
        if (!(await knife.useOn(logs))) {
            continue;
        }
        await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 6000);
    }
    if (!ChatDialog.isMakeMenu()) {
        log('ikov: the fletch menu never opened');
        return false;
    }
    const before = heldId(IKOV_OBJ.UNSTRUNG_YEW_SHORTBOW);
    if (!(await ChatDialog.makeOne(IKOV_NAME.YEW_SHORTBOW))) {
        log(`ikov: no shortbow on the fletch menu — products: [${ChatDialog.makeProducts().join(', ')}]`);
        return false;
    }
    return Execution.delayUntil(() => heldId(IKOV_OBJ.UNSTRUNG_YEW_SHORTBOW) > before, 10_000);
}

async function stringBow(log: (m: string) => void): Promise<boolean> {
    const string = Inventory.items().find(i => i.id === IKOV_OBJ.BOW_STRING);
    const stave = Inventory.items().find(i => i.id === IKOV_OBJ.UNSTRUNG_YEW_SHORTBOW);
    if (!string || !stave) {
        log('ikov: the pack is short a bow string or a yew stave');
        return false;
    }
    if (!(await string.useOn(stave))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(IKOV_OBJ.YEW_SHORTBOW) > 0, 10_000);
}

async function lightCandle(log: (m: string) => void): Promise<boolean> {
    if (heldId(IKOV_OBJ.LIT_CANDLE) > 0) {
        return true;
    }
    const tinderbox = Inventory.items().find(i => i.id === IKOV_OBJ.TINDERBOX);
    const candle = Inventory.items().find(i => i.id === IKOV_OBJ.UNLIT_CANDLE);
    if (!tinderbox || !candle) {
        log(`ikov: the pack is short ${!tinderbox ? 'a tinderbox' : 'a candle'} for the dark stairs`);
        return false;
    }
    log('ikov: lighting the candle for the dark stairs');
    if (!(await tinderbox.useOn(candle))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(IKOV_OBJ.LIT_CANDLE) > 0, 8000);
}

function sceneReachable(tile: { x: number; z: number; level: number }): boolean {
    return Reachability.canReach(tile, { adjacentOk: true, maxSteps: REACH_STEPS });
}

/** Low enough that the next two hits could land the bot in Lumbridge, with no food to stop them. */
function starving(): boolean {
    const max = Skills.level('hitpoints');
    return max > 0
        && Skills.effective('hitpoints') <= max * FLEE_HP
        && !IKOV_FOODS.some(food => Inventory.contains(food));
}

function hobgoblin(): Npc | null {
    return Npcs.query()
        .where(n => n.id === IKOV_NPC.HOBGOBLIN_ARMED || n.id === IKOV_NPC.HOBGOBLIN_UNARMED)
        .action('Attack')
        .where(n => !n.targetsAnotherPlayer())
        .where(n => sceneReachable(n.tile()))
        .within(HOB_RADIUS)
        .nearest();
}

async function takeRoot(log: (m: string) => void): Promise<boolean> {
    const drop = GroundItems.query().where(g => g.id === IKOV_OBJ.LIMPWURT_ROOT).action('Take').within(ROOT_RADIUS).nearest();
    if (!drop) {
        return false;
    }
    const before = Inventory.countById(IKOV_OBJ.LIMPWURT_ROOT);
    if (drop.distance() > 1 && !(await Traversal.walkResilient(drop.tile(), { radius: 1, attempts: 2, timeoutMs: 60_000, log }))) {
        return false;
    }
    const still = GroundItems.query().where(g => g.id === IKOV_OBJ.LIMPWURT_ROOT).action('Take').within(ROOT_RADIUS).nearest();
    if (!still || !(await still.interact('Take'))) {
        return false;
    }
    const took = await Execution.delayUntil(() => Inventory.countById(IKOV_OBJ.LIMPWURT_ROOT) > before, 6000);
    if (took) {
        log(`ikov: ${Inventory.countById(IKOV_OBJ.LIMPWURT_ROOT)}/${ROOTS_WANTED} limpwurt roots`);
    }
    return took;
}

async function killHobgoblin(target: Npc, log: (m: string) => void): Promise<boolean> {
    const index = target.index;
    const live = (): Npc | null => Npcs.all().find(n => n.index === index) ?? null;
    Game.setAutoRetaliate(true);
    if (target.distance() > 8 && !(await Traversal.walkResilient(target.tile(), { radius: 2, attempts: 2, timeoutMs: 90_000, log }))) {
        return false;
    }
    if (!(await target.interact('Attack'))) {
        return false;
    }
    const deadline = performance.now() + KILL_MS;
    while (performance.now() < deadline) {
        if (EventSignal.pending()) {
            return false;
        }
        await Sustain.run();
        if (!live()) {
            return true;
        }
        // Why: the camp is a crowd and the bot fights it in nothing but boots, so an empty pack at low hitpoints is a death rather than a slow kill, handing the tick back sends the ladder to a booth, which is also the way out.
        if (starving()) {
            log(`ikov: ${Skills.effective('hitpoints')} hitpoints and nothing to eat — leaving the camp`);
            return false;
        }
        await Execution.delayTicks(1);
    }
    log(`ikov: hobgoblin ${index} outlived ${KILL_MS / 1000}s`);
    return false;
}

/** One unit of root farming: take a drop, kill a hobgoblin, or close on the camp. */
async function farmRoots(log: (m: string) => void): Promise<boolean> {
    if (await takeRoot(log)) {
        return true;
    }
    if (Inventory.free() === 0) {
        log('ikov: the pack is full mid-farm');
        return false;
    }
    const hob = hobgoblin();
    if (hob) {
        return killHobgoblin(hob, log);
    }
    const here = Game.tile();
    if (here && IKOV_TILE.HOBGOBLINS.distanceTo(here) <= HOB_RADIUS) {
        await Execution.delayUntil(() => hobgoblin() !== null || EventSignal.pending(), 6000);
        return hobgoblin() !== null;
    }
    log(`ikov: walking to the hobgoblins at (${IKOV_TILE.HOBGOBLINS.x},${IKOV_TILE.HOBGOBLINS.z})`);
    return Traversal.walkResilient(IKOV_TILE.HOBGOBLINS, { radius: 4, attempts: 3, timeoutMs: 420_000, log });
}

// Why: the warrior fight ends with the yew shortbow worn over a quiver the fight emptied, and a bow with no arrows answers every Attack click with "There is no ammo left in your quiver" until the hobgoblins finish the job.
function armedForMelee(): boolean {
    const worn = Equipment.items();
    const weapon = worn.find(item => item.slot === WEAPON_SLOT);
    if (!weapon) {
        return false;
    }
    if (!/bow$/i.test(weapon.name ?? '')) {
        return true;
    }
    return worn.some(item => item.slot === AMMO_SLOT && item.count >= FARM_ARROWS);
}

/** Drop the spent bow so the fists the farm falls back on are at least fists. */
async function stowEmptyBow(log: (m: string) => void): Promise<boolean> {
    log('ikov: stowing the empty yew shortbow — it cannot swing at a hobgoblin');
    return Equipment.unequip(IKOV_NAME.YEW_SHORTBOW);
}

// Why: the crossing kit leaves the bot bare-handed, and a hundred-odd level-42 hobgoblins is not a fight to take with fists, the axe the yew was cut with is already banked and is a weapon.
function armForTheFarm(snap: QuestSnapshot): QuestStep | null {
    // Why: a spent bow is not a weapon however full the pack is, so the bow comes off before anything is picked to replace it.
    if (!armedForMelee() && Equipment.contains(IKOV_NAME.YEW_SHORTBOW)) {
        return { kind: 'custom', name: 'stow the empty bow', run: stowEmptyBow };
    }
    // Why: the bank is the armoury this quest never builds, so the best weapon in it beats the axe the yew was cut with.
    const better = meleeWeaponStep(snap);
    if (better) {
        return better;
    }
    // Why: the right-hand slot is what the loadout would have filled, so an armed bot keeps whatever it is already holding.
    if (armedForMelee()) {
        return null;
    }
    if ((snap.invIds?.get(IKOV_OBJ.IRON_AXE) ?? 0) > 0) {
        return { kind: 'equip', item: IKOV_NAME.IRON_AXE };
    }
    if ((snap.bankIds?.get(IKOV_OBJ.IRON_AXE) ?? 0) > 0) {
        return { kind: 'withdraw', items: [{ name: IKOV_NAME.IRON_AXE, id: IKOV_OBJ.IRON_AXE, qty: 1 }] };
    }
    // Why: a run resumed at this stage never walked the sourcing leg, so the axe it would have banked was never bought.
    if (snap.bankCoins + (snap.inv.get('coins') ?? 0) >= AXE_GP) {
        return { kind: 'buy', item: IKOV_NAME.IRON_AXE, qty: 1, shop: { npc: 'Aemad', anchor: IKOV_TILE.AEMAD }, estGp: AXE_GP };
    }
    return null;
}

// Why: the engine's food float is a one-shot at provisioning time and both fights outlast it, a starved bot dies at the hobgoblin camp and stands in front of the Fire Warrior doing nothing.
/** Walk to a booth for more lobsters once the pack is down to `floor`, or null when it is stocked. */
export function restockStep(snap: QuestSnapshot, want: number, floor: number): QuestStep | null {
    const food = IKOV_NAME.LOBSTER.toLowerCase();
    const held = snap.inv.get(food) ?? 0;
    if (held >= floor) {
        return null;
    }
    const qty = Math.min(want - held, snap.bank?.get(food) ?? 0);
    if (qty <= 0) {
        return null;
    }
    return { kind: 'withdraw', items: [{ name: IKOV_NAME.LOBSTER, qty }] };
}

// Why: hobgoblins are aggressive and the retreat has to clear their radius, not merely stop fighting, a bot that stands still in the camp with nothing to eat dies there while the watchdog is still deciding the quest is stuck.
/** Walk out of the camp when there is no food left anywhere to farm it with. */
async function leaveTheCamp(log: (m: string) => void): Promise<boolean> {
    log('ikov: no food in the pack or the bank — leaving the hobgoblin camp');
    await Traversal.walkResilient(IKOV_TILE.HOBGOBLIN_RETREAT, { radius: 3, attempts: 2, timeoutMs: 180_000, log });
    return false;
}

function foodless(snap: QuestSnapshot): boolean {
    const food = IKOV_NAME.LOBSTER.toLowerCase();
    return (snap.inv.get(food) ?? 0) === 0 && (snap.bank?.get(food) ?? 0) === 0;
}

// Why: 20 unstackable roots plus food fill the pack, so the farm banks in batches rather than holding the lot.
// Why: the camp is three level-42 attackers at once and the bot fights it in whatever the ice cavern dressed it in, so the armour is checked here too. A resumed run never walked the leg that put it on.
function rootStep(snap: QuestSnapshot): QuestStep {
    const arm = rangedArmourStep(snap) ?? armForTheFarm(snap) ?? restockStep(snap, FARM_FOOD, FARM_FOOD_FLOOR);
    if (arm) {
        return arm;
    }
    const held = snap.invIds?.get(IKOV_OBJ.LIMPWURT_ROOT) ?? 0;
    const banked = snap.bankIds?.get(IKOV_OBJ.LIMPWURT_ROOT) ?? 0;
    if (held > 0 && (banked + held >= ROOTS_WANTED || (snap.freeSlots ?? 28) <= 2)) {
        return { kind: 'deposit', keep: [IKOV_NAME.LOBSTER, 'coins'], exactKeep: true };
    }
    if (foodless(snap)) {
        return { kind: 'custom', name: 'leave the hobgoblin camp', run: leaveTheCamp };
    }
    return { kind: 'custom', name: `farm limpwurt roots (${banked + held}/${ROOTS_WANTED})`, run: farmRoots };
}

interface SupplyWants {
    candle: boolean;
    bow: boolean;
    roots: boolean;
}

/**
 * The next surface acquisition for the wanted parts of the kit, or null when they are all in hand.
 * @see docs/decisions/quest-pitfalls-26.md
 */
export function suppliesStep(snap: QuestSnapshot, wants: SupplyWants): QuestStep | null {
    const needBow = wants.bow && heldOrBanked(snap, IKOV_OBJ.YEW_SHORTBOW) === 0;
    // Why: Aemad's is in East Ardougne and the rest of the kit is a Catherby-Seers loop, so the axe is bought on the way out rather than walked back for.
    if (needBow && axeOutstanding(snap)) {
        return { kind: 'buy', item: IKOV_NAME.IRON_AXE, qty: 1, shop: { npc: 'Aemad', anchor: IKOV_TILE.AEMAD }, estGp: AXE_GP };
    }
    if (wants.candle && !kitCandleReady(snap)) {
        if (heldOrBanked(snap, IKOV_OBJ.TINDERBOX) === 0) {
            return { kind: 'buy', item: IKOV_NAME.TINDERBOX, qty: 1, shop: { npc: 'Arhein', anchor: IKOV_TILE.ARHEIN }, estGp: 100 };
        }
        return { kind: 'buy', item: IKOV_NAME.CANDLE, qty: 1, shop: { npc: 'Candle maker', anchor: IKOV_TILE.CANDLE_MAKER }, estGp: 100 };
    }

    if (needBow) {
        const bowStep = bowChainStep(snap);
        if (bowStep) {
            return bowStep;
        }
    }

    if (wants.roots && heldOrBanked(snap, IKOV_OBJ.LIMPWURT_ROOT) < ROOTS_WANTED) {
        return rootStep(snap);
    }
    return null;
}

// Why: a withdraw step reports failure when any line comes up short, so asking for something already in the pack fails the step the rest of it succeeded in.

/** Withdraw only the listed items the pack is short of and the bank can cover. */
function withdrawMissing(snap: QuestSnapshot, wanted: { name: string; id: number }[]): QuestStep | null {
    const short = wanted.filter(item => (snap.invIds?.get(item.id) ?? 0) === 0 && (snap.bankIds?.get(item.id) ?? 0) > 0);
    if (short.length === 0) {
        return null;
    }
    return { kind: 'withdraw', items: short.map(item => ({ name: item.name, id: item.id, qty: 1 })) };
}

/** True while an axe still has to be bought: no bow stave in sight, no logs, and nothing to cut one with. */
function axeOutstanding(snap: QuestSnapshot): boolean {
    return heldOrBanked(snap, IKOV_OBJ.UNSTRUNG_YEW_SHORTBOW) === 0
        && heldOrBanked(snap, IKOV_OBJ.YEW_LOGS) === 0
        && heldOrBanked(snap, IKOV_OBJ.IRON_AXE) === 0;
}

// Why: the order is a west-to-east sweep, the Armoury, then Catherby for the candle and the yews, then Seers for the knife, the flax and the wheel.
function bowChainStep(snap: QuestSnapshot): QuestStep | null {
    const stave = heldOrBanked(snap, IKOV_OBJ.UNSTRUNG_YEW_SHORTBOW);
    const string = heldOrBanked(snap, IKOV_OBJ.BOW_STRING);

    if (stave > 0 && string > 0) {
        const carry = withdrawMissing(snap, [
            { name: IKOV_NAME.UNSTRUNG_YEW_SHORTBOW, id: IKOV_OBJ.UNSTRUNG_YEW_SHORTBOW },
            { name: IKOV_NAME.BOW_STRING, id: IKOV_OBJ.BOW_STRING }
        ]);
        return carry ?? { kind: 'custom', name: 'string the yew shortbow', run: stringBow };
    }

    if (stave === 0 && heldOrBanked(snap, IKOV_OBJ.YEW_LOGS) === 0) {
        const axe = withdrawMissing(snap, [{ name: IKOV_NAME.IRON_AXE, id: IKOV_OBJ.IRON_AXE }]);
        return axe ?? { kind: 'custom', name: 'chop a yew log', run: chopYew };
    }

    if (heldOrBanked(snap, IKOV_OBJ.KNIFE) === 0) {
        return { kind: 'grabGround', item: IKOV_NAME.KNIFE, anchor: IKOV_TILE.KNIFE_SPAWN, waitIfMissing: true };
    }

    if (string === 0) {
        if (heldOrBanked(snap, IKOV_OBJ.FLAX) === 0) {
            return { kind: 'custom', name: 'pick flax', run: pickFlax };
        }
        const flax = withdrawMissing(snap, [{ name: IKOV_NAME.FLAX, id: IKOV_OBJ.FLAX }]);
        if (flax) {
            return flax;
        }
        return {
            kind: 'useOn',
            item: IKOV_NAME.FLAX,
            targetKind: 'loc',
            target: 'Spinning wheel',
            anchor: IKOV_TILE.SPINNING_WHEEL,
            product: IKOV_NAME.BOW_STRING
        };
    }

    if (stave === 0) {
        const kit = withdrawMissing(snap, [
            { name: IKOV_NAME.YEW_LOGS, id: IKOV_OBJ.YEW_LOGS },
            { name: IKOV_NAME.KNIFE, id: IKOV_OBJ.KNIFE }
        ]);
        return kit ?? { kind: 'custom', name: 'fletch a yew shortbow', run: fletchBow };
    }
    return null;
}

export function sourcingShortfall(): string | null {
    const short = IKOV_SOURCING_SKILLS.filter(req => Skills.level(req.skill) < req.level);
    if (short.length === 0) {
        return null;
    }
    return `Temple of Ikov sources its own yew shortbow — needs ${short.map(s => `${s.skill} ${s.level}`).join(', ')}`;
}

export { lightCandle };
