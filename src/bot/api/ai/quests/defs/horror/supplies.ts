import { Execution } from '../../../../execution/Execution.js';
import Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Locs } from '../../../../locs/Locs.js';
import { QuestFood } from '../../food.js';
import { QuestLoadout } from '../../gear.js';
import { weaponOf } from '../../../../loadout/loadoutPlan.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { useOnLoc } from '../../exec/prompts.js';
import { smithNails } from '../dragonslayer/supplies.js';
import {
    ARCHERY_SHOP, GENERAL_SHOP, HD_ID, HD_ITEM, HD_LOC, HD_TILE, RUNE_SHOP, SWORD_SHOP
} from './areas.js';

const COIN_FLOAT = 20_000;
const COIN_LOW = 2_000;

/** Comfortably over any single purchase here, comfortably under the float. */
const SHOP_GP = 1_500;

// Why: the dungeon load is fifteen slots before a single fish — coins, hammer, pickaxe, key, tinderbox, dagger, arrows, six rune stacks, tar and glass.
// Why: the quest ends by pushing a casket into the pack, so the last slot is not ours to fill.
// Why: ten sharks is still two hundred hitpoints, and the winning fight spent none of them.
const FOOD_TARGET = 10;
const FOOD_LOW = 4;
/** What the errand legs carry: enough to survive a long walk, not a fight. */
const TRAVEL_FOOD = 4;

export const PLANKS_NEEDED = 2;
/** Four steel nails per plank — quest_horror.rs2 checks each half separately. */
export const NAILS_NEEDED = 8;

// Why: this is about sixty blasts' worth, three times what the fight takes, plus the one of each element the strange wall swallows.
// Why: asking for more is not free — a purchase larger than Aubury's stock is filled a rune at a time as he restocks, and the bot stands at the counter for it.
// Why: the air stack carries a second job when nav teleports are on, as every standard hop spends three and Camelot spends five over about thirty hops, so the headroom keeps routing out of the fight's supply.
const RUNES: readonly { id: number; name: string; qty: number }[] = [
    { id: HD_ID.AIR_RUNE, name: HD_ITEM.AIR_RUNE, qty: 350 },
    { id: HD_ID.WATER_RUNE, name: HD_ITEM.WATER_RUNE, qty: 120 },
    { id: HD_ID.EARTH_RUNE, name: HD_ITEM.EARTH_RUNE, qty: 120 },
    { id: HD_ID.FIRE_RUNE, name: HD_ITEM.FIRE_RUNE, qty: 130 },
    { id: HD_ID.DEATH_RUNE, name: HD_ITEM.DEATH_RUNE, qty: 80 },
    { id: HD_ID.CHAOS_RUNE, name: HD_ITEM.CHAOS_RUNE, qty: 80 }
];

// Why: law is the limiting rune at one or two a teleport, and the elemental halves come out of {@link RUNES}, which Aubury sells and this quest already buys.
// Why: sixty is roughly double a full run's hop count.
// Why: it is bank-only on purpose, as the Magic Guild and the Mage Arena are the only two shops that stock it and the Guild wants 66 magic, seven above what this quest proves.
// Why: a bank without law is the ordinary case rather than a fault, and the answer to it is the walk the quest already did.
const LAW_RUNES = 60;

/** Below this the kit is topped up, so a part-spent stack does not trigger a trip. */
const LAW_LOW = Math.ceil(LAW_RUNES / 3);

