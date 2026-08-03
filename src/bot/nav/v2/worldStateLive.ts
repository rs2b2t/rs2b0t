/**
 * Build WorldStateData from live client APIs (main thread only — not for NavWorker).
 */

import { Client } from '#/client/Client.js';

import { reader } from '../../adapter/ClientAdapter.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests, type QuestStatus } from '../../api/hud/Quests.js';
import { namesHaveEntranaRestrictedGear } from '../exec/specialCrossing.js';
import type { EssenceReturnId } from './essenceExit.js';
import { EssenceSession } from './essenceSession.js';
import type { QuestProgress, WorldState } from './types.js';
import type { WorldStateData } from './worldStateData.js';
import { worldStateFromData } from './worldStateData.js';
import { wildernessLevelAt } from './wilderness.js';

/**
 * Essence-mine session return for plan filters.
 *
 * `%exit_essence_mine_coord` (varp 64) is **server-only** (no transmit=yes) —
 * see docs/local/varp-transmit-inventory.md. We never trust reader.varp(64).
 * Source: EssenceSession (set when the bot completes a wizard entry hop), or
 * harness override when cheat-tele into the mine.
 *
 * When unknown, omit the field so requires fail-open (pack / offline tools).
 * Content default on portal when null is Sedridor — live bots that entered via
 * a wizard will have session set.
 */
export function snapshotEssenceExitReturn(): EssenceReturnId | undefined {
    return EssenceSession.getReturnId();
}

function mapQuest(status: QuestStatus): QuestProgress {
    switch (status) {
        case 'notStarted':
            return 'not_started';
        case 'inProgress':
            return 'started';
        case 'complete':
            return 'complete';
        default:
            return 'unknown';
    }
}

export function snapshotWorldStateData(): WorldStateData {
    const skills: Record<string, number> = {};
    for (let i = 0; i < reader.skillCount(); i++) {
        const s = reader.stat(i);
        skills[s.name] = s.base;
        skills[s.name.toLowerCase()] = s.base;
    }

    const quests: Record<string, QuestProgress> = {};
    for (const q of Quests.all()) {
        const p = mapQuest(q.status);
        quests[q.name] = p;
        quests[q.name.toLowerCase()] = p;
    }

    const items: Record<string, number> = {};
    for (const item of Inventory.items()) {
        const name = item.name;
        if (!name) {
            continue;
        }
        items[name] = (items[name] ?? 0) + item.count;
        items[name.toLowerCase()] = (items[name.toLowerCase()] ?? 0) + item.count;
        items[name.toLowerCase().replace(/\s+/g, '')] =
            (items[name.toLowerCase().replace(/\s+/g, '')] ?? 0) + item.count;
    }
    // Explicit counts for tele-critical runes (names vary slightly by pack).
    for (const rune of ['Law rune', 'Air rune', 'Fire rune', 'Water rune', 'Earth rune']) {
        const c = Inventory.count(rune);
        if (c > 0) {
            items[rune] = Math.max(items[rune] ?? 0, c);
            items[rune.toLowerCase()] = Math.max(items[rune.toLowerCase()] ?? 0, c);
        }
    }

    const worn: Record<string, number> = {};
    const wornNames: string[] = [];
    for (const item of Equipment.items()) {
        const name = item.name;
        if (!name) {
            continue;
        }
        wornNames.push(name);
        worn[name] = (worn[name] ?? 0) + item.count;
        worn[name.toLowerCase()] = (worn[name.toLowerCase()] ?? 0) + item.count;
        worn[name.toLowerCase().replace(/\s+/g, '')] =
            (worn[name.toLowerCase().replace(/\s+/g, '')] ?? 0) + item.count;
    }

    const invNames = Inventory.items().map(i => i.name ?? '').filter(Boolean);
    const entranaRestrictedGear = namesHaveEntranaRestrictedGear([...invNames, ...wornNames]);

    const here = reader.worldTile();
    // Omit wildernessLevel when tile is unknown so planners fall back to
    // wildernessLevelAt(from) rather than treating missing as safe level 0.
    const wildernessLevel = here ? wildernessLevelAt(here) : undefined;
    const essenceExitReturn = snapshotEssenceExitReturn();

    return {
        // Client.memServer is set at boot from world config (members vs free world).
        // Never hardcode true — free-world snapshots must fail members-gated edges.
        members: Client.memServer === true,
        skills,
        quests,
        items,
        worn,
        freeSlots: Inventory.free(),
        entranaRestrictedGear,
        ...(wildernessLevel !== undefined ? { wildernessLevel } : {}),
        ...(essenceExitReturn !== undefined ? { essenceExitReturn } : {})
    };
}

export function snapshotWorldState(): WorldState {
    return worldStateFromData(snapshotWorldStateData());
}
