import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { EventSignal } from '../../../execution/EventSignal.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { foodForms } from '../../../combat/food.js';
import Tile from '../../../../geometry/Tile.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Equipment } from '../../../equipment/Equipment.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Skills } from '../../../skills/Skills.js';
import { GroundItems } from '../../../grounditems/GroundItems.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Reachability } from '../../../../event/webwalk/geometry/Reachability.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Traversal } from '../../../walking/Traversal.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { earnQuestCoinsStep } from '../exec/fundCoins.js';
import { QuestFood } from '../food.js';

// Why: the journal collapses the hidden transport stages 19..26 and reward choices 27..29, so the world and inventory probes below resolve those ranges.

// Stages the client can see.
export const TOURIST_TRAP_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    APPROACHED_CAPTAIN: 3,
    KILLED_CAPTAIN: 4,
    ENTERED_CAMP: 5,
    SPOKEN_SLAVE: 6,
    FREED_SLAVE: 7,
    TRADED_CLOTHES: 8,
    ENTERED_MINE: 9,
    FINDING_PINEAPPLE: 10,
    BEDABIN_KEY: 11,
    RETRIEVED_PLANS: 12,
    SHOWN_PLANS: 13,
    MADE_DART_TIP: 14,
    FINISHED_DART: 15,
    LEARNED_DARTS: 16,
    GIVEN_PINEAPPLE: 17,
    USED_MINE_CART: 18,
    RESCUE: 19,
    REWARD: 27,
    COMPLETE: 30
} as const;

function journalText(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

export function parseTouristTrapJournal(lines: readonly string[] | string): number | undefined {
    const text = journalText(lines);

    // The journal is cumulative, so test the newest milestone first.
    if (text.includes('quest complete!')) return TOURIST_TRAP_STAGE.COMPLETE;
    if (text.includes('talk to irena') && text.includes('for my reward')) return TOURIST_TRAP_STAGE.REWARD;
    if (text.includes('get ana') && text.includes('her barrel') && text.includes('out of this mine camp')) {
        return TOURIST_TRAP_STAGE.RESCUE;
    }
    if (text.includes('find some way of getting ana out')) return TOURIST_TRAP_STAGE.USED_MINE_CART;
    if (text.includes('i am sure ana is down here')) return TOURIST_TRAP_STAGE.GIVEN_PINEAPPLE;
    if (text.includes('now i have a pineapple') || (text.includes('misplaced it') && text.includes('another one'))) {
        return TOURIST_TRAP_STAGE.LEARNED_DARTS;
    }
    if (text.includes('made a prototype dart')) return TOURIST_TRAP_STAGE.FINISHED_DART;
    if (text.includes('made the prototype dart tip')) return TOURIST_TRAP_STAGE.MADE_DART_TIP;
    if (text.includes('if i make him a') && text.includes('prototype')) return TOURIST_TRAP_STAGE.SHOWN_PLANS;
    if (text.includes('captain siad') && text.includes('stolen the plans')) return TOURIST_TRAP_STAGE.RETRIEVED_PLANS;
    if (text.includes('if i can steal the') && text.includes('plans')) return TOURIST_TRAP_STAGE.BEDABIN_KEY;
    if (text.includes("get the mine guard a 'tenti' pineapple")) return TOURIST_TRAP_STAGE.FINDING_PINEAPPLE;
    if (text.includes('head deeper into the mine')) return TOURIST_TRAP_STAGE.ENTERED_MINE;
    if (text.includes('head into the mine') && text.includes('look for ana')) return TOURIST_TRAP_STAGE.TRADED_CLOTHES;
    if (text.includes('trade my desert robes')) return TOURIST_TRAP_STAGE.FREED_SLAVE;
    if (text.includes('undo the locks on the slave')) return TOURIST_TRAP_STAGE.SPOKEN_SLAVE;
    if (text.includes('look around this desert mining camp')) return TOURIST_TRAP_STAGE.ENTERED_CAMP;
    if (text.includes('inside a desert mining camp')) return TOURIST_TRAP_STAGE.KILLED_CAPTAIN;
    if (text.includes('feeling ana must be around here')) return TOURIST_TRAP_STAGE.APPROACHED_CAPTAIN;
    if (text.includes('head into the desert') && text.includes('search for ana')) return TOURIST_TRAP_STAGE.STARTED;
    if (text.includes('start this quest by speaking to irena')) return TOURIST_TRAP_STAGE.NOT_STARTED;
    return undefined;
}

async function readTouristTrapStage(): Promise<number | undefined> {
    // The 2004 journal calls it "Tourist Trap"; some quest-list revisions add "The".
    const names = ['The Tourist Trap', 'Tourist Trap'];
    const statuses = names.map(name => ({ name, status: Quests.status(name) }));
    if (statuses.some(entry => entry.status === 'complete')) return TOURIST_TRAP_STAGE.COMPLETE;
    if (statuses.some(entry => entry.status === 'notStarted')) return TOURIST_TRAP_STAGE.NOT_STARTED;
    const active = statuses.find(entry => entry.status === 'inProgress');
    if (!active) return undefined;

    const lines = await Quests.journal(active.name);
    const stage = parseTouristTrapJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

type TouristTrapArea =
    | 'surfaceJail'
    | 'undergroundJail'
    | 'campUpper'
    | 'campSurface'
    | 'mineDeep'
    | 'mineLower'
    | 'mineEntrance'
    | 'bedabinTent'
    | 'bedabin'
    | 'irena'
    | 'shantayNorth'
    | 'desert'
    | 'mainland'
    | 'unknown';

export function touristTrapArea(tile: QuestSnapshot['tile']): TouristTrapArea {
    if (!tile) return 'unknown';

    // The cells sit inside the camp/mine rectangles, so test them first.
    const inSurfaceCell = tile.level === 0 && tile.x >= 3284 && tile.x <= 3286 && tile.z >= 3032 && tile.z <= 3036;
    const escapeTiles = new Set(['3283,3032', '3282,3037', '3279,3038', '3277,3039', '3275,3040']);
    const onSurfaceEscapeRocks = tile.level === 0 && escapeTiles.has(`${tile.x},${tile.z}`);
    if (inSurfaceCell || onSurfaceEscapeRocks) {
        return 'surfaceJail';
    }
    if (tile.x >= 3274 && tile.x <= 3306 && tile.z >= 3011 && tile.z <= 3043) {
        return tile.level === 1 ? 'campUpper' : 'campSurface';
    }
    if (tile.level === 0 && tile.x >= 3264 && tile.x <= 3327 && tile.z >= 9408 && tile.z <= 9471) {
        // Order checked against every walkable tile in m51_147; the cave wall, punishment gate and cart each split adjacent coordinates.
        if (tile.x <= 3282) return 'mineEntrance';
        if (tile.x >= 3285 && tile.x <= 3292 && tile.z >= 9429 && tile.z <= 9452) return 'undergroundJail';
        if (tile.x >= 3315 || tile.z >= 9428) return 'mineDeep';
        return 'mineLower';
    }
    if (tile.level === 0 && tile.x >= 3167 && tile.x <= 3176 && tile.z >= 3046 && tile.z <= 3052) {
        return 'bedabinTent';
    }
    if (tile.level === 0 && tile.x >= 3150 && tile.x <= 3200 && tile.z >= 2990 && tile.z <= 3070) {
        return 'bedabin';
    }
    if (tile.level === 0 && tile.x >= 3300 && tile.x <= 3314 && tile.z >= 3109 && tile.z <= 3116) {
        return 'irena';
    }
    if (tile.level === 0 && tile.x >= 3288 && tile.x <= 3320 && tile.z >= 3117 && tile.z <= 3140) {
        return 'shantayNorth';
    }
    if (tile.level === 0 && tile.z < 3117) return 'desert';
    if (tile.level === 0) return 'mainland';
    return 'unknown';
}

const DRAYNOR_BANK = new Tile(3093, 3243, 0);
const BOB_AXES = { npc: 'Bob', anchor: new Tile(3232, 3203, 0) };
const KEBAB_SELLER = new Tile(3272, 3182, 0);
const SHANTAY_SHOP = { npc: 'Shantay', anchor: new Tile(3304, 3123, 0) };
const SHANTAY_PASS = new Tile(3302, 3116, 0);
const SHANTAY_NORTH_APPROACH = new Tile(3302, 3118, 0);
const SHANTAY_SOUTH_APPROACH = new Tile(3302, 3114, 0);
const IRENA = new Tile(3303, 3113, 0);
const CAPTAIN = new Tile(3270, 3029, 0);
const CAMP_GATE = new Tile(3273, 3029, 0);
const SLAVE = new Tile(3302, 3016, 0);
const MINE_ENTRANCE = new Tile(3301, 3036, 0);
// Source reverse-cave landing on the guards' west-mine component. (3279,9420) looks right but is a sealed collision component.
const CAVE_GUARD = new Tile(3278, 9415, 0);
const AL_SHABIM = new Tile(3171, 3025, 0);
// Why: interior tent tiles like (3169,3046) are a sealed collision component (walks from Shantay or Irena stop "unreachable", best about 135), so stand 1 south of the door and Walk-through.
const BEDABIN_TENT_APPROACH = new Tile(3169, 3045, 0);
const EXPERIMENTAL_ANVIL = new Tile(3171, 3048, 0);
const CAMP_LADDER = new Tile(3290, 3036, 0);
const SIAD_BOOKCASE = new Tile(3284, 3032, 1);
const SIAD_DESK = new Tile(3290, 3033, 1);
const SIAD_CHEST = new Tile(3292, 3033, 1);
const LOWER_BARREL = new Tile(3303, 9415, 0);
const LOWER_CART = new Tile(3303, 9417, 0);
const DEEP_CART = new Tile(3318, 9430, 0);
const ROWDY_SLAVE = new Tile(3288, 9446, 0);
const ANA_TILE = new Tile(3302, 9466, 0);
const LIFT_BUCKET = new Tile(3292, 9423, 0);
const CAVE_OUTER_LANDING = new Tile(3278, 9415, 0);
const CAVE_INNER_LANDING = new Tile(3286, 9415, 0);
const MINE_EXIT_DOOR = new Tile(3278, 9426, 0);
const MINE_EXIT_INSIDE_STAND = new Tile(3278, 9427, 0);
// The winch loc's origin (3279,3017) is occupied collision, so approach from the open south-east tile.
const SURFACE_WINCH_APPROACH = new Tile(3280, 3018, 0);
// 3 tiles from the quest's upper barrel at (3278,3017) only; the decorative full barrel stays outside locAt's filter.
const SURFACE_BARREL_APPROACH = new Tile(3281, 3017, 0);
// The cart's origin (3287,3023) is inside its 2x3 footprint; the west edge keeps the driver at (3287,3022) within the dialogue leash.
const SURFACE_CART_APPROACH = new Tile(3286, 3023, 0);
const SURFACE_JAIL = new Tile(3285, 3034, 0);
const UNDERGROUND_JAIL = new Tile(3288, 9437, 0);

const NPC = {
    ANA: 822,
    SLAVE: 825,
    ESCAPED_SLAVE: 826,
    ROWDY_SLAVE: 827,
    CAPTAIN: 830,
    SIAD: 831,
    AL_SHABIM: 832,
    BEDABIN_GUARD: 834,
    IRENA: 835,
    SHANTAY: 836,
    MINE_CART_DRIVER: 841
} as const;

const LOC = {
    SHANTAY_PASS: 4031,
    CAMP_GATE: [2673, 2674],
    SURFACE_MINE_DOOR: [2675, 2676],
    LADDER_UP: 1747,
    LADDER_DOWN: 1746,
    BOOKCASE: 2678,
    SIAD_DESK: 2679,
    CHEST: 2677,
    ANVIL: 2672,
    BEDABIN_TENT_DOOR: 2700,
    UNDERGROUND_MINE_DOOR: [2690, 2691],
    MINE_CAVE: [2698, 2699],
    EMPTY_BARREL: 2681,
    MINE_CART: 2684,
    LIFT_BUCKET: 2668,
    SURFACE_WINCH: 2667,
    FULL_BARREL: 2680,
    SURFACE_CART: 2682,
    WINDOW: 2683,
    PUNISHMENT_GATE: [2685, 2686],
    PUNISHMENT_ROCK: 2704
} as const;

const PUNISHMENT_ROCK_ID = 1855;

const ITEM = {
    COINS: 'Coins',
    PICKAXE: 'Bronze pickaxe',
    KEBAB: 'Kebab',
    DESERT_SHIRT: 'Desert shirt',
    DESERT_ROBE: 'Desert robe',
    DESERT_BOOTS: 'Desert boots',
    SLAVE_SHIRT: "Slaves' shirt",
    SLAVE_ROBE: 'Slave robe',
    SLAVE_BOOTS: 'Slave boots',
    WATERSKIN: 'Waterskin(4)',
    BAR: 'Bronze bar',
    FEATHER: 'Feather',
    HAMMER: 'Hammer',
    PASS: 'Shantay pass',
    DISCLAIMER: 'Shantay disclaimer',
    METAL_KEY: 'Metal key',
    CELL_KEY: 'Cell door key',
    BEDABIN_KEY: 'Bedobin key',
    PLANS: 'Technical plans',
    DART_TIP: 'Prototype dart tip',
    DART: 'Prototype dart',
    PINEAPPLE: 'Tenti pineapple',
    BARREL: 'Barrel',
    ANA_BARREL: 'Ana in a barrel',
} as const;

const DESERT_OUTFIT = [ITEM.DESERT_SHIRT, ITEM.DESERT_ROBE, ITEM.DESERT_BOOTS] as const;
const SLAVE_OUTFIT = [ITEM.SLAVE_SHIRT, ITEM.SLAVE_ROBE, ITEM.SLAVE_BOOTS] as const;
const SLAVE_OUTFIT_DROP_IDS = [1844, 1845, 1846] as const;
const WATERSKINS = ['Waterskin(4)', 'Waterskin(3)', 'Waterskin(2)', 'Waterskin(1)', 'Waterskin(0)'] as const;
const FOOD_ENTRY_TARGET = 16;
const FOOD_ENTRY_FLOOR = 12;
const FOOD_RESTOCK_FLOOR = 4;
const WATER_ENTRY_DOSES = 16;
const WATER_ENTRY_FLOOR = 12;
const WATER_RESTOCK_FLOOR = 8;
const RESCUE_COIN_FLOOR = 100;
const RESCUE_COIN_TARGET = 200;

const IRENA_START = [
    "What's the matter?",
    'Is there a reward if I get her back?',
    "Okay Irena, calm down. I'll get your daughter back for you."
];
const CAPTAIN_DUEL = [
    'Wow! A real captain!',
    "I'd love to work for a tough guy like you!",
    "Can't I do something for a strong Captain like you?",
    "Sorry Sir, I don't think I can do that.",
    "It's a funny captain who can't fight his own battles!"
];
const SLAVE_INTRO = [
    "I've just arrived.",
    'Oh yes, that sounds interesting.',
    "What's that then?",
    'I can try to undo them for you.'
];
const SLAVE_LOCK = ["It's funny you should say that...", "Yeah, okay, let's give it a go.", "Yeah I'll give it another go."];
const SLAVE_TRADE = ["It's funny you should say that...", "Yes, I'll trade."];
const CAVE_GUARD_DIALOG = [
    "I'd like to mine in a different area.",
    "Yes sir, you're quite right sir.",
    'Yes sir, we understand each other perfectly.'
];
const AL_PINEAPPLE = ['I am looking for a pineapple.', "Yes, I'm interested."];
const SIAD_DISTRACTION = [
    'I wanted to have a chat?',
    'You seem to have a lot of books!',
    "So, you're interested in sailing?",
    'I could tell by the cut of your jib.'
];
const AL_PLANS = ["Yes, I'm very interested.", "Yes, I'm kind of curious."];
const ANVIL_DIALOG = ["Yes, I'd like to try."];
const LIFT_GUARD_DIALOG = ['Yes please.', 'I said you were very gregarious!'];
const DRIVER_DIALOG = [
    'Nice cart.',
    "One wagon wheel says to the other, 'I'll see you around'.",
    "'One good turn deserves another'",
    'Fired... no, shot perhaps!',
    'In for a penny in for a pound.',
    "Well, you see, it's like this...",
    "There's ten gold in it for you if you leave now - no questions asked.",
    'A hundred it is!'
];
const DRIVER_NO_COIN_DIALOG = [
    ...DRIVER_DIALOG.slice(0, 6),
    'Prison riot in ten minutes, get your cart out of here!',
    "You can't leave me here, I'll get killed!"
];

function normalizeChoice(text: string): string {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function strictTouristTrapChoice(options: readonly string[], prefer: readonly string[]): string | null {
    const allowed = new Set(prefer.map(normalizeChoice));
    return options.find(option => allowed.has(normalizeChoice(option))) ?? null;
}

/** Strict quest-local dialogue driver; it never guesses when a menu changes. */
async function driveStrictDialog(
    prefer: readonly string[],
    log: (m: string) => void,
    until?: () => boolean
): Promise<boolean> {
    let reachedUntil = false;
    for (let i = 0; i < 140; i++) {
        if (EventSignal.pending()) return false;
        if (until?.()) reachedUntil = true;
        if (ChatDialog.canContinue()) {
            if (!(await ChatDialog.continue())) return false;
            await Execution.delayTicks(1);
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const selected = strictTouristTrapChoice(options, prefer);
            if (!selected) {
                log(`Tourist Trap dialogue stopped: unrecognized options [${options.join(' | ')}]`);
                return false;
            }
            if (!(await ChatDialog.chooseOption(selected))) return false;
            await Execution.delayTicks(1);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            if (!until || reachedUntil) return true;
            // Some source conversations close the modal for a few ticks mid-flow; the until predicate tells that gap from completion.
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    log('Tourist Trap dialogue exceeded its bounded step count');
    return false;
}

async function drainInteractionDialog(
    prefer: readonly string[],
    log: (m: string) => void,
    until?: () => boolean
): Promise<boolean> {
    const started = await Execution.delayUntil(
        () => ChatDialog.isOpen() || ChatDialog.canContinue() || until?.() === true,
        prefer.length > 0 || until ? 8000 : 1500
    );
    if (!started) {
        await Execution.delayTicks(2);
        return until ? until() : prefer.length === 0;
    }
    if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) return until?.() === true;
    return driveStrictDialog(prefer, log, until);
}

function dialogMatches(pattern: RegExp): boolean {
    return ChatDialog.texts().some(text => pattern.test(text));
}

function talkAction(actionsList: string[]): string | null {
    return actionsList.find(action => /^talk/i.test(action)) ?? null;
}

async function walk(anchor: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && here.level === anchor.level && anchor.distanceTo(here) <= radius) return true;
    return Traversal.walkResilient(anchor, { radius, attempts: 4, timeoutMs: 180_000, log });
}

async function talkStrict(
    npcId: number | readonly number[],
    anchor: Tile,
    prefer: readonly string[],
    log: (m: string) => void,
    leash = 8,
    until?: () => boolean
): Promise<boolean> {
    const npcIds = typeof npcId === 'number' ? [npcId] : npcId;
    if (!ChatDialog.isOpen()) {
        if (!(await walk(anchor, Math.min(3, leash), log))) return false;
        const npc = Npcs.query()
            .where(candidate => npcIds.includes(candidate.id) && talkAction(candidate.actions()) !== null)
            .within(leash)
            .nearest();
        if (!npc) {
            log(`no Tourist Trap NPC [${npcIds.join(',')}] available near (${anchor.x},${anchor.z})`);
            return false;
        }
        if (!(await npc.interact(talkAction(npc.actions())!))) return false;
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) return false;
    }
    return driveStrictDialog(prefer, log, until);
}

function locAt(ids: readonly number[], op: string, anchor: Tile, radius = 8) {
    return Locs.query()
        .where(loc => ids.includes(loc.id) && loc.tile().distanceTo(anchor) <= 3)
        .action(op)
        .within(radius)
        .nearest();
}

async function interactLoc(
    ids: readonly number[],
    op: string,
    anchor: Tile,
    log: (m: string) => void,
    prefer: readonly string[] = [],
    until?: () => boolean
): Promise<boolean> {
    if (!(await walk(anchor, 3, log))) return false;
    // The walk may take a transport edge on the way, so check the postcondition before looking for a loc that's now in the previous scene.
    if (until?.()) return true;
    const loc = locAt(ids, op, anchor, 10);
    if (!loc) {
        log(`no Tourist Trap loc [${ids.join(',')}] offering '${op}' near (${anchor.x},${anchor.z})`);
        return false;
    }
    if (!(await loc.interact(op))) return false;
    return drainInteractionDialog(prefer, log, until);
}

async function useItemOnLoc(
    itemName: string,
    ids: readonly number[],
    anchor: Tile,
    log: (m: string) => void,
    prefer: readonly string[] = [],
    until?: () => boolean
): Promise<boolean> {
    if (!(await walk(anchor, 3, log))) return false;
    const item = Inventory.first(itemName);
    const loc = Locs.query().where(candidate => ids.includes(candidate.id) && candidate.tile().distanceTo(anchor) <= 3).within(10).nearest();
    if (!item || !loc) {
        log(`cannot use '${itemName}' on Tourist Trap loc [${ids.join(',')}]`);
        return false;
    }
    if (!(await item.useOn(loc))) return false;
    return drainInteractionDialog(prefer, log, until);
}

async function useItemOnNpc(
    itemName: string,
    npcId: number,
    anchor: Tile,
    log: (m: string) => void,
    prefer: readonly string[] = [],
    until?: () => boolean
): Promise<boolean> {
    if (!(await walk(anchor, 4, log))) return false;
    const item = Inventory.first(itemName);
    const npc = Npcs.query().where(candidate => candidate.id === npcId).within(10).nearest();
    if (!item || !npc) return false;
    if (!(await item.useOn(npc))) return false;
    return drainInteractionDialog(prefer, log, until);
}

const lower = (name: string): string => name.toLowerCase();
const heldCount = (snap: QuestSnapshot, name: string): number => snap.inv.get(lower(name)) ?? 0;
const held = (snap: QuestSnapshot, name: string): boolean => heldCount(snap, name) > 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(lower(name));
const ownedNow = (snap: QuestSnapshot, name: string): number => heldCount(snap, name) + (worn(snap, name) ? 1 : 0);
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(lower(name)) ?? 0;

function waterskinContainers(snap: QuestSnapshot): number {
    return WATERSKINS.reduce((sum, name) => sum + heldCount(snap, name), 0);
}

export function waterskinDoses(snap: QuestSnapshot): number {
    return WATERSKINS.slice(0, 4).reduce(
        (sum, name, index) => sum + heldCount(snap, name) * (4 - index),
        0
    );
}

function configuredFoodName(): string | null {
    const name = QuestFood.name?.trim();
    return name ? name : null;
}

function configuredFoodForms(): string[] {
    const name = configuredFoodName();
    return name ? foodForms(name) : [];
}

function configuredFoodCount(snap: QuestSnapshot): number {
    return configuredFoodForms().reduce((sum, name) => sum + heldCount(snap, name), 0);
}

function bankedConfiguredFoodCount(snap: QuestSnapshot): number {
    return configuredFoodForms().reduce((sum, name) => sum + banked(snap, name), 0);
}

function hasOutfit(snap: QuestSnapshot, outfit: readonly string[]): boolean {
    return outfit.every(item => ownedNow(snap, item) > 0);
}

function outfitCopies(snap: QuestSnapshot, outfit: readonly string[]): number {
    return Math.min(...outfit.map(item => ownedNow(snap, item)));
}

function bankStep(items: { name: string; qty: number }[]): QuestStep {
    // Nearest bank; mid-desert recovery shouldn't walk from Al Kharid to Draynor.
    return { kind: 'withdraw', items };
}

function scanBank(): QuestStep {
    return { kind: 'scanBank' };
}

function preparationKeep(): string[] {
    return [
        ITEM.COINS,
        ITEM.PICKAXE,
        ITEM.KEBAB,
        ...configuredFoodForms(),
        ...DESERT_OUTFIT,
        ...SLAVE_OUTFIT,
        ...WATERSKINS,
        ITEM.BAR,
        ITEM.FEATHER,
        ITEM.HAMMER,
        ITEM.PASS,
        ITEM.DISCLAIMER,
        ITEM.METAL_KEY,
        ITEM.BEDABIN_KEY,
        ITEM.PLANS,
        ITEM.DART_TIP,
        ITEM.DART,
        ITEM.PINEAPPLE,
        ITEM.BARREL,
        ITEM.ANA_BARREL
    ].map(lower);
}

function rescueKeep(): string[] {
    return [
        ITEM.COINS,
        ITEM.PICKAXE,
        ITEM.KEBAB,
        ...configuredFoodForms(),
        ...DESERT_OUTFIT,
        ...SLAVE_OUTFIT,
        ...WATERSKINS,
        ITEM.PASS,
        ITEM.DISCLAIMER,
        ITEM.METAL_KEY,
        ITEM.PINEAPPLE,
        ITEM.BARREL,
        ITEM.ANA_BARREL
    ].map(lower);
}

function hasPreparationSpillover(snap: QuestSnapshot): boolean {
    const keep = preparationKeep();
    return [...snap.inv.keys()].some(name => !keep.includes(name));
}

function makePreparationSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) return null;
    if (hasPreparationSpillover(snap)) {
        return { kind: 'deposit', keep: preparationKeep(), exactKeep: true };
    }
    return { kind: 'wait', reason: `need ${slots} free inventory slot${slots === 1 ? '' : 's'} for the Tourist Trap loadout` };
}

function makeRescueSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) return null;
    const keep = rescueKeep();
    if ([...snap.inv.keys()].some(name => !keep.includes(name))) {
        return { kind: 'deposit', keep, exactKeep: true };
    }
    return { kind: 'wait', reason: `need ${slots} free inventory slot${slots === 1 ? '' : 's'} for Tourist Trap survival supplies` };
}

interface PrepTarget {
    name: string;
    qty: number;
    shop?: { npc: string; anchor: Tile };
    estGp?: number;
}

const SHANTAY_TARGETS: readonly PrepTarget[] = [
    { name: ITEM.DESERT_SHIRT, qty: 1, shop: SHANTAY_SHOP, estGp: 45 },
    { name: ITEM.DESERT_ROBE, qty: 1, shop: SHANTAY_SHOP, estGp: 45 },
    { name: ITEM.DESERT_BOOTS, qty: 1, shop: SHANTAY_SHOP, estGp: 25 },
    { name: ITEM.WATERSKIN, qty: 4, shop: SHANTAY_SHOP, estGp: 35 },
    { name: ITEM.PASS, qty: 1, shop: SHANTAY_SHOP, estGp: 6 },
    { name: ITEM.BAR, qty: 3, shop: SHANTAY_SHOP, estGp: 8 },
    { name: ITEM.FEATHER, qty: 10, shop: SHANTAY_SHOP, estGp: 2 },
    { name: ITEM.HAMMER, qty: 1, shop: SHANTAY_SHOP, estGp: 13 }
];

const INITIAL_SHANTAY_TARGETS = SHANTAY_TARGETS.filter(target =>
    target.name !== ITEM.BAR && target.name !== ITEM.FEATHER && target.name !== ITEM.HAMMER
);

function withdrawBankedShortage(snap: QuestSnapshot, name: string, target: number): QuestStep | null {
    const missing = target - ownedNow(snap, name);
    const available = banked(snap, name);
    if (missing <= 0 || available <= 0) return null;
    const qty = Math.min(missing, available);
    const stackable = name === ITEM.COINS || name === ITEM.FEATHER || name === ITEM.PASS;
    const slots = stackable && heldCount(snap, name) === 0 ? 1 : stackable ? 0 : qty;
    return makePreparationSpace(snap, slots) ?? bankStep([{ name, qty }]);
}

async function buyKebabs(target: number, log: (m: string) => void): Promise<boolean> {
    if (EventSignal.pending()) return false;
    if (!(await walk(KEBAB_SELLER, 2, log))) return false;
    while (Inventory.count(ITEM.KEBAB) < target) {
        if (EventSignal.pending()) return false;
        if (Inventory.count(ITEM.COINS) < 1 || Inventory.isFull()) return false;
        const before = Inventory.count(ITEM.KEBAB);
        // The Kebab seller has no shop interface, only this dialogue.
        const seller = Npcs.query().name('Kebab seller').within(8).nearest();
        if (!seller) return false;
        const op = talkAction(seller.actions());
        if (!op || !(await seller.interact(op))) return false;
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) return false;
        if (!(await driveStrictDialog(['Yes please.'], log))) return false;
        if (EventSignal.pending()) return false;
        if (!(await Execution.delayUntil(() => Inventory.count(ITEM.KEBAB) > before, 5000))) return false;
    }
    return true;
}

