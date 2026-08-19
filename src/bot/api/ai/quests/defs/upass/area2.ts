import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { driveUntil, heldId, settleScene } from '../../exec/prompts.js';
import type { QuestSnapshot } from '../../engine/types.js';
import { UP_BADGES, UP_ITEM, UP_LOC, UP_NPC, UP_TILE, countHeld, type UpassItem } from './areas.js';
import { locById, walkTo } from './bridge.js';

/** Search the middle cage for the loose railing that levers the boulder. */
export async function takeRailing(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.RAILING.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.RAILINGS_LOOSE, 1, log))) {
        return false;
    }
    await settleScene();
    const cage = locById(UP_LOC.RAILINGS_LOOSE, 'Search', 8);
    if (!cage || !(await cage.interact('Search'))) {
        log('no searchable cage bars at the loose railing');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.RAILING.id) > 0, [], log, 12_000);
}

// Why: the journal cannot tell this stage from the last one. Both print "Something is watching me" and "I must work my way deeper into these caverns", differing only in the strike-through colour that marks which is current — so a run levered a boulder that was already spent, forever. The horn is the honest signal, and taking it is part of the same step.

/** Lever the boulder onto the unicorn, then take the horn from what is left of the cage. */
export async function crushUnicorn(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.UNICORN_HORN.id) === 0 && !(await dropBoulder(log))) {
        return false;
    }
    return takeUnicornHorn(log);
}

/** Lever the boulder onto the unicorn; the script telejumps the player west afterwards. */
export async function dropBoulder(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.BOULDER, 2, log))) {
        return false;
    }
    await settleScene();
    const boulder = Npcs.query().where(npc => npc.id === UP_NPC.BOULDER).within(10).nearest();
    const railing = Inventory.items().find(item => item.id === UP_ITEM.RAILING.id);
    // Why: no boulder and a smashed cage is the job already done — the stage moved and the journal did not.
    if (!boulder && locById(UP_LOC.UNICORN_CAGE, null, 16) !== null) {
        log('the boulder is already down and the cage is smashed');
        return true;
    }
    if (!boulder || !railing) {
        log(`missing ${boulder ? 'the piece of railing' : 'the boulder'} for the unicorn`);
        return false;
    }
    const from = Game.tile();
    if (!(await railing.useOn(boulder))) {
        return false;
    }
    // Why: the script keeps the railing, so there is no inventory delta to read — the oracle is its
    // `p_telejump(coord - 25x)`, and the threshold is set past anything the op-click's own walk could cover.
    return driveUntil(() => {
        const now = Game.tile();
        return now !== null && from !== null && Math.abs(now.x - from.x) >= 20;
    }, [], log, 15_000);
}

/** All that is left of the unicorn is the horn the blood well wants. */
export async function takeUnicornHorn(log: (m: string) => void): Promise<boolean> {
    if (heldId(UP_ITEM.UNICORN_HORN.id) > 0) {
        return true;
    }
    if (!(await walkTo(UP_TILE.UNICORN_CAGE, 3, log))) {
        return false;
    }
    await settleScene();
    const cage = locById(UP_LOC.UNICORN_CAGE, null, 8);
    const op = cage?.actions()[0];
    if (!cage || !op || !(await cage.interact(op))) {
        log('no crushed unicorn cage to search');
        return false;
    }
    return driveUntil(() => heldId(UP_ITEM.UNICORN_HORN.id) > 0, [], log, 12_000);
}

const PALADINS: readonly { npc: number; badge: UpassItem }[] = [
    { npc: UP_NPC.PALADIN_JERRO, badge: UP_ITEM.BADGE_JERRO },
    { npc: UP_NPC.PALADIN_CARL, badge: UP_ITEM.BADGE_CARL },
    { npc: UP_NPC.PALADIN_HARRY, badge: UP_ITEM.BADGE_HARRY }
];

export function badgesHeld(snap: QuestSnapshot): number {
    return countHeld(snap, UP_BADGES);
}

// Why: the three paladins only turn hostile once the main cavern has been entered, so before that they are killed one at a time from a standing start rather than left to aggro as a group.
// Why: the well eats the crests and the journal never says it did, so a snapshot cannot tell "not killed yet" from "already fed" — and a run killed three respawned paladins after feeding the first three. Every irreversible part of it is therefore one step, ending on the only thing the journal can see: the character standing on the level-1 platform past the temple doors.