export function heldId(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedId(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

const withdraw = (items: { name: string; qty: number; id?: number }[]): QuestStep =>
    ({ kind: 'withdraw', items });

const scanBank: QuestStep = { kind: 'scanBank' };

const buy = (item: string, qty: number, shop: { npc: string; anchor: Tile }, estGp = SHOP_GP): QuestStep =>
    ({ kind: 'buy', item, qty, shop, estGp });

// Why: `snap.bankIds` is empty until a booth has been opened, so a bare `banked(...) > 0` test answers "no" on the first decide tick and sends the bot shopping for something it already owns.

/** Withdraw from the bank when it can help, before any shop trip. */
function fromBank(snap: QuestSnapshot, id: number, name: string, qty: number): QuestStep | null {
    if (!snap.bankKnown) {
        return scanBank;
    }
    const banked = bankedId(snap, id);
    if (banked <= 0) {
        return null;
    }
    return withdraw([{ name, qty: Math.min(qty, banked), id }]);
}

function source(
    snap: QuestSnapshot,
    id: number,
    name: string,
    qty: number,
    shop: { npc: string; anchor: Tile },
    estGp = SHOP_GP
): QuestStep {
    return fromBank(snap, id, name, qty) ?? buy(name, qty, shop, estGp);
}

export interface FoodWant {
    name: string;
    held: number;
    target: number;
    low: number;
}

// Why: nothing before the lighthouse is a fight, and the nails leg is the tightest the pack ever gets — four iron and eight coal is twelve slots on top of the coins, hammer and pickaxe.
// Why: a full fifteen sharks leaves ten free and `smithNails` stops dead on "pack is full — no room for Coal", with nothing it is allowed to bank to make room.

/** How much food this stage wants, or null. */
export function foodWant(snap: QuestSnapshot, stage: number): FoodWant | null {
    const name = QuestFood.name?.trim();
    if (!name) {
        return null;
    }
    const full = stage >= 2;
    return {
        name,
        held: snap.inv.get(name.toLowerCase()) ?? 0,
        target: full ? FOOD_TARGET : TRAVEL_FOOD,
        low: full ? FOOD_LOW : 1
    };
}

// Why: `ownsInventory` opts this quest out of the engine's coin and food withdrawal, so the module draws both itself.
// Why: the float is a threshold rather than a target, as a `buy` step withdraws `estGp` when short, so topping up to an exact balance means a booth trip after every purchase.

/** The module's own coin and food withdrawal, or null when the pack is ready. */
export function kit(snap: QuestSnapshot, food?: FoodWant | null): QuestStep | null {
    const items: { name: string; qty: number; id?: number }[] = [];
    if (heldId(snap, HD_ID.COINS) < COIN_LOW) {
        items.push({ name: HD_ITEM.COINS, qty: COIN_FLOAT, id: HD_ID.COINS });
    }
    if (food && food.held < food.low) {
        items.push({ name: food.name, qty: food.target - food.held });
    }
    if (items.length === 0) {
        return null;
    }
    return snap.bankKnown ? withdraw(items) : scanBank;
}

// Why: a hammer is the item an established account is most likely to already own, and a bare `buy` walks past a bankful of them to pay for another.

/** Source the bridge hammer, bank before shop. */
export function hammer(snap: QuestSnapshot): QuestStep {
    return source(snap, HD_ID.HAMMER, HD_ITEM.HAMMER, 1, GENERAL_SHOP, 100);
}

/** Four `woodplank` spawns sit north-east of the Barbarian Outpost gate. */
export function planks(snap: QuestSnapshot): QuestStep {
    const held = heldId(snap, HD_ID.PLANK);
    const need = PLANKS_NEEDED - held;
    return fromBank(snap, HD_ID.PLANK, HD_ITEM.PLANK, need)
        ?? { kind: 'grabGround', item: HD_ITEM.PLANK, anchor: HD_TILE.PLANK_SPAWNS[0], waitIfMissing: true };
}

// Why: nothing in the game sells nails or the steel bars they come from, so they are mined, smelted and hammered.
// Why: that is the same chain Dragon Slayer's ship repair uses, reused rather than re-derived.

/** Source the eight steel nails. */
export function nails(snap: QuestSnapshot): QuestStep {
    const held = heldId(snap, HD_ID.NAILS);
    const need = NAILS_NEEDED - held;
    if (need <= 0) {
        return { kind: 'wait', reason: 'nails already held' };
    }
    return fromBank(snap, HD_ID.NAILS, HD_ITEM.NAILS, need)
        ?? { kind: 'custom', name: `smith ${need} nails`, run: log => smithNails(need, log) };
}

// Why: both the Range and the Furnace carry `forceapproach=east`, which names the only side that works and rotates with the placement.
// Why: the Yanille range sits at angle 0 so east is east, and the Ardougne furnace at angle 2 so its "east" is west in world space.
// Why: standing anywhere else has the use-on silently dropped — no refusal, no message, a loc that never answers.
// Why: a radius-2 walk is a coin flip between the legal side and a wedge, so this lands on the tile and nowhere else.

/** Use a held item on a loc from an exact tile. */
async function useOnLocFrom(
    stand: Tile,
    itemId: number,
    locName: string,
    done: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (done()) {
        return true;
    }
    if (!(await Traversal.walkResilient(stand, { radius: 0, attempts: 4, timeoutMs: 300_000, log }))) {
        log(`could not stand on (${stand.x},${stand.z}) to use the ${locName}`);
        return false;
    }
    await Execution.delayTicks(2);
    const loc = Locs.query().name(locName).within(6).nearest();
    const item = Inventory.items().find(entry => entry.id === itemId);
    if (!loc || !item) {
        log(`no ${locName} in reach, or nothing to use on it`);
        return false;
    }
    if (!(await item.useOn(loc))) {
        return false;
    }
    return Execution.delayUntil(done, 12_000);
}

const cookSeaweed = (log: (m: string) => void): Promise<boolean> => useOnLocFrom(
    HD_TILE.YANILLE_RANGE,
    HD_ID.SEAWEED,
    HD_LOC.RANGE,
    () => Inventory.countById(HD_ID.SODA_ASH) > 0,
    log
);

/** `[oplocu,_sand_pit]` — the pit carries no ops of its own, and no forced side. */
const fillSand = (log: (m: string) => void): Promise<boolean> => useOnLoc(
    HD_ID.BUCKET,
    { name: HD_LOC.SAND_PIT, near: HD_TILE.SAND_PIT },
    [],
    () => Inventory.countById(HD_ID.BUCKET_OF_SAND) > 0,
    log
);

// Why: sand and soda ash used on a furnace run `smelt_glass`.
// Why: Rellekka's furnace is nearer to everything else this quest does and refuses anyone who has not finished The Fremennik Trials, so this is East Ardougne's.
const smeltGlass = (log: (m: string) => void): Promise<boolean> => useOnLocFrom(
    HD_TILE.FURNACE,
    HD_ID.BUCKET_OF_SAND,
    HD_LOC.FURNACE,
    () => Inventory.countById(HD_ID.MOLTEN_GLASS) > 0,
    log
);

// Why: the chain is read backwards from the glass, so a part-built chain resumes at the right rung.
// Why: nothing sells molten glass, soda ash, sand or seaweed.
// Why: seaweed comes off the Rellekka shore, a hundred tiles from the lighthouse, as Catherby's beach spawns are on an islet nothing can walk to.
// Why: it cooks down to soda ash on the Yanille range, seven tiles from the sand pit the bucket is filled at.

/** The next rung of the molten-glass chain. */
function moltenGlass(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, HD_ID.MOLTEN_GLASS) > 0) {
        return { kind: 'wait', reason: 'molten glass already held' };
    }
    const banked = fromBank(snap, HD_ID.MOLTEN_GLASS, HD_ITEM.MOLTEN_GLASS, 1);
    if (banked) {
        return banked;
    }
    const ash = heldId(snap, HD_ID.SODA_ASH);
    const sand = heldId(snap, HD_ID.BUCKET_OF_SAND);
    if (ash > 0 && sand > 0) {
        return { kind: 'custom', name: 'smelt molten glass', run: smeltGlass };
    }
    if (ash === 0) {
        if (heldId(snap, HD_ID.SEAWEED) > 0) {
            return { kind: 'custom', name: 'cook seaweed into soda ash', run: cookSeaweed };
        }
        return { kind: 'grabGround', item: HD_ITEM.SEAWEED, anchor: HD_TILE.SEAWEED, waitIfMissing: true };
    }
    if (heldId(snap, HD_ID.BUCKET) === 0) {
        return source(snap, HD_ID.BUCKET, HD_ITEM.BUCKET, 1, GENERAL_SHOP, 100);
    }
    return { kind: 'custom', name: 'fill a bucket with sand', run: fillSand };
}