function configuredFoodWithdrawal(
    snap: QuestSnapshot,
    minimum: number,
    target: number,
    space: (snap: QuestSnapshot, slots: number) => QuestStep | null
): QuestStep | null {
    const name = configuredFoodName();
    if (!name) return null;
    const carried = configuredFoodCount(snap);
    if (carried >= minimum) return null;
    if (!snap.bankKnown) return scanBank();

    const bankedFood = bankedConfiguredFoodCount(snap);
    if (carried + bankedFood < target) {
        return {
            kind: 'wait',
            reason: `configured Tourist Trap food '${name}' unavailable: need ${target}, carried ${carried}, banked ${bankedFood}`
        };
    }

    let missing = target - carried;
    const items: { name: string; qty: number }[] = [];
    for (const form of configuredFoodForms()) {
        const qty = Math.min(missing, banked(snap, form));
        if (qty <= 0) continue;
        items.push({ name: form === name.toLowerCase() ? name : form, qty });
        missing -= qty;
        if (missing === 0) break;
    }
    return space(snap, target - carried) ?? bankStep(items);
}

function preparationAcquisitionStep(snap: QuestSnapshot): QuestStep | null {
    if (!snap.bankKnown) return scanBank();
    if (hasPreparationSpillover(snap)) {
        return { kind: 'deposit', keep: preparationKeep(), exactKeep: true };
    }

    const alreadySouth = ['irena', 'desert', 'bedabin'].includes(touristTrapArea(snap.tile));

    // One funding step covers every purchase and the driver's bribe.
    if (!alreadySouth && heldCount(snap, ITEM.COINS) < 1000) {
        const coins = withdrawBankedShortage(snap, ITEM.COINS, 1000);
        if (coins) return coins;
        return earnQuestCoinsStep(1000, 'Tourist Trap');
    }

    if (ownedNow(snap, ITEM.PICKAXE) < 1) {
        const bankPick = withdrawBankedShortage(snap, ITEM.PICKAXE, 1);
        if (bankPick) return bankPick;
        const space = makePreparationSpace(snap, 1);
        return space ?? { kind: 'buy', item: ITEM.PICKAXE, qty: 1, shop: BOB_AXES, estGp: 2 };
    }

    const selectedFood = configuredFoodName();
    if (selectedFood) {
        const food = configuredFoodWithdrawal(
            snap,
            FOOD_ENTRY_TARGET,
            FOOD_ENTRY_TARGET,
            makePreparationSpace
        );
        if (food) return food;
    } else {
        const ration = sourceKebabs(snap, FOOD_ENTRY_TARGET);
        if (ration) return ration;
    }

    for (const target of INITIAL_SHANTAY_TARGETS) {
        // Crossing south consumes the pass; buying another from the desert would route you back north and the quest would never start.
        if (target.name === ITEM.PASS && alreadySouth) {
            continue;
        }
        if (target.name === ITEM.WATERSKIN) {
            const water = sourceWaterDoses(snap, WATER_ENTRY_DOSES, WATER_ENTRY_DOSES, makePreparationSpace);
            if (water) return water;
            continue;
        }
        const bankItem = withdrawBankedShortage(snap, target.name, target.qty);
        if (bankItem) return bankItem;
        const missing = target.qty - ownedNow(snap, target.name);
        if (missing <= 0) continue;
        const stackable = target.name === ITEM.FEATHER || target.name === ITEM.PASS;
        const slots = stackable && heldCount(snap, target.name) === 0 ? 1 : stackable ? 0 : missing;
        const space = makePreparationSpace(snap, slots);
        if (space) return space;
        return {
            kind: 'buy',
            item: target.name,
            qty: missing,
            shop: target.shop!,
            estGp: target.estGp! * missing
        };
    }
    return null;
}

function preparationStep(snap: QuestSnapshot): QuestStep | null {
    const acquisition = preparationAcquisitionStep(snap);
    return acquisition ? (routeNorth(snap) ?? acquisition) : null;
}

async function ensureEquipment(required: readonly string[], allowed: readonly string[], log: (m: string) => void): Promise<boolean> {
    // Equip first: a same-slot swap is atomic and needs no spare pack slot for the old garment.
    for (const item of required) {
        if (!Equipment.contains(item) && !(await Equipment.equip(item))) {
            log(`could not equip required Tourist Trap item '${item}'`);
            return false;
        }
    }
    const permitted = new Set(allowed.map(lower));
    for (const item of Equipment.items()) {
        if (item.name && !permitted.has(lower(item.name)) && !(await Equipment.unequip(item.name))) {
            log(`could not safely remove '${item.name}' inside the mining camp`);
            return false;
        }
    }
    return required.every(item => Equipment.contains(item));
}

async function wearDesertLoadout(log: (m: string) => void): Promise<boolean> {
    return ensureEquipment([...DESERT_OUTFIT, ITEM.PICKAXE], [...DESERT_OUTFIT, ITEM.PICKAXE], log);
}

async function wearDesertOutfitForSpace(log: (m: string) => void): Promise<boolean> {
    return ensureEquipment(DESERT_OUTFIT, [...DESERT_OUTFIT, ITEM.PICKAXE], log);
}

async function wearSlaveLoadout(log: (m: string) => void): Promise<boolean> {
    // A pickaxe is the one weapon the camp equipment search allows.
    return ensureEquipment([...SLAVE_OUTFIT, ITEM.PICKAXE], [...SLAVE_OUTFIT, ITEM.PICKAXE], log);
}

async function wearSlaveDisguiseOnly(log: (m: string) => void): Promise<boolean> {
    return ensureEquipment(SLAVE_OUTFIT, [...SLAVE_OUTFIT, ITEM.PICKAXE], log);
}

async function waitOutCombat(timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (Game.inCombat() && performance.now() < deadline) {
        await Sustain.run();
        if (EventSignal.pending()) return false;
        await Execution.delayTicks(1);
    }
    return !Game.inCombat();
}

async function crossShantayPass(log: (m: string) => void): Promise<boolean> {
    // Why: the pass loc sits south of its own closed collision barrier, so walk to the near side first and then send Go-through.
    if (!(await walk(SHANTAY_NORTH_APPROACH, 1, log))) return false;
    const pass = locAt([LOC.SHANTAY_PASS], 'Go-through', SHANTAY_PASS, 6);
    if (!pass || !(await pass.interact('Go-through'))) return false;
    if (!(await drainInteractionDialog(["Yeah, that poster doesn't scare me!"], log))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && tile.z < 3117;
    }, 10_000);
}

async function crossShantayPassNorth(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(SHANTAY_SOUTH_APPROACH, 1, log))) return false;
    const pass = locAt([LOC.SHANTAY_PASS], 'Go-through', SHANTAY_PASS, 6);
    if (!pass || !(await pass.interact('Go-through'))) return false;
    if (!(await drainInteractionDialog([], log))) return false;
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && tile.z >= 3117;
    }, 10_000);
}

async function startWithIrena(log: (m: string) => void): Promise<boolean> {
    return talkStrict(NPC.IRENA, IRENA, IRENA_START, log);
}

async function challengeCaptain(log: (m: string) => void): Promise<boolean> {
    return talkStrict(NPC.CAPTAIN, CAPTAIN, CAPTAIN_DUEL, log, 10);
}

async function provokeAndDefeatCaptain(log: (m: string) => void): Promise<boolean> {
    // Stage 3 can resume after a restart before combat; the captain refuses a cold Attack and guards may join, so replay the taunt.
    if (!Game.inCombat() && !(await challengeCaptain(log))) return false;
    await Execution.delayUntil(() => Game.inCombat(), 5000);
    if (Game.inCombat()) {
        await waitOutCombat(180_000);
        return Execution.delayUntil(() => Inventory.contains(ITEM.METAL_KEY), 8000);
    }
    log('the Mercenary Captain did not enter the guaranteed duel; retrying the strict provocation');
    return false;
}

async function enterCamp(log: (m: string) => void): Promise<boolean> {
    if (!(await interactLoc(LOC.CAMP_GATE, 'Open', CAMP_GATE, log))) return false;
    return Execution.delayUntil(() => {
        const area = touristTrapArea(Game.tile());
        return area === 'campSurface' || area === 'campUpper';
    }, 10_000);
}

async function leaveCamp(log: (m: string) => void): Promise<boolean> {
    // Why: the outer gate only rejects slave clothing, so swap to the full desert outfit if it survived and otherwise strip the slave disguise before leaving.
    const hasFullDesertOutfit = DESERT_OUTFIT.every(item => Equipment.contains(item) || Inventory.contains(item));
    const safelyDressed = hasFullDesertOutfit
        ? await ensureEquipment(DESERT_OUTFIT, [...DESERT_OUTFIT, ITEM.PICKAXE], log)
        : await ensureEquipment([], [...DESERT_OUTFIT, ITEM.PICKAXE], log);
    if (!safelyDressed) return false;
    if (!(await interactLoc(
        LOC.CAMP_GATE,
        'Open',
        CAMP_GATE,
        log,
        [],
        () => touristTrapArea(Game.tile()) === 'desert'
    ))) return false;
    return Execution.delayUntil(() => touristTrapArea(Game.tile()) === 'desert', 10_000);
}

async function enterMine(log: (m: string) => void): Promise<boolean> {
    // The doors need only the 3 slave garments. A lost pickaxe shouldn't block rescue recovery; the punishment cell spawns its own.
    if (!(await wearSlaveDisguiseOnly(log))) return false;
    if (!(await interactLoc(LOC.SURFACE_MINE_DOOR, 'Open', MINE_ENTRANCE, log))) return false;
    return Execution.delayUntil(() => {
        const area = touristTrapArea(Game.tile());
        return area === 'mineEntrance';
    }, 12_000);
}

async function leaveMine(log: (m: string) => void): Promise<boolean> {
    if (!(await wearSlaveDisguiseOnly(log))) return false;
    if (touristTrapArea(Game.tile()) === 'mineLower' && !(await crossMineCave(false, log))) return false;
    if (touristTrapArea(Game.tile()) !== 'mineEntrance') return false;
    // The loc origin is across the closed door; targeting it makes the walker take the door transport and then chase a stale underground tile from the surface.
    if (!(await walk(MINE_EXIT_INSIDE_STAND, 0, log))) {
        log('could not reach the inside stand for the underground mine exit');
        return false;
    }
    const door = locAt(LOC.UNDERGROUND_MINE_DOOR, 'Open', MINE_EXIT_DOOR, 4);
    if (!door) {
        log('underground mine exit did not expose its Open action from the inside stand');
        return false;
    }
    if (!(await door.interact('Open')) || !(await drainInteractionDialog([], log))) return false;
    return Execution.delayUntil(() => touristTrapArea(Game.tile()) === 'campSurface', 12_000);
}

async function climbCampLadder(up: boolean, log: (m: string) => void): Promise<boolean> {
    const id = up ? LOC.LADDER_UP : LOC.LADDER_DOWN;
    const op = up ? 'Climb-up' : 'Climb-down';
    const anchor = new Tile(CAMP_LADDER.x, CAMP_LADDER.z, up ? 0 : 1);
    if (!(await interactLoc([id], op, anchor, log))) return false;
    return Execution.delayUntil(() => Game.tile()?.level === (up ? 1 : 0), 8000);
}

async function slaveUnlockAndTrade(log: (m: string) => void): Promise<boolean> {
    // Success, retry and the trade are one bounded interaction, so a random lockpick result can't leave a choice menu open between ticks.
    return talkStrict(
        [NPC.SLAVE, NPC.ESCAPED_SLAVE],
        SLAVE,
        [...SLAVE_INTRO, ...SLAVE_LOCK, ...SLAVE_TRADE],
        log,
        10
    );
}

async function replaceLostSlaveOutfit(log: (m: string) => void): Promise<boolean> {
    if (liveHasSlaveOutfit()) return true;
    if (!(await wearDesertLoadout(log))) return false;
    if (!(await walk(SLAVE, 3, log))) return false;

    const slave = Npcs.query()
        .where(candidate => (candidate.id === NPC.SLAVE || candidate.id === NPC.ESCAPED_SLAVE)
            && talkAction(candidate.actions()) !== null)
        .withinOf(SLAVE, 6)
        .nearest();
    if (!slave) {
        log(`slave-outfit recovery: no male slave 825/826 near (${SLAVE.x},${SLAVE.z})`);
        return false;
    }
    const tile = slave.tile();
    log(`slave-outfit recovery: talking to npc=${slave.id} at (${tile.x},${tile.z}); `
        + `missing=${SLAVE_OUTFIT.filter(item => !Inventory.contains(item) && !Equipment.contains(item)).join('|')}`);
    if (!(await slave.interact(talkAction(slave.actions())!))) return false;
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        log('slave-outfit recovery: male-slave dialogue did not open');
        return false;
    }
    if (!(await driveStrictDialog(['Yes, I\'ll trade.'], log))) return false;
    if (await Execution.delayUntil(liveHasSlaveOutfit, 5000)) {
        log('slave-outfit recovery: received the complete shirt, robe, and boots');
        return true;
    }
    log('slave-outfit recovery: dialogue ended without a complete outfit; '
        + `missing=${SLAVE_OUTFIT.filter(item => !Inventory.contains(item) && !Equipment.contains(item)).join('|')}`);
    return false;
}

async function askCaveGuard(log: (m: string) => void): Promise<boolean> {
    const guard = Npcs.query()
        .where(npc => (npc.id === 828 || npc.id === 829) && talkAction(npc.actions()) !== null)
        .inside({ minX: 3274, maxX: 3284, minZ: 9413, maxZ: 9423 })
        .nearest();
    if (!guard) {
        if (!(await walk(CAVE_GUARD, 4, log))) return false;
        return false;
    }
    if (!(await guard.interact(talkAction(guard.actions())!))) return false;
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) return false;
    return driveStrictDialog(CAVE_GUARD_DIALOG, log);
}

async function givePineapple(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(CAVE_GUARD, 4, log))) return false;
    const guard = Npcs.query()
        .where(npc => npc.id === 828 || npc.id === 829)
        .inside({ minX: 3274, maxX: 3284, minZ: 9413, maxZ: 9423 })
        .nearest();
    const pineapple = Inventory.first(ITEM.PINEAPPLE);
    if (!guard || !pineapple || !(await pineapple.useOn(guard))) return false;
    return drainInteractionDialog([], log);
}

