import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { Bank } from '../../../../bank/Bank.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import { Shop } from '../../../../shop/Shop.js';
import { Skills } from '../../../../skills/Skills.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Locs } from '../../../../locs/Locs.js';
import { Traversal } from '../../../../walking/Traversal.js';
import Tile from '../../../../../geometry/Tile.js';
import { talkThrough } from '../../exec/primitives.js';
import { openBankLeg } from '../../exec/steps.js';
import { QuestFood } from '../../food.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';

// Why: of the seven things on Dragon Slayer's shopping list, four are bought outright.
// Why: the other three are sold nowhere in free-to-play — planks only lie on the ground, and the nearest pile outside Crandor (useless before the ship sails) is the Graveyard of Shadows.
// Why: nails are two to a steel bar at an anvil, and an unfired bowl is clay, water and a potter's wheel.

export const SUPPLY = {
    /** Hammers, buckets and jugs: any general store, and Falador's is by the bank. */
    GENERAL_STORE: { npc: 'Shop keeper', anchor: new Tile(2955, 3389, 0) },
    /** Silk, 30gp. */
    THESSALIA: { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) },
    /** Lobster pots, 20gp. */
    GERRANT: { npc: 'Gerrant', anchor: new Tile(3013, 3225, 0) },
    /** The Rising Sun barmaid pours a mind bomb for 2gp; no shop interface. */
    BARMAID: { npc: 'Barmaid', anchor: new Tile(2957, 3371, 0) },
    /** Pickaxes, in the Dwarven Mine itself. */
    NURMOF: { npc: 'Nurmof', anchor: new Tile(2998, 9844, 0) }
} as const;

const SUPPLY_LOC = {
    FOUNTAIN: new Tile(2949, 3381, 0),
    // Why: clay comes from the Varrock mine, which is on the shopping sweep beside Thessalia, and iron and coal come from the Dwarven Mine.
    // Why: those two anchors sit in the mine's dense southern seams — five iron and thirteen coal inside one radius — as the three-rock outcrop by the ladder cannot keep up with six bars' worth and leaves the leg waiting on respawns.
    CLAY_ROCKS: new Tile(3181, 3373, 0),
    IRON_ROCKS: new Tile(3040, 9773, 0),
    COAL_ROCKS: new Tile(3042, 9760, 0),
    ANVIL: new Tile(3012, 9812, 0),
    FURNACE: new Tile(2974, 3369, 0),
    POTTERS_WHEEL: new Tile(3087, 3410, 0),
    /** The nearest free planks: wilderness, level 18-20, over open ground. */
    PLANK_SPAWNS: [
        new Tile(3154, 3659, 0),
        new Tile(3154, 3670, 0),
        new Tile(3148, 3671, 0),
        new Tile(3182, 3669, 0),
        new Tile(3171, 3680, 0)
    ]
} as const;

const SUPPLY_ITEM = {
    JUG: 'Jug',
    JUG_WATER: 'Jug of water',
    CLAY: 'Clay',
    SOFT_CLAY: 'Soft clay',
    STEEL_BAR: 'Steel bar',
    IRON_ORE: 'Iron ore',
    COAL: 'Coal',
    PICKAXE: 'Bronze pickaxe'
} as const;

/** Intermediates that must survive the pre-quest deposit. */
export const SUPPLY_TOOLS: readonly string[] = [
    'jug', 'clay', 'steel bar', 'iron ore', 'coal', 'pickaxe', 'bucket'
];

const walk = (to: Tile, log: (m: string) => void, radius = 2): Promise<boolean> =>
    Traversal.walkResilient(to, { radius, attempts: 3, timeoutMs: 180_000, log });

const sceneLoaded = (): Promise<boolean> =>
    Execution.delayUntil(() => Locs.query().within(10).exists(), 6000);

const buy = (item: string, qty: number, shop: { npc: string; anchor: Tile }, estGp: number): QuestStep =>
    ({ kind: 'buy', item, qty, shop: { npc: shop.npc, anchor: shop.anchor }, estGp });

