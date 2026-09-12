import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { LQ_ID, LQ_ITEM, LQ_NPC, LQ_STAGE, legendsArea, type LegendsArea } from './areas.js';
import {
    askGujuoForWater,
    askForSeeds,
    blessBowl,
    cutReed,
    enterOctagram,
    enterShamanCave,
    fillBowlFromPool,
    findPoolDried,
    germinateSeeds,
    makeGoldenBowl,
    speakToUngadulu,
    summonDemon
} from './shaman.js';
import { enterGuild, handInTotem, replaceMap, startQuest, takeMachete, takeTraining } from './guild.js';
import { fight } from './fight.js';
import { enterJungle, getBullroarer, leaveJungle, mapJungle, talkGujuo } from './jungle.js';
import { legendsPocket, type LegendsPocket } from './pockets.js';
import { climbDownWinch, climbOutOfTrials, descendToGemRoom, descendToWinch, takeBookOfBinding } from './trials.js';
import { askForMoreSeeds, growTotemPole, replaceEvilTotem, takeGildedTotem } from './totem.js';
import {
    banishSourceDemon,
    chargeHeartCrystal,
    climbLedges,
    collectSacredWater,
    crossBarrier,
    fillRecess,
    forgeHeartCrystal,
    leaveCaves,
    takeBlackDagger,
    tradeDaggerForSpell
} from './viyeldi.js';
import {
    BANK_ONLY_KIT,
    DESCENT_KIT,
    LEG_BANK,
    LQ_FOODS,
    ORB_RUNE_KIT,
    RUNE_KIT,
    SHOP_GP,
    coinTopUp,
    deposit,
    dressForCombat,
    FOOD_FOR_SLOT,
    foodTopUp,
    fromBank,
    held,
    heldFood,
    ditchIds,
    junkHeld,
    owned,
    PRAYER_POTIONS,
    potionTopUp,
    potsBanked,
    provision,
    potsHeld,
    sourceBankOnly,
    sourceFrom,
    sourceGems,
    sourceGoldBars,
    sourcePickaxe,
    warnLegendsReadiness
} from './supplies.js';
import { LQ_SHOP } from './areas.js';
import { BRAVERY_HERBS, identifyHerb, pickHerb } from './gather.js';
import { readLegendsProgress } from './journal.js';
import { driveUntil } from './scene.js';