async function crossMineCave(toInnerMine: boolean, log: (m: string) => void): Promise<boolean> {
    // Approach from the source landing tile; the cave loc tiles are wall-separated collision slivers and can't be walked to.
    const anchor = toInnerMine ? CAVE_OUTER_LANDING : CAVE_INNER_LANDING;
    const landing = toInnerMine ? CAVE_INNER_LANDING : CAVE_OUTER_LANDING;
    const atLanding = (): boolean => {
        const tile = Game.tile();
        return tile !== null && tile.level === landing.level && landing.distanceTo(tile) <= 1;
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
        if (EventSignal.pending()) return false;
        if (await interactLoc(LOC.MINE_CAVE, 'Walk through', anchor, log, [], atLanding)
            && await Execution.delayUntil(atLanding, 10_000)) return true;
        if (attempt < 3) {
            log(`mine cave transit attempt ${attempt}/3 was interrupted before the exact landing; retrying`);
            await Sustain.run();
            await Execution.delayTicks(1);
        }
    }
    // The mine regions overlap the approach tiles, so only the source landing proves the delayed transport ran.
    log(`mine cave transit did not reach (${landing.x},${landing.z}) after 3 attempts`);
    return false;
}

async function escapeSurfaceJail(log: (m: string) => void): Promise<boolean> {
    const start = Game.tile();
    const stillInCell = start !== null && start.x >= 3284 && start.x <= 3286 && start.z >= 3032 && start.z <= 3036;
    if (stillInCell && !(await interactLoc([LOC.WINDOW], 'Search', SURFACE_JAIL, log, [
        "Yes, I'll bend the bar.",
        "Yes, I'll bend the bar again."
    ]))) return false;

    for (let attempt = 0; attempt < 16; attempt++) {
        const tile = Game.tile();
        if (tile && tile.x < 3274) return true;
        if (!tile) return false;
        const rock = Locs.query()
            .where(loc => [2694, 2695, 2696].includes(loc.id) && loc.tile().x < tile.x)
            .action('Climb-to')
            .within(12)
            .nearest();
        if (rock) {
            if (!(await rock.interact('Climb-to'))) return false;
            const preference = rock.id === 2694 ? ["Yes, I'll give it a try."] : [];
            if (!(await drainInteractionDialog(preference, log))) return false;
            await Execution.delayTicks(1);
            continue;
        }

        // The 4th, westernmost rock is a one-way Climb down.
        const descent = Locs.query()
            .where(loc => loc.id === 2697 && loc.tile().x < tile.x)
            .action('Climb down')
            .within(12)
            .nearest();
        if (!descent || !(await descent.interact('Climb down'))) {
            log('no next outbound surface-jail rock is reachable');
            return false;
        }
        if (!(await drainInteractionDialog([], log))) return false;
        await Execution.delayTicks(1);
    }
    return Game.tile() !== null && Game.tile()!.x < 3274;
}

const JAIL_DROP_ORDER = [
    ITEM.KEBAB,
    'Waterskin(0)',
    'Waterskin(1)',
    'Waterskin(2)',
    'Waterskin(3)',
    'Waterskin(4)',
    ITEM.HAMMER,
    ITEM.BAR,
    ITEM.FEATHER,
    ITEM.PASS,
    ...DESERT_OUTFIT
];

async function dropPunishmentJunkUntil(slots: number, log: (m: string) => void): Promise<boolean> {
    for (const name of JAIL_DROP_ORDER) {
        while (Inventory.free() < slots) {
            const item = Inventory.first(name);
            if (!item) break;
            const beforeFree = Inventory.free();
            if (!(await item.interact('Drop'))) return false;
            if (!(await Execution.delayUntil(() => Inventory.free() > beforeFree, 3000))) return false;
        }
        if (Inventory.free() >= slots) return true;
    }
    log(`cannot safely free ${slots} punishment-mine inventory slots`);
    return false;
}

function punishmentRockCount(): number {
    // Common Rock (968) shares the display name but the gate only takes thpunishrock (1855), so count by id.
    return Inventory.items()
        .filter(item => item.id === PUNISHMENT_ROCK_ID)
        .reduce((sum, item) => sum + item.count, 0);
}

function liveHasSlaveOutfit(): boolean {
    return SLAVE_OUTFIT.every(item => Inventory.contains(item) || Equipment.contains(item));
}

async function recoverSlaveOutfitFromRowdy(log: (m: string) => void): Promise<boolean> {
    if (liveHasSlaveOutfit()) return true;

    // Why: the live Rowdy-slave death script checks the backpack only, so every surviving worn piece goes into the pack first or its shirt, robe, boots sequence repeats a piece.
    const requiredSlots = SLAVE_OUTFIT.filter(item => !Inventory.contains(item)).length;
    if (Inventory.free() < requiredSlots && !(await dropPunishmentJunkUntil(requiredSlots, log))) {
        return false;
    }
    for (const item of SLAVE_OUTFIT) {
        if (Equipment.contains(item) && !(await Equipment.unequip(item))) {
            log(`could not move '${item}' into the backpack for Rowdy-slave recovery`);
            return false;
        }
    }

    Game.setCombatStyle('strength');
    for (let index = 0; index < SLAVE_OUTFIT.length; index++) {
        const name = SLAVE_OUTFIT[index];
        const id = SLAVE_OUTFIT_DROP_IDS[index];
        for (let attempt = 0; attempt < 16 && !Inventory.contains(name); attempt++) {
            const drop = GroundItems.query().where(item => item.id === id).within(30).nearest();
            if (drop) {
                if (!(await drop.interact('Take'))) return false;
                if (!(await Execution.delayUntil(() => Inventory.contains(name), 8000))) return false;
                break;
            }
            if (Game.inCombat()) {
                await waitOutCombat(120_000);
                continue;
            }
            if (!(await walk(ROWDY_SLAVE, 6, log))) return false;
            const rowdy = Npcs.query()
                .where(npc => npc.id === NPC.ROWDY_SLAVE && !npc.inCombat && !npc.targetsAnotherPlayer())
                .action('Attack')
                .within(18)
                .nearest();
            if (!rowdy) {
                await Execution.delayTicks(2);
                continue;
            }
            log(`defeating the Rowdy slave for '${name}'`);
            if (!(await rowdy.interact('Attack'))) return false;
            await Execution.delayUntil(
                () => GroundItems.query().where(item => item.id === id).within(30).nearest() !== null
                    || Game.inCombat()
                    || !rowdy.valid(),
                5000
            );
            await waitOutCombat(120_000);
        }
        if (!Inventory.contains(name)) {
            log(`Rowdy-slave recovery did not produce '${name}'`);
            return false;
        }
    }
    return true;
}

async function freePunishmentRockSlots(log: (m: string) => void): Promise<boolean> {
    const rockSlots = Math.max(0, 15 - punishmentRockCount());
    if (!Equipment.contains(ITEM.PICKAXE) && !Inventory.contains(ITEM.PICKAXE)) {
        if (Inventory.free() < 1 && !(await dropPunishmentJunkUntil(1, log))) return false;
        const spawn = GroundItems.query().name(ITEM.PICKAXE).within(20).nearest();
        if (!spawn || !(await spawn.interact('Take'))) {
            log('no Bronze pickaxe held or available from the punishment-mine spawn');
            return false;
        }
        if (!(await Execution.delayUntil(() => Inventory.contains(ITEM.PICKAXE), 8000))) return false;
    }
    if (!Equipment.contains(ITEM.PICKAXE) && !(await Equipment.equip(ITEM.PICKAXE))) {
        log('could not wield the punishment-mine Bronze pickaxe');
        return false;
    }
    return Inventory.free() >= rockSlots || dropPunishmentJunkUntil(rockSlots, log);
}

async function escapeUndergroundJail(log: (m: string) => void): Promise<boolean> {
    if (!liveHasSlaveOutfit() && !(await recoverSlaveOutfitFromRowdy(log))) return false;
    if (!Equipment.contains(ITEM.PICKAXE)
        || (punishmentRockCount() < 15 && Inventory.free() < 15 - punishmentRockCount())) {
        if (!(await freePunishmentRockSlots(log))) return false;
    }
    while (punishmentRockCount() < 15) {
        const before = punishmentRockCount();
        // Why: identical punishment rocks stand across the closed gate and a distance-only query clicks those forever once the near veins are gone, so stay on a reachable rock and wait for respawns.
        const rock = Locs.query()
            .where(loc => loc.id === LOC.PUNISHMENT_ROCK
                && Reachability.canReach(loc.tile(), { adjacentOk: true }))
            .action('Mine')
            .within(20)
            .nearest();
        if (!rock) {
            if (!(await walk(UNDERGROUND_JAIL, 5, log))) return false;
            await Execution.delayTicks(2);
            continue;
        }
        if (!(await rock.interact('Mine'))) return false;
        if (!(await Execution.delayUntil(() => punishmentRockCount() > before, 20_000))) return false;
    }
    const gate = Locs.query().where(loc => (LOC.PUNISHMENT_GATE as readonly number[]).includes(loc.id)).action('Open').within(20).nearest();
    if (!gate || !(await gate.interact('Open'))) return false;
    if (!(await drainInteractionDialog([], log))) return false;
    return Execution.delayUntil(() => touristTrapArea(Game.tile()) !== 'undergroundJail', 10_000);
}

async function askAlForPineappleDeal(log: (m: string) => void): Promise<boolean> {
    return talkStrict(NPC.AL_SHABIM, AL_SHABIM, AL_PINEAPPLE, log, 10, () => Inventory.contains(ITEM.BEDABIN_KEY));
}

async function askAlForLostKey(log: (m: string) => void): Promise<boolean> {
    return talkStrict(NPC.AL_SHABIM, AL_SHABIM, ["I've lost the key!"], log, 10, () => Inventory.contains(ITEM.BEDABIN_KEY));
}

async function askAlForLostKeyAndPlans(log: (m: string) => void): Promise<boolean> {
    return talkStrict(NPC.AL_SHABIM, AL_SHABIM, ["I've lost the key and the plans!"], log, 10, () => Inventory.contains(ITEM.BEDABIN_KEY));
}

async function askAlForLostPlansAndTip(log: (m: string) => void): Promise<boolean> {
    // At stage 14 this is still the menu label; the plans/tips wording only appears in the player chat after picking it.
    return talkStrict(NPC.AL_SHABIM, AL_SHABIM, ["I've lost the key and the plans!"], log, 10, () => Inventory.contains(ITEM.BEDABIN_KEY));
}

async function recoverPineappleFromAl(log: (m: string) => void): Promise<boolean> {
    return talkStrict(NPC.AL_SHABIM, AL_SHABIM, ['I am looking for a pineapple.'], log, 10, () => Inventory.contains(ITEM.PINEAPPLE));
}

async function stealTechnicalPlans(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.PLANS)) return true;
    if (Game.tile()?.level !== 1 && !(await climbCampLadder(true, log))) return false;
    if (!(await interactLoc([LOC.BOOKCASE], 'Search', SIAD_BOOKCASE, log))) return false;
    if (!(await talkStrict(NPC.SIAD, new Tile(3291, 3032, 1), SIAD_DISTRACTION, log, 8))) return false;

    // The next chest attempt consumes the distraction, so approach from the north and stay out of Siad's line of sight.
    const northOfChest = new Tile(3292, 3034, 1);
    if (!(await walk(northOfChest, 0, log))) return false;
    const chest = locAt([LOC.CHEST], 'Open', SIAD_CHEST, 5);
    if (!chest || !(await chest.interact('Open'))) return false;
    if (!(await drainInteractionDialog([], log))) return false;
    return Execution.delayUntil(() => Inventory.contains(ITEM.PLANS), 8000);
}

async function recoverMiningCampKeys(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.METAL_KEY)) return true;
    if (Game.tile()?.level !== 1 && !(await climbCampLadder(true, log))) return false;
    if (!(await interactLoc([LOC.SIAD_DESK], 'Search', SIAD_DESK, log))) return false;
    return Execution.delayUntil(() => Inventory.contains(ITEM.METAL_KEY), 8000);
}

async function showPlansToAl(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(AL_SHABIM, 4, log))) return false;
    const plans = Inventory.first(ITEM.PLANS);
    const al = Npcs.query().where(npc => npc.id === NPC.AL_SHABIM).within(10).nearest();
    if (!plans || !al || !(await plans.useOn(al))) return false;
    return drainInteractionDialog(AL_PLANS, log);
}

async function enterPrototypeTent(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(BEDABIN_TENT_APPROACH, 3, log))) {
        log('could not reach the Bedabin experimental tent approach (3169,3045)');
        return false;
    }
    const guard = Npcs.query().where(npc => npc.id === NPC.BEDABIN_GUARD).within(8).nearest();
    const plans = Inventory.first(ITEM.PLANS);
    if (!guard || !plans || !(await plans.useOn(guard))) {
        log('could not show the technical plans to the Bedabin guard at the tent');
        return false;
    }
    if (!(await drainInteractionDialog([], log))) return false;
    return Execution.delayUntil(() => touristTrapArea(Game.tile()) === 'bedabinTent', 8000);
}

async function exitPrototypeTent(log: (m: string) => void): Promise<boolean> {
    if (touristTrapArea(Game.tile()) !== 'bedabinTent') return true;
    if (!(await interactLoc([LOC.BEDABIN_TENT_DOOR], 'Walk-through', BEDABIN_TENT_APPROACH, log))) return false;
    return Execution.delayUntil(() => touristTrapArea(Game.tile()) === 'bedabin', 8000);
}

export function forgeBarWastedSince(mark: number): boolean {
    return GameMessages.sawSince(mark, /waste the bronze bar|unlucky accident/i);
}

async function forgePrototypeTip(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.DART_TIP)) return true;
    if (touristTrapArea(Game.tile()) !== 'bedabinTent') {
        if (!(await enterPrototypeTent(log))) return false;
    }
    if (!(await walk(EXPERIMENTAL_ANVIL, 3, log))) return false;
    const bar = Inventory.first(ITEM.BAR);
    const anvil = Locs.query().where(loc => loc.id === LOC.ANVIL).within(8).nearest();
    if (!bar || !anvil) return false;
    // An earlier unlucky line is still in the chatbox; only a message after this bar goes in counts as wasted.
    const forgeMark = GameMessages.mark();
    if (!(await bar.useOn(anvil))) return false;
    if (!(await Execution.delayUntil(
        () => ChatDialog.isOpen() || ChatDialog.canContinue() || Inventory.contains(ITEM.DART_TIP),
        8000
    ))) return false;
    // The source consumes the bar before the success roll, so keep driving the anvil dialogue until the tip exists or the waste line fires.
    const forged = await driveStrictDialog(
        ANVIL_DIALOG,
        log,
        () => Inventory.contains(ITEM.DART_TIP) || forgeBarWastedSince(forgeMark)
    );
    if (Inventory.contains(ITEM.DART_TIP)) return true;
    if (forgeBarWastedSince(forgeMark)) {
        log('forge failed: bronze bar wasted without a dart tip');
        return false;
    }
    return forged;
}

