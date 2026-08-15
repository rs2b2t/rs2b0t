/**
 * Build WorldStateData from live client APIs (main thread only — not for NavWorker).
 */

// eslint-disable-next-line no-restricted-imports -- TODO: route through ClientAdapter
import { Client } from '#/client/shell/Client.js';

import { reader } from '../../adapter/ClientAdapter.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Quests, type QuestStatus } from '../../api/ui/questlog/Quests.js';
import { namesHaveEntranaRestrictedGear } from './exec/specialCrossing.js';
import type { EssenceReturnId } from './essenceExit.js';
import { EssenceSession } from './essenceSession.js';
import { recordsHaveSlashTool } from './slashTool.js';
import type { QuestProgress, WorldState } from './types.js';
import type { WorldStateData } from './worldStateData.js';
import { worldStateFromData } from './worldStateData.js';
import { wildernessLevelAt } from './wilderness.js';

// Why: `%exit_essence_mine_coord` (varp 64) is server-only with no transmit=yes — see docs/local/varp-transmit-inventory.md — so reader.varp(64) is never trusted.
// Why: the source is EssenceSession, set when the bot completes a wizard entry hop, or a harness override on a cheat-tele into the mine.
// Why: when unknown the field is omitted so requires fail open for pack and offline tools.
// Why: the content default on the portal when null is Sedridor, and a live bot that entered via a wizard has the session set.

/** Essence-mine session return for plan filters. */
function snapshotEssenceExitReturn(): EssenceReturnId | undefined {
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
    const canSlashWeb = recordsHaveSlashTool(items, worn);

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
        canSlashWeb,
        ...(wildernessLevel !== undefined ? { wildernessLevel } : {}),
        ...(essenceExitReturn !== undefined ? { essenceExitReturn } : {})
    };
}

export function snapshotWorldState(): WorldState {
    return worldStateFromData(snapshotWorldStateData());
}
