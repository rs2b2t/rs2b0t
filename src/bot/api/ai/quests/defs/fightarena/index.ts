import { Traversal } from '../../../../walking/Traversal.js';
import { talkStrict, type NpcStop } from '../../exec/primitives.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { QUESTS } from '../../data/quests.js';
import { FA_NPC, FA_OBJ, FA_TILE, pocketOf, type FaPocket } from './areas.js';
import { FA_FIGHT } from './fights.js';
import { FA_STAGE, readFightArenaStage } from './journal.js';
import {
    combatSwap,
    enterArenaByDoor2,
    enterArenaByGuard,
    enterBuilding,
    fightWithRelease,
    fleeArena,
    leaveBuilding,
    searchChest,
    talkAndLand,
    talkById,
    unlockJeremy,
    unwearable,
    wearCombat,
    wearKhazard,
    wearKit
} from './legs.js';

const LADY_SERVIL: NpcStop = {
    npc: 'Lady Servil',
    anchor: FA_TILE.LADY_SERVIL,
    leash: 8,
    prefer: ['Can I help you?', 'Yes']
};

const held = (snap: QuestSnapshot, id: number): boolean => (snap.invIds?.get(id) ?? 0) > 0;
const worn = (snap: QuestSnapshot, id: number): boolean => snap.wornIds?.has(id) ?? false;
const disguised = (snap: QuestSnapshot): boolean => worn(snap, FA_OBJ.HELMET) || worn(snap, FA_OBJ.ARMOUR);

// Why: door1 lets one piece through, but the drunk guard's `~wearing_khazard_armour` wants both, so half a disguise loops at him forever.
const hasBoth = (snap: QuestSnapshot): boolean =>
    (held(snap, FA_OBJ.HELMET) || worn(snap, FA_OBJ.HELMET))
    && (held(snap, FA_OBJ.ARMOUR) || worn(snap, FA_OBJ.ARMOUR));

