// Why: the Kharazi Jungle is sealed by a band of jungle plants standing on map-blocked ground, so the baked
// Why: pack has no edge into it and never will: `chop_jungle` teleports the chopper two tiles past each plant
// Why: it fells, which is a traversal mode rather than one crossing. Legends' Quest already cuts that band.
// @see docs/reference/clues-gates.md#clues-the-pack-cannot-reach

import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { AXES, bestAxe } from '#/bot/api/acquisition/Tools.js';
import { LEGENDS_QUEST, LQ_ITEM, legendsArea } from '#/bot/api/ai/quests/defs/legends/areas.js';
import { enterJungle, leaveJungle } from '#/bot/api/ai/quests/defs/legends/jungle.js';
import Tile from '#/bot/geometry/Tile.js';
import type { NavPoint } from '#/bot/event/webwalk/PathFinder.js';

/** The three hard coordinate digs inside the jungle. */
export const KHARAZI_CLUES: ReadonlySet<number> = new Set([3532, 3534, 3536]);

export const MACHETE = LQ_ITEM.MACHETE;
/** Radimus Erkle's notes, both the blank copy and the finished one, which share a name. */
export const RADIMUS_NOTES = LQ_ITEM.MAP;

const WALK_ATTEMPTS = 4;
const WALK_TIMEOUT_MS = 240_000;

export function inKharazi(p: NavPoint | null | undefined): boolean {
    return !!p && legendsArea(p) === 'jungle';
}

/** Which way the band has to be cut for this walk, if at all. */
export function jungleCrossing(dest: NavPoint | null, at: NavPoint | null | undefined): 'enter' | 'leave' | 'none' {
    if (inKharazi(dest) === inKharazi(at)) {
        return 'none';
    }
    return inKharazi(dest) ? 'enter' : 'leave';
}

/** True when the walk has one end in the jungle and the other outside it. */
export function crossesKharazi(dest: NavPoint | null): boolean {
    return jungleCrossing(dest, Game.tile()) !== 'none';
}

/** Cut through the dense band, then walk the rest on the ordinary graph. */
export async function walkAcrossKharazi(dest: NavPoint, radius: number, log: (m: string) => void): Promise<boolean> {
    const cut = jungleCrossing(dest, Game.tile()) === 'leave' ? leaveJungle : enterJungle;
    if (!(await cut(log))) {
        return false;
    }
    return Traversal.walkResilient(new Tile(dest.x, dest.z, dest.level), {
        radius,
        attempts: WALK_ATTEMPTS,
        timeoutMs: WALK_TIMEOUT_MS,
        log
    });
}

const held = (name: string): boolean => Inventory.first(name) !== null || Equipment.contains(name);

/** Every axe name, best first, so the bank stop knows what not to deposit. */
export const AXE_NAMES: readonly string[] = AXES.map(a => a.name);

// Why: `woodcutting_axe_checker` reads the pack and the right hand, not the bank, and this era puts no level
// Why: on any axe, so the best one the bank holds is the one to bring.

/** The best axe to take into the jungle, or null when neither pack nor bank has one. */
export function jungleAxe(): string | null {
    return bestAxe(Skills.level('woodcutting'), n => held(n) || Bank.count(n) > 0);
}

/** The axe already in the pack, which is what the server will swing. */
export function heldAxe(): string | null {
    return bestAxe(Skills.level('woodcutting'), held);
}

// Why: the notes are how an unfinished Legends account passes the map check, and they are Radimus Erkle's
// Why: to give, so a bot that has not started the quest cannot be sent to cut its way in.

/** True when `start_chop_jungle` will accept the map check. */
export function hasJungleMap(): boolean {
    return held(RADIMUS_NOTES) || Quests.status(LEGENDS_QUEST) === 'complete';
}

/** What `start_chop_jungle` checks before the first swing, and what the pack is short of. */
export function jungleKitMissing(): string[] {
    const missing: string[] = [];
    if (!held(MACHETE)) {
        missing.push(MACHETE);
    }
    if (!heldAxe()) {
        missing.push('an axe');
    }
    if (!hasJungleMap()) {
        missing.push(`${RADIMUS_NOTES} (${LEGENDS_QUEST} reads ${Quests.status(LEGENDS_QUEST)})`);
    }
    return missing;
}

/** The names a Kharazi trail must not let the bank stop deposit. */
export function jungleKeepNames(): string[] {
    return [MACHETE, RADIMUS_NOTES, ...AXE_NAMES];
}
