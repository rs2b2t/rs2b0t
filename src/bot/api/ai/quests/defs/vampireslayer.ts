import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import Tile from '../../../../geometry/Tile.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Skills } from '../../../skills/Skills.js';
import { Locs } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Traversal } from '../../../walking/Traversal.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { talkThrough, type NpcStop } from '../exec/primitives.js';
import { GARLIC, MORGAN_STAIRS_TOP, takeGarlic } from '../exec/garlic.js';
import { QuestFood } from '../food.js';

export const VAMPIRE_SLAYER_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_TO_HARLOW: 2,
    COMPLETE: 3
} as const;

export function parseVampireSlayerJournal(lines: readonly string[] | string): number | undefined {
    const text = (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();

    if (text.includes('quest complete!')) return VAMPIRE_SLAYER_STAGE.COMPLETE;
    if (text.includes('i have spoken to dr harlow') || text.includes('dr harlow gave me a stake')) {
        return VAMPIRE_SLAYER_STAGE.SPOKEN_TO_HARLOW;
    }
    if (text.includes('i need to speak to dr harlow')) return VAMPIRE_SLAYER_STAGE.STARTED;
    if (text.includes('i can start this quest')) return VAMPIRE_SLAYER_STAGE.NOT_STARTED;
    return undefined;
}

async function readVampireSlayerStage(): Promise<number | undefined> {
    const status = Quests.status('Vampire Slayer');
    if (status === 'complete') return VAMPIRE_SLAYER_STAGE.COMPLETE;
    if (status === 'notStarted') return VAMPIRE_SLAYER_STAGE.NOT_STARTED;
    if (status !== 'inProgress') return undefined;

    const lines = await Quests.journal('Vampire Slayer');
    const stage = parseVampireSlayerJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

const ITEM = {
    BEER: 'Beer',
    GARLIC,
    HAMMER: 'Hammer',
    STAKE: 'Stake',
    SWORD: 'Black sword',
    KEBAB: 'Kebab'
} as const;

const COUNT_DRAYNOR_ID = 757;
const COFFIN_CLOSED_ID = 2614;

const FOOD_TARGET = 20;
const COIN_FLOAT = 5000;
const COIN_RESERVE = 2000;

const DRAYNOR_BANK = new Tile(3093, 3243, 0);
const JOLLY_BOAR = new Tile(3277, 3490, 0);
const VARROCK_GENERAL = { npc: 'Shop keeper', anchor: new Tile(3218, 3415, 0) };
const VARROCK_SWORDS = { npc: 'Shop keeper', anchor: new Tile(3203, 3397, 0) };
const KEBAB_SELLER = new Tile(3272, 3182, 0);
const MANOR_STAIRS_DOWN = new Tile(3115, 3357, 0);
const CRYPT_ARRIVAL = new Tile(3077, 9771, 0);
const CRYPT_STAIRS_UP = new Tile(3077, 9768, 0);
const COFFIN = new Tile(3077, 9775, 0);

const MORGAN: NpcStop = {
    npc: 'Morgan',
    anchor: new Tile(3098, 3268, 0),
    leash: 5,
    prefer: ["Ok, I'm up for an adventure."]
};

const HARLOW_FIRST: NpcStop = {
    npc: 'Dr Harlow',
    anchor: new Tile(3277, 3492, 0),
    leash: 5,
    prefer: ['Morgan needs your help']
};

const HARLOW_STAKE: NpcStop = {
    ...HARLOW_FIRST,
    prefer: ['Ok mate.']
};

const SAFE_WEAPONS = ['Black sword', 'Steel sword', 'Iron sword', 'Bronze sword'] as const;
const BANK_FOODS = [
    'Shark',
    'Lobster',
    'Swordfish',
    'Tuna',
    'Salmon',
    'Trout',
    'Bread',
    'Cooked meat',
    'Cooked chicken',
    'Cake',
    ITEM.KEBAB
] as const;

type VampireSlayerArea = 'morganUpper' | 'crypt' | 'mainland' | 'unknown';

export function vampireSlayerArea(tile: QuestSnapshot['tile']): VampireSlayerArea {
    if (!tile) return 'unknown';
    if (tile.level === 1 && tile.x >= 3088 && tile.x <= 3110 && tile.z >= 3255 && tile.z <= 3280) {
        return 'morganUpper';
    }
    if (tile.level === 0 && tile.x >= 3040 && tile.x <= 3140 && tile.z >= 9700 && tile.z <= 9850) {
        return 'crypt';
    }
    if (tile.level === 0 && tile.z < 5000) return 'mainland';
    return 'unknown';
}

const heldCount = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
const held = (snap: QuestSnapshot, name: string): boolean => heldCount(snap, name) > 0;
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());

function foodNames(): string[] {
    const configured = QuestFood.name?.trim();
    const names = [configured, ...BANK_FOODS].filter((name): name is string => Boolean(name));
    return [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
}

function foodHeld(snap: QuestSnapshot): number {
    return foodNames().reduce((total, name) => total + heldCount(snap, name), 0);
}

function exactKeep(): string[] {
    return [
        'coins',
        ITEM.BEER.toLowerCase(),
        ITEM.GARLIC.toLowerCase(),
        ITEM.HAMMER.toLowerCase(),
        ITEM.STAKE.toLowerCase(),
        ...SAFE_WEAPONS.map(name => name.toLowerCase()),
        ...foodNames().map(name => name.toLowerCase())
    ];
}

function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: DRAYNOR_BANK };
}