// Why: this module runs with no standing coin float, as the float is topped back up on every provisioning loop and would put a bank trip between every purchase.

/** Fetch spending money only when a leg is about to spend it. */
export async function ensureCoins(need: number, log: (m: string) => void): Promise<boolean> {
    if (Inventory.count('Coins') >= need) {
        return true;
    }
    if (!(await openBankLeg('no bank to draw spending money from', undefined, log))) {
        return false;
    }
    await Bank.withdrawX('Coins', Math.max(need, 2000));
    await Modals.close();
    return Inventory.count('Coins') >= need;
}

/** The barmaid sells through dialogue, so the generic buy step cannot see her. */
async function buyMindBomb(log: (m: string) => void): Promise<boolean> {
    if (!(await ensureCoins(10, log))) {
        log('no coins for a mind bomb');
        return false;
    }
    // Why: she takes the money whatever the pack looks like, and a bomb bought into a full pack is poured onto the floor of the pub, so the snapshot check alone is not enough.
    if (Inventory.isFull()) {
        log('pack is full — she would pour the mind bomb onto the floor');
        return false;
    }
    if (!(await walk(SUPPLY.BARMAID.anchor, log, 2))) {
        return false;
    }
    const before = Inventory.count("Wizard's mind bomb");
    log('ordering a Wizard\'s Mind Bomb at the Rising Sun');
    if (!(await talkThrough(SUPPLY.BARMAID.npc, ["I'll try the Mind Bomb."], log))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count("Wizard's mind bomb") > before, 5000);
}

// Why: this is a swing budget rather than a rock budget — the caller re-enters once per engine tick, so a timeout here throws away the current swing and starts another.
// Why: it logs loudly when it fires, as a timeout shorter than the ore takes is an infinite loop that mines nothing and looks identical to a slow rock.
const MINE_TIMEOUT_MS = 20_000;

/** Mines until the pack holds `want` of the named ore. */
async function mineFor(rockIds: readonly number[], item: string, want: number, at: Tile, log: (m: string) => void): Promise<boolean> {
    if (Inventory.count(item) >= want) {
        return true;
    }
    if (!Inventory.items().some(i => i.name?.toLowerCase().includes('pickaxe'))) {
        log('no pickaxe in the pack');
        return false;
    }
    // Why: a full pack does not refuse the Mine — the rock never yields, which reads like a rock that is out of ore.
    if (Inventory.isFull()) {
        log(`pack is full — no room for ${item}`);
        return false;
    }
    const ids = new Set(rockIds);
    // Wide enough to cross a seam: a mined rock is a different loc until it
    // respawns, so a tight radius parks the leg on its own leftovers.
    const rock = () => Locs.query().where(l => ids.has(l.id)).action('Mine').within(14).nearest();
    const seam = (): number => Locs.query().where(l => ids.has(l.id)).action('Mine').within(14).count();
    if (!rock()) {
        log(`no live ${item} rock within 14 — walking to the seam at (${at.x},${at.z})`);
        if (!(await walk(at, log, 2)) || !(await sceneLoaded())) {
            log(`could not reach the ${item} seam at (${at.x},${at.z})`);
            return false;
        }
    }
    const target = rock();
    if (!target) {
        log(`no ${item} rocks in reach — waiting on a respawn (mining ${Skills.level('mining')}, `
            + `${Inventory.count(item)}/${want} ${item} held)`);
        await Execution.delayTicks(5);
        return false;
    }
    const before = Inventory.count(item);
    const spot = target.tile();
    log(`mining ${item} ${before}/${want} — rock ${target.id} at (${spot.x},${spot.z}) `
        + `${target.distance()} tile(s) away, ${seam()} live rock(s) in the seam, ${Inventory.free()} free slot(s)`);
    if (!(await target.interact('Mine'))) {
        log(`the Mine click on rock ${target.id} was not accepted`);
        return false;
    }
    const swungAt = Date.now();
    const landed = await Execution.delayUntil(() => Inventory.count(item) > before, MINE_TIMEOUT_MS);
    const took = ((Date.now() - swungAt) / 1000).toFixed(1);
    if (!landed) {
        log(`gave up on rock ${target.id} after ${took}s with no ${item} — mining ${Skills.level('mining')}; `
            + 'the next pass re-clicks and restarts the swing, so a rock slower than '
            + `${MINE_TIMEOUT_MS / 1000}s never finishes`);
        return false;
    }
    const now = Inventory.count(item);
    log(`got ${item} ${now}/${want} in ${took}s`);
    return now >= want;
}