function step(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

// Why: Each sealed Karamja pocket requires its scripted exit before normal pathfinding can resume.

/** A step out of whatever pocket we are standing in, or null on open ground. */
function escapePocket(snap: QuestSnapshot): QuestStep | null {
    // Why: The underground shaman cave has no pocket id, so include it explicitly before treating the tile as open ground.
    const area = legendsArea(snap.tile);
    if (legendsPocket(snap.tile) !== null || area === 'viyeldiCaves' || area === 'shamanCaves') {
        return step('climb back out of the caves', leaveCaves);
    }
    if (area === 'jungle') {
        return step('cut back out of the Kharazi Jungle', leaveJungle);
    }
    return null;
}

/** Take `whenOpen` only once we are somewhere a bank walk can start from. */
function inTheOpen(snap: QuestSnapshot, whenOpen: QuestStep): QuestStep {
    return escapePocket(snap) ?? whenOpen;
}

// Why: Each leg has different fixed-slot costs, so food limits are set per leg from the remaining inventory space.
const FOOD = { jungle: 4, trials: 3, fight: 9 } as const;

const CHOP_KIT = [
    { item: { id: LQ_ID.RUNE_AXE, name: LQ_ITEM.RUNE_AXE }, qty: 1 },
    { item: { id: LQ_ID.MACHETE, name: LQ_ITEM.MACHETE }, qty: 1 }
] as const;

const MAP_KIT = [
    { item: { id: LQ_ID.PAPYRUS, name: LQ_ITEM.PAPYRUS }, qty: 6 },
    { item: { id: LQ_ID.CHARCOAL, name: LQ_ITEM.CHARCOAL }, qty: 6 }
] as const;

const BOWL_KIT = [
    { item: { id: LQ_ID.GOLD_BAR, name: LQ_ITEM.GOLD_BAR }, qty: 2 },
    { item: { id: LQ_ID.HAMMER, name: LQ_ITEM.HAMMER }, qty: 1 },
    { item: { id: LQ_ID.KNIFE, name: LQ_ITEM.KNIFE }, qty: 1 }
] as const;

const BRAVERY_KIT = [
    { item: { id: LQ_ID.VIAL_WATER, name: LQ_ITEM.VIAL_WATER }, qty: 1 }
] as const;

const TRIALS_KIT = [
    { item: { id: LQ_ID.ROPE, name: LQ_ITEM.ROPE }, qty: 1 }
] as const;

/** Bank first, then Jiminua's counter in Tai Bwo Wannai. */
function fromShop(snap: QuestSnapshot, kit: readonly { item: { id: number; name: string }; qty: number }[]): QuestStep | null {
    return sourceFrom(snap, kit, LQ_SHOP.JIMINUA, SHOP_GP.JIMINUA, LEG_BANK.karamja);
}

// Why: `jungle_tree` empties every filled bowl state, so leave the island before filling it.

/** Holding a golden bowl with anything in it. */
function carryingWater(snap: QuestSnapshot): boolean {
    return [LQ_ID.GOLD_BOWL_WATER, LQ_ID.GOLD_BOWL_PURE, LQ_ID.GOLD_BOWL_BLESSED_WATER, LQ_ID.GOLD_BOWL_BLESSED_PURE]
        .some(id => held(snap, id) > 0);
}

// Why: Several quest rewards fail silently with a full pack, so clear spent mapping, forging, and boulder items first.

/** Every state a forged bowl can be in. */
const BOWLS: readonly number[] = [
    LQ_ID.GOLD_BOWL, LQ_ID.GOLD_BOWL_BLESSED, LQ_ID.GOLD_BOWL_WATER,
    LQ_ID.GOLD_BOWL_PURE, LQ_ID.GOLD_BOWL_BLESSED_WATER, LQ_ID.GOLD_BOWL_BLESSED_PURE
];

/** What the quest is done with, given where it has got to. */
function spentNow(snap: QuestSnapshot): number[] {
    const spent: number[] = [LQ_ID.SWAMP_ROCK, LQ_ID.VIAL];
    if (held(snap, LQ_ID.MAP_COMPLETE) > 0 || (snap.stage ?? 0) >= LQ_STAGE.MAPPED_JUNGLE) {
        spent.push(LQ_ID.PAPYRUS, LQ_ID.CHARCOAL);
    }
    // Why: The hammer is done after forging, and the machete can cut the reed without the knife.
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED) > 0 || held(snap, LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        spent.push(LQ_ID.HAMMER, LQ_ID.KNIFE);
    }
    // Why: Any bowl state proves the sketch has served its only purpose.
    if (BOWLS.some(id => held(snap, id) > 0)) {
        spent.push(LQ_ID.GOLD_BOWL_SKETCH);
    }
    // Why: Keep Prayer potions until the final demon dies; stage 8 still has three demon fights, guardians, and the trials ahead.
    if ((snap.stage ?? 0) >= LQ_STAGE.DEFEATED_NEZI_FINAL) {
        spent.push(...PRAYER_POTIONS.map(pot => pot.id));
    }
    return spent.filter(id => held(snap, id) > 0);
}

/** Drop the named items, wherever we are standing. */
function ditch(ids: readonly number[]): (log: (m: string) => void) => Promise<boolean> {
    return async log => {
        const spent = Inventory.items().filter(item => ids.includes(item.id));
        for (const item of spent) {
            await item.interact('Drop');
            await Execution.delayTicks(1);
        }
        log(`dropped ${spent.length} spent item(s)`);
        return spent.length > 0;
    };
}

// Why: Bank and shop errands leave the island, and re-entry empties the bowl, so complete them before filling it.

/** A kit errand, routed back out to open ground when it was decided from inside. */
function offIsland(snap: QuestSnapshot, kit: QuestStep | null): QuestStep | null {
    if (!kit) {
        return null;
    }
    return legendsArea(snap.tile) === 'mainland' ? kit : inTheOpen(snap, kit);
}

/** Everything a descent to the winch spends, whether or not it is the first. */
function gateKit(snap: QuestSnapshot): QuestStep | null {
    return sourceBankOnly(snap, DESCENT_KIT)
        ?? sourceFrom(snap, ORB_RUNE_KIT, LQ_SHOP.MAGIC_GUILD, SHOP_GP.MAGIC_GUILD, LEG_BANK.runes)
        ?? sourcePickaxe(snap, LEG_BANK.karamja)
        // Why: the rope is tied once and recovered from the beams afterwards, but the first descent has no beams to search, and a spare costs a few coins at Jiminua's.
        ?? fromShop(snap, TRIALS_KIT);
}

// Why: The gate consumes the orb, so skip the kit check after crossing it.

/** The 2 pockets past the magic gate, where the orb it shattered is spent. */
const PAST_GATE: readonly LegendsPocket[] = ['winchRoom', 'viyeldiLedge'];