function withdraw(items: { name: string; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: DRAYNOR_BANK };
}

function makeSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) return null;
    const keep = exactKeep();
    if ([...snap.inv.keys()].some(name => !keep.includes(name))) {
        return { kind: 'deposit', keep, bank: DRAYNOR_BANK, exactKeep: true };
    }
    // Why: a restart can hold nothing but an oversized pile of otherwise-valid quest supplies or food, and the generic deposit step cannot retain quantities.
    // Why: the load is banked, keeping only coins, and the state machine withdraws one clean loadout.
    return { kind: 'deposit', keep: ['coins'], bank: DRAYNOR_BANK, exactKeep: true };
}

function normalizePack(snap: QuestSnapshot): QuestStep | null {
    const keep = exactKeep();
    return [...snap.inv.keys()].some(name => !keep.includes(name))
        ? { kind: 'deposit', keep, bank: DRAYNOR_BANK, exactKeep: true }
        : null;
}

function sourceCoins(snap: QuestSnapshot): QuestStep | null {
    const inPack = heldCount(snap, 'Coins');
    // One 5k withdrawal comfortably covers the beer, hammer, sword, and kebabs. Do not walk
    // across the map after every tiny purchase to refill one or two coins.
    if (inPack >= COIN_RESERVE) return null;
    const inBank = banked(snap, 'Coins');
    if (inBank <= 0) return { kind: 'wait', reason: 'need coins for Vampire Slayer supplies' };
    const space = inPack === 0 ? makeSpace(snap, 1) : null;
    return space ?? withdraw([{ name: 'Coins', qty: Math.min(COIN_FLOAT - inPack, inBank) }]);
}

function sourceBankedOr(
    snap: QuestSnapshot,
    name: string,
    fallback: () => QuestStep
): QuestStep | null {
    if (held(snap, name)) return null;
    if (banked(snap, name) > 0) {
        return makeSpace(snap, 1) ?? withdraw([{ name, qty: 1 }]);
    }
    return fallback();
}

function heldSafeWeapon(snap: QuestSnapshot): string | null {
    return SAFE_WEAPONS.find(name => held(snap, name)) ?? null;
}

function wornWeapon(snap: QuestSnapshot): boolean {
    if (SAFE_WEAPONS.some(name => worn(snap, name))) return true;
    return [...snap.worn].some(name => /(?:sword|scimitar|dagger|mace|battleaxe|warhammer|spear|halberd|whip|axe)$/.test(name));
}

function bankWeapon(snap: QuestSnapshot): string | null {
    return SAFE_WEAPONS.find(name => banked(snap, name) > 0) ?? null;
}