const ROCKS = { clay: [2108, 2109], iron: [2092, 2093], coal: [2096, 2097] } as const;

// Why: bronze pickaxes lie on the ground for nothing, and one of them is thirteen tiles from the Falador bank.
// Why: Nurmof is a last resort, as his shop is at the bottom of the Dwarven Mine.
const PICKAXE_SPAWNS: readonly Tile[] = [
    new Tile(3009, 3342, 0), // Falador, south of the bank
    new Tile(3081, 3429, 0), // Barbarian Village
    new Tile(2963, 3216, 0)  // Rimmington
];

const pickaxeTried = new Set<string>();

async function ensurePickaxe(log: (m: string) => void): Promise<boolean> {
    if (Inventory.items().some(i => i.name?.toLowerCase().includes('pickaxe'))) {
        pickaxeTried.clear();
        return true;
    }
    const loose = GroundItems.query().name(SUPPLY_ITEM.PICKAXE).within(12).nearest();
    if (loose) {
        log('taking the pickaxe off the ground');
        if (await loose.interact('Take')) {
            return Execution.delayUntil(() => Inventory.contains(SUPPLY_ITEM.PICKAXE), 8000);
        }
    }
    const here = Game.tile();
    const spawn = PICKAXE_SPAWNS
        .filter(t => !pickaxeTried.has(`${t.x},${t.z}`))
        .sort((a, b) => (here ? a.distanceTo(here) - b.distanceTo(here) : 0))[0];
    if (spawn) {
        pickaxeTried.add(`${spawn.x},${spawn.z}`);
        log(`checking the pickaxe spawn at (${spawn.x},${spawn.z})`);
        await walk(spawn, log, 1);
        await sceneLoaded();
        return false;
    }
    // Every spawn was bare — they respawn, but Nurmof always has one.
    log('no pickaxe on the ground anywhere — buying one from Nurmof');
    if (!(await ensureCoins(200, log)) || !(await walk(SUPPLY.NURMOF.anchor, log, 2))) {
        return false;
    }
    if (!(await Shop.open(SUPPLY.NURMOF.npc))) {
        log('could not open Nurmof\'s shop');
        return false;
    }
    await Shop.buy(SUPPLY_ITEM.PICKAXE, 1);
    await Shop.close();
    return Inventory.contains(SUPPLY_ITEM.PICKAXE);
}

