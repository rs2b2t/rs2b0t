import { Execution } from '../../../../execution/Execution.js';
import Tile from '../../../../../geometry/Tile.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Equipment } from '../../../../equipment/Equipment.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Skills } from '../../../../skills/Skills.js';
import { Locs } from '../../../../locs/Locs.js';
import { FOOD_FLOAT, QuestFood } from '../../food.js';
import { QuestLoadout } from '../../gear.js';
import { weaponOf } from '../../../../loadout/loadoutPlan.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { useOnLoc } from '../../exec/prompts.js';
import { smithNails } from '../dragonslayer/supplies.js';
import { PICKAXES, bankedPickaxe, liveBestWeapon } from '../../weapons.js';
import {
    ARCHERY_SHOP, GENERAL_SHOP, HD_ID, HD_ITEM, HD_LOC, HD_TILE, RUNE_SHOP, SWORD_SHOP
} from './areas.js';

const COIN_FLOAT = 20_000;
const COIN_LOW = 2_000;

/** Over any single purchase here, under the float. */
const SHOP_GP = 1_500;

// Why: the dungeon load is 15 slots before food (coins, hammer, pickaxe, key, tinderbox, dagger, arrows, 6 rune stacks, tar, glass) and the quest ends by pushing a casket into the pack, so leave the last slot free.
const FOOD_TARGET = FOOD_FLOAT;
const FOOD_LOW = 4;
/** What the errand legs carry: enough for a long walk. */
const TRAVEL_FOOD = 4;

export const PLANKS_NEEDED = 2;
/** 4 steel nails per plank, quest_horror.rs2 checks each half separately. */
export const NAILS_NEEDED = 8;

// Why: Carry about 60 casts plus one of each elemental rune for the strange wall; Aubury restocks depleted runes one at a time.
// Why: with nav teleports on the air stack also pays hops, 3 per standard and 5 for Camelot over about 30 hops, so the headroom keeps routing out of the fight's supply.
const RUNES: readonly { id: number; name: string; qty: number }[] = [
    { id: HD_ID.AIR_RUNE, name: HD_ITEM.AIR_RUNE, qty: 350 },
    { id: HD_ID.WATER_RUNE, name: HD_ITEM.WATER_RUNE, qty: 120 },
    { id: HD_ID.EARTH_RUNE, name: HD_ITEM.EARTH_RUNE, qty: 120 },
    { id: HD_ID.FIRE_RUNE, name: HD_ITEM.FIRE_RUNE, qty: 130 },
    { id: HD_ID.DEATH_RUNE, name: HD_ITEM.DEATH_RUNE, qty: 80 },
    { id: HD_ID.CHAOS_RUNE, name: HD_ITEM.CHAOS_RUNE, qty: 80 }
];

// Why: law is the limiting rune at 1 or 2 a teleport, the elemental halves come out of {@link RUNES}, and 60 is about double a full run's hop count.
// Why: bank-only, since the Magic Guild (66 magic) and the Mage Arena are the only shops that stock it; a bank without law falls back to walking.
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

// Why: `snap.bankIds` is empty before the first bank scan, so preserve unknown state before shopping.

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

// Why: nothing before the lighthouse is a fight, and the nails leg needs 12 slots of ore on top of coins, hammer and pickaxe; 15 sharks leaves 10 free and `smithNails` stops on "pack is full, no room for Coal".

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

// Why: `ownsInventory` opts out of the engine's coin and food withdrawal; the float is a threshold since a `buy` step withdraws `estGp` when short, and topping up to an exact balance means a booth trip per purchase.

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

// Why: most accounts already own a hammer, and a bare `buy` walks past a bankful to pay for another.

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

// Why: nothing sells nails or steel bars, so they're mined, smelted and hammered by Dragon Slayer's ship-repair chain.

/** Source the 8 steel nails: the bank's nails, then its steel, then the ore chain. */
export function nails(snap: QuestSnapshot): QuestStep {
    const held = heldId(snap, HD_ID.NAILS);
    const need = NAILS_NEEDED - held;
    if (need <= 0) {
        return { kind: 'wait', reason: 'nails already held' };
    }
    const fromNails = fromBank(snap, HD_ID.NAILS, HD_ITEM.NAILS, need);
    if (fromNails) {
        return fromNails;
    }
    // Why: `smithNails` only reads steel in the pack, so banked bars (2 nails each) get withdrawn to skip the ore chain.
    const bars = Math.ceil(need / 2);
    if (heldId(snap, HD_ID.STEEL_BAR) < bars) {
        const fromSteel = fromBank(snap, HD_ID.STEEL_BAR, 'Steel bar', bars - heldId(snap, HD_ID.STEEL_BAR));
        if (fromSteel) {
            return fromSteel;
        }
        // Prefer the best owned pickaxe; the ground-spawn fallback is bronze.
        const pick = bankedPickaxe(snap.bankIds, snap.attack ?? 0);
        if (pick && !PICKAXES.some(p => heldId(snap, p.id) > 0 || (snap.wornIds?.has(p.id) ?? false))) {
            return withdraw([{ name: pick.name, qty: 1, id: pick.id }]);
        }
    }
    return { kind: 'custom', name: `smith ${need} nails`, run: log => smithNails(need, log) };
}

// Why: both the Range and the Furnace are `forceapproach=east`, which rotates with placement: the Yanille range is angle 0 so east is east, the Ardougne furnace angle 2 so its "east" is west.
// Why: from any other side the use-on is silently dropped, so this lands on the exact tile.

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

