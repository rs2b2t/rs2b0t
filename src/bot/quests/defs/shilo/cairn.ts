// docs/superpowers/specs/2026-07-29-shilo-village-design.md
import { Inventory } from '../../../api/hud/Inventory.js';
import { Quests } from '../../../api/hud/Quests.js';
import { SV_ITEM, SV_LOC, SV_TILE } from './areas.js';
import { SHILO_QUEST } from './journal.js';
import { driveUntil, heldId, here, promptLoc, settleScene, useOnLoc } from './scene.js';

const YES_CRAWL = ['Yes Please, I can think of nothing nicer!'];
const YES_NOTES = ["Yes, I'll make some notes."];

/** Crawling in needs the tattered scroll read; the pack routes over the log bridge. */
export async function enterBerviriusTomb(log: (m: string) => void): Promise<boolean> {
    if (here() === 'berviriusTomb') {
        return true;
    }
    const ok = await promptLoc(
        {
            name: SV_LOC.WELL_STACKED_ROCKS,
            op: 'Search',
            near: SV_TILE.WELL_STACKED_ROCKS,
            prefer: YES_CRAWL,
            // A failed Agility roll wedges you in the crevice and spits you back out.
            expect: () => here() === 'berviriusTomb'
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

export async function leaveBerviriusTomb(log: (m: string) => void): Promise<boolean> {
    if (here() !== 'berviriusTomb') {
        return true;
    }
    const ok = await promptLoc(
        {
            name: SV_LOC.HANDHOLDS,
            op: 'Climb',
            near: SV_TILE.HANDHOLDS,
            expect: () => here() !== 'berviriusTomb'
        },
        log
    );
    if (ok) {
        await settleScene();
    }
    return ok;
}

/**
 * One search hands over the sword pommel, the locating crystal and the notes. The
 * notes are what set `used_dolmen_paper`, which is the journal's own marker that
 * this leg is done — a second visit asks for papyrus and charcoal instead.
 */
export async function searchBerviriusDolmen(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.SWORD_POMMEL.id) > 0 || heldId(SV_ITEM.BONE_BEADS.id) > 0 || heldId(SV_ITEM.DEAD_BEADS.id) > 0) {
        return true;
    }
    if (!(await enterBerviriusTomb(log))) {
        return false;
    }
    return promptLoc(
        {
            name: SV_LOC.BERVIRIUS_DOLMEN,
            op: 'Search',
            near: SV_TILE.BERVIRIUS_DOLMEN,
            prefer: YES_NOTES,
            expect: () => heldId(SV_ITEM.SWORD_POMMEL.id) > 0
        },
        log
    );
}

async function useItemOnItem(sourceId: number, targetId: number, want: number, log: (m: string) => void): Promise<boolean> {
    if (heldId(want) > 0) {
        return true;
    }
    const source = Inventory.items().find(item => item.id === sourceId);
    const target = Inventory.items().find(item => item.id === targetId);
    if (!source || !target) {
        log(`missing ${sourceId} or ${targetId} for the craft`);
        return false;
    }
    if (!(await source.useOn(target))) {
        return false;
    }
    return driveUntil(() => heldId(want) > 0, [], log);
}

export function craftBoneBeads(log: (m: string) => void): Promise<boolean> {
    return useItemOnItem(SV_ITEM.CHISEL.id, SV_ITEM.SWORD_POMMEL.id, SV_ITEM.BONE_BEADS.id, log);
}

/** Refused until the crumpled scroll has been read, whatever the Crafting level. */
export function craftDeadBeads(log: (m: string) => void): Promise<boolean> {
    return useItemOnItem(SV_ITEM.BRONZE_WIRE.id, SV_ITEM.BONE_BEADS.id, SV_ITEM.DEAD_BEADS.id, log);
}

/** Refused until the carved doors have been searched, whatever the Crafting level. */
export function craftBoneKey(log: (m: string) => void): Promise<boolean> {
    return useItemOnItem(SV_ITEM.CHISEL.id, SV_ITEM.BONE_SHARD.id, SV_ITEM.BONE_KEY.id, log);
}

/** The quest ends by laying Rashiliyia beside her son on the Bervirius dolmen. */
export async function deliverCorpse(log: (m: string) => void): Promise<boolean> {
    if (!(await enterBerviriusTomb(log))) {
        return false;
    }
    return useOnLoc(
        SV_ITEM.RASH_CORPSE.id,
        { name: SV_LOC.BERVIRIUS_DOLMEN, near: SV_TILE.BERVIRIUS_DOLMEN },
        [],
        () => Quests.status(SHILO_QUEST) === 'complete',
        log
    );
}