/** Clay, water and a potter's wheel; the bowl is fired later or not at all. */
async function makeUnfiredBowl(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains('Unfired bowl')) {
        return true;
    }
    if (Inventory.contains(SUPPLY_ITEM.SOFT_CLAY)) {
        if (!(await walk(SUPPLY_LOC.POTTERS_WHEEL, log, 1)) || !(await sceneLoaded())) {
            return false;
        }
        const wheel = Locs.query().name("Potter's Wheel").within(5).nearest();
        const clay = Inventory.first(SUPPLY_ITEM.SOFT_CLAY);
        if (!wheel || !clay) {
            log('no potter\'s wheel in reach');
            return false;
        }
        log('throwing a bowl on the wheel');
        if (!(await clay.useOn(wheel))) {
            return false;
        }
        // skill_multi3 is if_openchat — a chat make menu, not the main skill
        // panel the anvil puts up. They are different interfaces entirely.
        if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 6000))) {
            log('the wheel did not offer anything to make');
            return false;
        }
        if (!(await ChatDialog.make('Bowl'))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains('Unfired bowl'), 10_000);
    }
    if (Inventory.contains(SUPPLY_ITEM.CLAY) && Inventory.contains(SUPPLY_ITEM.JUG_WATER)) {
        const clay = Inventory.first(SUPPLY_ITEM.CLAY);
        const water = Inventory.first(SUPPLY_ITEM.JUG_WATER);
        if (!clay || !water) {
            return false;
        }
        log('mixing the clay with water');
        if (!(await clay.useOn(water))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(SUPPLY_ITEM.SOFT_CLAY), 8000);
    }
    if (!Inventory.contains(SUPPLY_ITEM.JUG_WATER)) {
        if (!Inventory.contains(SUPPLY_ITEM.JUG)) {
            log('buying a jug');
            if (!(await ensureCoins(200, log))) {
                return false;
            }
            if (!(await walk(SUPPLY.GENERAL_STORE.anchor, log, 2)) || !(await Shop.open(SUPPLY.GENERAL_STORE.npc))) {
                return false;
            }
            await Shop.buy(SUPPLY_ITEM.JUG, 1);
            await Shop.close();
            return Inventory.contains(SUPPLY_ITEM.JUG);
        }
        if (!(await walk(SUPPLY_LOC.FOUNTAIN, log, 1)) || !(await sceneLoaded())) {
            return false;
        }
        const fountain = Locs.query().name('Fountain').within(5).nearest();
        const jug = Inventory.first(SUPPLY_ITEM.JUG);
        if (!fountain || !jug) {
            log('no fountain in reach');
            return false;
        }
        log('filling the jug');
        if (!(await jug.useOn(fountain))) {
            return false;
        }
        return Execution.delayUntil(() => Inventory.contains(SUPPLY_ITEM.JUG_WATER), 8000);
    }
    if (!(await ensurePickaxe(log))) {
        return false;
    }
    return mineFor(ROCKS.clay, SUPPLY_ITEM.CLAY, 1, SUPPLY_LOC.CLAY_ROCKS, log);
}

/**
 * Nails are two to a steel bar, and nothing sells steel bars: one iron and two
 * coal per bar at the Falador furnace, then the Dwarven Mine anvil.
 */