async function fletchPrototypeDart(log: (m: string) => void): Promise<boolean> {
    const feathers = Inventory.first(ITEM.FEATHER);
    const tip = Inventory.first(ITEM.DART_TIP);
    if (!feathers || !tip || Inventory.count(ITEM.FEATHER) < 10) return false;
    if (!(await feathers.useOn(tip))) return false;
    if (!(await drainInteractionDialog([], log))) return false;
    // A failed attempt eats the feathers with no dart, so only the dart proves success; the next pass can buy 10 more.
    return Execution.delayUntil(() => Inventory.contains(ITEM.DART), 12_000);
}

async function givePrototypeToAl(log: (m: string) => void): Promise<boolean> {
    if (!(await exitPrototypeTent(log))) return false;
    if (!(await walk(AL_SHABIM, 4, log))) return false;
    const dart = Inventory.first(ITEM.DART);
    const al = Npcs.query().where(npc => npc.id === NPC.AL_SHABIM).within(10).nearest();
    if (!dart || !al || !(await dart.useOn(al))) return false;
    if (!(await Execution.delayUntil(
        () => ChatDialog.isOpen() || ChatDialog.canContinue() || Inventory.contains(ITEM.PINEAPPLE),
        8000
    ))) return false;
    return driveStrictDialog([], log, () => Inventory.contains(ITEM.PINEAPPLE));
}

async function returnFromDeepMine(log: (m: string) => void): Promise<boolean> {
    if (!(await interactLoc([LOC.MINE_CART], 'Search', DEEP_CART, log, ['Yes, of course.']))) return false;
    return Execution.delayUntil(() => touristTrapArea(Game.tile()) === 'mineLower', 10_000);
}

async function returnToPunishmentMineForOutfit(log: (m: string) => void): Promise<boolean> {
    let area = touristTrapArea(Game.tile());
    if (area === 'mineDeep') {
        // The cart refuses you while carrying Ana, so send her barrel first; the collapsed-stage probe picks her up later.
        if (Inventory.contains(ITEM.ANA_BARREL)) {
            if (!(await useItemOnLoc(ITEM.ANA_BARREL, [LOC.MINE_CART], DEEP_CART, log))) return false;
            if (!(await Execution.delayUntil(() => !Inventory.contains(ITEM.ANA_BARREL), 8000))) return false;
        }
        if (!(await returnFromDeepMine(log))) return false;
        area = touristTrapArea(Game.tile());
    }
    if (area === 'mineLower' && Inventory.contains(ITEM.ANA_BARREL)) {
        // Why: a guard capture deletes Ana's barrel without setting a recovery transport bit, so she goes on the lift first and the collapsed-stage probe fetches her once the disguise is back.
        if (!(await useItemOnLoc(ITEM.ANA_BARREL, [LOC.LIFT_BUCKET], LIFT_BUCKET, log, LIFT_GUARD_DIALOG))) return false;
        if (!(await Execution.delayUntil(() => !Inventory.contains(ITEM.ANA_BARREL), 8000))) return false;
    }
    if (area !== 'mineLower' && area !== 'mineEntrance') return false;

    // Approaching the guarded cave without the full worn disguise triggers the search/capture and puts you beside the Rowdy slave.
    const anchor = area === 'mineLower' ? new Tile(3286, 9415, 0) : new Tile(3281, 9415, 0);
    if (!(await interactLoc(LOC.MINE_CAVE, 'Walk through', anchor, log))) return false;
    // Before the pineapple milestone the search sends you to the surface cell; from stage 17 it's the underground punishment mine.
    return Execution.delayUntil(() => {
        const destination = touristTrapArea(Game.tile());
        return destination === 'surfaceJail' || destination === 'undergroundJail';
    }, 15_000);
}

function safeRecoveryRoute(area: TouristTrapArea): QuestStep | null {
    if (area === 'bedabinTent') {
        return { kind: 'custom', name: 'leave the prototype tent for item recovery', run: exitPrototypeTent };
    }
    if (area === 'campUpper') {
        return { kind: 'custom', name: 'climb down before item recovery', run: log => climbCampLadder(false, log) };
    }
    if (area === 'campSurface') {
        return { kind: 'custom', name: 'leave the camp safely for item recovery', run: leaveCamp };
    }
    if (area === 'mineEntrance' || area === 'mineLower') {
        return { kind: 'custom', name: 'leave the mine for item recovery', run: leaveMine };
    }
    if (area === 'mineDeep') {
        return { kind: 'custom', name: 'ride back to the lower mine for item recovery', run: returnFromDeepMine };
    }
    return null;
}

function criticalSlotKeep(): string[] {
    return [
        ITEM.COINS,
        ITEM.PICKAXE,
        ITEM.KEBAB,
        ...configuredFoodForms(),
        ...WATERSKINS,
        ...DESERT_OUTFIT,
        ...SLAVE_OUTFIT,
        ITEM.METAL_KEY,
        ITEM.BEDABIN_KEY,
        ITEM.PLANS,
        ITEM.DART_TIP,
        ITEM.DART,
        ITEM.PINEAPPLE,
        ITEM.BARREL,
        ITEM.ANA_BARREL
    ].map(lower);
}

function makeCriticalItemSpace(snap: QuestSnapshot, slots = 1): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) return null;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const north = routeNorth(snap);
    if (north) return north;
    const keep = criticalSlotKeep();
    if (![...snap.inv.keys()].some(name => !keep.includes(name))) {
        return { kind: 'wait', reason: `need ${slots} safe inventory slot${slots === 1 ? '' : 's'} for a Tourist Trap quest item` };
    }
    return { kind: 'deposit', keep, exactKeep: true };
}

function recoverCritical(
    snap: QuestSnapshot,
    name: string,
    reacquire: QuestStep
): QuestStep | null {
    if (held(snap, name)) return null;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const space = makeCriticalItemSpace(snap);
    if (space) return space;
    if (!snap.bankKnown || banked(snap, name) > 0) {
        const north = routeNorth(snap);
        if (north) return north;
    }
    if (!snap.bankKnown) return scanBank();
    if (banked(snap, name) > 0) {
        const space = makePreparationSpace(snap, 1);
        return space ?? bankStep([{ name, qty: 1 }]);
    }
    return reacquire;
}

function sourceConsumable(snap: QuestSnapshot, name: string, target: number): QuestStep | null {
    if (heldCount(snap, name) >= target) return null;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const north = routeNorth(snap);
    if (north) return north;
    if (!snap.bankKnown) return scanBank();
    const missing = target - heldCount(snap, name);
    const stackable = name === ITEM.FEATHER;
    const needsSlot = !stackable || heldCount(snap, name) === 0;
    const requiredSlots = needsSlot ? (stackable ? 1 : missing) : 0;
    if (missing > 0 && requiredSlots > 0 && (snap.freeSlots ?? requiredSlots) < requiredSlots) {
        const space = makeCriticalItemSpace(snap, requiredSlots);
        if (space) return space;
    }
    const withdrawal = withdrawBankedShortage(snap, name, target);
    if (withdrawal) return withdrawal;
    const shopTarget = SHANTAY_TARGETS.find(item => item.name === name);
    if (!shopTarget) return { kind: 'wait', reason: `cannot naturally replace '${name}'` };
    const purchaseCost = shopTarget.estGp! * missing;
    const coins = sourceCoins(snap, purchaseCost, `replace ${name}`);
    if (coins) return coins;
    const slots = stackable && heldCount(snap, name) === 0 ? 1 : stackable ? 0 : missing;
    const space = makePreparationSpace(snap, slots);
    return space ?? {
        kind: 'buy',
        item: name,
        qty: missing,
        shop: SHANTAY_SHOP,
        estGp: purchaseCost
    };
}

async function freeOneRescueSlot(log: (m: string) => void): Promise<boolean> {
    if (Inventory.free() >= 1) return true;
    // From stage 17 the prototype is done, so these are surplus. Never drop a key, disguise, rescue barrel, coins or the pickaxe.
    for (const name of ['Waterskin(0)', ITEM.HAMMER, ITEM.BAR, ITEM.FEATHER, ITEM.PASS, ITEM.KEBAB]) {
        const item = Inventory.first(name);
        if (!item) continue;
        const before = Inventory.free();
        if (!(await item.interact('Drop'))) return false;
        if (await Execution.delayUntil(() => Inventory.free() > before, 3000)) return true;
    }
    log('no safe expendable item can be dropped for the rescue barrel checkpoint');
    return false;
}

async function searchLowerBarrel(
    takeOrdinary: boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (Inventory.free() < 1 && !Inventory.contains(ITEM.BARREL) && !Inventory.contains(ITEM.ANA_BARREL)) {
        if (!(await freeOneRescueSlot(log))) return false;
    }
    const preference = takeOrdinary ? ['Yeah, cool!'] : ['No thanks.'];
    const mark = GameMessages.mark();
    const completed = (): boolean => takeOrdinary
        ? Inventory.contains(ITEM.BARREL) || Inventory.contains(ITEM.ANA_BARREL)
        : Inventory.contains(ITEM.ANA_BARREL)
            || GameMessages.sawSince(mark, /decide not to take the barrel/i);
    if (!(await interactLoc([LOC.EMPTY_BARREL], 'Search', LOWER_BARREL, log, preference, completed)) || !completed()) {
        const observed = GameMessages.since(mark).map(message => message.text).join(' | ');
        log(`lower barrel interaction ended without its authoritative result; observed=[${observed}]`);
        return false;
    }
    return true;
}

async function searchSurfaceBarrel(log: (m: string) => void): Promise<boolean> {
    if (!(await walk(SURFACE_BARREL_APPROACH, 3, log))) return false;
    const barrel = locAt([LOC.FULL_BARREL], 'Search', SURFACE_BARREL_APPROACH, 10);
    if (!barrel) {
        log('lift checkpoint: exact top barrel did not expose its Search action');
        return false;
    }
    if (!(await barrel.interact('Search'))) {
        log('lift checkpoint: exact top barrel Search action was not dispatched');
        return false;
    }
    const anaResponse = await Execution.delayUntil(
        () => Inventory.contains(ITEM.ANA_BARREL) || ChatDialog.isOpen() || ChatDialog.canContinue(),
        8000
    );
    if (!anaResponse) {
        // The source sends no message when this barrel has no Ana bit.
        log('lift checkpoint: top barrel contained no Ana response');
        return false;
    }
    if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
        if (!(await driveStrictDialog([], log, () => Inventory.contains(ITEM.ANA_BARREL)))) {
            log('lift checkpoint: top barrel Ana dialogue did not reach the inventory award');
            return false;
        }
    }
    const recovered = await Execution.delayUntil(() => Inventory.contains(ITEM.ANA_BARREL), 3000);
    if (!recovered) log('lift checkpoint: top barrel dialogue ended without returning Ana');
    return recovered;
}

async function rideMineCart(anchor: Tile, log: (m: string) => void): Promise<boolean> {
    await Sustain.run();
    if (EventSignal.pending()) return false;
    const fromLower = anchor.distanceTo(LOWER_CART) <= 1;
    const origin = fromLower ? 'lower mine' : 'deep mine';
    const destination = fromLower ? 'deep mine' : 'lower mine';
    log(`mine-cart attempt: ${origin} -> ${destination}; Agility=${Skills.level('agility')}`);
    if (!(await interactLoc([LOC.MINE_CART], 'Search', anchor, log, ['Yes, of course.']))) {
        log(`mine-cart interaction did not complete at the ${origin}`);
        return false;
    }
    const arrived = await Execution.delayUntil(
        () => touristTrapArea(Game.tile()) === (fromLower ? 'mineDeep' : 'mineLower'),
        12_000
    );
    if (arrived) {
        log(`mine-cart transit reached the ${destination}`);
        return true;
    }

    const area = touristTrapArea(Game.tile());
    if (area === (fromLower ? 'mineLower' : 'mineDeep')) {
        await Sustain.run();
        log(`mine-cart Agility roll failed at the ${origin}; upkeep applied before retry`);
    } else {
        log(`mine-cart transit unresolved; current area=${area}`);
    }
    return false;
}

async function catchAnaInBarrel(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.ANA_BARREL)) return true;
    // Re-catching Ana with stale transport bits adds 2 delayed messages before the catch; her final complaint means every gap was driven.
    const completed = await useItemOnNpc(
        ITEM.BARREL,
        NPC.ANA,
        ANA_TILE,
        log,
        [],
        () => dialogMatches(/manage to squeeze Ana into the barrel|I djont fit in dis bawwel/i)
    );
    return completed && Inventory.contains(ITEM.ANA_BARREL);
}

async function reachAndCatchAna(log: (m: string) => void): Promise<boolean> {
    let area = touristTrapArea(Game.tile());
    log(`deep-mine recapture: starting area=${area}; empty barrel=${Inventory.contains(ITEM.BARREL) ? 'yes' : 'no'}; Ana barrel=${Inventory.contains(ITEM.ANA_BARREL) ? 'yes' : 'no'}`);
    if (area === 'campSurface') {
        if (!(await enterMine(log))) return false;
        area = touristTrapArea(Game.tile());
    }
    if (area === 'mineEntrance') {
        if (!(await crossMineCave(true, log))) return false;
        area = touristTrapArea(Game.tile());
    }
    if (area === 'mineDeep' && !Inventory.contains(ITEM.BARREL)) {
        if (!(await rideMineCart(DEEP_CART, log))) return false;
        area = touristTrapArea(Game.tile());
    }
    if (area === 'mineLower') {
        if (!Inventory.contains(ITEM.BARREL) && !(await searchLowerBarrel(true, log))) return false;
        if (Inventory.contains(ITEM.ANA_BARREL)) {
            log('deep-mine recapture: recovered Ana directly from the lower transport barrel');
            return true;
        }
        if (!(await rideMineCart(LOWER_CART, log))) return false;
        area = touristTrapArea(Game.tile());
    }
    if (area !== 'mineDeep') {
        log(`deep-mine recapture did not reach Ana; current area=${area}`);
        return false;
    }
    const caught = await catchAnaInBarrel(log);
    log(caught ? 'deep-mine recapture: Ana secured in the barrel' : 'deep-mine recapture: using the empty barrel on Ana did not complete');
    return caught;
}