/** The descent kit, asked for anywhere the gate is still ahead of us. */
function descentKit(snap: QuestSnapshot): QuestStep | null {
    const at = legendsPocket(snap.tile);
    if (legendsArea(snap.tile) === 'viyeldiCaves' || (at !== null && PAST_GATE.includes(at))) {
        return null;
    }
    return offIsland(snap, gateKit(snap));
}

/** Everything the trials swallow in one go, none of which can be fetched from inside. */
function trialsKit(snap: QuestSnapshot): QuestStep | null {
    return sourceBankOnly(snap, BANK_ONLY_KIT)
        ?? sourceFrom(snap, RUNE_KIT, LQ_SHOP.MAGIC_GUILD, SHOP_GP.MAGIC_GUILD, LEG_BANK.runes)
        ?? sourceGems(snap, LEG_BANK.karamja)
        ?? fromShop(snap, TRIALS_KIT)
        ?? gateKit(snap);
}

// Why: At level 70, three flasks keep Protect from Melee active through the three aggressive guardians.
/** 3 flasks of 4 doses: 14 minutes of protection and the last slot the descent leaves. */
const FIGHT_POTS = 3;

// Why: Summoning drains 90% Prayer, so reserve a potion slot before filling remaining space with food.

/** Coin, prayer potions, food and a melee kit, taken only where a booth is reachable. */
function upkeep(snap: QuestSnapshot, food: number, pots = 0): QuestStep | null {
    const bank = LEG_BANK.karamja;
    return coinTopUp(snap, undefined, bank)
        ?? potionTopUp(snap, pots, bank)
        ?? (heldFood(snap) < Math.ceil(food / 2) ? foodTopUp(snap, food, bank) : null)
        ?? dressForCombat(snap, bank);
}

// Why: Trials, chopping, and random events add items to an already tight pack, so reserve space before withdrawals.

/** Free slots at or below which a bank trip empties the pack of junk on its way past. */
const JUNK_RESERVE = 4;

/** Make room: at the booth the step was going to anyway, or on the ground. */
function makeRoom(snap: QuestSnapshot, chosen: QuestStep): QuestStep {
    // Why: Deposit before bank or shop errands when useful junk is present; otherwise the planner could repeat a no-op deposit.
    if ((chosen.kind === 'withdraw' || chosen.kind === 'buy') && (snap.freeSlots ?? 28) <= JUNK_RESERVE && junkHeld(snap)) {
        return deposit(chosen.bank ?? LEG_BANK.karamja);
    }
    // Why: Dropping is irreversible, so wait until the pack is full.
    if ((snap.freeSlots ?? 1) > 0) {
        return chosen;
    }
    // Why: a pack with spent kit in it is already being dropped by the step above, and 2 drops racing each other shed one item a pass.
    const junk = spentNow(snap).length > 0 ? [] : ditchIds(snap);
    if (junk.length > 0) {
        return step('drop what the quest has no use for', ditch(junk));
    }
    // Why: 28 wanted things still leave no slot for the reed, the herb or the lump about to be handed over, and the lobster count is the only float in the pack.
    // Why: eating below the float's top-up threshold buys a slot the next withdraw spends on another lobster, a loop after a death, so only the surplus is edible.
    const spare = heldFood(snap) - Math.ceil(foodFor(snap, snap.stage ?? 0) / 2);
    const worst = FOOD_FOR_SLOT.find(f => held(snap, f.id) > 0);
    return spare > 0 && worst ? step(`eat a ${worst.name.toLowerCase()} to make room`, eatOne) : chosen;
}

/** Eat the worst food held, for the slot. */
async function eatOne(log: (m: string) => void): Promise<boolean> {
    const held = Inventory.items();
    const worst = FOOD_FOR_SLOT.find(f => held.some(item => item.id === f.id));
    const food = worst ? held.find(item => item.id === worst.id) : undefined;
    if (!food) {
        log('no food left to eat for the slot');
        return false;
    }
    await food.interact('Eat');
    await Execution.delayTicks(2);
    return Inventory.free() > 0;
}

// Why: the pack is tightest through the trials and the fights want the most food, so the float is chosen by where the quest is.
// Why: the Book of Binding in the pack says the trials are behind us and the octagram demon is next; both are stage 10.
function foodFor(snap: QuestSnapshot, stage: number): number {
    // Why: nothing after the last demon is a fight. The gilded totem is a walk to Radimus and 4 training sessions, so a fight float there (and `potsFor` reads this) is a bank trip for flasks the quest never drinks.
    if (stage >= LQ_STAGE.DEFEATED_NEZI_FINAL) {
        return FOOD.jungle;
    }
    // Why: everything from the winch down is a fight, 3 aggressive guardians then the demon at the source, so the trials float ends where the trials do.
    if (held(snap, LQ_ID.BOOK_OF_BINDING) > 0 || stage >= LQ_STAGE.ENTER_LOWER_DUNGEON) {
        return FOOD.fight;
    }
    return stage >= LQ_STAGE.ASKED_GUJUO_WATER ? FOOD.trials : FOOD.jungle;
}