/** Kill paladins, feed the well and pass the doors — whatever of that is still outstanding. */
export async function crossTheTemple(log: (m: string) => void): Promise<boolean> {
    const crests = (): number => UP_BADGES.filter(badge => heldId(badge.id) > 0).length;
    // Why: a paladin respawns, and "whichever is alive" always picks the nearest — so the same one died eight times, its crest was fed to a bit already set, and the other two were never touched. Each is killed once per crossing, by id.
    const killed = new Set<number>();
    for (let round = 0; round < 4; round++) {
        if ((Game.tile()?.level ?? 0) === 1) {
            return true;
        }
        // Why: all three crests before one trip to the well. Feeding each as it drops costs a walk from the
        // shelf to the well and back for every one of them, and that walk is fifty-odd tiles each way.
        while (crests() < 3 && (await killPaladin(log, killed))) {
            log(`crests in hand: ${crests()}`);
        }
        if (crests() > 0 || heldId(UP_ITEM.UNICORN_HORN.id) > 0) {
            await feedBloodWell(log);
        }
        if (await enterMainCavern(log)) {
            return true;
        }
    }
    log('the temple doors will not open and there is nothing left to feed the well');
    return (Game.tile()?.level ?? 0) === 1;
}

/** Kill a paladin this crossing has not killed yet and take the crest it drops. */
export async function killPaladin(log: (m: string) => void, killed = new Set<number>()): Promise<boolean> {
    if (!(await walkTo(UP_TILE.PALADINS, 4, log))) {
        return false;
    }
    await settleScene();
    // Why: which crest is owed cannot be read once the well has eaten them, so the target is picked by who
    // has not been killed yet rather than by which crest is missing.
    const target = Npcs.query()
        .where(npc => PALADINS.some(p => p.npc === npc.id) && !killed.has(npc.id))
        .action('Attack')
        .within(14)
        .nearest();
    if (!target) {
        log('no paladin left on the shelf that this crossing has not already killed');
        return false;
    }
    killed.add(target.id);
    const owed = PALADINS.find(p => p.npc === target.id) ?? PALADINS[0]!;
    if (!(await target.interact('Attack'))) {
        log(`could not attack paladin ${owed.npc}`);
        return false;
    }
    // Why: `ai_queue3` drops the crest on the paladin's own tile rather than handing it over, so waiting for
    // it to appear in the pack waits forever — the kill and the pickup are two separate things.
    if (!(await driveUntil(() => Npcs.query().where(npc => npc.id === owed.npc).within(14).nearest() === null, [], log, 180_000))) {
        log(`paladin ${owed.npc} outlasted the fight`);
        return false;
    }
    const drop = GroundItems.query().where(item => item.id === owed.badge.id).within(10).nearest();
    if (!drop) {
        log(`paladin ${owed.npc} died but left no coat of arms in reach`);
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return driveUntil(() => heldId(owed.badge.id) > 0, [], log, 10_000);
}

/** The blood well opens the temple doors once it has all three crests and the horn. */
export async function feedBloodWell(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.BLOODWELL, 3, log))) {
        return false;
    }
    await settleScene();
    let fed = 0;
    for (const item of [...UP_BADGES, UP_ITEM.UNICORN_HORN]) {
        if (heldId(item.id) === 0) {
            continue;
        }
        const well = locById(UP_LOC.BLOODWELL, null, 8);
        const held = Inventory.items().find(inv => inv.id === item.id);
        if (!well || !held) {
            break;
        }
        if (!(await held.useOn(well))) {
            break;
        }
        if (!(await driveUntil(() => heldId(item.id) === 0, [], log, 15_000))) {
            log(`the blood well would not take ${item.name}`);
            break;
        }
        fed++;
    }
    log(`fed ${fed} item(s) to the blood well`);
    return fed > 0;
}

/** Through the double doors into the main cavern. */
export async function enterMainCavern(log: (m: string) => void): Promise<boolean> {
    if (!(await walkTo(UP_TILE.TEMPLE_DOOR, 3, log))) {
        return false;
    }
    await settleScene();
    const door = locById(UP_LOC.TEMPLE_DOOR_L, null, 8) ?? locById(UP_LOC.TEMPLE_DOOR_R, null, 8);
    const op = door?.actions()[0];
    if (!door || !op || !(await door.interact(op))) {
        log('no temple double door at the west end of the shelf');
        return false;
    }
    return driveUntil(() => (Game.tile()?.level ?? 0) === 1, [], log, 15_000);
}