/** `[oplocu,_sand_pit]`. The pit carries no ops of its own, and no forced side. */
const fillSand = (log: (m: string) => void): Promise<boolean> => useOnLoc(
    HD_ID.BUCKET,
    { name: HD_LOC.SAND_PIT, near: HD_TILE.SAND_PIT },
    [],
    () => Inventory.countById(HD_ID.BUCKET_OF_SAND) > 0,
    log
);

// Why: sand and soda ash on a furnace run `smelt_glass`; Rellekka's furnace is nearer but refuses anyone without The Fremennik Trials, so this is East Ardougne's.
const smeltGlass = (log: (m: string) => void): Promise<boolean> => useOnLocFrom(
    HD_TILE.FURNACE,
    HD_ID.BUCKET_OF_SAND,
    HD_LOC.FURNACE,
    () => Inventory.countById(HD_ID.MOLTEN_GLASS) > 0,
    log
);

// Why: the chain is read backwards from the glass so a part-built one resumes at the right rung; nothing sells glass, soda ash, sand or seaweed.
// Why: seaweed is the Rellekka shore (Catherby's spawns are on an unwalkable islet) and cooks to soda ash on the Yanille range, 7 tiles from the sand pit.

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

/** True while the glass still has to be made. */
function glassWanted(snap: QuestSnapshot): boolean {
    return heldId(snap, HD_ID.MOLTEN_GLASS) === 0 && bankedId(snap, HD_ID.MOLTEN_GLASS) === 0;
}

/** Lumbridge swamp: 17 spawns, the only ones outside Morytania. */
function swampTar(snap: QuestSnapshot): QuestStep {
    return fromBank(snap, HD_ID.SWAMP_TAR, HD_ITEM.SWAMP_TAR, 1)
        ?? { kind: 'grabGround', item: HD_ITEM.SWAMP_TAR, anchor: HD_TILE.SWAMP_TAR, waitIfMissing: true };
}

// Why: split out of {@link dungeonKit} because with nav teleports on it's worth a Varrock counter before the 10-bar barcrawl, and a hop is only planned when the live pack can pay for it.
// Why: law isn't in {@link kit}, which runs every decide tick: `smithNails` banks the pack for ore and law isn't on its keep-list, so a per-tick top-up and the nails leg would deposit each other's work forever.

/** The rune kit, law from the bank, the elements from Aubury. */
export function runeKit(snap: QuestSnapshot, teleports = Traversal.teleportsEnabled()): QuestStep | null {
    if (teleports && heldId(snap, HD_ID.LAW_RUNE) < LAW_LOW) {
        // Why: `bankIds` is blank until a booth has been opened, so an unread bank can't be called empty or the toggle does nothing.
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
        // Half is the top-up mark: buying the last 100 after every splash would walk the bot back to Varrock mid-quest.
        if (heldId(snap, rune.id) < rune.qty / 2) {
            return fromBank(snap, rune.id, rune.name, rune.qty)
                ?? buy(rune.name, rune.qty - heldId(snap, rune.id), RUNE_SHOP, 20_000);
        }
    }
    return null;
}

// Why: the order makes the 2 Varrock shops and 2 ground-spawn errands happen once each; `needLight` goes false once the lamp is lit, past which tinderbox, tar and glass are spent and re-sourcing them is a wasted trip.

/** The one shortfall worth acting on, or null when the load is complete. */
export function dungeonKit(snap: QuestSnapshot, needLight: boolean): QuestStep | null {
    if (needLight && heldId(snap, HD_ID.TINDERBOX) === 0) {
        return source(snap, HD_ID.TINDERBOX, HD_ITEM.TINDERBOX, 1, GENERAL_SHOP, 100);
    }
    // Why: the bucket rides the tinderbox's counter; left to the glass chain it's asked for at the Yanille range, 900 tiles and 2 boat fares from the nearest general store in Varrock.
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

// Why: Zeke's Superior Scimitars stops at mithril, so the weapon is whatever the loadout holds; absent or unwieldable, the fights fall back to magic and pray through the melee form.
let meleeGaveUp = false;



/** Attempts before the weapon is written off, an unwieldable one never lands. */
const WIELD_TRIES = 3;
let wieldTries = 0;

export function meleeWeaponName(): string | null {
    // Why: no shop sells a rune scimitar, so the fallback is the best tier the account's Attack level reaches and already owns.
    const name = (weaponOf(QuestLoadout.current) ?? liveBestWeapon()?.name)?.trim();
    return name && name.length > 0 ? name : null;
}

/** True once the weapon is wielded. */
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
    // An attack level short of the weapon's requirement refuses silently.
    if (++wieldTries >= WIELD_TRIES) {
        meleeGaveUp = true;
        log(`could not wield the ${name} after ${WIELD_TRIES} tries `
            + `(attack ${Skills.level('attack')}), falling back to the magic-only fight`);
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
        // The magic loadout wins the quest on its own.
        meleeGaveUp = true;
        return null;
    }
    return withdraw([{ name, qty: 1 }]);
}

// Why: the server doesn't gate these but the quest needs them: `smithing` is the nails (2 to a steel bar at 34), `crafting` the glass, `magic` the mother fight's spell tier.
// Why: `prayer` 43 covers both protections, melee for the junior and missiles for the mother, whose ranged attack hits 24.
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