// Why: the blessing is a prayer roll that takes 5 points a miss and refuses below 42, so the leg needs a flask as much as the demon does; a plain bowl in the pack says it hasn't happened yet.

/** How many prayer flasks this stage's next step wants. */
function potsFor(snap: QuestSnapshot, stage: number): number {
    if (foodFor(snap, stage) === FOOD.fight) {
        return FIGHT_POTS;
    }
    return held(snap, LQ_ID.GOLD_BOWL) > 0 ? BLESS_POTS : 0;
}

// Why: the trance takes 5 points a miss and misses about 3 times in 5, and a 42 bar is one dose back to full, so the doses are the throws and one potion buys 4.
const BLESS_POTS = 2;

// Why: the shopping happens before Radimus is asked for the quest, because both counters are a sea crossing from everything the quest then does.

function stageStart(snap: QuestSnapshot): QuestStep {
    return inTheOpen(snap, provision(snap) ?? step('ask Radimus Erkle for the quest', startQuest));
}

// Why: Radimus keeps a free machete in the cupboard beside his desk and refuses a second one, so the counter in Shilo is the fallback.
// Why: The cupboard counts banked machetes but gives none, so withdraw an existing one instead of retrying the cupboard.

function stageMapping(snap: QuestSnapshot): QuestStep {
    // Why: the completed notes are the mapping's receipt, so holding them means the leg is done whatever the varp says: `radimus_notes.rs2` only advances the stage when it swaps the notes and clears the 3 section bits as it goes.
    // Why: Without this guard, `mapJungle` returns immediate success on every stage-1 iteration.
    if (held(snap, LQ_ID.MAP_COMPLETE) > 0) {
        return stageBullroarer(snap);
    }
    if (held(snap, LQ_ID.MACHETE) === 0) {
        const machete = { id: LQ_ID.MACHETE, name: LQ_ITEM.MACHETE };
        return inTheOpen(snap, fromBank(snap, machete, 1)
            ?? step("take the machete from Radimus' cupboard", takeMachete));
    }
    const kit = legendsArea(snap.tile) === 'mainland'
        ? fromShop(snap, CHOP_KIT) ?? fromShop(snap, MAP_KIT)
        : null;
    if (kit) {
        return kit;
    }
    return step('map all three thirds of the Kharazi Jungle', mapJungle);
}

const GUJUO_RESCUE_PREFER = [
    'I will release Ungadulu...',
    'How do we make the totem pole?',
    'What can we do instead then?',
    'Can you get your people together?',
    'I want to develop friendly relations with your people.',
    'I was hoping to attract the attention of a native.'
];

const acceptRescue = talkGujuo(GUJUO_RESCUE_PREFER, undefined, 150_000, 'I will release Ungadulu...');

/** Gujuo is still wanted, so the roarer is still kit. */
function needsGujuo(stage: number): boolean {
    return stage >= LQ_STAGE.MAPPED_JUNGLE && stage < LQ_STAGE.RETURNED_TO_RADIMUS;
}

// Why: the forester wants a map to copy and the map goes the same way the roarer does; Radimus sells a replacement for 30 coins, but only while neither is held.

/** Get a roarer back: buy a map if that went too, redraw it, then trade it. */
function regainRoarer(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, LQ_ID.MAP_COMPLETE) > 0) {
        return step('trade a copy of the map for the bull roarer', getBullroarer);
    }
    if (held(snap, LQ_ID.MAP) === 0) {
        return step('buy a replacement map from Radimus', replaceMap);
    }
    return fromShop(snap, MAP_KIT) ?? step('redraw the map of the Kharazi Jungle', mapJungle);
}

function stageBullroarer(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.BULLROARER) === 0) {
        return step('trade a copy of the map for the bull roarer', getBullroarer);
    }
    return step('swing the bull roarer and befriend Gujuo', acceptRescue);
}

function stageCave(): QuestStep {
    return step('find Ungadulu and talk through the flames', speakToUngadulu);
}

// Why: the sketch is Gujuo's answer to the pure-water question and the only client-visible proof that the stage moved with it.

function stageWater(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.GOLD_BOWL_SKETCH) === 0 && owned(snap, LQ_ID.GOLD_BOWL) === 0) {
        return step('ask Gujuo where the sacred water is', askGujuoForWater);
    }
    return stageBowl(snap);
}