async function deepToLowerCheckpoint(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.ANA_BARREL)) {
        if (!(await useItemOnLoc(ITEM.ANA_BARREL, [LOC.MINE_CART], DEEP_CART, log))) return false;
        if (!(await Execution.delayUntil(() => !Inventory.contains(ITEM.ANA_BARREL), 8000))) return false;
    }
    if (!(await rideMineCart(DEEP_CART, log))) return false;
    if (!(await searchLowerBarrel(false, log))) return false;
    // At hidden stage 20 this barrel returns Ana (stage 21). If it offers an ordinary barrel, No changes nothing and proves Ana is already on the lift.
    return Inventory.contains(ITEM.ANA_BARREL) || touristTrapArea(Game.tile()) === 'mineLower';
}

async function retrieveFromSurfaceLift(log: (m: string) => void): Promise<boolean> {
    if (touristTrapArea(Game.tile()) === 'mineLower') {
        if (Inventory.contains(ITEM.ANA_BARREL)) {
            log('lift checkpoint: placing Ana on the underground lift');
            if (!(await useItemOnLoc(
                ITEM.ANA_BARREL,
                [LOC.LIFT_BUCKET],
                LIFT_BUCKET,
                log,
                LIFT_GUARD_DIALOG,
                () => !Inventory.contains(ITEM.ANA_BARREL)
            ))) {
                log('lift checkpoint: underground lift interaction did not complete');
                return false;
            }
            if (!(await Execution.delayUntil(() => !Inventory.contains(ITEM.ANA_BARREL), 8000))) {
                log('lift checkpoint: Ana remained in the backpack after the lift interaction');
                return false;
            }
        }
        if (!(await leaveMine(log))) {
            log('lift checkpoint: could not reach the surface machinery');
            return false;
        }
    }
    const area = touristTrapArea(Game.tile());
    if (area !== 'campSurface') {
        log(`lift checkpoint: surface probe unavailable from area=${area}`);
        return false;
    }
    log('lift checkpoint: probing the surface winch and top barrel');
    const emptyWinchFollowup = /heavy barrel filled with stone comes to the surface/i;
    const anaWinchFollowup = /barrel coming to the surface|get me out of here/i;
    const winchMark = GameMessages.mark();
    if (!(await interactLoc(
        [LOC.SURFACE_WINCH],
        'Use',
        SURFACE_WINCH_APPROACH,
        log
    ))) {
        log('lift checkpoint: surface winch interaction could not be dispatched');
        return false;
    }
    // After the same server delay an empty lift gives a game message and an Ana lift gives a multi-page modal.
    const followedUp = await Execution.delayUntil(
        () => GameMessages.sawSince(winchMark, emptyWinchFollowup) || dialogMatches(anaWinchFollowup),
        8000
    );
    if (!followedUp) {
        const observed = GameMessages.since(winchMark).map(message => message.text).join(' | ');
        log(`lift checkpoint: surface winch follow-up timed out; messages=[${observed}] modal=[${ChatDialog.texts().join(' | ')}]`);
        return false;
    }
    if (ChatDialog.isOpen() || ChatDialog.canContinue()) {
        if (!(await driveStrictDialog([], log, () => dialogMatches(anaWinchFollowup)))) return false;
    }
    if (Inventory.free() < 1 && !(await freeOneRescueSlot(log))) return false;
    const recovered = await searchSurfaceBarrel(log);
    log(recovered ? 'lift checkpoint: recovered Ana from the top barrel' : 'lift checkpoint: top barrel did not contain Ana');
    return recovered;
}

async function bribeDriverAndEscape(log: (m: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.ANA_BARREL)) {
        log('surface cart: placing Ana in the cart');
        if (!(await useItemOnLoc(ITEM.ANA_BARREL, [LOC.SURFACE_CART], SURFACE_CART_APPROACH, log))) {
            log('surface cart: placing Ana in the cart did not complete');
            return false;
        }
        if (!(await Execution.delayUntil(() => !Inventory.contains(ITEM.ANA_BARREL), 8000))) {
            log('surface cart: Ana remained in the backpack after the cart interaction');
            return false;
        }
    }

    // A reload can land after paying the driver but before boarding, so Search first; with the ready bit set it boards for free.
    if (await interactLoc([LOC.SURFACE_CART], 'Search', SURFACE_CART_APPROACH, log, ["Yes, I'll get on."])) {
        // Boarding closes its choice modal for p_delay(1) before teleporting with Ana; wait for that so a driver click can't cancel the ride.
        const escaped = await Execution.delayUntil(
            () => touristTrapArea(Game.tile()) === 'desert' && Inventory.contains(ITEM.ANA_BARREL),
            8000
        );
        if (escaped) {
            log('surface cart: ready-state boarding reached the desert with Ana');
            return true;
        }
    }
    log('surface cart: ready-state boarding was not available');

    // With the coins banked after a restart use the prison-riot appeal; a clean run pays the 100-coin bribe.
    const coinsSufficient = Inventory.count(ITEM.COINS) >= 100;
    const coinsBefore = Inventory.count(ITEM.COINS);
    const dialog = coinsSufficient ? DRIVER_DIALOG : DRIVER_NO_COIN_DIALOG;
    log(`surface cart: starting driver dialogue; coins>=100=${coinsSufficient ? 'yes' : 'no'}`);
    if (!(await talkStrict(NPC.MINE_CART_DRIVER, SURFACE_CART_APPROACH, dialog, log, 8))) {
        log('surface cart: driver dialogue did not complete');
        return false;
    }
    if (coinsSufficient && Inventory.count(ITEM.COINS) !== coinsBefore - 100) {
        log(`surface cart: driver dialogue ended without the 100-Coin bribe (${coinsBefore}→${Inventory.count(ITEM.COINS)})`);
        return false;
    }
    await Execution.delayTicks(1);
    if (!(await interactLoc([LOC.SURFACE_CART], 'Search', SURFACE_CART_APPROACH, log, ["Yes, I'll get on."]))) {
        log('surface cart: boarding interaction did not complete');
        return false;
    }
    const escaped = await Execution.delayUntil(() => {
        const area = touristTrapArea(Game.tile());
        return area === 'desert' && Inventory.contains(ITEM.ANA_BARREL);
    }, 15_000);
    log(escaped ? 'surface cart: driver sequence reached the desert with Ana' : 'surface cart: boarding did not reach the desert with Ana');
    return escaped;
}

async function lowerRescueCheckpoint(log: (m: string) => void): Promise<boolean> {
    // A failed lower-cart Agility roll leaves this state. Retry beside the cart; the lift/surface route would throw away a ready barrel and loop for minutes.
    if (Inventory.contains(ITEM.BARREL)) {
        log('lower checkpoint: empty barrel ready after a failed cart roll; retrying the cart in place');
        return rideMineCart(LOWER_CART, log);
    }
    if (!Inventory.contains(ITEM.ANA_BARREL)) {
        if (!(await searchLowerBarrel(false, log))) return false;
        if (Inventory.contains(ITEM.ANA_BARREL)) return true;
    }
    // An ordinary-barrel probe with no item means hidden stage 22.
    return retrieveFromSurfaceLift(log);
}

export interface SurfaceRescueOperations {
    hasAnaBarrel(): boolean;
    retrieveLift(log: (m: string) => void): Promise<boolean>;
    escapeByCart(log: (m: string) => void): Promise<boolean>;
    recaptureAna(log: (m: string) => void): Promise<boolean>;
    currentArea(): TouristTrapArea;
    maintainSurvival(): Promise<void>;
    waitBetweenAttempts(): Promise<void>;
}

export async function runSurfaceRescueCheckpoint(
    operations: SurfaceRescueOperations,
    log: (m: string) => void
): Promise<boolean> {
    await operations.maintainSurvival();
    if (EventSignal.pending()) return false;
    if (!operations.hasAnaBarrel()) {
        // Safe at hidden stages 22, 23 and 25: the winch is harmless to repeat and the top barrel only yields Ana with its transport bit set.
        if (await operations.retrieveLift(log)) return true;
        await operations.maintainSurvival();
        if (EventSignal.pending()) return false;
    }
    // Hidden stage 25 has Ana on this cart, so retry the full driver sequence before treating every transport bit as clear.
    for (let attempt = 1; attempt <= 3; attempt++) {
        await operations.maintainSurvival();
        if (EventSignal.pending()) return false;
        log(`surface cart attempt ${attempt}/3`);
        if (await operations.escapeByCart(log)) return true;
        await operations.maintainSurvival();
        if (EventSignal.pending()) return false;
        if (attempt < 3) {
            await operations.waitBetweenAttempts();
            if (EventSignal.pending()) return false;
        }
    }
    // A transient cart/driver failure shouldn't send you back underground while holding Ana; leave the state and retry next pass.
    if (operations.hasAnaBarrel()) {
        log('surface cart unresolved while carrying Ana; retrying this checkpoint in place');
        return false;
    }
    // Cleared bits or lost barrel: take the lower barrel and catch original Ana, which clears every transport bit server-side.
    await operations.maintainSurvival();
    if (EventSignal.pending()) return false;
    log('surface lift/cart state is clear; starting the canonical deep-mine replay');
    const recaptured = await operations.recaptureAna(log);
    if (!recaptured) log(`deep-mine recapture did not complete; current area=${operations.currentArea()}`);
    return recaptured;
}

async function surfaceRescueCheckpoint(log: (m: string) => void): Promise<boolean> {
    const slaveOutfitReady = SLAVE_OUTFIT.every(item => Inventory.contains(item) || Equipment.contains(item));
    log(
        `rescue checkpoint: area=${touristTrapArea(Game.tile())}; empty barrel=${Inventory.contains(ITEM.BARREL) ? 'yes' : 'no'}; `
        + `Ana barrel=${Inventory.contains(ITEM.ANA_BARREL) ? 'yes' : 'no'}; slave outfit=${slaveOutfitReady ? 'ready' : 'missing'}; `
        + `free slots=${Inventory.free()}; coins>=100=${Inventory.count(ITEM.COINS) >= 100 ? 'yes' : 'no'}`
    );
    return runSurfaceRescueCheckpoint({
        hasAnaBarrel: () => Inventory.contains(ITEM.ANA_BARREL),
        retrieveLift: retrieveFromSurfaceLift,
        escapeByCart: bribeDriverAndEscape,
        recaptureAna: reachAndCatchAna,
        currentArea: () => touristTrapArea(Game.tile()),
        maintainSurvival: () => Sustain.run(),
        waitBetweenAttempts: () => Execution.delayTicks(1)
    }, log);
}

async function returnAnaToIrena(log: (m: string) => void): Promise<boolean> {
    // Returning Ana runs straight into both reward menus with no dialogue boundary, so allow the skill choice here too.
    if (!(await talkStrict(NPC.IRENA, IRENA, ['Agility.'], log))) return false;
    return Execution.delayUntil(() => !Inventory.contains(ITEM.ANA_BARREL), 8000);
}

async function claimReward(log: (m: string) => void): Promise<boolean> {
    // The same skill can be picked at both menus; the driver picks it twice and drains the quest-complete dialogue.
    return talkStrict(NPC.IRENA, IRENA, ['Agility.'], log);
}

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

function routeNorth(snap: QuestSnapshot): QuestStep | null {
    const area = touristTrapArea(snap.tile);
    if (area !== 'desert' && area !== 'irena' && area !== 'bedabin') return null;
    return custom('cross the Shantay Pass north for supplies', crossShantayPassNorth);
}

function sourceWaterDoses(
    snap: QuestSnapshot,
    minimum: number,
    target: number,
    makeSpace: (snap: QuestSnapshot, slots: number) => QuestStep | null
): QuestStep | null {
    const doses = waterskinDoses(snap);
    if (doses >= minimum) return null;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const north = routeNorth(snap);
    if (north) return north;
    if (!snap.bankKnown) return scanBank();

    const partialNames = WATERSKINS.slice(1).map(lower);
    if ([...snap.inv.keys()].some(name => partialNames.includes(name))) {
        const keep = rescueKeep().filter(name => !partialNames.includes(name));
        return { kind: 'deposit', keep, exactKeep: true };
    }

    const missingContainers = Math.ceil((target - doses) / 4);
    const bankedFull = banked(snap, ITEM.WATERSKIN);
    if (bankedFull > 0) {
        const qty = Math.min(missingContainers, bankedFull);
        return makeSpace(snap, qty) ?? bankStep([{ name: ITEM.WATERSKIN, qty }]);
    }
    const purchaseCost = 35 * missingContainers;
    const coins = sourceCoins(snap, purchaseCost, 'replace Tourist Trap waterskins');
    if (coins) return coins;
    const space = makeSpace(snap, missingContainers);
    if (space) return space;
    return {
        kind: 'buy',
        item: ITEM.WATERSKIN,
        qty: missingContainers,
        shop: SHANTAY_SHOP,
        estGp: purchaseCost
    };
}

function sourceConfiguredSurvivalFood(snap: QuestSnapshot): QuestStep | null {
    const area = touristTrapArea(snap.tile);
    const minimum = area === 'mainland' || area === 'shantayNorth'
        ? FOOD_ENTRY_FLOOR
        : FOOD_RESTOCK_FLOOR;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (configuredFoodCount(snap) < minimum && route) return route;
    const north = routeNorth(snap);
    if (configuredFoodCount(snap) < minimum && north) return north;
    return configuredFoodWithdrawal(
        snap,
        minimum,
        FOOD_ENTRY_TARGET,
        makeRescueSpace
    );
}

function sourceCoins(snap: QuestSnapshot, target: number, purpose: string): QuestStep | null {
    if (heldCount(snap, ITEM.COINS) >= target) return null;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const north = routeNorth(snap);
    if (north) return north;
    if (!snap.bankKnown) return scanBank();
    const missing = target - heldCount(snap, ITEM.COINS);
    const available = banked(snap, ITEM.COINS);
    if (available > 0) {
        return bankStep([{ name: ITEM.COINS, qty: Math.min(missing, available, 40) }]);
    }
    return earnQuestCoinsStep(target, purpose);
}

function sourceRescueCoins(snap: QuestSnapshot): QuestStep | null {
    if (heldCount(snap, ITEM.COINS) >= RESCUE_COIN_FLOOR) return null;
    return sourceCoins(snap, RESCUE_COIN_TARGET, 'Tourist Trap rescue');
}