/** True while the glass still has to be made rather than carried or withdrawn. */
function glassWanted(snap: QuestSnapshot): boolean {
    return heldId(snap, HD_ID.MOLTEN_GLASS) === 0 && bankedId(snap, HD_ID.MOLTEN_GLASS) === 0;
}

/** Lumbridge swamp: seventeen spawns, and the only ones outside Morytania. */
function swampTar(snap: QuestSnapshot): QuestStep {
    return fromBank(snap, HD_ID.SWAMP_TAR, HD_ITEM.SWAMP_TAR, 1)
        ?? { kind: 'grabGround', item: HD_ITEM.SWAMP_TAR, anchor: HD_TILE.SWAMP_TAR, waitIfMissing: true };
}

// Why: this is split out of {@link dungeonKit} because with nav teleports on it is worth a Varrock counter before the barcrawl rather than after — the tour is a ten-bar lap of the map and a hop is only planned when the live pack can pay for it.
// Why: same shop, same quantities, earlier.
// Why: law belongs here and not in {@link kit}, which runs on every decide tick.
// Why: `smithNails` banks the pack to make room for ore and law is not on its keep-list, so a per-tick law top-up and the nails leg deposit each other's work forever — `smith 8 nails` → `withdraw Law rune×60` → `smith 8 nails`, parked at the Varrock booth until the engine gives up.
// Why: drawing it here means it is drawn once, after the last leg that empties the pack.