function stageBowl(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        return step('douse the flames and use the Book of Binding', bookLeg);
    }
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED) === 0 && held(snap, LQ_ID.GOLD_BOWL) === 0) {
        const bars = legendsArea(snap.tile) === 'mainland' ? sourceGoldBars(snap, LEG_BANK.karamja) : null;
        if (bars) {
            return bars;
        }
        const kit = legendsArea(snap.tile) === 'mainland' ? fromShop(snap, BOWL_KIT) : null;
        return kit ?? inTheOpen(snap, step('hammer two gold bars into a golden bowl', makeGoldenBowl));
    }
    if (held(snap, LQ_ID.GOLD_BOWL) > 0) {
        return step('have Gujuo bless the golden bowl', blessBowl);
    }
    // Why: `jungle_tree` evaporates a filled bowl on every chop, so the last errand off the island runs before the pool.
    // Why: the gems and the wall runes are spent by the time the book is in the pack and gone from it once the book is read, so asking for them again sends the run back for things nothing sells.
    // Why: with the book in hand the next thing after the fill is a level-187 demon, and the bowl is still empty here, so this is the last free bank trip.
    const errands = held(snap, LQ_ID.BOOK_OF_BINDING) > 0
        ? upkeep(snap, FOOD.fight, FIGHT_POTS)
        : (snap.stage ?? 0) >= LQ_STAGE.DEFEATED_NEZI_FIRE ? null : trialsKit(snap);
    const off = offIsland(snap, errands);
    if (off) {
        return off;
    }
    // Why: `stat_sub(prayer, 0, 90)` runs as the book opens, so the fight starts with 90% of the prayer bar gone and Protect from Melee lapses within the minute. `potionTopUp` answers null when the bank holds no flask, which walks into a level-187 demon and says nothing.
    // Why: this is the last branch that still has a bank behind it. The fill is next and `jungle_tree` boils the bowl off on any chop back across the band.
    const flask = held(snap, LQ_ID.BOOK_OF_BINDING) > 0 && potsHeld(snap) === 0 && potsBanked(snap) === 0;
    if (flask) {
        return { kind: 'wait', reason: 'no prayer potion in the pack or the bank, and opening the book drains nine tenths of the prayer bar before the demon lands a blow' };
    }
    if (held(snap, LQ_ID.HOLLOW_REED) === 0) {
        return step('cut a hollow reed at the sacred pool', cutReed);
    }
    return step('syphon the sacred pool into the blessed bowl', fillBowlFromPool);
}

// Why: the book is conjured in the gem room and the magic gate past it is one-way, so this leg stops one crossing short of the winch.

async function bookLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await enterShamanCave(log)) || !(await descendToGemRoom(log))) {
        return false;
    }
    return takeBookOfBinding(log);
}

// Why: the demon is `npc_del`ed on death, so his leaving the scene ends the fight; without it the loop sits out its budget and reports a win as a failure.

async function summonAndFight(log: (m: string) => void): Promise<boolean> {
    if (!(await summonDemon(log))) {
        return false;
    }
    const gone = (): boolean => !Npcs.query().name(LQ_NPC.NEZIKCHENED).within(14).exists();
    return fight({ npc: LQ_NPC.NEZIKCHENED, done: gone, ms: 420_000 }, log);
}

function stageBook(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.BOOK_OF_BINDING) === 0) {
        return offIsland(snap, trialsKit(snap)) ?? step('fetch the Book of Binding from the gem room', bookLeg);
    }
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED_PURE) === 0) {
        return stageBowl(snap);
    }
    // Why: `stageBowl` fetches the fight kit while the bowl is empty, but a run arriving here with it filled never went through that, and `choose` only reaches its upkeep on the mainland while this is decided in the caves. Opening the book runs `stat_sub(prayer, 0, 90)`, a level-187 demon on a tenth of a prayer bar.
    // Why: the trip boils the bowl, and `stageBowl` refills it on the way back; a flask is worth a refill against this fight.
    const fightKit = offIsland(snap, upkeep(snap, FOOD.fight, FIGHT_POTS));
    if (fightKit) {
        return fightKit;
    }
    if (potsHeld(snap) === 0 && potsBanked(snap) === 0) {
        return { kind: 'wait', reason: 'no prayer potion in the pack or the bank, and opening the book drains nine tenths of the prayer bar before the demon lands a blow' };
    }
    return step('open the Book of Binding on Ungadulu', summonAndFight);
}

function stageSeeds(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.YOMMI_SEEDS) === 0 && held(snap, LQ_ID.YOMMI_SEEDS_GERM) === 0) {
        return step('ask Ungadulu for the Yommi tree seeds', askForSeeds);
    }
    if (held(snap, LQ_ID.YOMMI_SEEDS_GERM) > 0) {
        return step('find the sacred pool fouled', findPoolDried);
    }
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED_PURE) === 0) {
        return stageBowl(snap);
    }
    return step('germinate the seeds in the bowl of sacred water', germinateSeeds);
}