export async function smithNails(need: number, log: (m: string) => void): Promise<boolean> {
    // `need` is the shortfall, not the total. Two nails to a bar.
    if (need <= 0) {
        return true;
    }
    const bars = Math.ceil(need / 2);
    const ore = (): number => Inventory.count(SUPPLY_ITEM.IRON_ORE);
    // Why: three of these earn their slot by what banking them would cost — the maze key is what decide() reads as "the briefing never happened", the map is what Ned is waiting for, and the shield cannot be fetched back once the ship has sailed.
    const KEEP = ['coins', 'pickaxe', 'hammer', 'maze key', 'crandor map', 'map part', 'dragonfire shield',
        'iron ore', 'coal', 'steel bar', 'nails',
        'shark', 'lobster', 'swordfish', 'tuna', 'salmon', 'trout'];
    const coal = (): number => Inventory.count(SUPPLY_ITEM.COAL);
    const steel = (): number => Inventory.count(SUPPLY_ITEM.STEEL_BAR);

    // Why: mining, then smelting the load, then hammering the load is the order that works; reversed, the leg smelts one bar, walks to the anvil for two nails, and walks back — six round trips across half of Asgarnia.
    if (steel() === 0 && (ore() < bars || coal() < bars * 2)) {
        // Why: six bars is eighteen slots of ore, and the rest of the quest's shopping is already bought by now, so it goes in the bank to make room and comes back out when the ship needs it.
        if (Inventory.items().some(i => i.name !== null && !KEEP.some(k => i.name!.toLowerCase().includes(k)))) {
            log('banking the shopping to make room for ore');
            if (!(await openBankLeg('no bank to clear the pack at', undefined, log))) {
                return false;
            }
            const spare = Inventory.items()
                .filter(i => i.name !== null && !KEEP.some(k => i.name!.toLowerCase().includes(k)))
                .map(i => i.name);
            await Bank.depositAllMatching((name) => !KEEP.some(k => name.toLowerCase().includes(k)));
            log(`banked ${spare.length} items for ore room: ${spare.join(', ')}`);
            // Why: the bank is left open deliberately, as QuestEngine only re-reads it while the interface is up.
            // Why: a stale snapshot makes everything deposited look lost, which sent the bot back to Oziach for a maze key that was in the bank the time.
            return false;
        }
        if (!(await ensurePickaxe(log))) {
            return false;
        }
        if (ore() < bars) {
            return mineFor(ROCKS.iron, SUPPLY_ITEM.IRON_ORE, bars, SUPPLY_LOC.IRON_ROCKS, log);
        }
        return mineFor(ROCKS.coal, SUPPLY_ITEM.COAL, bars * 2, SUPPLY_LOC.COAL_ROCKS, log);
    }

    if (ore() > 0 && coal() >= 2) {
        if (!(await walk(SUPPLY_LOC.FURNACE, log, 1)) || !(await sceneLoaded())) {
            return false;
        }
        // Why: the furnace's own Smelt op is the one that opens the quantity panel.
        // Why: an ore used on the furnace takes the oplocu branch instead, smelt_ore_single — one bar, no menu, and another walk in for the next.
        const smelter = Locs.query().name('Furnace').action('Smelt').within(5).nearest();
        const furnace = smelter ?? Locs.query().name('Furnace').within(5).nearest();
        if (!furnace) {
            log('no furnace in reach');
            return false;
        }
        log(`smelting ${Math.min(ore(), Math.floor(coal() / 2))} steel bars`);
        if (smelter) {
            if (!(await smelter.interact('Smelt'))) {
                return false;
            }
        } else {
            const held = Inventory.first(SUPPLY_ITEM.IRON_ORE);
            if (!held || !(await held.useOn(furnace))) {
                return false;
            }
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 6000))) {
            // A furnace with no Smelt op answers with a single bar and no menu.
            return steel() > 0;
        }
        if (!(await ChatDialog.make('Steel'))) {
            return false;
        }
        // The make menu runs a batch. Wait for the ore to run out, not for the
        // first bar to land, or the anvil leg starts with one bar in the pack.
        await Execution.delayUntil(() => ore() === 0 || coal() < 2, 180_000);
        return steel() > 0;
    }

    if (steel() === 0) {
        log('no steel and nothing to smelt it from');
        return false;
    }
    // An anvil without a hammer does nothing and says nothing.
    if (!Inventory.contains('Hammer')) {
        log('no hammer — an anvil will not answer without one');
        return false;
    }
    if (!(await walk(SUPPLY_LOC.ANVIL, log, 1)) || !(await sceneLoaded())) {
        return false;
    }
    const anvil = Locs.query().name('Anvil').within(5).nearest();
    const bar = Inventory.first(SUPPLY_ITEM.STEEL_BAR);
    if (!anvil || !bar) {
        log('no anvil in reach');
        return false;
    }
    log(`hammering ${steel()} bars into nails`);
    if (!(await bar.useOn(anvil))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isMainMakePanel(), 6000))) {
        return false;
    }
    if (!(await ChatDialog.makeFromPanelMax('Nails'))) {
        return false;
    }
    await Execution.delayUntil(() => steel() === 0, 180_000);
    return Inventory.count('Nails') >= need;
}

/** Spawns already emptied this trip, so the walk moves on instead of circling. */
const plankTried = new Set<string>();