/** The rune kit — law from the bank, the elements from Aubury. */
export function runeKit(snap: QuestSnapshot, teleports = Traversal.teleportsEnabled()): QuestStep | null {
    if (teleports && heldId(snap, HD_ID.LAW_RUNE) < LAW_LOW) {
        // Why: an unread bank is no evidence of an empty one, as `bankIds` is blank until a booth has been opened.
        // Why: answering "no law banked" here would quietly leave the toggle doing nothing for the quest.
        if (!snap.bankKnown) {
            return scanBank;
        }
        const banked = bankedId(snap, HD_ID.LAW_RUNE);
        if (banked > 0) {
            return withdraw([{
                name: HD_ITEM.LAW_RUNE, qty: Math.min(LAW_RUNES, banked), id: HD_ID.LAW_RUNE
            }]);
        }
    }
    for (const rune of RUNES) {
        // Half is the top-up mark: buying the last hundred of a stack after every
        // splash would walk the bot back to Varrock mid-quest.
        if (heldId(snap, rune.id) < rune.qty / 2) {
            return fromBank(snap, rune.id, rune.name, rune.qty)
                ?? buy(rune.name, rune.qty - heldId(snap, rune.id), RUNE_SHOP, 20_000);
        }
    }
    return null;
}

// Why: the order is what makes the two Varrock shops and the two ground-spawn errands each happen once.
// Why: `needLight` goes false once the lamp is lit, past which the tinderbox, tar and glass are spent, and asking for them again is a trip to Lumbridge swamp and the Rellekka shore for three items the quest will never use.

/** The one shortfall worth acting on, or null when the load is complete. */
export function dungeonKit(snap: QuestSnapshot, needLight: boolean): QuestStep | null {
    if (needLight && heldId(snap, HD_ID.TINDERBOX) === 0) {
        return source(snap, HD_ID.TINDERBOX, HD_ITEM.TINDERBOX, 1, GENERAL_SHOP, 100);
    }
    // Why: the bucket rides the same counter as the tinderbox, as left to the glass chain it is asked for at the Yanille range and the nearest general store to there is nine hundred tiles and two boat fares away in Varrock.
    if (needLight && glassWanted(snap) && heldId(snap, HD_ID.BUCKET) === 0
        && heldId(snap, HD_ID.BUCKET_OF_SAND) === 0) {
        return source(snap, HD_ID.BUCKET, HD_ITEM.BUCKET, 1, GENERAL_SHOP, 100);
    }
    if (heldId(snap, HD_ID.DAGGER) === 0) {
        return source(snap, HD_ID.DAGGER, HD_ITEM.DAGGER, 1, SWORD_SHOP, 200);
    }
    if (heldId(snap, HD_ID.ARROW) === 0) {
        return source(snap, HD_ID.ARROW, HD_ITEM.ARROW, 5, ARCHERY_SHOP, 100);
    }
    const runes = runeKit(snap);
    if (runes) {
        return runes;
    }
    const melee = meleeWeapon(snap);
    if (melee) {
        return melee;
    }
    if (needLight && heldId(snap, HD_ID.SWAMP_TAR) === 0) {
        return swampTar(snap);
    }
    if (needLight && heldId(snap, HD_ID.MOLTEN_GLASS) === 0) {
        return moltenGlass(snap);
    }
    return null;
}

// Why: nothing in the game sells a rune scimitar, as Zeke's Superior Scimitars stops at mithril, so this is whatever the player put in their loadout's weapon slot.
// Why: absent, unwieldable or blank, the fights fall back to magic only, which still wins — the melee form is prayed through instead of killed.
let meleeGaveUp = false;

const FALLBACK_WEAPON = 'Rune scimitar';

/** Attempts before the weapon is written off — an unwieldable one never lands. */
const WIELD_TRIES = 3;
let wieldTries = 0;

export function meleeWeaponName(): string | null {
    const name = weaponOf(QuestLoadout.current, FALLBACK_WEAPON)?.trim();
    return name && name.length > 0 ? name : null;
}