// Why: only `gujuo_helpme` moves the varp, and it's 3 menus deep: pool-dried, then the source, then the offer of help.
// Why: the goodbye outranks the source question because the menu after the recipe offers both, and picking the source again walks the chain a second time.
const GUJUO_POTION_PREFER = [
    'If I went, could you help me?',
    'If I went in search of the source, could you help me?',
    'The water pool has dried up and I need more water.',
    'Where can I get more water for the Yommi tree?',
    'Ok thanks for your help.',
    'Where is the source of the spring of pure water?'
];

const askForRecipe = talkGujuo(GUJUO_POTION_PREFER, undefined, 150_000);

function stagePotion(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.BRAVERY_POTION) > 0) {
        return descentKit(snap) ?? step('climb down the winch into the Viyeldi caves', descendLeg);
    }
    if (held(snap, LQ_ID.SNAKEWEED_MIXTURE) > 0 && held(snap, LQ_ID.ARDRIGAL) > 0) {
        return {
            kind: 'useOn',
            item: LQ_ITEM.ARDRIGAL,
            targetKind: 'item',
            target: LQ_ITEM.SNAKEWEED_MIXTURE,
            anchor: LEG_BANK.karamja,
            product: LQ_ITEM.BRAVERY_POTION
        };
    }
    const open = escapePocket(snap);
    if (open) {
        return open;
    }
    if (legendsArea(snap.tile) === 'jungle') {
        return step('cut back out of the Kharazi Jungle', leaveJungle);
    }
    for (const herb of BRAVERY_HERBS) {
        if (held(snap, herb.id) > 0) {
            continue;
        }
        if (held(snap, herb.unidId) > 0) {
            return step(`identify the ${herb.name}`, identifyHerb(herb));
        }
        return step(`pick the ${herb.name}`, pickHerb(herb));
    }
    const vial = fromShop(snap, BRAVERY_KIT);
    if (vial) {
        return vial;
    }
    return {
        kind: 'useOn',
        item: LQ_ITEM.SNAKE_WEED,
        targetKind: 'item',
        target: LQ_ITEM.VIAL_WATER,
        anchor: LEG_BANK.karamja,
        product: LQ_ITEM.SNAKEWEED_MIXTURE
    };
}

// Why: the rope refuses anyone who hasn't drunk the potion, and the refusal is a chat line with no prompt, so drink before the climb.

async function drinkBravery(log: (m: string) => void): Promise<boolean> {
    const dose = Inventory.items().find(item => item.id === LQ_ID.BRAVERY_POTION);
    if (!dose) {
        return true;
    }
    if (!(await dose.interact('Drink'))) {
        return false;
    }
    // Why: Drink only asks whether you're sure; the swig and the bit the winch checks are behind the yes.
    return driveUntil(
        () => !Inventory.items().some(item => item.id === LQ_ID.BRAVERY_POTION),
        ["Yes, I'll bravely drink the bravery potion."],
        log,
        20_000
    );
}

async function descendLeg(log: (m: string) => void): Promise<boolean> {
    if (!(await drinkBravery(log))) {
        return false;
    }
    if (!(await enterShamanCave(log)) || !(await descendToWinch(log))) {
        return false;
    }
    return climbDownWinch(log);
}

// Why: every leg below the winch stands on a tile the walker can't path to from anywhere else, so a run resumed on the surface climbs back down before it acts.

function viyeldiStep(snap: QuestSnapshot, name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    if (legendsArea(snap.tile) !== 'viyeldiCaves') {
        return descentKit(snap) ?? step('climb back down to the Viyeldi caves', descendLeg);
    }
    return step(name, run);
}

function stageCrystal(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.HEART_CRYSTAL_GLOW) > 0 || held(snap, LQ_ID.HEART_CRYSTAL) > 0) {
        return stageRecess(snap);
    }
    return viyeldiStep(snap, 'take the dragon heart off the three guardians', forgeHeartCrystal);
}

function stageRecess(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.HEART_CRYSTAL) > 0) {
        return viyeldiStep(snap, "charge the heart on the dragon's eye", chargeHeartCrystal);
    }
    return viyeldiStep(snap, 'slot the glowing heart into the recess', fillRecess);
}

function stageSpirit(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.HOLY_FORCE) > 0) {
        return viyeldiStep(snap, 'read the Holy Force at the spirit and kill it', banishSourceDemon);
    }
    if (held(snap, LQ_ID.DEATH_DAGGER) > 0) {
        return step('take the black dagger to Ungadulu', daggerToUngadulu);
    }
    return viyeldiStep(snap, 'push the boulder and hear Echned Zekin out', takeBlackDagger);
}