async function leaveMorganUpper(log: (message: string) => void): Promise<boolean> {
    if (Game.tile()?.level !== 1) return true;
    // Why: the upper staircase's map tile is blocked by its own collision shape.
    // Why: on a restart the staircase is already in the loaded scene, so it is interacted with before navigation is asked to route onto an impossible destination.
    const visible = Locs.query().name('Staircase').action('Climb-down').within(8).nearest();
    if (visible) {
        if (!(await visible.interact('Climb-down'))) return false;
        return Execution.delayUntil(() => Game.tile()?.level === 0, 8000);
    }
    if (!(await Traversal.walkResilient(MORGAN_STAIRS_TOP, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const stairs = Locs.query().name('Staircase').action('Climb-down').within(6).nearest();
    if (!stairs || !(await stairs.interact('Climb-down'))) {
        log("Morgan's Staircase did not offer Climb-down");
        return false;
    }
    return Execution.delayUntil(() => Game.tile()?.level === 0, 8000);
}

async function buyBeer(log: (message: string) => void): Promise<boolean> {
    if (Inventory.contains(ITEM.BEER)) return true;
    if (!(await Traversal.walkResilient(JOLLY_BOAR, { radius: 3, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const before = Inventory.count(ITEM.BEER);
    if (!(await talkThrough('Bartender', ["I'll have a beer please."], log))) return false;
    return Execution.delayUntil(() => Inventory.count(ITEM.BEER) > before, 6000);
}

async function buyKebabs(target: number, log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(KEBAB_SELLER, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    while (Inventory.count(ITEM.KEBAB) < target) {
        if (Inventory.count('Coins') < 1 || Inventory.isFull()) return false;
        const before = Inventory.count(ITEM.KEBAB);
        if (!(await talkThrough('Kebab seller', ['Yes please.'], log))) return false;
        if (!(await Execution.delayUntil(() => Inventory.count(ITEM.KEBAB) > before, 5000))) return false;
    }
    return true;
}

function sourceFood(snap: QuestSnapshot): QuestStep | null {
    const have = foodHeld(snap);
    if (have >= FOOD_TARGET) return null;
    for (const name of foodNames()) {
        const available = banked(snap, name);
        if (available <= 0) continue;
        const qty = Math.min(FOOD_TARGET - have, available);
        return makeSpace(snap, qty) ?? withdraw([{ name, qty }]);
    }
    const coins = sourceCoins(snap);
    if (coins) return coins;
    const missing = FOOD_TARGET - have;
    const space = makeSpace(snap, missing);
    if (space) return space;
    const target = heldCount(snap, ITEM.KEBAB) + missing;
    return { kind: 'custom', name: `buy ${missing} combat Kebabs`, run: log => buyKebabs(target, log) };
}

async function eatFood(): Promise<boolean> {
    const allowed = new Set(foodNames().map(name => name.toLowerCase()));
    const food = Inventory.items().find(item => item.name !== null
        && allowed.has(item.name.toLowerCase())
        && item.actions().some(action => /^(eat|drink)$/i.test(action)));
    if (!food) return false;
    const action = food.actions().find(op => /^(eat|drink)$/i.test(op));
    if (!action) return false;
    const beforeCount = Inventory.items().length;
    const beforeHp = Skills.effective('hitpoints');
    if (!(await food.interact(action))) return false;
    return Execution.delayUntil(
        () => Inventory.items().length < beforeCount || Skills.effective('hitpoints') !== beforeHp,
        4000
    );
}

async function leaveCrypt(log: (message: string) => void): Promise<boolean> {
    if (vampireSlayerArea(Game.tile()) !== 'crypt') return true;
    if (!(await Traversal.walkResilient(CRYPT_STAIRS_UP, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const stairs = Locs.query().name('Stairs').action('Walk-Up').within(6).nearest();
    if (!stairs || !(await stairs.interact('Walk-Up'))) {
        log('the crypt Stairs did not offer Walk-Up');
        return false;
    }
    return Execution.delayUntil(() => vampireSlayerArea(Game.tile()) !== 'crypt', 8000);
}

async function enterCrypt(log: (message: string) => void): Promise<boolean> {
    if (vampireSlayerArea(Game.tile()) === 'crypt') return true;
    if (!(await Traversal.walkResilient(MANOR_STAIRS_DOWN, { radius: 2, attempts: 5, timeoutMs: 240_000, log }))) {
        return false;
    }
    const stairs = Locs.query().name('Stairs').action('Walk-Down').within(7).nearest();
    if (!stairs || !(await stairs.interact('Walk-Down'))) {
        log('the manor Stairs did not offer Walk-Down');
        return false;
    }
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return vampireSlayerArea(tile) === 'crypt' && CRYPT_ARRIVAL.distanceTo(tile!) <= 8;
    }, 10_000);
}

function liveCount() {
    return Npcs.query().where(npc => npc.id === COUNT_DRAYNOR_ID && !npc.targetsAnotherPlayer()).within(12).nearest();
}

async function fightCount(log: (message: string) => void): Promise<boolean> {
    if (vampireSlayerArea(Game.tile()) !== 'crypt') {
        await enterCrypt(log);
        return false;
    }

    while (Skills.hpFraction() < 0.9 && Inventory.items().some(item => item.actions().some(op => /^(eat|drink)$/i.test(op)))) {
        if (!(await eatFood())) break;
    }

    if (!(await Traversal.walkResilient(COFFIN, { radius: 3, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    let count = liveCount();
    if (!count) {
        const coffin = Locs.query().where(loc => loc.id === COFFIN_CLOSED_ID).action('Open').within(7).nearest();
        if (!coffin) {
            log('waiting for Count Draynor\'s Coffin to close');
            await Execution.delayTicks(2);
            return false;
        }
        if (!(await coffin.interact('Open'))) return false;
        await Execution.delayUntil(() => liveCount() !== null, 10_000);
        count = liveCount();
    }
    if (!count) {
        log('Count Draynor did not emerge from the Coffin');
        return false;
    }

    const deadline = performance.now() + 180_000;
    while (performance.now() < deadline) {
        if (Quests.status('Vampire Slayer') === 'complete') return true;
        if (Skills.hpFraction() < 0.6) await eatFood();

        count = liveCount();
        if (!count) {
            return Execution.delayUntil(() => Quests.status('Vampire Slayer') === 'complete', 12_000);
        }
        if (!Game.inCombat()) {
            if (!(await count.interact('Attack'))) return false;
            await Execution.delayUntil(() => Game.inCombat() || liveCount() === null, 5000);
        }
        await Execution.delayTicks(1);
    }
    log('Count Draynor fight exceeded three minutes');
    return false;
}

function completeCombatLoadout(snap: QuestSnapshot): boolean {
    return held(snap, ITEM.STAKE)
        && held(snap, ITEM.GARLIC)
        && held(snap, ITEM.HAMMER)
        && wornWeapon(snap)
        && foodHeld(snap) >= FOOD_TARGET;
}

function stageTwo(snap: QuestSnapshot, area: VampireSlayerArea): QuestStep {
    if (area === 'crypt' && !completeCombatLoadout(snap)) {
        return { kind: 'custom', name: 'leave the crypt to recover supplies', run: leaveCrypt };
    }
    if (area === 'morganUpper') {
        return held(snap, ITEM.GARLIC)
            ? { kind: 'custom', name: "leave Morgan's upper floor", run: leaveMorganUpper }
            : { kind: 'custom', name: "take garlic from Morgan's cupboard", run: takeGarlic };
    }
    if (area === 'unknown') return { kind: 'wait', reason: 'return to the mainland to resume Vampire Slayer' };
    if (!snap.bankKnown) return scanBank();
    const normalize = normalizePack(snap);
    if (normalize) return normalize;

    if (!held(snap, ITEM.STAKE)) {
        if (banked(snap, ITEM.STAKE) > 0) {
            return makeSpace(snap, 1) ?? withdraw([{ name: ITEM.STAKE, qty: 1 }]);
        }
        if (held(snap, ITEM.BEER)) return { kind: 'talk', stop: HARLOW_STAKE };
        if (banked(snap, ITEM.BEER) > 0) {
            return makeSpace(snap, 1) ?? withdraw([{ name: ITEM.BEER, qty: 1 }]);
        }
        const coins = sourceCoins(snap);
        return coins ?? { kind: 'custom', name: 'buy Dr Harlow a Beer', run: buyBeer };
    }

    const garlic = sourceBankedOr(snap, ITEM.GARLIC, () => ({
        kind: 'custom', name: "take garlic from Morgan's cupboard", run: takeGarlic
    }));
    if (garlic) return garlic;

    const hammer = sourceBankedOr(snap, ITEM.HAMMER, () => {
        const coins = sourceCoins(snap);
        return coins ?? { kind: 'buy', item: ITEM.HAMMER, qty: 1, shop: VARROCK_GENERAL, estGp: 100 };
    });
    if (hammer) return hammer;

    if (!wornWeapon(snap)) {
        const weapon = heldSafeWeapon(snap);
        if (weapon) return { kind: 'equip', item: weapon };
        const inBank = bankWeapon(snap);
        if (inBank) return makeSpace(snap, 1) ?? withdraw([{ name: inBank, qty: 1 }]);
        const coins = sourceCoins(snap);
        if (coins) return coins;
        return { kind: 'buy', item: ITEM.SWORD, qty: 1, shop: VARROCK_SWORDS, estGp: 1000 };
    }

    const food = sourceFood(snap);
    if (food) return food;
    return { kind: 'custom', name: 'enter the crypt and defeat Count Draynor', run: fightCount };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? 0) >= VAMPIRE_SLAYER_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') return { kind: 'wait', reason: 'quest journal not loaded' };
    if (snap.stage === undefined) return { kind: 'wait', reason: 'Vampire Slayer journal stage unavailable' };

    const area = vampireSlayerArea(snap.tile);
    if (area === 'crypt') {
        return snap.stage === VAMPIRE_SLAYER_STAGE.SPOKEN_TO_HARLOW
            ? stageTwo(snap, area)
            : { kind: 'custom', name: 'leave the crypt before continuing the quest', run: leaveCrypt };
    }
    if (area === 'morganUpper') {
        if (snap.stage === VAMPIRE_SLAYER_STAGE.STARTED && !held(snap, ITEM.GARLIC)) {
            return { kind: 'custom', name: "take garlic from Morgan's cupboard", run: takeGarlic };
        }
        return { kind: 'custom', name: "leave Morgan's upper floor", run: leaveMorganUpper };
    }
    if (area === 'unknown') return { kind: 'wait', reason: 'return to the mainland to resume Vampire Slayer' };
    if (!snap.bankKnown) return scanBank();
    const normalize = normalizePack(snap);
    if (normalize) return normalize;

    if (snap.stage === VAMPIRE_SLAYER_STAGE.NOT_STARTED) return { kind: 'talk', stop: MORGAN };
    if (snap.stage === VAMPIRE_SLAYER_STAGE.STARTED) {
        const garlic = sourceBankedOr(snap, ITEM.GARLIC, () => ({
            kind: 'custom', name: "take garlic from Morgan's cupboard", run: takeGarlic
        }));
        return garlic ?? { kind: 'talk', stop: HARLOW_FIRST };
    }
    if (snap.stage === VAMPIRE_SLAYER_STAGE.SPOKEN_TO_HARLOW) return stageTwo(snap, area);
    return { kind: 'wait', reason: `unrecognized Vampire Slayer stage ${snap.stage}` };
}

export const vampireslayer: QuestModule = {
    record: QUESTS.find(record => record.id === 'vampire')!,
    bank: DRAYNOR_BANK,
    grind: ['Count Draynor'],
    tools: ['beer', 'garlic', 'hammer', 'stake', 'sword', 'kebab', 'coins'],
    ownsInventory: true,
    readStage: readVampireSlayerStage,
    sustain: { foods: foodNames(), eatBelowHp: 0.6 },
    decide
};