/** True once the weapon is on — the only state the fight loops care about. */
export function meleeReady(): boolean {
    const name = meleeWeaponName();
    return name !== null && Equipment.contains(name);
}

async function wieldMelee(name: string, log: (m: string) => void): Promise<boolean> {
    if (Equipment.contains(name)) {
        return true;
    }
    if (await Equipment.equip(name)) {
        log(`wielded the ${name}`);
        wieldTries = 0;
        return true;
    }
    // Silent refusal is the norm here: an attack level short of the weapon's
    // requirement is not a message, a wield that does not happen.
    if (++wieldTries >= WIELD_TRIES) {
        meleeGaveUp = true;
        log(`could not wield the ${name} after ${WIELD_TRIES} tries `
            + `(attack ${Skills.level('attack')}) — falling back to the magic-only fight`);
    }
    return false;
}

function meleeWeapon(snap: QuestSnapshot): QuestStep | null {
    const name = meleeWeaponName();
    if (!name || meleeGaveUp) {
        return null;
    }
    const key = name.toLowerCase();
    if (snap.worn.has(key)) {
        return null;
    }
    if ((snap.inv.get(key) ?? 0) > 0) {
        return { kind: 'custom', name: `wield the ${name}`, run: log => wieldMelee(name, log) };
    }
    if (!snap.bankKnown) {
        return scanBank;
    }
    if ((snap.bank?.get(key) ?? 0) <= 0) {
        // Not a fault: the magic loadout wins the quest on its own.
        meleeGaveUp = true;
        return null;
    }
    return withdraw([{ name, qty: 1 }]);
}

// Why: these are skills the server does not gate but the quest cannot be done without.
// Why: `smithing` is the nails (2 to a steel bar at 34), `crafting` is the glass, and `magic` is the mother fight — four elemental spells with the tier chosen from this level.
// Why: `prayer` 43 covers both protections — melee for the junior, which is a plain melee npc, and missiles for the mother, which forces her off the ranged attack that hits for twenty-four.
const HD_PROVEN_SKILLS = { smithing: 34, crafting: 1, magic: 59, prayer: 43 } as const;

/** Below this the mother's forms cannot be answered at all. */
const MAGIC_FLOOR = 13;

export function warnHorrorReadiness(): string | null {
    const have = {
        smithing: Skills.level('smithing'),
        crafting: Skills.level('crafting'),
        magic: Skills.level('magic'),
        prayer: Skills.level('prayer')
    };
    if (have.magic < MAGIC_FLOOR) {
        return `magic ${have.magic} cannot cast Fire Strike, and four of the Dagannoth mother's six forms take damage from nothing else`;
    }
    const short = (Object.keys(HD_PROVEN_SKILLS) as (keyof typeof HD_PROVEN_SKILLS)[])
        .filter(s => have[s] < HD_PROVEN_SKILLS[s])
        .map(s => `${s} ${have[s]}/${HD_PROVEN_SKILLS[s]}`);
    if (short.length === 0) {
        return null;
    }
    return `below the proven profile (${short.join(', ')}); headed PASS at max stats. `
        + 'Low magic makes the mother a long fight, and without the protection prayers she ranges for up to 24 a hit.';
}

/** Everything the module ever wants to keep through a spillover deposit. */
export const HORROR_TOOLS: readonly string[] = [
    'coins', 'hammer', 'plank', 'nails', 'tinderbox', 'swamp tar', 'molten glass',
    'soda ash', 'bucket', 'bucket of sand', 'seaweed', 'lighthouse key',
    'air rune', 'water rune', 'earth rune', 'fire rune', 'death rune', 'chaos rune',
    'bronze dagger', 'bronze arrow', 'barcrawl card', 'rusty casket',
    'pickaxe', 'iron ore', 'coal', 'steel bar'
];

/** True while standing anywhere a bank trip cannot start from. */
export function sealedArea(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    if (!tile) {
        return false;
    }
    // The broken lighthouse copy (38_71) and the cavern beneath it (39_72).
    if (tile.z >= 4544 && tile.z <= 4671 && tile.x >= 2432 && tile.x <= 2559) {
        return true;
    }
    // The post-quest cavern the completion teleport lands in.
    if (tile.z >= 9984 && tile.z <= 10047 && tile.x >= 2496 && tile.x <= 2559) {
        return true;
    }
    // The lighthouse above the ground floor.
    return tile.level > 0 && tile.x >= 2503 && tile.x <= 2514 && tile.z >= 3635 && tile.z <= 3646;
}