const custom = (name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep =>
    ({ kind: 'custom', name, run });

const CHEST = custom('search the guards\' chest', searchChest);
const WEAR_DISGUISE = custom('wear the Khazard disguise', wearKhazard);
const WEAR_COMBAT = custom('wear the combat kit', wearCombat);
const ENTER_BUILDING = custom('enter the arena building', enterBuilding);
const LEAVE_BUILDING = custom('leave the arena building', leaveBuilding);
const ENTER_ARENA = custom('enter the arena', enterArenaByDoor2);
const KNOCK_FOR_GUARD = custom('knock for the arena guard', enterArenaByGuard);
const UNLOCK_JEREMY = custom('unlock Jeremy\'s cell', unlockJeremy);
const FLEE = custom('run from General Khazard', fleeArena);

const DRUNK_GUARD = custom('talk to the drunk guard', log =>
    talkById(FA_NPC.DRUNK_GUARD, ['Do you still fancy a drink?', 'Yes'], log, FA_TILE.DRUNK_GUARD));
const CUTSCENE_MS = 60_000;

const HENGRAD = custom('talk to Hengrad', log =>
    talkAndLand(FA_NPC.HENGRAD, 'arena', CUTSCENE_MS, log));
const ASK_SERVILS = custom('ask the Servils about Khazard', log => talkById(FA_NPC.JEREMY_ARENA, [], log));
const RELEASE_BEAST = custom('ask Justin what comes next', log =>
    talkAndLand(FA_NPC.JUSTIN, 'prisonCell', CUTSCENE_MS, log));

// Why: the barman runs no shop, and buying a beer by mistake is what an unmatched option costs here.
const BUY_BREW = custom('buy a Khali brew', async log => {
    if (!(await Traversal.walkResilient(FA_TILE.BARMAN, { radius: 3, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    return talkStrict('Khazard barman', ['I\'d like a Khali brew please.'], log);
});

// Why: `jeremy_servil_arena` is the one who queues the ogre, and Justin is the one who opens the scorpion's and Bouncer's gates.
const FIGHT_OGRE = custom(`fight ${FA_FIGHT.ogre.what}`, log =>
    fightWithRelease(FA_FIGHT.ogre, FA_NPC.JEREMY_ARENA, log));
const FIGHT_SCORPION = custom(`fight ${FA_FIGHT.scorpion.what}`, log =>
    fightWithRelease(FA_FIGHT.scorpion, FA_NPC.JUSTIN, log));
const FIGHT_BOUNCER = custom(`fight ${FA_FIGHT.bouncer.what}`, log =>
    fightWithRelease(FA_FIGHT.bouncer, FA_NPC.JUSTIN, log));

/** True once the pack holds a head or body that is not the disguise. */
function combatKitCarried(snap: QuestSnapshot): boolean {
    return combatSwap([...(snap.invIds?.keys() ?? [])]).length > 0;
}

// Why: the queue keeps its gear banked between quests, so a bot that walks in wearing nothing punches a level-137 dog for 116 hitpoints.
// Why: Bouncer's damagetype is stab and its defences are flat, so a scimitar is as good as anything and faster than a two-hander.
const TIERS = ['rune', 'adamant', 'mithril', 'black', 'steel', 'iron', 'bronze'] as const;

// Why: chainbody outranks platebody because rune plate wants Dragon Slayer complete and refuses in silence.
const KIT_SLOTS: readonly { readonly kinds: readonly string[] }[] = [
    { kinds: ['scimitar', 'longsword', 'battleaxe', 'mace', 'sword'] },
    { kinds: ['chainbody', 'platebody'] },
    { kinds: ['platelegs', 'plateskirt'] },
    { kinds: ['full helm', 'med helm'] },
    { kinds: ['kiteshield', 'sq shield'] }
];

/** Every word `KIT_SLOTS` can pick, so the spillover deposit never banks the kit. */
export const KIT_KEEP: readonly string[] = KIT_SLOTS.flatMap(s => s.kinds);

function wearingKind(snap: QuestSnapshot, kinds: readonly string[]): boolean {
    for (const name of snap.worn) {
        if (kinds.some(kind => name.endsWith(kind))) {
            return true;
        }
    }
    return false;
}

function bestForSlot(snap: QuestSnapshot, kinds: readonly string[]): string | null {
    for (const tier of TIERS) {
        for (const kind of kinds) {
            const name = `${tier} ${kind}`;
            if (unwearable.has(name)) {
                continue;
            }
            if ((snap.bank?.get(name) ?? 0) > 0 || (snap.inv.get(name) ?? 0) > 0) {
                return name[0]!.toUpperCase() + name.slice(1);
            }
        }
    }
    return null;
}

/** The best melee kit the account owns for the slots it has not filled. */
export function kitWanted(snap: QuestSnapshot): string[] {
    const out: string[] = [];
    for (const { kinds } of KIT_SLOTS) {
        if (wearingKind(snap, kinds)) {
            continue;
        }
        // Why: a two-hander would take the shield slot with it, and none of the weapon kinds here is one.
        const pick = bestForSlot(snap, kinds);
        if (pick) {
            out.push(pick);
        }
    }
    return out;
}

// Why: `snap.bank` is empty until something opens a booth, so "is the scimitar banked?" answers no on the first decide tick.

/** Arm the account from the bank, or null when it is already dressed for the arena. */
function kitStep(snap: QuestSnapshot): QuestStep | null {
    const wanted = kitWanted(snap);
    if (wanted.length === 0) {
        return snap.bankKnown ? null : { kind: 'scanBank', bank: FA_TILE.YANILLE_BANK };
    }
    const carried = wanted.filter(name => (snap.inv.get(name.toLowerCase()) ?? 0) > 0);
    if (carried.length > 0) {
        return custom(`wear ${carried.join(', ')}`, log => wearKit(carried, log));
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: FA_TILE.YANILLE_BANK };
    }
    return { kind: 'withdraw', items: wanted.map(name => ({ name, qty: 1 })), bank: FA_TILE.YANILLE_BANK };
}

function outsideStep(snap: QuestSnapshot, stage: number): QuestStep {
    if (stage <= FA_STAGE.NOT_STARTED || stage >= FA_STAGE.FREED_SERVILS) {
        return { kind: 'talk', stop: LADY_SERVIL };
    }
    // Why: the disguise fills the head and body slots without being a kit item, so a kit check under it wants a second body on every pass.
    if (!disguised(snap)) {
        const kit = kitStep(snap);
        if (kit) {
            return kit;
        }
    }
    if (stage >= FA_STAGE.SENT_JAIL) {
        return KNOCK_FOR_GUARD;
    }
    if (!hasBoth(snap)) {
        return CHEST;
    }
    if (stage === FA_STAGE.SPOKEN_DRUNKGUARD && !held(snap, FA_OBJ.BREW)) {
        return BUY_BREW;
    }
    if (!disguised(snap)) {
        return WEAR_DISGUISE;
    }
    return ENTER_BUILDING;
}

function buildingStep(snap: QuestSnapshot, stage: number): QuestStep {
    // Why: from stage 9 the arena is entered through the guard at door1, and door2 refuses anyone coming from inside the building.
    if (stage >= FA_STAGE.SENT_JAIL) {
        return LEAVE_BUILDING;
    }
    if (stage >= FA_STAGE.ENTERED_OGRE_FIGHT) {
        return ENTER_ARENA;
    }
    if (stage === FA_STAGE.GIVEN_KHALI_BREW) {
        // Why: a death drops the keys, and the drunk guard hands out a spare set below stage 6.
        if (!held(snap, FA_OBJ.KEYS)) {
            return disguised(snap) ? DRUNK_GUARD : WEAR_DISGUISE;
        }
        if (disguised(snap) && combatKitCarried(snap)) {
            return WEAR_COMBAT;
        }
        return UNLOCK_JEREMY;
    }
    if ((stage === FA_STAGE.SPOKEN_DRUNKGUARD && !held(snap, FA_OBJ.BREW)) || !hasBoth(snap)) {
        return LEAVE_BUILDING;
    }
    if (!disguised(snap)) {
        return WEAR_DISGUISE;
    }
    return DRUNK_GUARD;
}

function arenaStep(snap: QuestSnapshot, stage: number): QuestStep {
    if (stage >= FA_STAGE.FREED_SERVILS) {
        return FLEE;
    }
    if (disguised(snap) && combatKitCarried(snap)) {
        return WEAR_COMBAT;
    }
    if (stage === FA_STAGE.DEFEATED_BOUNCER) {
        return ASK_SERVILS;
    }
    if (stage === FA_STAGE.DEFEATED_SCORPION) {
        return FIGHT_BOUNCER;
    }
    if (stage === FA_STAGE.SENT_JAIL) {
        return FIGHT_SCORPION;
    }
    if (stage === FA_STAGE.DEFEATED_OGRE) {
        return RELEASE_BEAST;
    }
    return FIGHT_OGRE;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const stage = snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Fight Arena stage unavailable' };
    }
    if (stage >= FA_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    const where: FaPocket = pocketOf(snap.tile);
    if (where === 'jeremyCell') {
        return { kind: 'wait', reason: 'standing inside Jeremy\'s cell — nothing routes out' };
    }
    if (where === 'prisonCell') {
        return HENGRAD;
    }
    if (where === 'arena') {
        return arenaStep(snap, stage);
    }
    if (where === 'building') {
        return buildingStep(snap, stage);
    }
    return outsideStep(snap, stage);
}

// Why: the fights are back to back with no bank between the jail and the escape, so the pack carries every meal the quest gets.
const FOOD = 24;

export const fightarena: QuestModule = {
    record: QUESTS.find(r => r.id === 'arena')!,
    bank: FA_TILE.YANILLE_BANK,
    food: FOOD,
    grind: ['Khazard Ogre', 'Khazard Scorpion', 'Bouncer'],
    tools: ['khazard helmet', 'khazard armour', 'khazard cell keys', 'khali brew', 'coins', ...KIT_KEEP],
    // Why: the kit is withdrawn and worn by decide(), so the engine's food float has to wait for it — 24 lobsters into an empty pack leave no room for five pieces of rune.
    foodReady: snap => disguised(snap) || kitWanted(snap).length === 0,
    readStage: readFightArenaStage,
    sustain: { foods: ['Lobster', 'Swordfish', 'Shark', 'Tuna'], eatBelowHp: 0.6 },
    warnReadiness: () => 'Fight Arena ends on Bouncer — level 137, 116 hitpoints, 120 attack and defence',
    decide
};