async function daggerToUngadulu(log: (m: string) => void): Promise<boolean> {
    if (!(await climbLedges(log))) {
        return false;
    }
    if (!(await climbOutOfTrials(log))) {
        return false;
    }
    if (!(await enterShamanCave(log))) {
        return false;
    }
    // Why: the flames block a use-on as surely as a step, so the dagger is handed over from inside the octagram.
    if (!(await enterOctagram(log))) {
        return false;
    }
    return tradeDaggerForSpell(log);
}

function stageSacredWater(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
        return stageGrow(snap);
    }
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED) === 0) {
        return { kind: 'wait', reason: 'no empty blessed bowl to fill at the source' };
    }
    return viyeldiStep(snap, 'shift the boulder and fill the bowl at the source', collectSacredWater);
}

// Why: the sapling is watered from the bowl and the walk back into the jungle boils it dry, so a bowl that arrives empty is a trip back to the source.

function stageGrow(snap: QuestSnapshot): QuestStep {
    // Why: the carve moves the varp only when the pole is lifted, so for one tick the tree is done and the stage still says it is not.
    if (held(snap, LQ_ID.TOTEM_POLE) > 0) {
        return stageReplace(snap);
    }
    if (held(snap, LQ_ID.YOMMI_SEEDS_GERM) === 0) {
        if (held(snap, LQ_ID.YOMMI_SEEDS) > 0 && held(snap, LQ_ID.GOLD_BOWL_BLESSED_PURE) > 0) {
            return step('germinate the seeds in the bowl of sacred water', germinateSeeds);
        }
        if (held(snap, LQ_ID.YOMMI_SEEDS) === 0) {
            return step('ask Ungadulu for another set of seeds', askForMoreSeeds);
        }
    }
    if (held(snap, LQ_ID.GOLD_BOWL_BLESSED_PURE) === 0) {
        return viyeldiStep(snap, 'fill the bowl again at the source', collectSacredWater);
    }
    return step('grow a Yommi tree and carve a totem pole', growTotemPole);
}

function stageReplace(snap: QuestSnapshot): QuestStep {
    if (held(snap, LQ_ID.GILDED_TOTEM) > 0) {
        return inTheOpen(snap, step('take the gilded totem to Radimus', handInTotem));
    }
    if (held(snap, LQ_ID.TOTEM_POLE) > 0) {
        // Why: replacing the totem spawns Nezikchened for the last time, and the totems stand in the Kharazi jungle where `choose` never reaches its upkeep, so the fight kit is asked for here.
        const kit = offIsland(snap, upkeep(snap, FOOD.fight, FIGHT_POTS));
        if (kit) {
            return kit;
        }
        // Why: same silence as the octagram: `potionTopUp` answers null when the bank has no flask, and Protect from Melee can't be raised on an empty prayer bar.
        if (potsHeld(snap) === 0 && potsBanked(snap) === 0) {
            return { kind: 'wait', reason: 'no prayer potion in the pack or the bank, and replacing the totem spawns Nezikchened on the spot' };
        }
        return step('replace the evil totem and kill what comes out', replaceEvilTotem);
    }
    return step('collect the gilded totem from Gujuo', takeGildedTotem);
}

export function decide(snap: QuestSnapshot): QuestStep {
    return makeRoom(snap, choose(snap));
}