function survivalStep(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ITEM.ANA_BARREL)) return null;
    if (configuredFoodName()) {
        const food = sourceConfiguredSurvivalFood(snap);
        if (food) return food;
    } else {
        const area = touristTrapArea(snap.tile);
        const minimum = area === 'mainland' || area === 'shantayNorth'
            ? FOOD_ENTRY_FLOOR
            : FOOD_RESTOCK_FLOOR;
        const ration = heldCount(snap, ITEM.KEBAB) < minimum
            ? sourceKebabs(snap, FOOD_ENTRY_TARGET)
            : null;
        if (ration) return ration;
    }
    const area = touristTrapArea(snap.tile);
    const minimum = area === 'mainland' || area === 'shantayNorth'
        ? WATER_ENTRY_FLOOR
        : WATER_RESTOCK_FLOOR;
    return sourceWaterDoses(snap, minimum, WATER_ENTRY_DOSES, makeRescueSpace);
}

function routeSouth(snap: QuestSnapshot): QuestStep | null {
    const area = touristTrapArea(snap.tile);
    if (area !== 'mainland' && area !== 'shantayNorth') return null;
    const skins = sourceWaterDoses(snap, WATER_ENTRY_FLOOR, WATER_ENTRY_DOSES, makeRescueSpace);
    if (skins) return skins;
    if (!held(snap, ITEM.PASS)) {
        if (!snap.bankKnown) return scanBank();
        if (banked(snap, ITEM.PASS) > 0) return bankStep([{ name: ITEM.PASS, qty: 1 }]);
        const coins = sourceCoins(snap, 6, 'replace a Shantay pass');
        if (coins) return coins;
        return { kind: 'buy', item: ITEM.PASS, qty: 1, shop: SHANTAY_SHOP, estGp: 6 };
    }
    return custom('cross the Shantay Pass', crossShantayPass);
}

function sourceDesertOutfitCopies(snap: QuestSnapshot, target: number): QuestStep | null {
    if (outfitCopies(snap, DESERT_OUTFIT) >= target) return null;
    const area = touristTrapArea(snap.tile);
    const route = safeRecoveryRoute(area);
    if (route) return route;
    const north = routeNorth(snap);
    if (north) return north;
    if (!snap.bankKnown) return scanBank();
    for (const name of DESERT_OUTFIT) {
        const missing = target - ownedNow(snap, name);
        if (missing <= 0) continue;
        const availableSlots = snap.freeSlots ?? missing;
        if (availableSlots === 0) {
            const canWearFirstCopy = target > 1
                && outfitCopies(snap, DESERT_OUTFIT) >= 1
                && !DESERT_OUTFIT.every(item => worn(snap, item));
            if (canWearFirstCopy) {
                return custom('wear the first desert outfit to free recovery slots', wearDesertOutfitForSpace);
            }
            const space = makeCriticalItemSpace(snap, 1);
            if (space) return space;
        }
        const qty = Math.min(missing, Math.max(1, availableSlots));
        if (banked(snap, name) > 0) {
            const withdrawQty = Math.min(qty, banked(snap, name));
            const space = makePreparationSpace(snap, withdrawQty);
            return space ?? bankStep([{ name, qty: withdrawQty }]);
        }
        const price = SHANTAY_TARGETS.find(item => item.name === name)!.estGp!;
        const purchaseCost = price * qty;
        const coins = sourceCoins(snap, purchaseCost, `replace ${name}`);
        if (coins) return coins;
        const space = makePreparationSpace(snap, qty);
        return space ?? { kind: 'buy', item: name, qty, shop: SHANTAY_SHOP, estGp: purchaseCost };
    }
    return null;
}

function sourcePickaxe(snap: QuestSnapshot): QuestStep | null {
    if (ownedNow(snap, ITEM.PICKAXE) > 0) return null;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const north = routeNorth(snap);
    if (north) return north;
    if (!snap.bankKnown) return scanBank();
    if (snap.freeSlots === 0) {
        const space = makeCriticalItemSpace(snap);
        if (space) return space;
    }
    if (banked(snap, ITEM.PICKAXE) > 0) {
        const space = makePreparationSpace(snap, 1);
        return space ?? bankStep([{ name: ITEM.PICKAXE, qty: 1 }]);
    }
    const coins = sourceCoins(snap, 2, 'replace the Tourist Trap pickaxe');
    if (coins) return coins;
    const space = makePreparationSpace(snap, 1);
    return space ?? { kind: 'buy', item: ITEM.PICKAXE, qty: 1, shop: BOB_AXES, estGp: 2 };
}

function ensureDesertExteriorLoadout(snap: QuestSnapshot): QuestStep | null {
    const outfit = sourceDesertOutfitCopies(snap, 1);
    if (outfit) return outfit;
    const pickaxe = sourcePickaxe(snap);
    if (pickaxe) return pickaxe;
    const south = routeSouth(snap);
    if (south) return south;
    if (!DESERT_OUTFIT.every(item => worn(snap, item)) || !worn(snap, ITEM.PICKAXE)) {
        return custom('wear the camp-safe desert loadout', wearDesertLoadout);
    }
    return null;
}

/** Blank configured food means Kebabs. */
function sourceKebabs(snap: QuestSnapshot, target = 8): QuestStep | null {
    if (heldCount(snap, ITEM.KEBAB) >= target) return null;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const north = routeNorth(snap);
    if (north) return north;
    if (!snap.bankKnown) return scanBank();
    const bankFood = withdrawBankedShortage(snap, ITEM.KEBAB, target);
    if (bankFood) return bankFood;
    const missing = target - heldCount(snap, ITEM.KEBAB);
    const coins = sourceCoins(snap, missing, 'buy Tourist Trap quest rations');
    if (coins) return coins;
    const space = makePreparationSpace(snap, missing);
    return space ?? { kind: 'custom', name: `buy ${missing} Kebabs`, run: log => buyKebabs(target, log) };
}

function ensureCampSurface(snap: QuestSnapshot): QuestStep | null {
    const area = touristTrapArea(snap.tile);
    if (area === 'campSurface') return null;
    if (area === 'campUpper') return custom('climb down to the mining camp', log => climbCampLadder(false, log));
    if (area === 'mineEntrance' || area === 'mineLower') return custom('leave the underground mine', leaveMine);
    if (area === 'mineDeep') return custom('ride back to the lower mine', returnFromDeepMine);
    if (!held(snap, ITEM.METAL_KEY)) {
        if (!snap.bankKnown || banked(snap, ITEM.METAL_KEY) > 0) {
            const north = routeNorth(snap);
            if (north) return north;
        }
        if (!snap.bankKnown) return scanBank();
        if (banked(snap, ITEM.METAL_KEY) > 0) {
            const space = makeCriticalItemSpace(snap);
            return space ?? bankStep([{ name: ITEM.METAL_KEY, qty: 1 }]);
        }
    }
    const loadout = ensureDesertExteriorLoadout(snap);
    if (loadout) return loadout;
    if (!held(snap, ITEM.METAL_KEY)) {
        return custom('replace the mining-camp Metal key', provokeAndDefeatCaptain);
    }
    return custom('unlock the desert mining camp', enterCamp);
}

function ensureMineEntrance(snap: QuestSnapshot): QuestStep | null {
    const area = touristTrapArea(snap.tile);
    if ((area === 'mineEntrance' || area === 'mineLower')
        && hasOutfit(snap, SLAVE_OUTFIT)
        && !SLAVE_OUTFIT.every(item => worn(snap, item))) {
        return custom('wear the slave disguise', wearSlaveDisguiseOnly);
    }
    if (area === 'mineEntrance') return null;
    if (area === 'mineLower') return custom('cross back to the cave guards', log => crossMineCave(false, log));
    if (area === 'mineDeep') return custom('ride back to the lower mine', returnFromDeepMine);
    const pickaxe = sourcePickaxe(snap);
    if (pickaxe) return pickaxe;
    if (!hasOutfit(snap, SLAVE_OUTFIT)) {
        // The late re-trade swaps worn desert pieces in place, so 1 set is enough and leaves room for rescue supplies.
        const desert = sourceDesertOutfitCopies(snap, 1);
        if (desert) return desert;
    }
    const camp = ensureCampSurface(snap);
    if (camp) return camp;
    if (!hasOutfit(snap, SLAVE_OUTFIT)) {
        return custom('replace the slave disguise', replaceLostSlaveOutfit);
    }
    if (!SLAVE_OUTFIT.every(item => worn(snap, item)) || !worn(snap, ITEM.PICKAXE)) {
        return custom('wear the slave disguise', wearSlaveLoadout);
    }
    return custom('open the slave-only mine doors', enterMine);
}

function ensureMineLower(snap: QuestSnapshot): QuestStep | null {
    const area = touristTrapArea(snap.tile);
    if (area === 'mineLower') return null;
    if (area === 'mineDeep') return custom('ride back to the lower mine', returnFromDeepMine);
    if (area === 'mineEntrance') {
        if (hasOutfit(snap, SLAVE_OUTFIT) && !SLAVE_OUTFIT.every(item => worn(snap, item))) {
            return custom('wear the slave disguise', wearSlaveDisguiseOnly);
        }
        return custom('walk through the guarded mine cave', log => crossMineCave(true, log));
    }
    return ensureMineEntrance(snap);
}

function plansRecoveryStep(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, ITEM.PLANS)) return null;
    const area = touristTrapArea(snap.tile);
    const itemSpace = makeCriticalItemSpace(snap);
    if (itemSpace) return itemSpace;
    if (!snap.bankKnown || banked(snap, ITEM.PLANS) > 0) {
        const route = safeRecoveryRoute(area);
        if (route) return route;
        const north = routeNorth(snap);
        if (north) return north;
        if (!snap.bankKnown) return scanBank();
        const space = makePreparationSpace(snap, 1);
        return space ?? bankStep([{ name: ITEM.PLANS, qty: 1 }]);
    }
    if ((area === 'campSurface' || area === 'campUpper') && held(snap, ITEM.BEDABIN_KEY)) {
        return custom('distract Captain Siad and recover the plans', stealTechnicalPlans);
    }
    if (area === 'mineEntrance' || area === 'mineLower' || area === 'mineDeep') {
        return safeRecoveryRoute(area)!;
    }
    if (!held(snap, ITEM.BEDABIN_KEY)) {
        const route = safeRecoveryRoute(area);
        if (route) return route;
        if (banked(snap, ITEM.BEDABIN_KEY) > 0) {
            const north = routeNorth(snap);
            if (north) return north;
            const space = makePreparationSpace(snap, 1);
            return space ?? bankStep([{ name: ITEM.BEDABIN_KEY, qty: 1 }]);
        }
        const south = routeSouth(snap);
        const lost = snap.stage === TOURIST_TRAP_STAGE.MADE_DART_TIP
            ? askAlForLostPlansAndTip
            : askAlForLostKeyAndPlans;
        return south ?? custom('ask Al Shabim to replace the plans key', lost);
    }
    const camp = ensureCampSurface(snap);
    if (camp) return camp;
    return custom('distract Captain Siad and recover the plans', stealTechnicalPlans);
}

function remakePrototypeStep(snap: QuestSnapshot, needDart: boolean): QuestStep | null {
    if (needDart && held(snap, ITEM.DART)) return null;
    if (!held(snap, ITEM.DART_TIP)) {
        if (!snap.bankKnown) {
            const route = safeRecoveryRoute(touristTrapArea(snap.tile));
            if (route) return route;
            const north = routeNorth(snap);
            return north ?? scanBank();
        }
        const bankedProduct = needDart && banked(snap, ITEM.DART) > 0
            ? ITEM.DART
            : banked(snap, ITEM.DART_TIP) > 0
                ? ITEM.DART_TIP
                : null;
        if (bankedProduct) {
            const route = safeRecoveryRoute(touristTrapArea(snap.tile));
            if (route) return route;
            const north = routeNorth(snap);
            if (north) return north;
            const space = makeCriticalItemSpace(snap);
            return space ?? bankStep([{ name: bankedProduct, qty: 1 }]);
        }
    }
    if (held(snap, ITEM.DART_TIP)) {
        const feathers = sourceConsumable(snap, ITEM.FEATHER, 10);
        return feathers ?? custom('attach feathers to the prototype dart tip', fletchPrototypeDart);
    }
    const plans = plansRecoveryStep(snap);
    if (plans) return plans;
    const hammer = sourceConsumable(snap, ITEM.HAMMER, 1);
    if (hammer) return hammer;
    const bars = sourceConsumable(snap, ITEM.BAR, 1);
    if (bars) return bars;
    const route = safeRecoveryRoute(touristTrapArea(snap.tile));
    if (route) return route;
    const south = routeSouth(snap);
    if (south) return south;
    return custom('forge the prototype dart tip', forgePrototypeTip);
}

function stepLabel(step: QuestStep): string {
    switch (step.kind) {
        case 'talk': return `talk ${step.stop.npc}`;
        case 'buy': return `buy ${step.qty}× ${step.item} @ ${step.shop.npc}`;
        case 'withdraw': return `withdraw ${step.items.map(i => `${i.name}×${i.qty}`).join(',')}`;
        case 'deposit': return `deposit keep=${step.keep.join('|')}`;
        case 'custom': return step.name;
        case 'wait': return `wait:${step.reason}`;
        case 'equip': return `equip ${step.item}`;
        case 'scanBank': return 'scanBank';
        case 'done': return 'done';
        default: return step.kind;
    }
}

