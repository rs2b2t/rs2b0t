import { actions, reader } from '../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../execution/Execution.js';
import { Game } from '../../../game/Game.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Equipment } from '../../../equipment/Equipment.js';
import { Inventory, type InvItem } from '../../../inventory/Inventory.js';
import { Quests } from '../../../ui/questlog/Quests.js';
import { Skills } from '../../../skills/Skills.js';
import { Locs, type Loc } from '../../../locs/Locs.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Traversal } from '../../../walking/Traversal.js';
import Tile from '../../../../geometry/Tile.js';
import { GameMessages } from '../../../chatbox/gameMessages.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { talkThrough, walkWithHops, type LadderHop, type NpcStop } from '../exec/primitives.js';
import { executeStep } from '../exec/steps.js';

export const WATERFALL_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_TO_HUDON: 2,
    READ_BOOK: 3,
    ENTERED_TOMB: 4,
    ENTERED_WATERFALL: 5,
    ENTERED_PUZZLE: 6,
    RAISED_FLOOR: 8,
    COMPLETE: 10
} as const;

interface WaterfallItem {
    id: number;
    name: string;
}

const ITEM = {
    BOOK: { id: 292, name: 'Book on baxtorian' },
    GOLRIE_KEY: { id: 293, name: 'A key' },
    PEBBLE: { id: 294, name: "Glarial's pebble" },
    AMULET: { id: 295, name: "Glarial's amulet" },
    FULL_URN: { id: 296, name: "Glarial's urn" },
    EMPTY_URN: { id: 297, name: "Glarial's urn" },
    BAXTORIAN_KEY: { id: 298, name: 'A key' },
    WATER_RUNE: { id: 555, name: 'Water rune' },
    AIR_RUNE: { id: 556, name: 'Air rune' },
    EARTH_RUNE: { id: 557, name: 'Earth rune' },
    COINS: { id: 995, name: 'Coins' },
    KEBAB: { id: 1971, name: 'Kebab' },
    ROPE: { id: 954, name: 'Rope' },
    TEA: { id: 1978, name: 'Cup of tea' },
    BREAD: { id: 2309, name: 'Bread' }
} as const satisfies Record<string, WaterfallItem>;

const RUNES = [ITEM.AIR_RUNE, ITEM.EARTH_RUNE, ITEM.WATER_RUNE] as const;
const BREAD_TARGET = 15;
const TRAVEL_TEA_TARGET = 10;
const RUNE_TARGET = 6;
const RUNE_UNIT_BUDGET = 24;
const BETTY_RETURN_FARE = 60;
const EASTERN_SUPPLY_FARE = 60;
const CASH_FLOAT = 500;
// Why: the forced entry, crate, south-door route is 80 physical tiles, and at the prepared pack's roughly 9 kg 40% covers about 105 running tiles through the fire-giant lane.
// Why: the nav cost reads 89 because three door edges are weighted.
const DUNGEON_RUN_ENERGY = 40;

const LOC = {
    RAFT: 1987,
    BOOKCASE: 1989,
    GOLRIE_CRATE: 1990,
    GOLRIE_GATE: 1991,
    TOMBSTONE: 1992,
    COFFIN: 1993,
    CHEST_CLOSED: 1994,
    CHEST_OPEN: 1995,
    CROSSING_ROCK: 1996,
    BAXTORIAN_CRATE: 1999,
    ENTRY_DOOR: 2000,
    KEYED_DOOR: 2002,
    PILLAR: 2004,
    GLARIAL_STATUE: 2006,
    LEDGE_DOOR: 2010,
    CHALICE: 2014,
    DEAD_TREE: 2020,
    BARREL: 2022
} as const;

const ARDOUGNE_BANK = new Tile(2616, 3332, 0);
const VARROCK_EAST_BANK = new Tile(3253, 3420, 0);
const AEMAD_SHOP = { npc: 'Aemad', anchor: new Tile(2614, 3293, 0) };
const BAKER_SHOP = { npc: 'Baker', anchor: new Tile(2654, 3311, 0) };
const TEA_SHOP = { npc: 'Tea seller', anchor: new Tile(3271, 3411, 0) };
const BETTY_SHOP = { npc: 'Betty', anchor: new Tile(3012, 3259, 0) };
const VARROCK_MAN = new Tile(3240, 3405, 0);
const AL_KHARID_MAN = new Tile(3279, 3188, 0);
const KEBAB_SELLER = new Tile(3272, 3182, 0);
const AL_KHARID_TOLL = 10;
const AL_KHARID_ENTRY_CASH = AL_KHARID_TOLL + 3;
const SAFE_PICKPOCKET_HP = 3;
const FUNDING_MAN_LEASH = 24;
const FUNDING_STALL_MS = 120_000;

const ALMERA: NpcStop = {
    npc: 'Almera',
    anchor: new Tile(2522, 3498, 0),
    leash: 6,
    prefer: ['How can I help?']
};

const WATERFALL_HOPS: LadderHop[] = [
    { stand: new Tile(2533, 3156, 0), locName: 'Ladder', op: 'Climb-down', arrive: new Tile(2533, 9556, 0) },
    { stand: new Tile(2533, 9556, 0), locName: 'Ladder', op: 'Climb-up', arrive: new Tile(2533, 3156, 0) }
];

const RAFT_STAND = new Tile(2509, 3493, 0);
const HUDON_STAND = new Tile(2511, 3481, 0);
const MOUND_SWIM_STAND = new Tile(2512, 3476, 0);
const BOOKCASE_STAND = new Tile(2519, 3426, 1);
const GOLRIE_CRATE_STAND = new Tile(2548, 9565, 0);
const GOLRIE_GATE_STAND = new Tile(2515, 9574, 0);
const GOLRIE_STAND = new Tile(2515, 9581, 0);
const TOMBSTONE_STAND = new Tile(2558, 3444, 0);
const CHEST_STAND = new Tile(2530, 9845, 0);
const COFFIN_STAND = new Tile(2542, 9810, 0);
// Why: directional ladder 1757 only accepts an approach from its east tile.
// Why: the exact stand keeps the hostile approach inside Traversal's sustain loop rather than handing an opaque final route to the interaction.
const TOMB_LADDER_STAND = new Tile(2557, 9844, 0);
const ROCK_STAND = new Tile(2512, 3477, 0);
const ENTRY_DOOR_STAND = new Tile(2575, 9861, 0);
// Why: the crate's south interaction tile (2589,9887) is adjacent to the level-45 giant skeleton at (2589,9886).
// Why: its west tile stays search-capable while sitting outside that NPC's one-tile aggression range.
const BAXTORIAN_CRATE_STAND = new Tile(2588, 9888, 0);
const SOUTH_DOOR_STAND = new Tile(2568, 9892, 0);
const SOUTH_DOOR_NORTH_STAND = new Tile(2568, 9894, 0);
const PUZZLE_DOOR_STAND = new Tile(2566, 9900, 0);
const PUZZLE_DOOR_NORTH_STAND = new Tile(2566, 9902, 0);
const PILLAR_STAND = new Tile(2563, 9911, 0);
const STATUE_STAND = new Tile(2565, 9915, 0);
const RAISED_ROOM_STAND = new Tile(2603, 9906, 0);

type WaterfallArea =
    | 'mainland'
    | 'hudonMound'
    | 'fallsTreeBank'
    | 'fallsLedge'
    | 'tgvDungeon'
    | 'glarialTomb'
    | 'waterfallDungeon'
    | 'puzzleRoom'
    | 'raisedRoom'
    | 'unknown';

export function waterfallArea(tile: QuestSnapshot['tile']): WaterfallArea {
    if (!tile) return 'unknown';
    const { x, z } = tile;
    if (x >= 2598 && x <= 2620 && z >= 9905 && z <= 9930) return 'raisedRoom';
    if (x >= 2558 && x <= 2572 && z >= 9907 && z <= 9920) return 'puzzleRoom';
    if (x >= 2490 && x <= 2630 && z >= 9850 && z <= 9950) return 'waterfallDungeon';
    if (x >= 2500 && x <= 2570 && z >= 9780 && z < 9850) return 'glarialTomb';
    if (x >= 2480 && x <= 2570 && z >= 9500 && z <= 9650) return 'tgvDungeon';
    if (x >= 2505 && x <= 2518 && z >= 3474 && z <= 3486) return 'hudonMound';
    if (x >= 2505 && x <= 2518 && z >= 3466 && z <= 3473) return 'fallsTreeBank';
    if (x >= 2505 && x <= 2518 && z >= 3460 && z <= 3465) return 'fallsLedge';
    return 'mainland';
}

