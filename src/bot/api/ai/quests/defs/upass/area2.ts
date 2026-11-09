import { Execution } from '../../../../execution/Execution.js';
import { Game } from '../../../../game/Game.js';
import { GroundItems } from '../../../../grounditems/GroundItems.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import type { GroundItem } from '../../../../model/GroundItem.js';
import type { Npc } from '../../../../model/Npc.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { Skills } from '../../../../skills/Skills.js';
import { Sustain } from '../../../../sustain/Sustain.js';
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

// Why: the journal can't tell this stage from the last: both print "Something is watching me" and "I must work my way deeper into these caverns" and differ only in strike-through colour. The horn is the signal, so taking it is part of the same step.

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
    // Why: no boulder and a smashed cage means the job is done; the stage moved and the journal didn't.
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
    // Why: the script keeps the railing, so the oracle is its `p_telejump(coord - 25x)`, with the threshold past anything the op-click's walk could cover.
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

// Why: the 3 paladins only turn hostile once the main cavern has been entered, so before that they're killed one at a time from a standing start.
// Why: the well eats the crests and the journal never says so, so a snapshot can't tell "not killed yet" from "already fed". Every irreversible part is one step, ending on the one thing the journal can see: standing on the level-1 platform past the temple doors.

/** Kill paladins, feed the well and pass the doors, whatever of that is still outstanding. */
export async function crossTheTemple(log: (m: string) => void): Promise<boolean> {
    const crests = (): number => UP_BADGES.filter(badge => heldId(badge.id) > 0).length;
    // Why: a paladin respawns and "whichever is alive" always picks the nearest, so the same one would die every time and its crest feed a bit already set. Each is killed once per crossing, by id.
    const killed = new Set<number>();
    for (let round = 0; round < 4; round++) {
        if ((Game.tile()?.level ?? 0) === 1) {
            return true;
        }
        // Why: all 3 crests before one trip to the well; feeding each as it drops costs a 50-odd tile walk each way per crest.
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
    // Why: which crest is owed can't be read once the well has eaten them, so the target is picked by who hasn't been killed yet.
    const findTarget = (): Npc | null => Npcs.query()
        .where(npc => PALADINS.some(p => p.npc === npc.id) && !killed.has(npc.id)
            && !(npc.health === 0 && npc.snap.totalHealth > 0))
        .action('Attack')
        .within(20)
        .nearest();
    const target = findTarget();
    if (!target) {
        log('no paladin left on the shelf that this crossing has not already killed');
        return false;
    }
    const owed = PALADINS.find(p => p.npc === target.id) ?? PALADINS[0]!;
    const findLive = (): Npc | null => Npcs.query().where(npc => npc.id === owed.npc).within(20).nearest();
    // Why: the crest is the only proof the death script ran, and it lands on the paladin's tile, so it is also the earliest read of a kill.
    const findDrop = (): GroundItem | null => GroundItems.query().where(item => item.id === owed.badge.id).within(12).nearest();
    log(`attacking paladin ${owed.npc} at (${target.tile().x},${target.tile().z})`);
    const combatXp = (): number => ['attack', 'strength', 'defence', 'hitpoints']
        .reduce((sum, skill) => sum + Skills.xp(skill), 0);
    const deadline = performance.now() + 180_000;
    let lastOffense = performance.now();
    let lastXp = combatXp();
    let lastHealth = target.health;
    let lastAttack = 0;
    let dead = false;
    while (performance.now() < deadline) {
        // Why: a one-shot step blocks the scheduler, so the quest's own sustain never runs unless this loop calls it; at 1 Prayer that is the food between hits.
        await Sustain.run();
        if (findDrop() !== null) {
            dead = true;
            break;
        }
        const live = findLive();
        if (!live || (live.health === 0 && live.snap.totalHealth > 0)) {
            dead = true;
            break;
        }
        const at = Game.tile();
        const adjacent = at !== null && Math.max(Math.abs(live.tile().x - at.x), Math.abs(live.tile().z - at.z)) <= 1;
        // Why: a paladin can stand 3 tiles away behind a wall and answer the Attack op with nothing, so the fight keeps closing to melee instead of trusting one click to walk there.
        if (!adjacent && !(await walkTo(live.tile(), 1, log))) {
            log(`paladin ${owed.npc} out of reach at (${live.tile().x},${live.tile().z})`);
            return false;
        }
        const now = performance.now();
        const nextXp = combatXp();
        if (nextXp > lastXp || live.health < lastHealth) {
            lastOffense = now;
        }
        lastXp = nextXp;
        lastHealth = live.health;
        // Why: a fight that lands nothing for 20s is a geometry problem, not a slow kill, and waiting the full 3 minutes just lets the crest time out on the floor.
        if (now - lastOffense >= 20_000) {
            log(`no damage on paladin ${owed.npc} for 20s at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
            return false;
        }
        if (now - lastAttack >= 5_000) {
            if (!(await live.interact('Attack'))) {
                log(`could not attack paladin ${owed.npc}`);
                return false;
            }
            lastAttack = now;
        }
        await Execution.delayTicks(1);
    }
    if (!dead) {
        log(`paladin ${owed.npc} outlasted the fight at ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp`);
        return false;
    }
    // Why: the death script drops the crest a tick after the hp bar empties, so a single query loses the drop and burns the paladin for this crossing.
    if (!(await driveUntil(() => findDrop() !== null, [], log, 8_000))) {
        log(`paladin ${owed.npc} died but left no coat of arms in reach`);
        return false;
    }
    const drop = findDrop();
    if (!drop || !(await walkTo(drop.tile(), 1, log)) || !(await drop.interact('Take'))) {
        return false;
    }
    // Why: only a crest in the pack proves the kill counted; marking it earlier makes a lost drop look like a paladin this crossing may no longer touch.
    if (!(await driveUntil(() => heldId(owed.badge.id) > 0, [], log, 10_000))) {
        return false;
    }
    killed.add(target.id);
    return true;
}

/** The blood well opens the temple doors once it has all 3 crests and the horn. */
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