function choose(snap: QuestSnapshot): QuestStep {
    const area: LegendsArea = legendsArea(snap.tile);
    const stage = snap.stage ?? -1;

    if (snap.journal === 'complete' || stage >= LQ_STAGE.COMPLETE) {
        return escapePocket(snap) ?? { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Legends Quest journal stage unavailable' };
    }
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }

    const spent = (snap.freeSlots ?? 9) <= 1 ? spentNow(snap) : [];
    if (spent.length > 0) {
        return step('drop what the quest has finished with', ditch(spent));
    }

    // Why: the Karamja ships and Hajedy's cart each want coin, and the walk to the jungle is "unreachable" without it, so the float comes before any leg.
    // Why: only on open ground, as a top-up decided inside a sealed pocket sends the walker at a booth it can't reach.
    // Why: never with water in the bowl, since the only way back into the jungle is a chop and every chop boils it off.
    if (area === 'mainland' && !carryingWater(snap)) {
        const kit = upkeep(snap, foodFor(snap, stage), potsFor(snap, stage));
        if (kit) {
            // Why: what the quest is finished with goes out before the bank hands anything over, or the top-up is capped by whatever room the junk left.
            const finished = spentNow(snap);
            return finished.length > 0 ? step('drop what the quest has finished with', ditch(finished)) : kit;
        }
        // Why: the machete and the axe open the jungle band and every leg from the map onwards crosses it, so a death that drops them is a dead run unless they're replaced like food.
        // Why: stage 1 is left alone, since Radimus hands the first machete over for nothing.
        const chop = stage >= LQ_STAGE.MAPPED_JUNGLE && stage < LQ_STAGE.RETURNED_TO_RADIMUS ? fromShop(snap, CHOP_KIT) : null;
        if (chop) {
            return chop;
        }
        // Why: the roarer is the only way to summon Gujuo, wanted at the bowl, the recipe and the gilded totem, but the branch that trades for one only runs at stage 3.
        // Why: a Jungle Savage takes a dislike to the noise, and the death that follows drops the roarer and the map together at stage 14.
        const roarer = needsGujuo(stage) && held(snap, LQ_ID.BULLROARER) === 0 ? regainRoarer(snap) : null;
        if (roarer) {
            return roarer;
        }
    }

    switch (stage) {
        case LQ_STAGE.NOT_STARTED:
            return stageStart(snap);
        case LQ_STAGE.STARTED:
            return stageMapping(snap);
        case LQ_STAGE.MAPPED_JUNGLE:
        case LQ_STAGE.GOT_BULLROARER:
        case LQ_STAGE.SWUNG_BULLROARER:
            return stageBullroarer(snap);
        case LQ_STAGE.ACCEPTED_RESCUE:
        case LQ_STAGE.FOUND_ENTRANCE:
            return stageCave();
        case LQ_STAGE.SPOKE_UNGADULU:
            return stageWater(snap);
        case LQ_STAGE.ASKED_GUJUO_WATER:
            return stageBowl(snap);
        case LQ_STAGE.FILLED_BOWL:
        case LQ_STAGE.SUMMONED_NEZI_FIRE:
            return stageBook(snap);
        case LQ_STAGE.DEFEATED_NEZI_FIRE:
            return stageSeeds(snap);
        case LQ_STAGE.GERMINATED_SEEDS:
            // Why: the pool is a jungle loc and `cutReed` walks in on its own, so wrapping this in an escape sends the run out through the band and back for nothing.
            return step('find the sacred pool fouled', findPoolDried);
        case LQ_STAGE.POOL_DRIED:
            return step('ask Gujuo for the bravery potion recipe', askForRecipe);
        case LQ_STAGE.TALK_GUJUO_POOL:
            return stagePotion(snap);
        case LQ_STAGE.ENTER_LOWER_DUNGEON:
            return stageCrystal(snap);
        case LQ_STAGE.CRYSTAL_SMELTED:
            return stageRecess(snap);
        case LQ_STAGE.HEART_IN_RECESS:
            return viyeldiStep(snap, 'cross the barrier and rouse the spirit', crossAndRouse);
        case LQ_STAGE.PUSHED_BOULDER:
        case LQ_STAGE.RECEIVED_DAGGER:
            return stageSpirit(snap);
        case LQ_STAGE.DEFEATED_NEZI_WATER:
            return stageSacredWater(snap);
        case LQ_STAGE.SACRED_WATER:
            return stageGrow(snap);
        case LQ_STAGE.COLLECTED_TOTEM:
        case LQ_STAGE.SPAWNED_NEZI_FINAL:
        case LQ_STAGE.DEFEATED_NEZI_FINAL:
        case LQ_STAGE.REPLACED_TOTEM:
        case LQ_STAGE.GOT_GILDED_TOTEM:
            return stageReplace(snap);
        case LQ_STAGE.RETURNED_TO_RADIMUS:
        case LQ_STAGE.TRAINING_1:
        case LQ_STAGE.TRAINING_2:
        case LQ_STAGE.TRAINING_3:
        case LQ_STAGE.TRAINING_4:
            return inTheOpen(snap, step("take Radimus' four training sessions", takeTraining));
        default:
            return { kind: 'wait', reason: `Legends Quest stage ${stage} is not implemented` };
    }
}

async function crossAndRouse(log: (m: string) => void): Promise<boolean> {
    if (!(await crossBarrier(log))) {
        return false;
    }
    return takeBlackDagger(log);
}

export const legends: QuestModule = {
    record: QUESTS.find(record => record.id === 'legends')!,
    bank: LEG_BANK.karamja,
    ownsInventory: true,
    coinFloat: 0,
    readProgress: readLegendsProgress,
    sustain: { foods: [...LQ_FOODS], eatBelowHp: 0.6 },
    warnReadiness: warnLegendsReadiness,
    decide
};

export { enterGuild, enterJungle, deposit };