type WaterfallDungeonEntryReadiness = 'waitForEnergy' | 'heal' | 'enableRun' | 'ready';

export function waterfallDungeonEntryReadiness(
    energy: number,
    currentHp: number,
    baseHp: number,
    runEnabled: boolean
): WaterfallDungeonEntryReadiness {
    if (energy < DUNGEON_RUN_ENERGY) return 'waitForEnergy';
    if (currentHp < baseHp) return 'heal';
    if (!runEnabled) return 'enableRun';
    return 'ready';
}

function normalizeJournal(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

export function parseWaterfallJournal(lines: readonly string[] | string): number | undefined {
    const text = normalizeJournal(lines);
    // Later entries retain the complete earlier history, so match newest first.
    if (text.includes('quest complete!')) return WATERFALL_STAGE.COMPLETE;
    if (text.includes('worked out how to raise the floor') || text.includes('now i just need to retrieve the treasure')) {
        return WATERFALL_STAGE.RAISED_FLOOR;
    }
    if (text.includes('it is floating out of reach') || text.includes("i'll need to work out how to get to it")) {
        return WATERFALL_STAGE.ENTERED_PUZZLE;
    }
    if (text.includes('used it to enter baxtorian falls')) return WATERFALL_STAGE.ENTERED_WATERFALL;
    if (text.includes('managed to enter the tomb of glarial')) return WATERFALL_STAGE.ENTERED_TOMB;
    if (text.includes("the book also mentions glarial's tomb")) return WATERFALL_STAGE.READ_BOOK;
    if (text.includes('i found hudon a short raft ride down the river')) return WATERFALL_STAGE.SPOKEN_TO_HUDON;
    if (text.includes('i spoke to almera in a house close to the baxtorian waterfall')) return WATERFALL_STAGE.STARTED;
    if (text.includes('i can start this quest')) return WATERFALL_STAGE.NOT_STARTED;
    return undefined;
}

export async function readWaterfallStage(): Promise<number | undefined> {
    const status = Quests.status('Waterfall Quest');
    if (status === 'complete') return WATERFALL_STAGE.COMPLETE;
    if (status === 'notStarted') return WATERFALL_STAGE.NOT_STARTED;
    if (status !== 'inProgress') return undefined;

    // Varp 65 is permanent server state but is not transmitted to revision-274
    // clients. The rendered journal is the exact browser-visible stage oracle.
    const stage = parseWaterfallJournal(await Quests.journal('Waterfall Quest'));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

function countId(map: ReadonlyMap<number, number> | undefined, id: number): number {
    return map?.get(id) ?? 0;
}

function heldCount(snap: QuestSnapshot, item: WaterfallItem): number {
    return snap.invIds ? countId(snap.invIds, item.id) : (snap.inv.get(item.name.toLowerCase()) ?? 0);
}

function held(snap: QuestSnapshot, item: WaterfallItem): boolean {
    return heldCount(snap, item) > 0;
}

function worn(snap: QuestSnapshot, item: WaterfallItem): boolean {
    return snap.wornIds ? snap.wornIds.has(item.id) : snap.worn.has(item.name.toLowerCase());
}

function banked(snap: QuestSnapshot, item: WaterfallItem): number {
    return snap.bankIds ? countId(snap.bankIds, item.id) : (snap.bank?.get(item.name.toLowerCase()) ?? 0);
}

function owned(snap: QuestSnapshot, item: WaterfallItem): number {
    return heldCount(snap, item) + banked(snap, item) + (worn(snap, item) ? 1 : 0);
}

function liveItem(item: WaterfallItem): InvItem | null {
    return Inventory.items().find(candidate => candidate.id === item.id) ?? null;
}

function liveCount(item: WaterfallItem): number {
    return Inventory.items().filter(candidate => candidate.id === item.id).reduce((sum, candidate) => sum + candidate.count, 0);
}

function liveWorn(item: WaterfallItem): boolean {
    return Equipment.items().some(candidate => candidate.id === item.id);
}

type WithdrawItem = { name: string; qty: number; id?: number };

function withdraw(items: WithdrawItem[], bank: Tile = ARDOUGNE_BANK): QuestStep {
    return { kind: 'withdraw', items, bank };
}

function withdrawExact(item: WaterfallItem, qty: number, bank: Tile = ARDOUGNE_BANK): QuestStep {
    return withdraw([{ name: item.name, id: item.id, qty }], bank);
}

function scanBank(bank: Tile = ARDOUGNE_BANK): QuestStep {
    return { kind: 'scanBank', bank };
}

function coinsHeld(snap: QuestSnapshot): number {
    return heldCount(snap, ITEM.COINS);
}

function remainingWaterfallCash(snap: QuestSnapshot): number {
    // Why: a blank eastern account needs 1,472 gp at Varrock East — 500 retained float, 100 Tea, 300 Bread, 20 Rope, 432 runes, 60 for the later Betty leg and 60 for the safe eastern supply leg.
    // Why: that last 60 is not headroom, as the live level-3 route to the Baker crossed Port Sarim to Musa and Brimhaven to Ardougne at 30 gp each.
    const tea = needsEasternTravelBootstrap(snap)
        ? Math.max(0, TRAVEL_TEA_TARGET - owned(snap, ITEM.TEA)) * 10
        : 0;
    const bread = Math.max(0, BREAD_TARGET - owned(snap, ITEM.BREAD)) * 20;
    const rope = owned(snap, ITEM.ROPE) > 0 ? 0 : 20;
    const runes = RUNES.reduce(
        (total, rune) => total + Math.max(0, RUNE_TARGET - owned(snap, rune)) * RUNE_UNIT_BUDGET,
        0
    );
    const supplyFare = needsEasternTravelBootstrap(snap) ? EASTERN_SUPPLY_FARE : 0;
    // Why: stage zero cannot buy runes yet, and even a restart beside Betty retains the later fare, as the quest first leaves and returns west.
    const runeFare = runes > 0 ? BETTY_RETURN_FARE : 0;
    return CASH_FLOAT + tea + bread + rope + runes + supplyFare + runeFare;
}

function liveCoins(): number {
    return liveCount(ITEM.COINS);
}

function inAlKharidFundingArea(tile: ReturnType<typeof Game.tile>): boolean {
    return tile !== null
        && tile.level === 0
        && tile.x >= 3230
        && tile.x <= 3330
        && tile.z >= 3120
        && tile.z <= 3227;
}

function fundingMan(anchor: Tile) {
    return Npcs.query()
        .name('Man')
        .action('Pickpocket')
        .where(npc => npc.tile().distanceTo(anchor) <= FUNDING_MAN_LEASH)
        .nearest();
}

async function reachFundingMan(anchor: Tile, log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(anchor, { radius: 6, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    if (fundingMan(anchor)) return true;
    if (await Execution.delayUntil(() => fundingMan(anchor) !== null, 15_000)) return true;
    log(`no pickpocketable Man returned within ${FUNDING_MAN_LEASH} tiles of (${anchor.x},${anchor.z})`);
    return false;
}

async function clearFundingContinues(): Promise<void> {
    for (let pages = 0; pages < 12 && ChatDialog.canContinue(); pages++) {
        await ChatDialog.continue();
        await Execution.delayTicks(1);
    }
}

async function pickpocketFundingMan(anchor: Tile, log: (message: string) => void): Promise<boolean> {
    let man = fundingMan(anchor);
    if (!man) {
        if (!(await reachFundingMan(anchor, log))) return false;
        man = fundingMan(anchor);
    }
    if (!man) return false;

    const coinsBefore = liveCoins();
    const xpBefore = Skills.xp('thieving');
    const hpBefore = Skills.effective('hitpoints');
    if (!(await man.interact('Pickpocket'))) return false;
    const resolved = await Execution.delayUntil(
        () => liveCoins() > coinsBefore
            || Skills.xp('thieving') > xpBefore
            || Skills.effective('hitpoints') < hpBefore
            || ChatDialog.canContinue(),
        8000
    );
    if (!resolved) {
        log(`pickpocketing Man at ${man.tile()} produced no coin, XP, health, or dialogue change`);
        // A walking target can step away after the packet is accepted. This is
        // an observed miss, not a failed funding route; re-query the live NPC.
        await Execution.delayTicks(2);
        return true;
    }
    await clearFundingContinues();
    if (Skills.effective('hitpoints') < hpBefore) {
        // A failed level-1 Man pickpocket stuns for eight server ticks.
        await Execution.delayTicks(8);
    }
    return true;
}

async function buyFundingKebab(log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(KEBAB_SELLER, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const seller = Npcs.query().name('Kebab seller').action('Talk-to').within(8).nearest();
    if (!seller) {
        log(`no talkable Kebab seller near (${KEBAB_SELLER.x},${KEBAB_SELLER.z})`);
        return false;
    }
    const kebabsBefore = liveCount(ITEM.KEBAB);
    if (!(await seller.interact('Talk-to'))) return false;

    for (let step = 0; step < 40; step++) {
        if (liveCount(ITEM.KEBAB) > kebabsBefore) return true;
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const choice = options.find(option => option.trim().toLowerCase() === 'yes please.');
            if (!choice) {
                log(`Kebab seller offered unexpected options: [${options.join(' | ')}]`);
                return false;
            }
            if (!(await ChatDialog.chooseOption(choice))) return false;
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    log('Kebab seller accepted no exact purchase within 40 dialogue steps');
    return false;
}

async function eatFundingKebab(): Promise<boolean> {
    const kebab = liveItem(ITEM.KEBAB);
    if (!kebab) return false;
    const before = liveCount(ITEM.KEBAB);
    if (!(await kebab.interact('Eat'))) return false;
    return Execution.delayUntil(() => liveCount(ITEM.KEBAB) < before, 5000);
}

async function restoreFundingHealth(kebabsAvailable: boolean, log: (message: string) => void): Promise<boolean> {
    while (Skills.effective('hitpoints') < SAFE_PICKPOCKET_HP) {
        if (kebabsAvailable && liveCoins() > 0) {
            if (!(await buyFundingKebab(log)) || !(await eatFundingKebab())) return false;
            continue;
        }
        log(`waiting for ${SAFE_PICKPOCKET_HP} Hitpoints before another Man pickpocket`);
        await Execution.delayUntil(() => Skills.effective('hitpoints') >= SAFE_PICKPOCKET_HP, 0);
    }
    return true;
}

async function farmWaterfallCoins(
    anchor: Tile,
    target: number,
    kebabsAvailable: boolean,
    log: (message: string) => void
): Promise<boolean> {
    if (!(await reachFundingMan(anchor, log))) return false;
    let reportedHundreds = Math.floor(liveCoins() / 100);
    let lastEvidenceAt = performance.now();
    while (liveCoins() < target) {
        const coinsBefore = liveCoins();
        const xpBefore = Skills.xp('thieving');
        const hpBefore = Skills.effective('hitpoints');
        if (!(await restoreFundingHealth(kebabsAvailable, log))) return false;
        if (!(await pickpocketFundingMan(anchor, log))) return false;
        if (liveCoins() !== coinsBefore
            || Skills.xp('thieving') !== xpBefore
            || Skills.effective('hitpoints') !== hpBefore) {
            lastEvidenceAt = performance.now();
        } else if (performance.now() - lastEvidenceAt >= FUNDING_STALL_MS) {
            log(`no cash, Thieving XP, or Hitpoints change for ${FUNDING_STALL_MS / 1000}s at the verified Man`);
            return false;
        }
        const hundreds = Math.floor(liveCoins() / 100);
        if (hundreds > reportedHundreds) {
            reportedHundreds = hundreds;
            log(`Waterfall funding: ${liveCoins()}/${target} gp`);
        }
    }
    return true;
}

export function waterfallFundingTarget(minimum: number, returnBank: Tile): number {
    const returnFare = AL_KHARID_TOLL + (returnBank.x < 3100 ? EASTERN_SUPPLY_FARE : 0);
    return minimum + returnFare;
}

async function fundWaterfallCoins(minimum: number, returnBank: Tile, log: (message: string) => void): Promise<boolean> {
    if (liveCoins() >= minimum && !inAlKharidFundingArea(Game.tile())) return true;

    if (!inAlKharidFundingArea(Game.tile())) {
        if (liveCoins() < AL_KHARID_ENTRY_CASH) {
            log(`earning the ${AL_KHARID_TOLL} gp Al Kharid toll and a food reserve from a Varrock Man`);
            if (!(await farmWaterfallCoins(VARROCK_MAN, AL_KHARID_ENTRY_CASH, false, log))) return false;
        }
        if (liveCoins() >= minimum) return true;
        if (!(await Traversal.walkResilient(AL_KHARID_MAN, { radius: 6, attempts: 4, timeoutMs: 240_000, log }))) {
            return false;
        }
        if (!inAlKharidFundingArea(Game.tile())) {
            log('did not cross the Al Kharid toll gate into the verified Man/Kebab area');
            return false;
        }
    }

    // Returning to Varrock pays only the gate. Returning to the western supply
    // bank then takes the two exact 30-gp ship edges observed on the safe route.
    const target = waterfallFundingTarget(minimum, returnBank);
    log(`pickpocketing the Al Kharid Man to ${target} gp, buying exact Kebabs below ${SAFE_PICKPOCKET_HP} HP`);
    if (!(await farmWaterfallCoins(AL_KHARID_MAN, target, true, log))) return false;
    if (!(await Traversal.walkResilient(returnBank, { radius: 3, attempts: 4, timeoutMs: 300_000, log }))) {
        return false;
    }
    if (liveCoins() < minimum) {
        log(`returned from self-funding with ${liveCoins()} gp, below the required ${minimum}`);
        return false;
    }
    return true;
}

function ensureCoins(snap: QuestSnapshot, minimum: number = CASH_FLOAT, bank: Tile = ARDOUGNE_BANK): QuestStep | null {
    if (coinsHeld(snap) >= minimum) return null;
    const available = banked(snap, ITEM.COINS);
    if (available <= 0) {
        return {
            kind: 'custom',
            name: `earn ${minimum} gp for Waterfall supplies`,
            run: log => fundWaterfallCoins(minimum, bank, log)
        };
    }
    return withdrawExact(ITEM.COINS, Math.min(Math.max(minimum - coinsHeld(snap), 1), available), bank);
}

function sourceRope(snap: QuestSnapshot, bank: Tile = ARDOUGNE_BANK): QuestStep | null {
    if (held(snap, ITEM.ROPE)) return null;
    if (!snap.bankKnown) return scanBank(bank);
    if (banked(snap, ITEM.ROPE) > 0) return withdrawExact(ITEM.ROPE, 1, bank);
    const coins = ensureCoins(snap, CASH_FLOAT, bank);
    return coins ?? { kind: 'buy', item: ITEM.ROPE.name, qty: 1, shop: AEMAD_SHOP, estGp: 20 };
}

function sourceBread(snap: QuestSnapshot, bank: Tile = ARDOUGNE_BANK): QuestStep | null {
    const missing = BREAD_TARGET - heldCount(snap, ITEM.BREAD);
    if (missing <= 0) return null;
    if (!snap.bankKnown) return scanBank(bank);
    const inBank = banked(snap, ITEM.BREAD);
    if (inBank > 0) return withdrawExact(ITEM.BREAD, Math.min(missing, inBank), bank);
    if (snap.freeSlots !== undefined && snap.freeSlots < missing) {
        return { kind: 'wait', reason: 'need ' + missing + ' free slots for combat Bread' };
    }
    const coins = ensureCoins(snap, CASH_FLOAT, bank);
    return coins ?? { kind: 'buy', item: ITEM.BREAD.name, qty: missing, shop: BAKER_SHOP, estGp: missing * 20 };
}

function nearerSupplyBank(snap: QuestSnapshot): Tile {
    return needsEasternTravelBootstrap(snap) ? VARROCK_EAST_BANK : ARDOUGNE_BANK;
}

function needsEasternTravelBootstrap(snap: QuestSnapshot): boolean {
    // Why: Lumbridge, Varrock and Al Kharid are far enough east that a fresh level-3 account needs the extra Tea leg.
    // Why: Betty and Port Sarim sit west of this boundary on purpose, so rune shopping cannot restart the bootstrap.
    return (snap.tile?.x ?? 0) >= 3100;
}

function sourceTravelFood(snap: QuestSnapshot, bank: Tile = nearerSupplyBank(snap)): QuestStep | null {
    const missingTea = needsEasternTravelBootstrap(snap)
        ? TRAVEL_TEA_TARGET - heldCount(snap, ITEM.TEA)
        : 0;
    const missingBread = BREAD_TARGET - heldCount(snap, ITEM.BREAD);
    if (missingTea <= 0 && missingBread <= 0) return null;
    if (!snap.bankKnown) return scanBank(bank);
    if (missingTea > 0) {
        const inBank = banked(snap, ITEM.TEA);
        if (inBank > 0) return withdrawExact(ITEM.TEA, Math.min(missingTea, inBank), bank);
        if (snap.freeSlots !== undefined && snap.freeSlots < missingTea) {
            return { kind: 'wait', reason: 'need ' + missingTea + ' free slots for fresh-account travel tea' };
        }
        const coins = ensureCoins(snap, CASH_FLOAT + missingTea * 10, bank);
        return coins ?? { kind: 'buy', item: ITEM.TEA.name, qty: missingTea, shop: TEA_SHOP, estGp: missingTea * 10 };
    }
    return sourceBread(snap, bank);
}

function nearBetty(snap: QuestSnapshot): boolean {
    const tile = snap.tile;
    return tile !== null && tile !== undefined
        && Math.max(Math.abs(tile.x - BETTY_SHOP.anchor.x), Math.abs(tile.z - BETTY_SHOP.anchor.z)) <= 16;
}

function sourcePuzzleRunes(snap: QuestSnapshot): QuestStep | null {
    if (!snap.bankKnown) return scanBank();

    // Empty every useful bank stack before going to Betty. Otherwise an earlier
    // missing rune can trigger a shop trip before a later free stack is noticed.
    const bankWithdrawals: WithdrawItem[] = [];
    for (const rune of RUNES) {
        const missing = RUNE_TARGET - heldCount(snap, rune);
        const inBank = banked(snap, rune);
        if (missing > 0 && inBank > 0) {
            bankWithdrawals.push({ name: rune.name, id: rune.id, qty: Math.min(missing, inBank) });
        }
    }
    if (bankWithdrawals.length > 0) return withdraw(bankWithdrawals);

    const missingRunes = RUNES.map(rune => ({ rune, missing: Math.max(0, RUNE_TARGET - heldCount(snap, rune)) }))
        .filter(entry => entry.missing > 0);
    if (missingRunes.length === 0) return null;

    // Why: Betty's shared stock price rises as items are bought, and 24 gp per rune is the server's hard upper bound.
    // Why: the normal cash float is retained after every purchase, and before departure both paid ship edges observed on the route are reserved, so later per-stack decisions never bounce back to the bank.
    const purchaseBudget = missingRunes.reduce((total, entry) => total + entry.missing * RUNE_UNIT_BUDGET, 0);
    const reserve = CASH_FLOAT + (nearBetty(snap) ? 0 : BETTY_RETURN_FARE);
    const coins = ensureCoins(snap, reserve + purchaseBudget);
    if (coins) return coins;

    const { rune, missing } = missingRunes[0];
    return { kind: 'buy', item: rune.name, qty: missing, shop: BETTY_SHOP, estGp: missing * RUNE_UNIT_BUDGET };
}

function inventoryHasOutsideIds(snap: QuestSnapshot, keepIds: readonly number[]): boolean {
    if (snap.invIds) {
        return [...snap.invIds.keys()].some(id => !keepIds.includes(id));
    }
    const keepNames = new Set(
        Object.values(ITEM)
            .filter(item => keepIds.includes(item.id))
            .map(item => item.name.toLowerCase())
    );
    return [...snap.inv.keys()].some(name => !keepNames.has(name));
}

const MAX_LOADOUT_COUNT = new Map<number, number>([
    [ITEM.BOOK.id, 1],
    [ITEM.GOLRIE_KEY.id, 1],
    [ITEM.PEBBLE.id, 1],
    [ITEM.AMULET.id, 1],
    [ITEM.FULL_URN.id, 1],
    [ITEM.EMPTY_URN.id, 1],
    [ITEM.BAXTORIAN_KEY.id, 1],
    [ITEM.WATER_RUNE.id, RUNE_TARGET],
    [ITEM.AIR_RUNE.id, RUNE_TARGET],
    [ITEM.EARTH_RUNE.id, RUNE_TARGET],
    [ITEM.ROPE.id, 1],
    [ITEM.TEA.id, TRAVEL_TEA_TARGET],
    [ITEM.BREAD.id, BREAD_TARGET]
]);

function inventoryHasExcessKeptIds(snap: QuestSnapshot, keepIds: readonly number[]): boolean {
    if (!snap.invIds) return false;
    return [...snap.invIds.entries()].some(([id, count]) => {
        const maximum = MAX_LOADOUT_COUNT.get(id);
        return keepIds.includes(id) && maximum !== undefined && count > maximum;
    });
}

async function stripAndDeposit(
    keepIds: readonly number[],
    log: (message: string) => void,
    bank: Tile = ARDOUGNE_BANK
): Promise<boolean> {
    const deposit = (leaveOpen: boolean): Promise<boolean> =>
        executeStep(
            {
                kind: 'deposit',
                keep: [],
                keepIds,
                exactKeep: true,
                bank,
                leaveOpen
            },
            WATERFALL_HOPS,
            log
        );

    // Clear the backpack first so every equipped slot can be removed even when
    // a recovery account reached the bank with a full inventory.
    if (!(await deposit(false))) return false;
    for (const item of Equipment.items()) {
        if (item.name && !(await Equipment.unequip(item.name))) return false;
    }
    // Leave the final view open so QuestEngine refreshes both its name and
    // exact-ID bank caches before making the next recovery decision.
    return deposit(true);
}

function normalizeLoadout(
    snap: QuestSnapshot,
    keepIds: readonly number[],
    name: string,
    bank: Tile = ARDOUGNE_BANK
): QuestStep | null {
    const hasExcess = inventoryHasExcessKeptIds(snap, keepIds);
    const hasEquipment = snap.worn.size > 0 || (snap.wornIds?.size ?? 0) > 0;
    if (!hasEquipment && !inventoryHasOutsideIds(snap, keepIds) && !hasExcess) return null;
    // Why: the bank API can keep an exact id but not a partial quantity, so an otherwise valid item over its phase limit means banking the pack and letting the stage planner withdraw the precise quantities on its next snapshot.
    // Why: equipment needs the same empty-pack treatment, so every worn slot has room to unequip before the final deposit pass.
    const normalizedKeepIds = hasExcess || hasEquipment ? [] : keepIds;
    return { kind: 'custom', name, run: log => stripAndDeposit(normalizedKeepIds, log, bank) };
}

const START_KEEP = [ITEM.COINS.id, ITEM.ROPE.id, ITEM.TEA.id, ITEM.BREAD.id] as const;
const BOOK_TRAVEL_KEEP = [...START_KEEP, ITEM.BOOK.id] as const;
const TOMB_KEEP = [
    ITEM.COINS.id,
    ITEM.PEBBLE.id,
    ITEM.BREAD.id,
    ITEM.AMULET.id,
    ITEM.FULL_URN.id,
    ITEM.BAXTORIAN_KEY.id
] as const;
const TOMB_TRAVEL_KEEP = [ITEM.COINS.id, ITEM.PEBBLE.id, ITEM.TEA.id, ITEM.BREAD.id] as const;
const DUNGEON_KEEP = [
    ITEM.COINS.id,
    ITEM.ROPE.id,
    ITEM.BREAD.id,
    ITEM.AMULET.id,
    ITEM.FULL_URN.id,
    ITEM.BAXTORIAN_KEY.id,
    ITEM.AIR_RUNE.id,
    ITEM.EARTH_RUNE.id,
    ITEM.WATER_RUNE.id
] as const;
const FINAL_KEEP = [
    ITEM.COINS.id,
    ITEM.ROPE.id,
    ITEM.BREAD.id,
    ITEM.AMULET.id,
    ITEM.FULL_URN.id,
    ITEM.BAXTORIAN_KEY.id
] as const;
const DUNGEON_TRAVEL_KEEP = [...DUNGEON_KEEP, ITEM.TEA.id] as const;
const FINAL_TRAVEL_KEEP = [...FINAL_KEEP, ITEM.TEA.id] as const;

async function boardRaft(log: (message: string) => void, driveHudon: boolean = false): Promise<boolean> {
    if (!(await Traversal.walkResilient(RAFT_STAND, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) return false;
    const raft = Locs.query().where(loc => loc.id === LOC.RAFT).action('Board').within(8).nearest();
    if (!raft || !(await raft.interact('Board'))) return false;
    if (driveHudon) {
        await Execution.delayUntil(() => ChatDialog.canContinue(), 12_000);
        // Why: stage 2 is set partway through the forced Hudon conversation, so it is finished here and a transient gap between pages cannot let the engine walk away while the server script is still suspended at stage 1.
        for (let page = 0; page < 14 && ChatDialog.canContinue(); page++) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
        }
    }
    return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'hudonMound', 12_000);
}

async function stageOneLeg(log: (message: string) => void): Promise<boolean> {
    if (waterfallArea(Game.tile()) !== 'hudonMound') return boardRaft(log, true);
    if (!(await Traversal.walkResilient(HUDON_STAND, { radius: 2, attempts: 2, timeoutMs: 30_000, log }))) return false;
    return talkThrough('Hudon', [], log);
}

async function leaveHudonMound(log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(MOUND_SWIM_STAND, { radius: 1, attempts: 3, timeoutMs: 30_000, log }))) return false;
    const rock = Locs.query().where(loc => loc.id === LOC.CROSSING_ROCK).action('Swim to').within(10).nearest();
    if (!rock || !(await rock.interact('Swim to'))) return false;
    return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'mainland', 20_000);
}

async function readBook(): Promise<boolean> {
    const book = liveItem(ITEM.BOOK);
    if (!book || !(await book.interact('Read'))) return false;
    await Execution.delayUntil(() => reader.modals().main !== -1, 5000);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return true;
}

async function bookLeg(log: (message: string) => void): Promise<boolean> {
    if (liveCount(ITEM.BOOK) > 0) return readBook();
    if (waterfallArea(Game.tile()) === 'hudonMound') return leaveHudonMound(log);
    if (!(await Traversal.walkResilient(BOOKCASE_STAND, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) return false;
    const shelf = Locs.query().where(loc => loc.id === LOC.BOOKCASE).action('Search').within(8).nearest();
    if (!shelf || !(await shelf.interact('Search'))) return false;
    if (!(await Execution.delayUntil(() => liveCount(ITEM.BOOK) > 0, 8000))) return false;
    return readBook();
}

async function leaveTgvDungeon(log: (message: string) => void): Promise<boolean> {
    return walkWithHops(new Tile(2533, 3156, 0), 3, WATERFALL_HOPS, log);
}

async function pebbleLeg(log: (message: string) => void): Promise<boolean> {
    if (liveCount(ITEM.PEBBLE) > 0) return leaveTgvDungeon(log);
    if (waterfallArea(Game.tile()) !== 'tgvDungeon') {
        if (!(await walkWithHops(GOLRIE_CRATE_STAND, 2, WATERFALL_HOPS, log))) return false;
    }
    if (liveCount(ITEM.GOLRIE_KEY) === 0) {
        if (!(await Traversal.walkResilient(GOLRIE_CRATE_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const crate = Locs.query().where(loc => loc.id === LOC.GOLRIE_CRATE).action('Search').within(8).nearest();
        if (!crate || !(await crate.interact('Search'))) return false;
        return Execution.delayUntil(() => liveCount(ITEM.GOLRIE_KEY) > 0, 8000);
    }
    const tile = Game.tile();
    if (!tile || tile.z < 9576) {
        if (!(await Traversal.walkResilient(GOLRIE_GATE_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        const gate = Locs.query().where(loc => loc.id === LOC.GOLRIE_GATE).within(6).nearest();
        const key = liveItem(ITEM.GOLRIE_KEY);
        if (!gate || !key || !(await key.useOn(gate))) return false;
        return Execution.delayUntil(() => (Game.tile()?.z ?? 0) >= 9576, 8000);
    }
    if (!(await Traversal.walkResilient(GOLRIE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) return false;
    if (!(await talkThrough('Golrie', [], log))) return false;
    return liveCount(ITEM.PEBBLE) > 0;
}

async function tombExit(log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(TOMB_LADDER_STAND, { radius: 0, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    // If the recovery trip spent its last food, leaving immediately is still
    // safer than waiting in the armed-zombie corridor.
    await healToFull(log, 'Glarial tomb exit');
    const ladder = Locs.query().action('Climb-up').within(8).nearest();
    if (!ladder || !(await ladder.interact('Climb-up'))) return false;
    return Execution.delayUntil(() => waterfallArea(Game.tile()) !== 'glarialTomb', 12_000);
}

async function tombLeg(log: (message: string) => void): Promise<boolean> {
    if (waterfallArea(Game.tile()) !== 'glarialTomb') {
        if (!(await Traversal.walkResilient(TOMBSTONE_STAND, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        const stone = Locs.query().where(loc => loc.id === LOC.TOMBSTONE).within(8).nearest();
        const pebble = liveItem(ITEM.PEBBLE);
        if (!stone || !pebble || !(await pebble.useOn(stone))) return false;
        return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'glarialTomb', 15_000);
    }
    if (liveCount(ITEM.AMULET) === 0 && !liveWorn(ITEM.AMULET)) {
        if (!(await Traversal.walkResilient(CHEST_STAND, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
        const closed = Locs.query().where(loc => loc.id === LOC.CHEST_CLOSED).action('Open').within(8).nearest();
        if (closed) {
            if (!(await closed.interact('Open'))) return false;
            await Execution.delayTicks(2);
            return true;
        }
        const open = Locs.query().where(loc => loc.id === LOC.CHEST_OPEN).action('Search').within(8).nearest();
        if (!open || !(await open.interact('Search'))) return false;
        return Execution.delayUntil(() => liveCount(ITEM.AMULET) > 0, 8000);
    }
    if (liveCount(ITEM.FULL_URN) === 0) {
        if (!(await Traversal.walkResilient(COFFIN_STAND, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
        const coffin = Locs.query().where(loc => loc.id === LOC.COFFIN).action('Search').within(8).nearest();
        if (!coffin || !(await coffin.interact('Search'))) return false;
        return Execution.delayUntil(() => liveCount(ITEM.FULL_URN) > 0, 8000);
    }
    return tombExit(log);
}

async function barrelEscape(log: (message: string) => void): Promise<boolean> {
    if (waterfallArea(Game.tile()) !== 'fallsLedge') return true;
    const barrel = Locs.query().where(loc => loc.id === LOC.BARREL).action('Get in').within(12).nearest();
    if (!barrel) {
        log('no Waterfall escape barrel is loaded on the ledge');
        return false;
    }
    if (!(await barrel.interact('Get in'))) return false;
    return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'mainland', 15_000);
}

async function crossKeyedDoor(stand: Tile, arrived: () => boolean, log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(stand, { radius: 1, attempts: 3, timeoutMs: 90_000, log }))) return false;
    const door = Locs.query().where(loc => loc.id === LOC.KEYED_DOOR).within(4).nearest();
    const key = liveItem(ITEM.BAXTORIAN_KEY);
    if (!door || !key || !(await key.useOn(door))) return false;
    return Execution.delayUntil(arrived, 12_000);
}

async function exitWaterfallDungeon(log: (message: string) => void): Promise<boolean> {
    let area = waterfallArea(Game.tile());
    if (area === 'raisedRoom') {
        // Taking the treasure without using the urn is the quest's safe washout
        // path. It deals no damage and is also an escape when the key was lost.
        const chalice = Locs.query().where(loc => loc.id === LOC.CHALICE).action('Take treasure').within(12).nearest();
        if (!chalice || !(await chalice.interact('Take treasure'))) return false;
        return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'mainland', 30_000);
    }
    if (area === 'puzzleRoom') {
        if (!(await crossKeyedDoor(PUZZLE_DOOR_NORTH_STAND, () => (Game.tile()?.z ?? 9999) < 9902, log))) return false;
        area = waterfallArea(Game.tile());
    }
    const tile = Game.tile();
    if ((area === 'waterfallDungeon' || area === 'puzzleRoom') && tile && tile.z >= 9894) {
        if (!(await crossKeyedDoor(SOUTH_DOOR_NORTH_STAND, () => (Game.tile()?.z ?? 9999) < 9894, log))) return false;
    }
    if (waterfallArea(Game.tile()) === 'waterfallDungeon') {
        if (!(await Traversal.walkResilient(ENTRY_DOOR_STAND, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
        const door = Locs.query().where(loc => loc.id === LOC.ENTRY_DOOR).action('Open').within(8).nearest();
        if (!door || !(await door.interact('Open'))) return false;
        if (!(await Execution.delayUntil(() => waterfallArea(Game.tile()) === 'fallsLedge', 15_000))) return false;
    }
    return barrelEscape(log);
}

async function healToFull(log: (message: string) => void, context: string): Promise<boolean> {
    while (Skills.effective('hitpoints') < Skills.level('hitpoints')) {
        const before = Skills.effective('hitpoints');
        await Sustain.run();
        if (Skills.effective('hitpoints') <= before) {
            log(`${context}: cannot reach full health without usable food`);
            return false;
        }
    }
    return true;
}

async function prepareDungeonSprint(log: (message: string) => void): Promise<boolean> {
    let loggedEnergyWait = false;
    for (;;) {
        const readiness = waterfallDungeonEntryReadiness(
            Game.energy(),
            Skills.effective('hitpoints'),
            Skills.level('hitpoints'),
            Game.runEnabled()
        );
        if (readiness === 'waitForEnergy') {
            if (!loggedEnergyWait) {
                log(`waiting on the safe Waterfall ledge for ${DUNGEON_RUN_ENERGY}% run energy`);
                loggedEnergyWait = true;
            }
            await Sustain.run();
            await Execution.delayTicks(5);
            continue;
        }
        if (readiness === 'heal') {
            if (await healToFull(log, 'Waterfall dungeon entry')) continue;
            await barrelEscape(log);
            return false;
        }
        if (readiness === 'enableRun') {
            if (!actions.setRun(true) || !(await Execution.delayUntil(() => Game.runEnabled(), 3000))) {
                log('could not enable run before entering the Waterfall dungeon');
                return false;
            }
            continue;
        }
        return true;
    }
}

async function fallsLeg(log: (message: string) => void): Promise<boolean> {
    const area = waterfallArea(Game.tile());
    if (area === 'fallsLedge') {
        if (!(await prepareDungeonSprint(log))) return false;
        const door = Locs.query().where(loc => loc.id === LOC.LEDGE_DOOR).action('Open').within(6).nearest();
        if (!door || !(await door.interact('Open'))) return false;
        return Execution.delayUntil(
            () => ['waterfallDungeon', 'puzzleRoom', 'raisedRoom'].includes(waterfallArea(Game.tile())),
            15_000
        );
    }
    if (area === 'fallsTreeBank') {
        const tree = Locs.query().where(loc => loc.id === LOC.DEAD_TREE).within(8).nearest();
        const rope = liveItem(ITEM.ROPE);
        if (!tree || !rope || !(await rope.useOn(tree))) return false;
        return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'fallsLedge', 10_000);
    }
    if (area === 'hudonMound') {
        if (!(await Traversal.walkResilient(ROCK_STAND, { radius: 1, attempts: 3, timeoutMs: 45_000, log }))) return false;
        const rock = Locs.query().where(loc => loc.id === LOC.CROSSING_ROCK).within(10).nearest();
        const rope = liveItem(ITEM.ROPE);
        if (!rock || !rope || !(await rope.useOn(rock))) return false;
        return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'fallsTreeBank', 10_000);
    }
    return boardRaft(log);
}

function pillarOrder(a: Loc, b: Loc): number {
    const at = a.tile();
    const bt = b.tile();
    return at.x - bt.x || at.z - bt.z;
}

async function placeRune(rune: WaterfallItem, pillar: Loc, log: (message: string) => void): Promise<boolean> {
    const item = liveItem(rune);
    if (!item) return true;
    const before = liveCount(rune);
    const messageMark = GameMessages.mark();
    if (!(await item.useOn(pillar))) return false;
    const processed = await Execution.delayUntil(
        () => liveCount(rune) < before
            || GameMessages.sawSince(messageMark, /you place the rune on the stand/i)
            || GameMessages.sawSince(messageMark, /you remember putting that type of rune there/i),
        8000
    );
    if (!processed) {
        const tile = pillar.tile();
        log(rune.name + ' placement on (' + tile.x + ',' + tile.z + ') was not acknowledged');
        return false;
    }
    return true;
}

async function solvePillars(log: (message: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(PILLAR_STAND, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) return false;
    await Execution.delayUntil(
        () => Locs.query().where(loc => loc.id === LOC.PILLAR).within(20).count() === 6,
        5000
    );
    const pillars = Locs.query().where(loc => loc.id === LOC.PILLAR).within(20).results().sort(pillarOrder);
    if (pillars.length !== 6) {
        log('pillar room loaded ' + pillars.length + '/6 pillars; waiting for a complete scene');
        return false;
    }

    // Why: varp 66 is server-only, and a fresh trip starts with six of each rune, so after an interrupted trip the number still held equals the number of unset pillars.
    // Why: replaying every possible placement is therefore idempotent — set bits consume nothing and unset bits consume one.
    for (const pillar of pillars) {
        for (const rune of RUNES) {
            if (!(await placeRune(rune, pillar, log))) return false;
        }
    }

    if (!(await Traversal.walkResilient(STATUE_STAND, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) return false;
    const statue = Locs.query().where(loc => loc.id === LOC.GLARIAL_STATUE).within(6).nearest();
    const amulet = liveItem(ITEM.AMULET);
    if (!statue || !amulet || !(await amulet.useOn(statue))) return false;
    return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'raisedRoom', 20_000);
}

async function findBaxtorianKey(log: (message: string) => void): Promise<boolean> {
    if (liveCount(ITEM.BAXTORIAN_KEY) > 0) return true;
    if (!(await Traversal.walkResilient(BAXTORIAN_CRATE_STAND, { radius: 0, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    if (!(await healToFull(log, 'Baxtorian crate'))) {
        await exitWaterfallDungeon(log);
        return false;
    }
    const crate = Locs.query().where(loc => loc.id === LOC.BAXTORIAN_CRATE).action('Search').within(8).nearest();
    if (!crate || !(await crate.interact('Search'))) return false;
    return Execution.delayUntil(() => liveCount(ITEM.BAXTORIAN_KEY) > 0, 8000);
}

async function completeQuest(log: (message: string) => void): Promise<boolean> {
    if (waterfallArea(Game.tile()) !== 'raisedRoom') return false;
    if (Inventory.free() < 5) {
        log('raised room pack has fewer than five reward slots; taking the safe washout');
        return exitWaterfallDungeon(log);
    }
    const chalice = Locs.query().where(loc => loc.id === LOC.CHALICE).within(12).nearest();
    const urn = liveItem(ITEM.FULL_URN);
    if (!chalice || !urn || !(await urn.useOn(chalice))) return false;
    return Execution.delayUntil(() => Quests.status('Waterfall Quest') === 'complete', 30_000);
}

async function dungeonLeg(stage: number, log: (message: string) => void): Promise<boolean> {
    const area = waterfallArea(Game.tile());
    if (area === 'raisedRoom') return stage >= WATERFALL_STAGE.RAISED_FLOOR ? completeQuest(log) : false;
    if (!(await findBaxtorianKey(log))) return false;
    const tile = Game.tile();
    if (!tile) return false;
    if (stage >= WATERFALL_STAGE.RAISED_FLOOR && tile.x >= 2598) {
        if (!(await Traversal.walkResilient(RAISED_ROOM_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
            return false;
        }
        return Execution.delayUntil(() => waterfallArea(Game.tile()) === 'raisedRoom', 5000);
    }
    if (stage >= WATERFALL_STAGE.RAISED_FLOOR && tile.z >= 9902) {
        return crossKeyedDoor(PUZZLE_DOOR_NORTH_STAND, () => (Game.tile()?.z ?? 9999) < 9902, log);
    }
    if (tile.z < 9894) {
        return crossKeyedDoor(SOUTH_DOOR_STAND, () => (Game.tile()?.z ?? 0) >= 9894, log);
    }
    if (tile.z < 9902) {
        return crossKeyedDoor(
            PUZZLE_DOOR_STAND,
            () => stage >= WATERFALL_STAGE.RAISED_FLOOR
                ? (Game.tile()?.x ?? 0) >= 2598
                : (Game.tile()?.z ?? 0) >= 9902,
            log
        );
    }
    return solvePillars(log);
}

function prepareTombEntry(snap: QuestSnapshot): QuestStep {
    const bank = nearerSupplyBank(snap);
    if (!snap.bankKnown) return scanBank(bank);
    if (!held(snap, ITEM.PEBBLE)) {
        const travelNormalize = normalizeLoadout(snap, TOMB_TRAVEL_KEEP, 'prepare a safe Glarial tomb recovery trip', bank);
        if (travelNormalize) return travelNormalize;
        const travelFood = sourceTravelFood(snap, bank);
        if (travelFood) return travelFood;
        if (banked(snap, ITEM.PEBBLE) > 0) return withdrawExact(ITEM.PEBBLE, 1, bank);
        return { kind: 'custom', name: 'recover Glarial pebble from Golrie', run: pebbleLeg };
    }
    const normalize = normalizeLoadout(snap, TOMB_KEEP, 'strip prohibited items before Glarial tomb');
    if (normalize) return normalize;
    const food = sourceTravelFood(snap, bank);
    if (food) return food;
    // Why: surviving relics are banked during the exposed Golrie leg and brought into the tomb, so only the missing relic is recovered.
    const survivingRelics = withdrawBankedRelics(snap, bank);
    if (survivingRelics) return survivingRelics;
    return { kind: 'custom', name: 'loot Glarial amulet and urn', run: tombLeg };
}

function recoverRelics(snap: QuestSnapshot): QuestStep | null {
    const missing = [ITEM.AMULET, ITEM.FULL_URN].filter(item => owned(snap, item) === 0);
    return missing.length > 0 ? prepareTombEntry(snap) : null;
}

function resumePebbleRecovery(snap: QuestSnapshot, area: WaterfallArea): QuestStep | null {
    if (area !== 'tgvDungeon' || !recoverRelics(snap)) return null;
    return { kind: 'custom', name: 'recover Glarial pebble from Golrie', run: pebbleLeg };
}

function withdrawBankedRelics(snap: QuestSnapshot, bank: Tile = ARDOUGNE_BANK): QuestStep | null {
    const items: WithdrawItem[] = [];
    for (const item of [ITEM.AMULET, ITEM.FULL_URN, ITEM.BAXTORIAN_KEY]) {
        if (!held(snap, item) && !worn(snap, item) && banked(snap, item) > 0) {
            items.push({ name: item.name, id: item.id, qty: 1 });
        }
    }
    return items.length > 0 ? withdraw(items, bank) : null;
}

function prepareDungeon(snap: QuestSnapshot, finalTrip: boolean): QuestStep | null {
    const bank = nearerSupplyBank(snap);
    if (!snap.bankKnown) return scanBank(bank);
    const relicRecovery = recoverRelics(snap);
    if (relicRecovery) return relicRecovery;
    // Why: any Bread refill first narrows the pack to travel supplies, so an arbitrary mainland restart with surviving relics or runes cannot fill the pack before all 15 Bread and a missing Rope are assembled.
    const replenishingFood = heldCount(snap, ITEM.BREAD) < BREAD_TARGET
        || (needsEasternTravelBootstrap(snap) && heldCount(snap, ITEM.TEA) < TRAVEL_TEA_TARGET);
    const travelNormalize = normalizeLoadout(
        snap,
        replenishingFood ? START_KEEP : (finalTrip ? FINAL_TRAVEL_KEEP : DUNGEON_TRAVEL_KEEP),
        finalTrip ? 'prepare a safe final Waterfall trip' : 'prepare a safe Waterfall dungeon trip',
        bank
    );
    if (travelNormalize) return travelNormalize;
    const food = sourceTravelFood(snap, bank);
    if (food) return food;
    const rope = sourceRope(snap, bank);
    if (rope) return rope;
    const normalize = normalizeLoadout(
        snap,
        finalTrip ? FINAL_KEEP : DUNGEON_KEEP,
        finalTrip ? 'bank puzzle leftovers for the final trip' : 'assemble the Waterfall dungeon loadout'
    );
    if (normalize) return normalize;
    const relics = withdrawBankedRelics(snap, bank);
    if (relics) return relics;
    if (!finalTrip) {
        const runes = sourcePuzzleRunes(snap);
        if (runes) return runes;
    }
    if (!held(snap, ITEM.AMULET) && !worn(snap, ITEM.AMULET)) {
        return { kind: 'wait', reason: "Glarial's amulet is not in the final loadout" };
    }
    if (!held(snap, ITEM.FULL_URN)) {
        return { kind: 'wait', reason: "Glarial's full urn is not in the final loadout" };
    }
    return null;
}

function escapeUnexpectedArea(area: WaterfallArea): QuestStep | null {
    if (area === 'hudonMound') {
        return { kind: 'custom', name: 'swim back from Hudon mound', run: leaveHudonMound };
    }
    if (area === 'fallsLedge') {
        return { kind: 'custom', name: 'leave the Waterfall ledge by barrel', run: barrelEscape };
    }
    if (area === 'fallsTreeBank') {
        return { kind: 'wait', reason: 'cannot leave the Waterfall tree bank safely without Rope' };
    }
    if (area === 'tgvDungeon') {
        return { kind: 'custom', name: 'leave the Tree Gnome Village dungeon', run: leaveTgvDungeon };
    }
    if (area === 'glarialTomb') {
        return { kind: 'custom', name: "leave Glarial's tomb", run: tombExit };
    }
    if (area === 'waterfallDungeon' || area === 'puzzleRoom' || area === 'raisedRoom') {
        return { kind: 'custom', name: 'leave the Waterfall dungeon safely', run: exitWaterfallDungeon };
    }
    return null;
}

function stageZero(snap: QuestSnapshot, area: WaterfallArea): QuestStep {
    if (area === 'unknown') return { kind: 'wait', reason: 'player location unavailable' };
    const escape = escapeUnexpectedArea(area);
    if (escape) return escape;
    const bank = nearerSupplyBank(snap);
    if (!snap.bankKnown) return scanBank(bank);
    const normalize = normalizeLoadout(snap, START_KEEP, 'bank everything except Waterfall supplies', bank);
    if (normalize) return normalize;
    const cash = ensureCoins(snap, remainingWaterfallCash(snap), bank);
    if (cash) return cash;
    const food = sourceTravelFood(snap, bank);
    if (food) return food;
    const rope = sourceRope(snap, bank);
    if (rope) return rope;
    return { kind: 'talk', stop: ALMERA };
}

function stageTwo(snap: QuestSnapshot, area: WaterfallArea): QuestStep {
    if (area === 'hudonMound') return { kind: 'custom', name: 'swim downstream to the tourist office', run: leaveHudonMound };
    const escape = escapeUnexpectedArea(area);
    if (escape) return escape;
    const bank = nearerSupplyBank(snap);
    if (!snap.bankKnown) return scanBank(bank);
    const normalize = normalizeLoadout(snap, BOOK_TRAVEL_KEEP, 'prepare the Book on Baxtorian trip', bank);
    if (normalize) return normalize;
    const food = sourceTravelFood(snap);
    if (food) return food;
    if (held(snap, ITEM.BOOK)) return { kind: 'custom', name: 'read the Book on Baxtorian', run: readBook };
    if (banked(snap, ITEM.BOOK) > 0) return withdrawExact(ITEM.BOOK, 1);
    return { kind: 'custom', name: 'find and read the Book on Baxtorian', run: bookLeg };
}

function stageThree(snap: QuestSnapshot, area: WaterfallArea): QuestStep {
    if (area === 'glarialTomb') return { kind: 'custom', name: 'loot Glarial amulet and urn', run: tombLeg };
    if (area === 'tgvDungeon') return { kind: 'custom', name: 'recover Glarial pebble from Golrie', run: pebbleLeg };
    const escape = escapeUnexpectedArea(area);
    if (escape) return escape;
    return prepareTombEntry(snap);
}

function stageFour(snap: QuestSnapshot, area: WaterfallArea): QuestStep {
    if (area === 'glarialTomb') return { kind: 'custom', name: 'loot Glarial amulet and urn', run: tombLeg };
    const pebbleRecovery = resumePebbleRecovery(snap, area);
    if (pebbleRecovery) return pebbleRecovery;
    if (area === 'fallsLedge' && !held(snap, ITEM.AMULET) && !worn(snap, ITEM.AMULET)) {
        return { kind: 'custom', name: 'leave the ledge without risking the amulet door', run: barrelEscape };
    }
    if (area === 'hudonMound' && !held(snap, ITEM.ROPE)) {
        return { kind: 'custom', name: 'swim back from Hudon mound', run: leaveHudonMound };
    }
    if (area === 'fallsTreeBank' && !held(snap, ITEM.ROPE)) {
        return { kind: 'wait', reason: 'Rope missing on the one-way Waterfall crossing' };
    }
    if (area === 'hudonMound' || area === 'fallsTreeBank' || area === 'fallsLedge') {
        return { kind: 'custom', name: 'enter Baxtorian Falls', run: fallsLeg };
    }
    const escape = escapeUnexpectedArea(area);
    if (escape) return escape;
    const prep = prepareDungeon(snap, false);
    return prep ?? { kind: 'custom', name: 'enter Baxtorian Falls', run: fallsLeg };
}

function stageFiveOrSix(snap: QuestSnapshot, stage: number, area: WaterfallArea): QuestStep {
    if (area === 'waterfallDungeon' || area === 'puzzleRoom' || area === 'raisedRoom') {
        return {
            kind: 'custom',
            name: stage === WATERFALL_STAGE.ENTERED_PUZZLE ? 'solve the six rune pillars' : 'cross the Waterfall dungeon',
            run: log => dungeonLeg(stage, log)
        };
    }
    if (area === 'glarialTomb') return { kind: 'custom', name: 'finish recovering Glarial relics', run: tombLeg };
    const pebbleRecovery = resumePebbleRecovery(snap, area);
    if (pebbleRecovery) return pebbleRecovery;
    if (area === 'tgvDungeon') return { kind: 'custom', name: 'leave the Tree Gnome Village dungeon', run: leaveTgvDungeon };
    if (area === 'fallsLedge' && !held(snap, ITEM.AMULET) && !worn(snap, ITEM.AMULET)) {
        return { kind: 'custom', name: 'leave the ledge without risking the amulet door', run: barrelEscape };
    }
    if (area === 'hudonMound' && !held(snap, ITEM.ROPE)) {
        return { kind: 'custom', name: 'swim back from Hudon mound', run: leaveHudonMound };
    }
    if (area === 'fallsTreeBank' && !held(snap, ITEM.ROPE)) {
        return { kind: 'wait', reason: 'Rope missing on the one-way Waterfall crossing' };
    }
    if (area !== 'mainland') return { kind: 'custom', name: 'cross into Baxtorian Falls', run: fallsLeg };
    const prep = prepareDungeon(snap, false);
    return prep ?? { kind: 'custom', name: 'cross into Baxtorian Falls', run: fallsLeg };
}

function stageEight(snap: QuestSnapshot, area: WaterfallArea): QuestStep {
    if (area === 'raisedRoom') {
        if (!held(snap, ITEM.FULL_URN) || (snap.freeSlots ?? 0) < 5) {
            return { kind: 'custom', name: 'wash out to recover the final loadout', run: exitWaterfallDungeon };
        }
        return { kind: 'custom', name: "pour Glarial's ashes into the Chalice", run: completeQuest };
    }
    if (area === 'waterfallDungeon' || area === 'puzzleRoom') {
        return {
            kind: 'custom',
            name: 'return directly to the raised Chalice room',
            run: log => dungeonLeg(WATERFALL_STAGE.RAISED_FLOOR, log)
        };
    }
    if (area === 'glarialTomb') return { kind: 'custom', name: 'recover final Glarial relics', run: tombLeg };
    const pebbleRecovery = resumePebbleRecovery(snap, area);
    if (pebbleRecovery) return pebbleRecovery;
    if (area === 'tgvDungeon') return { kind: 'custom', name: 'leave the Tree Gnome Village dungeon', run: leaveTgvDungeon };
    if (area === 'fallsLedge' && !held(snap, ITEM.AMULET) && !worn(snap, ITEM.AMULET)) {
        return { kind: 'custom', name: 'leave the ledge without risking the amulet door', run: barrelEscape };
    }
    if (area === 'hudonMound' && !held(snap, ITEM.ROPE)) {
        return { kind: 'custom', name: 'swim back from Hudon mound', run: leaveHudonMound };
    }
    if (area === 'fallsTreeBank' && !held(snap, ITEM.ROPE)) {
        return { kind: 'wait', reason: 'Rope missing on the one-way Waterfall crossing' };
    }
    if (area !== 'mainland') return { kind: 'custom', name: 'return to the Waterfall dungeon', run: fallsLeg };
    const prep = prepareDungeon(snap, true);
    return prep ?? { kind: 'custom', name: 'return to the Waterfall dungeon', run: fallsLeg };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? 0) >= WATERFALL_STAGE.COMPLETE) return { kind: 'done' };
    if (snap.journal === 'unknown') return { kind: 'wait', reason: 'quest journal not loaded' };
    if (snap.stage === undefined) return { kind: 'wait', reason: 'Waterfall Quest journal stage unavailable' };

    const area = waterfallArea(snap.tile);
    switch (snap.stage) {
        case WATERFALL_STAGE.NOT_STARTED:
            return stageZero(snap, area);
        case WATERFALL_STAGE.STARTED:
            if (area === 'hudonMound') return { kind: 'custom', name: 'speak to Hudon', run: stageOneLeg };
            if (area !== 'mainland') {
                return escapeUnexpectedArea(area) ?? { kind: 'wait', reason: 'cannot reach Almera raft from this area' };
            }
            {
                const bank = nearerSupplyBank(snap);
                if (!snap.bankKnown) return scanBank(bank);
                const normalize = normalizeLoadout(snap, START_KEEP, 'prepare the Almera raft trip', bank);
                if (normalize) return normalize;
                const food = sourceTravelFood(snap);
                if (food) return food;
            }
            return { kind: 'custom', name: 'board Almera raft and find Hudon', run: stageOneLeg };
        case WATERFALL_STAGE.SPOKEN_TO_HUDON:
            return stageTwo(snap, area);
        case WATERFALL_STAGE.READ_BOOK:
            return stageThree(snap, area);
        case WATERFALL_STAGE.ENTERED_TOMB:
            return stageFour(snap, area);
        case WATERFALL_STAGE.ENTERED_WATERFALL:
        case WATERFALL_STAGE.ENTERED_PUZZLE:
            return stageFiveOrSix(snap, snap.stage, area);
        case WATERFALL_STAGE.RAISED_FLOOR:
            return stageEight(snap, area);
        default:
            return { kind: 'wait', reason: 'unrecognized Waterfall Quest stage ' + snap.stage };
    }
}

export const waterfall: QuestModule = {
    record: QUESTS.find(record => record.id === 'waterfall')!,
    bank: ARDOUGNE_BANK,
    hops: WATERFALL_HOPS,
    tools: ['glarial', 'a key', 'rope', 'book on baxtorian', 'bread', 'cup of tea', 'air rune', 'earth rune', 'water rune', 'coins'],
    ownsInventory: true,
    readStage: readWaterfallStage,
    // prepareDungeonSprint requires full health. At 1.0 the shared sustain hook
    // can satisfy that invariant at every Hitpoints level, not only fresh 10 HP.
    sustain: { foods: [ITEM.BREAD.name, ITEM.TEA.name], eatBelowHp: 1 },
    decide
};