/** Dense context for stuck runs; the engine logs it via observe and operators paste it into agents. */
export function observeTouristTrap(snap: QuestSnapshot, step: QuestStep): readonly string[] {
    const area = touristTrapArea(snap.tile);
    const tile = snap.tile ? `(${snap.tile.x},${snap.tile.z}${snap.tile.level ? `,L${snap.tile.level}` : ''})` : '(no tile)';
    const water = waterskinDoses(snap);
    const containers = waterskinContainers(snap);
    const food = configuredFoodName();
    const desertWorn = DESERT_OUTFIT.filter(n => worn(snap, n)).length;
    const slaveOwned = SLAVE_OUTFIT.filter(n => ownedNow(snap, n) > 0).length;
    const lines = [
        `tt: stage=${snap.stage ?? '?'} journal=${snap.journal} area=${area} tile=${tile} free=${snap.freeSlots ?? '?'} bankKnown=${snap.bankKnown === true}`,
        `tt: water=${water} doses across ${containers} skins food=${food ?? '(disabled)'}:${configuredFoodCount(snap)} `
            + `pass=${heldCount(snap, ITEM.PASS)} coins=${heldCount(snap, ITEM.COINS)} `
            + `pick=${ownedNow(snap, ITEM.PICKAXE)} metalKey=${heldCount(snap, ITEM.METAL_KEY)} `
            + `bedabinKey=${heldCount(snap, ITEM.BEDABIN_KEY)} pineapple=${heldCount(snap, ITEM.PINEAPPLE)} `
            + `anaBarrel=${heldCount(snap, ITEM.ANA_BARREL)} barrel=${heldCount(snap, ITEM.BARREL)}`,
        `tt: desertWorn=${desertWorn}/${DESERT_OUTFIT.length} slaveOwned=${slaveOwned}/${SLAVE_OUTFIT.length} `
            + `kebabs=${heldCount(snap, ITEM.KEBAB)} plans=${heldCount(snap, ITEM.PLANS)} `
            + `dartTip=${heldCount(snap, ITEM.DART_TIP)} dart=${heldCount(snap, ITEM.DART)}`,
        `tt: decide→ ${stepLabel(step)}`
    ];
    if ((area === 'desert' || area === 'irena' || area === 'bedabin') && water < WATER_RESTOCK_FLOOR) {
        lines.push(`tt: WARN only ${water} waterskin doses in the desert — below ${WATER_RESTOCK_FLOOR}-dose safety floor`);
    }
    if (step.kind === 'wait' && step.reason === 'death') {
        lines.push('tt: death dump — next loop re-provisions (ownsInventory) then re-decides from journal');
    }
    return lines;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? 0) >= TOURIST_TRAP_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') return { kind: 'wait', reason: 'quest journal not loaded' };
    if (snap.stage === undefined) return { kind: 'wait', reason: 'Tourist Trap journal stage unavailable' };

    const stage = snap.stage;
    const area = touristTrapArea(snap.tile);

    // Capture, lockpick, equipment search and guard dialogue can all jail you at any stage, so location wins over stage.
    if (area === 'surfaceJail') return custom('escape the surface jail through the rocks', escapeSurfaceJail);
    if (area === 'undergroundJail') return custom('mine 15 punishment rocks and escape', escapeUndergroundJail);
    if (stage >= TOURIST_TRAP_STAGE.TRADED_CLOTHES
        && (area === 'mineEntrance' || area === 'mineLower' || area === 'mineDeep')
        && !hasOutfit(snap, SLAVE_OUTFIT)) {
        // The supply route can't leave this component without the disguise it wants to replace, so recover the outfit here first.
        return custom('return to the punishment mine to recover the slave disguise', returnToPunishmentMineForOutfit);
    }
    if (stage >= TOURIST_TRAP_STAGE.STARTED
        && stage <= TOURIST_TRAP_STAGE.REWARD
        && (stage < TOURIST_TRAP_STAGE.REWARD
            || (stage === TOURIST_TRAP_STAGE.REWARD && (area === 'mainland' || area === 'shantayNorth')))) {
        const survival = survivalStep(snap);
        if (survival) return survival;
    }
    if (stage >= TOURIST_TRAP_STAGE.ENTERED_CAMP
        && (stage !== TOURIST_TRAP_STAGE.RESCUE
            || (!held(snap, ITEM.ANA_BARREL) && !hasOutfit(snap, SLAVE_OUTFIT)))
        && (area === 'campSurface' || area === 'campUpper')
        && !held(snap, ITEM.METAL_KEY)) {
        // The desk gives a cell key then the Metal key, so a restart with neither needs 2 free slots.
        const slots = held(snap, ITEM.CELL_KEY) ? 1 : 2;
        if ((snap.freeSlots ?? slots) < slots) {
            return custom('free a slot for mining-camp key recovery', freeOneRescueSlot);
        }
        return custom("recover the mining-camp keys from Captain Siad's desk", recoverMiningCampKeys);
    }
    if (stage === TOURIST_TRAP_STAGE.NOT_STARTED) {
        const prep = preparationStep(snap);
        if (prep) return prep;
        if (!DESERT_OUTFIT.every(item => worn(snap, item)) || !worn(snap, ITEM.PICKAXE)) {
            return custom('wear the desert quest loadout', wearDesertLoadout);
        }
        const south = routeSouth(snap);
        return south ?? custom('start Tourist Trap with Irena', startWithIrena);
    }

    if (stage === TOURIST_TRAP_STAGE.STARTED) {
        const loadout = ensureDesertExteriorLoadout(snap);
        if (loadout) return loadout;
        return custom('provoke the Mercenary Captain', challengeCaptain);
    }

    if (stage === TOURIST_TRAP_STAGE.APPROACHED_CAPTAIN) {
        const loadout = ensureDesertExteriorLoadout(snap);
        if (loadout) return loadout;
        return custom('provoke and defeat the Mercenary Captain', provokeAndDefeatCaptain);
    }

    if (stage === TOURIST_TRAP_STAGE.KILLED_CAPTAIN) {
        if (!held(snap, ITEM.METAL_KEY)) {
            if (!snap.bankKnown || banked(snap, ITEM.METAL_KEY) > 0) {
                const north = routeNorth(snap);
                if (north) return north;
            }
            if (!snap.bankKnown) return scanBank();
            if (banked(snap, ITEM.METAL_KEY) > 0) {
                const space = makeCriticalItemSpace(snap);
                return space ?? bankStep([{ name: ITEM.METAL_KEY, qty: 1 }]);
            }
            const loadout = ensureDesertExteriorLoadout(snap);
            if (loadout) return loadout;
            if (snap.freeSlots === 0) return custom("free one slot for the captain's Metal key", freeOneRescueSlot);
            return custom('provoke and defeat the respawned Mercenary Captain', provokeAndDefeatCaptain);
        }
        const camp = ensureCampSurface(snap);
        return camp ?? custom('unlock the desert mining camp', enterCamp);
    }

    if (stage === TOURIST_TRAP_STAGE.ENTERED_CAMP
        || stage === TOURIST_TRAP_STAGE.SPOKEN_SLAVE
        || stage === TOURIST_TRAP_STAGE.FREED_SLAVE) {
        const outfit = sourceDesertOutfitCopies(snap, 2);
        if (outfit) return outfit;
        const camp = ensureCampSurface(snap);
        return camp ?? custom('free the slave and trade the spare desert outfit', slaveUnlockAndTrade);
    }

    if (stage === TOURIST_TRAP_STAGE.TRADED_CLOTHES) {
        const mine = ensureMineEntrance(snap);
        return mine ?? custom('open the slave-only mine doors', enterMine);
    }

    if (stage === TOURIST_TRAP_STAGE.ENTERED_MINE) {
        const mine = ensureMineEntrance(snap);
        return mine ?? custom('learn the cave guard wants a Tenti pineapple', askCaveGuard);
    }

    if (stage === TOURIST_TRAP_STAGE.FINDING_PINEAPPLE) {
        const route = safeRecoveryRoute(area);
        if (route) return route;
        if (area === 'campSurface' || area === 'campUpper') return custom('leave camp to visit Al Shabim', leaveCamp);
        const itemSpace = makeCriticalItemSpace(snap);
        if (itemSpace) return itemSpace;
        const south = routeSouth(snap);
        return south ?? custom('accept Al Shabim\'s pineapple deal', askAlForPineappleDeal);
    }

    if (stage === TOURIST_TRAP_STAGE.BEDABIN_KEY) {
        if (!held(snap, ITEM.BEDABIN_KEY) && snap.bankKnown && banked(snap, ITEM.BEDABIN_KEY) === 0) {
            const itemSpace = makeCriticalItemSpace(snap);
            if (itemSpace) return itemSpace;
            const south = routeSouth(snap);
            if (south) return south;
        }
        const key = recoverCritical(snap, ITEM.BEDABIN_KEY, custom('ask Al Shabim for a replacement key', askAlForLostKey));
        if (key) return key;
        const camp = ensureCampSurface(snap);
        return camp ?? custom('distract Captain Siad and steal the plans', stealTechnicalPlans);
    }

    if (stage === TOURIST_TRAP_STAGE.RETRIEVED_PLANS) {
        const plans = plansRecoveryStep(snap);
        if (plans) return plans;
        const bar = sourceConsumable(snap, ITEM.BAR, 1);
        if (bar) return bar;
        const feathers = sourceConsumable(snap, ITEM.FEATHER, 10);
        if (feathers) return feathers;
        const hammer = sourceConsumable(snap, ITEM.HAMMER, 1);
        if (hammer) return hammer;
        const route = safeRecoveryRoute(area);
        if (route) return route;
        if (area === 'campSurface' || area === 'campUpper') return custom('leave camp with the technical plans', leaveCamp);
        const south = routeSouth(snap);
        return south ?? custom('show the technical plans to Al Shabim', showPlansToAl);
    }

    if (stage === TOURIST_TRAP_STAGE.SHOWN_PLANS) {
        const remake = remakePrototypeStep(snap, false);
        return remake ?? custom('forge the prototype dart tip', forgePrototypeTip);
    }

    if (stage === TOURIST_TRAP_STAGE.MADE_DART_TIP) {
        const remake = remakePrototypeStep(snap, true);
        return remake ?? custom('attach feathers to the prototype dart tip', fletchPrototypeDart);
    }

    if (stage === TOURIST_TRAP_STAGE.FINISHED_DART) {
        const remake = remakePrototypeStep(snap, true);
        if (remake) return remake;
        const south = routeSouth(snap);
        return south ?? custom('give the prototype dart to Al Shabim', givePrototypeToAl);
    }

    if (stage === TOURIST_TRAP_STAGE.LEARNED_DARTS) {
        if (!held(snap, ITEM.PINEAPPLE) && snap.bankKnown && banked(snap, ITEM.PINEAPPLE) === 0) {
            const itemSpace = makeCriticalItemSpace(snap);
            if (itemSpace) return itemSpace;
            const south = routeSouth(snap);
            if (south) return south;
        }
        const pineapple = recoverCritical(snap, ITEM.PINEAPPLE, custom('replace the Tenti pineapple at Al Shabim', recoverPineappleFromAl));
        if (pineapple) return pineapple;
        const mine = ensureMineEntrance(snap);
        return mine ?? custom('give the cave guard his Tenti pineapple', givePineapple);
    }

    if (stage === TOURIST_TRAP_STAGE.GIVEN_PINEAPPLE) {
        const mine = ensureMineLower(snap);
        if (mine) return mine;
        if (snap.freeSlots === 0 && !held(snap, ITEM.BARREL)) {
            return custom('free one slot for the rescue barrel', freeOneRescueSlot);
        }
        if (!held(snap, ITEM.BARREL)) return custom('take an empty mining barrel', log => searchLowerBarrel(true, log));
        return custom('ride the mine cart and catch Ana in the barrel', reachAndCatchAna);
    }

    if (stage === TOURIST_TRAP_STAGE.USED_MINE_CART) {
        if (area === 'mineLower') {
            if (snap.freeSlots === 0 && !held(snap, ITEM.BARREL)) return custom('free one slot for the rescue barrel', freeOneRescueSlot);
            if (!held(snap, ITEM.BARREL)) return custom('take an empty mining barrel', log => searchLowerBarrel(true, log));
            return custom('ride back to Ana with the empty barrel', log => rideMineCart(LOWER_CART, log));
        }
        if (area === 'mineDeep') {
            return held(snap, ITEM.BARREL)
                ? custom('put Ana safely in the barrel', catchAnaInBarrel)
                : custom('return to the lower mine for an empty barrel', returnFromDeepMine);
        }
        const mine = ensureMineLower(snap);
        return mine ?? custom('return to the deep mine', reachAndCatchAna);
    }

    if (stage === TOURIST_TRAP_STAGE.RESCUE) {
        if (!held(snap, ITEM.ANA_BARREL) && !hasOutfit(snap, SLAVE_OUTFIT)) {
            const recovery = ensureMineEntrance(snap);
            if (recovery) return recovery;
        }
        if (!held(snap, ITEM.ANA_BARREL)
            && area !== 'mineDeep'
            && area !== 'mineLower'
            && area !== 'mineEntrance') {
            const coins = sourceRescueCoins(snap);
            if (coins) return coins;
        }
        if (area === 'mineDeep') {
            if (held(snap, ITEM.BARREL)) {
                // Catching Ana clears every stale transport bit first, so it resets the rescue at any hidden stage.
                return custom('reset the rescue state by catching original Ana', catchAnaInBarrel);
            }
            return custom('move Ana through the deep-to-lower cart checkpoint', deepToLowerCheckpoint);
        }
        if (area === 'mineLower') {
            if (held(snap, ITEM.ANA_BARREL)) return custom('lift Ana and retrieve her at the surface checkpoint', retrieveFromSurfaceLift);
            if (held(snap, ITEM.BARREL)) return custom('retry the lower mine cart with the empty barrel', log => rideMineCart(LOWER_CART, log));
            if (snap.freeSlots === 0) return custom('free one slot for the lower barrel probe', freeOneRescueSlot);
            return custom('resolve the lower barrel/lift checkpoint', lowerRescueCheckpoint);
        }
        if (area === 'mineEntrance') return custom('leave the mine to resolve the surface checkpoint', leaveMine);
        if (area === 'campSurface') {
            return custom('resolve the surface winch/cart checkpoint', surfaceRescueCheckpoint);
        }
        if (area === 'campUpper') return custom('climb down to the surface rescue machinery', log => climbCampLadder(false, log));
        if ((area === 'desert' || area === 'irena') && held(snap, ITEM.ANA_BARREL)) {
            return custom('return Ana to Irena', returnAnaToIrena);
        }
        if (area === 'desert' || area === 'irena' || area === 'bedabin') {
            const camp = ensureCampSurface(snap);
            return camp ?? custom('return to the mining camp to resume Ana\'s rescue', enterCamp);
        }
        const south = routeSouth(snap);
        return south ?? { kind: 'wait', reason: 'locating the visible Ana rescue checkpoint' };
    }

    if (stage === TOURIST_TRAP_STAGE.REWARD) {
        const south = routeSouth(snap);
        return south ?? custom('claim both Tourist Trap skill rewards', claimReward);
    }

    return { kind: 'wait', reason: `unrecognized Tourist Trap journal stage ${stage}` };
}

export const touristtrap: QuestModule = {
    record: QUESTS.find(record => record.id === 'desertrescue')!,
    bank: DRAYNOR_BANK,
    grind: ['Mercenary Captain'],
    tools: ['bronze pickaxe'],
    ownsInventory: true,
    sustain: { foods: [ITEM.KEBAB], eatBelowHp: 0.5 },
    readStage: readTouristTrapStage,
    observe: observeTouristTrap,
    decide
};