// Why: `need` is the shortfall the engine still wants and not the total, as comparing it against the pack reads "2 held, 1 short" as satisfied and the third plank never gets fetched.

/** Walk the Graveyard of Shadows picking up the plank spawns. */
async function grabPlanks(need: number, log: (m: string) => void): Promise<boolean> {
    if (need <= 0) {
        plankTried.clear();
        return true;
    }
    const loose = GroundItems.query().name('Plank').within(14).nearest();
    if (loose) {
        const before = Inventory.count('Plank');
        log('taking a plank');
        if (!(await loose.interact('Take'))) {
            return false;
        }
        await Execution.delayUntil(() => Inventory.count('Plank') > before, 8000);
        return Inventory.count('Plank') >= need;
    }
    const here = Game.tile();
    if (here) {
        for (const t of SUPPLY_LOC.PLANK_SPAWNS) {
            if (t.distanceTo(here) <= 6 && t.level === here.level) {
                plankTried.add(`${t.x},${t.z}`);
            }
        }
    }
    const next = SUPPLY_LOC.PLANK_SPAWNS
        .filter(t => !plankTried.has(`${t.x},${t.z}`))
        .sort((a, b) => (here ? a.distanceTo(here) - b.distanceTo(here) : 0))[0];
    if (!next) {
        log('every plank spawn was empty — they respawn, so waiting');
        plankTried.clear();
        await Execution.delayTicks(10);
        return false;
    }
    log(`walking to the plank spawn at (${next.x},${next.z})`);
    await walk(next, log, 2);
    await sceneLoaded();
    return false;
}

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

// Why: the mining load is deliberately absent, as eighteen slots of ore is what fills the pack.
// Why: `smithNails` reads its ore out of the inventory, so banking it costs a re-mine and nothing else.
const SHOPPING_KEEP: readonly string[] = [
    'coins', 'maze key', 'pickaxe', 'hammer', 'lobster pot', "wizard's mind bomb",
    'unfired bowl', 'silk', 'plank', 'jug', 'clay'
];

// Why: a purchase into a full pack is not refused — `inv_add` drops the overflow at the player's feet and the coins are already gone.
// Why: the leg's own "did it arrive in the pack" check can then never pass, which is an unbounded loop that pays for a new item every lap.
// Why: every acquisition here goes through this.

/** Free `slots` inventory slots before an acquisition, or null when there is room. */
function makeRoom(snap: QuestSnapshot, slots = 1): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) {
        return null;
    }
    const food = QuestFood.name?.toLowerCase();
    const keep = food ? [...SHOPPING_KEEP, food] : [...SHOPPING_KEEP];
    const spare = [...snap.inv.keys()].some(name => !keep.some(k => name.includes(k)));
    return spare
        ? { kind: 'deposit', keep }
        : { kind: 'wait', reason: `no room for ${slots} more item${slots === 1 ? '' : 's'} and nothing spare to bank` };
}

/** Wired into the quest module's `gather` map, keyed by item display name. */
export const SUPPLY_GATHERS: Record<string, (snap: QuestSnapshot, need: number) => QuestStep> = {
    hammer: snap => makeRoom(snap) ?? buy('Hammer', 1, SUPPLY.GENERAL_STORE, 100),
    silk: snap => makeRoom(snap) ?? buy('Silk', 1, SUPPLY.THESSALIA, 200),
    'lobster pot': snap => makeRoom(snap) ?? buy('Lobster pot', 1, SUPPLY.GERRANT, 200),
    "wizard's mind bomb": snap => makeRoom(snap) ?? custom('buy a mind bomb at the Rising Sun', buyMindBomb),
    // A jug, then water, then clay, then the bowl: one free slot carries the lot.
    'unfired bowl': snap => makeRoom(snap) ?? custom('make an unfired bowl', makeUnfiredBowl),
    plank: (snap, need) => makeRoom(snap, need) ?? custom(`fetch ${need} planks`, log => grabPlanks(need, log))
};


