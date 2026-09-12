import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { bankDistance } from '../../geometry/distance.js';
import { SettingsStore } from '../../runtime/Settings.js';
import { Quests } from '../ui/questlog/Quests.js';
import { Skills } from '../skills/Skills.js';
import Tile from '../../geometry/Tile.js';

export interface BankRequirement {
    skill?: { name: string; level: number };
    quest?: string;
    // Why: Gundai's cellar is reached by slashing into ~level 55 Wilderness, so an Ardougne script must never pick it up for being a few tiles closer.
    // Why: off by default, so a Wilderness bot opts in.

    /** A Global setting that must be true before this bank is offered at all. */
    setting?: string;
}

export interface BankObjectAccess {
    name: string;
    op: string;
    openFirst?: {
        name: string;
        op: string;
    };
}

/**
 * A bank opened through a conversation.
 * Why: Gundai in the Mage Arena is the only one; `[opnpc1,magearena_banker]` chats, offers 2 choices, and only then runs `@openbank`.
 */
export interface BankNpcAccess {
    name: string;
    op: string;
    /** The dialogue option that opens the bank. */
    choose: string;
}

/**
 * A bank, its stand tile, and how to open it.
 * @see docs/reference/api-items.md#bank
 */
export interface BankLocation {
    name: string;
    tile: Tile;
    requires?: BankRequirement;
    access?: BankObjectAccess;
    npcAccess?: BankNpcAccess;
    // Why: callers still walk to `tile`, since the nav graph knows how to get there.
    // Why: ranking is straight-line, and Gundai's cellar at z=4714 scores ~800 tiles from the ladder it's reached by, so it would never be chosen.

    /** Where the surface route to this bank starts, for distance ranking only. */
    approach?: Tile;
}

/** Global setting key gating the Mage Arena bank. @see BankRequirement.setting */
export const USE_MAGE_BANK = 'useMageBank';

/**
 * Every known bank. Some stands are sealed collision islands, so reaching one is a data problem.
 * @see docs/reference/nav-walker.md#arrival
 */
export const BANK_LOCATIONS: BankLocation[] = [
    { name: 'Varrock East', tile: new Tile(3253, 3420, 0) },
    { name: 'Varrock West', tile: new Tile(3185, 3440, 0) },
    { name: 'Al Kharid', tile: new Tile(3269, 3167, 0) },
    { name: 'Draynor', tile: new Tile(3093, 3243, 0) },
    { name: 'Falador East', tile: new Tile(3013, 3355, 0) },
    { name: 'Falador West', tile: new Tile(2946, 3369, 0) },
    { name: 'Edgeville', tile: new Tile(3094, 3493, 0) },
    { name: 'Seers', tile: new Tile(2725, 3491, 0) },
    { name: 'Catherby', tile: new Tile(2809, 3441, 0) },
    { name: 'Yanille', tile: new Tile(2612, 3092, 0) },
    { name: 'Ardougne West', tile: new Tile(2616, 3332, 0) },
    { name: 'Ardougne East', tile: new Tile(2655, 3283, 0) },
    { name: 'Canifis', tile: new Tile(3512, 3480, 0), requires: { quest: 'Priest in Peril' } },
    // Why: Shilo has no booth: `bank_store_icon` is the only bank loc in the mapsquare and the teller is `shilobanker` (npc 499), whose `op3=Bank` runs `@openbank`. Without npcAccess the booth query finds nothing and the bank never opens.
    // Why: the quest gate is the village itself: every tile is behind Vigroy's cart, and `shiloCartEdges` refuses the Brimhaven crossing until Shilo Village is complete.
    {
        name: 'Shilo Village',
        tile: new Tile(2852, 2954, 0),
        requires: { quest: 'Shilo Village' },
        npcAccess: { name: 'Banker', op: 'Bank', choose: "I'd like to access my bank account" }
    },
    { name: 'Fishing Guild', tile: new Tile(2586, 3420, 0), requires: { skill: { name: 'fishing', level: 68 } } },
    // Why: the live object is "Shantay chest" (id 2693) with Open; "Bank chest" with Use doesn't exist here, and neither does a Bank booth.
    {
        name: 'Shantay Pass',
        tile: new Tile(3308, 3120, 0),
        access: { name: 'Shantay chest', op: 'Open' }
    },
    // Why: Gundai's cellar, where magearena_ladder_to_cellar lands: slash the 2 bigweb_slashable webs along z=3957 and climb down at (3091,3958), all 3 baked as edges. Kolodion's arena teleport is unrelated.
    // Why: still gated, because that's ~level 55 Wilderness and the webs need a wielded slash weapon, so it must not win on distance for a script working elsewhere.
    {
        name: 'Mage Arena',
        tile: new Tile(2542, 4714, 0),
        requires: { setting: USE_MAGE_BANK },
        approach: new Tile(3091, 3958, 0),
        npcAccess: { name: 'Gundai', op: 'Talk-to', choose: "I'd like to access my bank account" }
    },
    // Why: the Grand Tree 1F bank booths (SE of the trunk ladder) open without the Grand Tree quest, though the mine still requires it.
    // Why: the stand is in front of the south booth row.
    { name: 'Grand Tree', tile: new Tile(2449, 3482, 1) },
    {
        name: 'Duel Arena',
        tile: new Tile(3382, 3269, 0),
        access: {
            name: 'Open chest',
            op: 'Bank',
            openFirst: { name: 'Closed chest', op: 'Open' }
        }
    }
];

export { bankDistance };

/** The tile a bank is walked to, its approach when it has one. */
export function approachOf(bank: BankLocation): Tile {
    return bank.approach ?? bank.tile;
}

// Why: ranked on x/z across planes, because stair edges are baked into the nav graph and a bank one floor down is a walk like any other.
// Why: matching planes made the Grand Tree, the one bank off level 0, the only candidate for anyone standing upstairs anywhere.
// Why: straight-line order can't see a toll gate or a fare, so a caller that needs a walkable bank probes these in order.

/** Every bank this account can use, nearest first by straight line. */
export function nearestBanks(from: WorldTile): BankLocation[] {
    return BANK_LOCATIONS
        .filter(bank => meetsRequirement(bank))
        .sort((a, b) => bankDistance(from, approachOf(a)) - bankDistance(from, approachOf(b)));
}

export function nearestUsableBank(from: WorldTile, usable: (bank: BankLocation) => boolean): BankLocation | null {
    let best: BankLocation | null = null;
    let bestD = Infinity;
    for (const bank of BANK_LOCATIONS) {
        if (!usable(bank)) {
            continue;
        }
        const d = bankDistance(from, approachOf(bank));
        if (d < bestD) {
            bestD = d;
            best = bank;
        }
    }
    return best;
}

/** Whether this account's quests and stats unlock the bank at all. */
export function bankUnlocked(bank: BankLocation): boolean {
    return meetsRequirement(bank);
}

function meetsRequirement(bank: BankLocation): boolean {
    const req = bank.requires;
    if (!req) {
        return true;
    }
    if (req.skill && Skills.level(req.skill.name) < req.skill.level) {
        return false;
    }
    if (req.quest && Quests.status(req.quest) !== 'complete') {
        return false;
    }
    if (req.setting && !SettingsStore.globalBag().bool(req.setting, false)) {
        return false;
    }
    return true;
}

export function nearestBank(from: WorldTile): BankLocation | null {
    return nearestUsableBank(from, meetsRequirement);
}
