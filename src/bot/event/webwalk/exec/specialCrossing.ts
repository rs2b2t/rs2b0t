/**
 * Special crossings: tolls, ships, quest unlock, use-item gates (extracted from WalkExecutor).
 */

import type { WorldTile } from '../../../adapter/ClientAdapter.js';
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Banking, isDisposableGatherJunk } from '../../../api/bank/Banking.js';
import { Execution } from '../../../api/execution/Execution.js';
import { Bank } from '../../../api/bank/Bank.js';
import { ChatDialog } from '../../../api/ui/dialogue/ChatDialog.js';
import { Equipment } from '../../../api/equipment/Equipment.js';
import { Inventory } from '../../../api/inventory/Inventory.js';
import { Quests } from '../../../api/ui/questlog/Quests.js';
import { Skills } from '../../../api/skills/Skills.js';
import { Locs } from '../../../api/locs/Locs.js';
import { Npcs } from '../../../api/npcs/Npcs.js';
import { GameMessages } from '../../../api/chatbox/gameMessages.js';
import { Sustain } from '../../../api/sustain/Sustain.js';
import { Reachability } from '../geometry/Reachability.js';
import {
    matchesUseItem,
    meetsRequirement,
    meetsSkill,
    pickChoice,
    type SpecialCrossing
} from '../data/specialCrossings.js';
import { DirectNavigator } from '../DirectNavigator.js';
import { chebyshev, isOnFarSide } from '../geometry/followMath.js';
import type { TransportInfo } from '../PathFinder.js';
import { findTransportLoc } from './transportLoc.js';

const DIALOGUE_STEPS = 24;
const SHIP_DIALOGUE_STEPS = 40;
const GATE_REOPENS = 2;

function isNearTile(
    me: { x: number; z: number; level: number },
    dest: { x: number; z: number; level: number },
    rad: number
): boolean {
    return me.level === dest.level && chebyshev(me, dest) <= rad;
}

export function shouldSceneStepToTile(
    staging: WorldTile | undefined,
    promptOpen: boolean,
    edgePassable: boolean,
    current: WorldTile | null,
    destination: WorldTile | undefined
): boolean {
    return (
        staging !== undefined &&
        !promptOpen &&
        edgePassable &&
        current !== null &&
        destination !== undefined &&
        current.x === staging.x &&
        current.z === staging.z &&
        current.level === staging.level &&
        current.level === destination.level &&
        chebyshev(current, destination) === 1
    );
}

export function arrivalDialogueResolved(settleDialogueAfterArrival: boolean | undefined, promptOpen: boolean): boolean {
    return settleDialogueAfterArrival !== true || !promptOpen;
}

export interface PathStepTile extends WorldTile {
    transport?: TransportInfo;
}

type WalkToFn = (
    dest: WorldTile,
    opts?: { radius?: number; timeoutMs?: number; log?: (msg: string) => void }
) => Promise<boolean>;

/**
 * Approx content category bans for Entrana (monk_of_entrana.rs2 has_entrana_restricted_items).
 * Pure helper so plan-time WorldState can reuse the same heuristic.
 */
export const ENTRANA_RESTRICTED_GEAR_RE =
    /\b(sword|dagger|scimitar|longsword|2h|two.handed|mace|warhammer|battleaxe|axe|pickaxe|spear|hasta|halberd|maul|claws|whip|bow|crossbow|javelin|dart|thrownaxe|knife|staff|wand|battlestaff|halberd|cannon|helmet|full helm|med helm|coif|platebody|chainbody|platelegs|plateskirt|skirt of|kiteshield|square shield|sq shield|dragon square|god cape|fire cape|obsidian cape|defender)\b/i;

/** True if any of the given item names looks like Entrana-banned gear. */
export function namesHaveEntranaRestrictedGear(names: readonly string[]): boolean {
    return names.some(n => n.length > 0 && ENTRANA_RESTRICTED_GEAR_RE.test(n));
}

export function hasEntranaRestrictedGear(): boolean {
    const names = [
        ...Inventory.items().map(i => i.name ?? ''),
        ...Equipment.items().map(i => i.name ?? '')
    ];
    return namesHaveEntranaRestrictedGear(names);
}

export async function handleSpecialCrossing(
    approach: PathStepTile,
    step: PathStepTile,
    sc: SpecialCrossing,
    log: (msg: string) => void,
    walkTo: WalkToFn
): Promise<boolean> {
    const transport = step.transport;
    if (!transport) {
        throw new Error(`${sc.label}: path step is missing transport metadata`);
    }

    if (sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires)) {
        log(`${sc.label}: need ${sc.requires.count} ${sc.requires.item} — skipping`);
        return false;
    }

    if (sc.requiresSkill && !meetsSkill(Skills.level(sc.requiresSkill.name), sc.requiresSkill)) {
        log(`${sc.label}: need ${sc.requiresSkill.name} ${sc.requiresSkill.level} — skipping`);
        return false;
    }

    // Port Sarim → Entrana: monks refuse weapons/armour (content category check).
    if (/port sarim.*entrana/i.test(sc.label) && hasEntranaRestrictedGear()) {
        log(`${sc.label}: remove weapons/armour before boarding Entrana`);
        return false;
    }

    if (sc.unlockQuest) {
        const st = Quests.status(sc.unlockQuest.quest);
        if (st === 'notStarted' || st === 'unknown') {
            if (!(await unlockQuestForCrossing(sc, approach, log, walkTo))) {
                return false;
            }
        }
    }

    // Loc-backed multi-dest hubs (spirit trees): interact loc then dialog, no NPC.
    if (!sc.npc && sc.dialogue && sc.toTile && /spirit/i.test(sc.locName)) {
        const loc =
            Locs.query().name(sc.locName).action(sc.action).within(3).nearest()
            ?? Locs.query().name(sc.locName).within(3).nearest();
        if (!loc || !(await loc.interact(sc.action))) {
            log(`${sc.label}: '${sc.locName}' not interactable`);
            return false;
        }
        const rad = sc.arrivalRadius ?? 3;
        const arrived = (): boolean => {
            const me = reader.worldTile();
            return me !== null && sc.toTile !== undefined && isNearTile(me, sc.toTile, rad);
        };
        for (let i = 0; i < SHIP_DIALOGUE_STEPS && !arrived(); i++) {
            const pick = pickChoice(ChatDialog.options(), sc.dialogue.choose);
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
        }
        if (arrived()) {
            log(`${sc.label}: arrived`);
            return true;
        }
        log(`${sc.label}: spirit hop did not resolve — repathing`);
        return false;
    }

    if (sc.npc) {
        // Prefer the crossing action when it is a NPC op (Teleport, Pay-fare, …).
        const preferred =
            sc.action && sc.action !== 'Open' && sc.action !== 'Go-through' && sc.action !== 'Pull'
                ? sc.action
                : 'Talk-to';
        const tryActs = preferred === 'Talk-to' ? (['Talk-to'] as const) : ([preferred, 'Talk-to'] as const);
        // Why: keying on the specialCrossing stand tile rather than the NPC type alone matters because one type serves several routes — a Customs officer with coordx(npc) < 2815 goes to Ardougne, else Port Sarim.
        // Why: a global nearest() would work while piers are far apart, but the instance at this pier is preferred so a wrong officer can never steal the hop (#404).
        const stand = { x: sc.x, z: sc.z, level: sc.level };
        let interacted = false;
        for (const act of tryActs) {
            const npc =
                Npcs.query().name(sc.npc).action(act).withinOf(stand, 10).nearest()
                ?? Npcs.query().name(sc.npc).action(act).within(12).nearest();
            if (npc && (await npc.interact(act))) {
                interacted = true;
                break;
            }
        }
        if (!interacted) {
            log(`${sc.label}: '${sc.npc}' not interactable (${preferred}) near (${sc.x},${sc.z})`);
            return false;
        }
        const rad = sc.arrivalRadius ?? 2;
        const arrived = (): boolean => {
            const me = reader.worldTile();
            return me !== null && sc.toTile !== undefined && isNearTile(me, sc.toTile, rad);
        };
        let mapClicked = false;
        for (let i = 0; i < SHIP_DIALOGUE_STEPS && !arrived(); i++) {
            const pick = sc.dialogue ? pickChoice(ChatDialog.options(), sc.dialogue.choose) : null;
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else if (sc.mapChoice && !mapClicked) {
                // Glidermap (and similar): click dest button nearest label after dialog closes.
                const comId = reader.mainModalButtonNearText(sc.mapChoice);
                if (comId !== -1 && actions.ifButton(comId)) {
                    mapClicked = true;
                    log(`${sc.label}: map → ${sc.mapChoice}`);
                } else {
                    await Execution.delayTicks(1);
                }
            } else {
                await Execution.delayTicks(1);
            }
        }
        if (arrived()) {
            // Ship/tele landings rebuild the scene (gangplanks on deck). Wait so
            // Locs.query can see the disembark plank before the next hop.
            if (sc.toTile && approach.level !== sc.toTile.level) {
                await Execution.delayTicks(2);
            } else if (sc.toTile) {
                await Execution.delayTicks(1);
            }
            log(`${sc.label}: arrived`);
            return true;
        }
        log(`${sc.label}: hop did not resolve — repathing`);
        return false;
    }

    const crossed = (): boolean => {
        // useItem hops (rope on rock/tree) land on toTile via animation, not a door far-side.
        if (sc.toTile) {
            const me = reader.worldTile();
            const rad = sc.arrivalRadius ?? 2;
            return me !== null && isNearTile(me, sc.toTile, rad);
        }
        return isOnFarSide(reader.worldTile(), approach, step);
    };
    // Already-open gate (Close leaf only): do not fail "not found" — walk through.
    if (/^open$/i.test(sc.action) && !sc.useItem) {
        const shutProbe = findTransportLoc(transport);
        if (!shutProbe) {
            if (crossed()) {
                log(`${sc.label}: already past open '${sc.locName}'`);
                return true;
            }
            const me = reader.worldTile();
            if (me && Reachability.canStep(approach, step)) {
                log(`${sc.label}: '${sc.locName}' already open — continuing`);
                if (me.x === approach.x && me.z === approach.z && me.level === approach.level) {
                    DirectNavigator.walk(step);
                    await Execution.delayUntil(() => crossed(), 2500);
                }
                return crossed() || Reachability.canStep(approach, step);
            }
        }
    }
    // Plague City sewer pipe: content requires a worn gas mask after the quest.
    if (/sewer pipe|plague city/i.test(sc.label) && /pipe/i.test(sc.locName)) {
        if (!Equipment.contains('Gas mask')) {
            if (!(await Equipment.equip('Gas mask'))) {
                log(`${sc.label}: need Gas mask worn — skipping`);
                return false;
            }
        }
    }

    const maxOpens = sc.retryOnGameMessage?.attempts ?? sc.retryIfUnacknowledged?.attempts ?? (sc.reopenAfterDialogue ? GATE_REOPENS : 1);
    for (let open = 0; open < maxOpens && !crossed(); open++) {
        if (sc.exactApproach) {
            const current = reader.worldTile();
            const alreadyExact = current !== null && current.x === approach.x && current.z === approach.z && current.level === approach.level;
            if (!alreadyExact) {
                const reached = await walkTo(approach, {
                    radius: 0,
                    timeoutMs: 30_000,
                    log: message => log(`  ${message}`)
                });
                const arrived = reader.worldTile();
                if (!reached || arrived === null || arrived.x !== approach.x || arrived.z !== approach.z || arrived.level !== approach.level) {
                    log(`${sc.label}: could not reach exact approach (${approach.x},${approach.z},${approach.level})`);
                    return false;
                }
            }
        }
        // useItem (e.g. rope on Rock) must not require a menu action that is not
        // the use-with target — content often only exposes Swim-to / no Climb.
        const loc = sc.useItem
            ? Locs.query()
                .name(sc.locName)
                .where(l => {
                    const t = l.tile();
                    return Math.max(Math.abs(t.x - sc.x), Math.abs(t.z - sc.z)) <= 3;
                })
                .nearest()
            : findTransportLoc(transport);
        if (!loc) {
            // Open leaf mid-loop: succeed if we can pass rather than repath-fail.
            if (
                /^open$/i.test(sc.action)
                && (crossed() || Reachability.canStep(approach, step))
            ) {
                log(`${sc.label}: '${sc.locName}' already open`);
                return true;
            }
            log(`${sc.label}: '${sc.locName}' not found at (${sc.x},${sc.z})`);
            return false;
        }
        const messageMark = GameMessages.mark();
        if (sc.useItem) {
            // FireGiant: walk to exact throw/tree stand before rope (content aplocu range
            // is ~10; from raft landing "I can't reach that!" / bad shot).
            if (/Baxtorian rope → rock/i.test(sc.label)) {
                const stand = { x: 2512, z: 3477, level: 0 };
                const atStand = await walkTo(stand, {
                    radius: 0,
                    timeoutMs: 60_000,
                    log: m => log(`  ${m}`)
                });
                if (!atStand) {
                    log(`${sc.label}: could not reach rope-throw stand (2512,3477)`);
                    return false;
                }
            } else if (/Baxtorian rope → ledge/i.test(sc.label)) {
                const stand = { x: 2512, z: 3466, level: 0 };
                const atStand = await walkTo(stand, {
                    radius: 0,
                    timeoutMs: 60_000,
                    log: m => log(`  ${m}`)
                });
                if (!atStand) {
                    log(`${sc.label}: could not reach dead-tree stand (2512,3466)`);
                    return false;
                }
            }
            // Prefer id match, then name (give/cheat labels vs pack id).
            const item =
                Inventory.items().find(candidate => matchesUseItem(candidate, sc.useItem!))
                ?? Inventory.first(sc.useItem.name);
            if (!item) {
                log(`${sc.label}: need ${sc.useItem.name} (id ${sc.useItem.id}) — skipping`);
                return false;
            }
            // Re-resolve loc after walking into range (scene may have lagged).
            const useLoc =
                Locs.query()
                    .name(sc.locName)
                    .where(l => {
                        const t = l.tile();
                        return Math.max(Math.abs(t.x - sc.x), Math.abs(t.z - sc.z)) <= 3;
                    })
                    .nearest() ?? loc;
            if (!(await item.useOn(useLoc))) {
                log(`${sc.label}: could not use ${sc.useItem.name} on ${sc.locName}`);
                return false;
            }
            // Baxtorian rock/tree: forcewalk + throw + swim/tele takes many ticks
            // (FireGiant waits ~12s for PastRock / AtLedge).
            if (sc.toTile) {
                const rad = sc.arrivalRadius ?? 2;
                const landed = await Execution.delayUntil(() => {
                    const me = reader.worldTile();
                    return me !== null && isNearTile(me, sc.toTile!, rad);
                }, 14_000);
                if (landed) {
                    log(`${sc.label}: crossed`);
                    return true;
                }
                log(`${sc.label}: use-item hop did not land at toTile — repathing`);
                return false;
            }
        } else if (!(await loc.interact(sc.action))) {
            log(`${sc.label}: '${sc.action}' not offered (ops: ${loc.actions().join(', ')})`);
            return false;
        }
        const waitSteps = DIALOGUE_STEPS;
        let sawQuietArrival = false;
        let sceneStepIssued = false;
        let sawDialogue = false;
        for (let i = 0; i < waitSteps && (sc.settleDialogueAfterArrival === true || !crossed()); i++) {
            if (sc.retryOnGameMessage && GameMessages.sawSince(messageMark, sc.retryOnGameMessage.message)) {
                break;
            }
            const promptOpen = ChatDialog.isOpen();
            sawDialogue ||= promptOpen;
            if (sc.settleDialogueAfterArrival === true && crossed() && !promptOpen) {
                if (sawQuietArrival) break;
                sawQuietArrival = true;
                await Execution.delayTicks(1);
                continue;
            }
            const edgePassable = sc.sceneStepFromTile !== undefined && sc.toTile !== undefined
                && Reachability.canStep(sc.sceneStepFromTile, sc.toTile);
            if (!sceneStepIssued && shouldSceneStepToTile(sc.sceneStepFromTile, promptOpen, edgePassable, reader.worldTile(), sc.toTile)) {
                const me = reader.worldTile();
                if (!(await DirectNavigator.walk(sc.toTile!))) {
                    log(`${sc.label}: could not scene-step from (${me?.x},${me?.z}) to (${sc.toTile!.x},${sc.toTile!.z})`);
                    return false;
                }
                sceneStepIssued = true;
                log(`${sc.label}: scene-step (${me?.x},${me?.z}) → (${sc.toTile!.x},${sc.toTile!.z})`);
                await Execution.delayTicks(1);
                continue;
            }
            sawQuietArrival = false;
            const pick = sc.dialogue ? pickChoice(ChatDialog.options(), sc.dialogue.choose) : null;
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
        }
        const retryMessage = sc.retryOnGameMessage ? GameMessages.firstSince(messageMark, sc.retryOnGameMessage.message) : undefined;
        if (retryMessage) {
            const attempt = open + 1;
            for (let step = 0; step < 12 && ChatDialog.isOpen(); step++) {
                if (ChatDialog.canContinue()) {
                    if (!(await ChatDialog.continue())) {
                        log(`${sc.label}: could not continue ${sc.retryOnGameMessage!.reason} dialogue — repathing`);
                        return false;
                    }
                    await Execution.delayTicks(1);
                } else {
                    await Execution.delayTicks(1);
                }
            }
            if (ChatDialog.isOpen()) {
                log(`${sc.label}: ${sc.retryOnGameMessage!.reason} dialogue did not settle — repathing`);
                return false;
            }
            await Sustain.run();
            if (attempt < maxOpens) {
                log(`${sc.label}: ${sc.retryOnGameMessage!.reason}; attempt ${attempt}/${maxOpens}; ` + `server='${retryMessage.text}' — retrying`);
                await Execution.delayTicks(1);
                continue;
            }
            log(`${sc.label}: ${sc.retryOnGameMessage!.reason}; attempt ${attempt}/${maxOpens}; ` + `server='${retryMessage.text}' — bounded retries exhausted; repathing`);
            return false;
        }
        if (sc.retryIfUnacknowledged && !crossed() && !sawDialogue) {
            const attempt = open + 1;
            const here = reader.worldTile();
            const detail = `tile=(${here?.x},${here?.z},${here?.level}); chat=${reader.modals().chat}; sawDialogue=false`;
            await Sustain.run();
            if (attempt < maxOpens) {
                log(`${sc.label}: ${sc.retryIfUnacknowledged.reason}; attempt ${attempt}/${maxOpens}; ${detail} — retrying`);
                await Execution.delayTicks(1);
                continue;
            }
            log(`${sc.label}: ${sc.retryIfUnacknowledged.reason}; attempt ${attempt}/${maxOpens}; ${detail} — bounded retries exhausted; repathing`);
            return false;
        }
        // Non-useItem tele hops (pipe, manhole, mud Climb, cave Enter, Jump-From).
        if (sc.toTile && !sc.useItem && !crossed()) {
            const rad = sc.arrivalRadius ?? 2;
            await Execution.delayUntil(() => {
                const me = reader.worldTile();
                return me !== null && isNearTile(me, sc.toTile!, rad);
            }, 14_000);
        }
        if (sc.retryOnGameMessage && !crossed()) break;
    }
    if (crossed() && arrivalDialogueResolved(sc.settleDialogueAfterArrival, ChatDialog.isOpen())) {
        const me = reader.worldTile();
        log(`${sc.label}: crossed at (${me?.x},${me?.z},${me?.level})`);
        return true;
    }
    if (crossed()) {
        log(`${sc.label}: arrived with unresolved dialogue; chat=${reader.modals().chat}; ` + `options=${ChatDialog.options().join(' | ') || 'none'}`);
        return false;
    }
    log(`${sc.label}: dialogue did not resolve — repathing`);
    return false;
}

async function unlockQuestForCrossing(
    sc: SpecialCrossing,
    approach: PathStepTile,
    log: (msg: string) => void,
    walkTo: WalkToFn
): Promise<boolean> {
    const u = sc.unlockQuest!;
    if (u.requireComplete) {
        const req = Quests.status(u.requireComplete);
        if (req !== 'complete') {
            log(`${sc.label}: need ${u.requireComplete} complete before ${u.quest} — skipping`);
            return false;
        }
    }

    const needSlots = u.freeSlots ?? 0;
    if (needSlots > 0 && !(await ensureUnlockPackSpace(sc, needSlots, log))) {
        return false;
    }

    log(`${sc.label}: ${u.quest} not started — walking to ${u.npc} to unlock`);
    const toNpc = await walkTo(u.stand, {
        radius: 4,
        timeoutMs: 180_000,
        log: m => log(`  ${m}`)
    });
    if (!toNpc) {
        log(`${sc.label}: could not reach ${u.npc} at (${u.stand.x},${u.stand.z})`);
        return false;
    }

    if (needSlots > 0 && Inventory.free() < needSlots) {
        log(
            `${sc.label}: pack only ${Inventory.free()} free after walk (need ${needSlots} for ${u.npc} rewards) — giving up`
        );
        return false;
    }

    const npc = Npcs.query().name(u.npc).nearest();
    if (!npc || !(await npc.interact('Talk-to'))) {
        log(`${sc.label}: '${u.npc}' not talkable near unlock stand`);
        return false;
    }

    const unlocked = (): boolean => {
        const st = Quests.status(u.quest);
        return st === 'inProgress' || st === 'complete';
    };
    for (let i = 0; i < 80 && !unlocked(); i++) {
        const pick = pickChoice(ChatDialog.options(), u.dialogue.choose);
        if (pick) {
            await ChatDialog.chooseOption(pick);
        } else if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        } else {
            await Execution.delayTicks(1);
        }
    }
    for (let i = 0; i < 20 && (ChatDialog.isOpen() || ChatDialog.canContinue()); i++) {
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        } else {
            await Execution.delayTicks(1);
        }
    }

    if (!unlocked()) {
        log(`${sc.label}: talked to ${u.npc} but ${u.quest} still ${Quests.status(u.quest)}`);
        return false;
    }
    log(`${sc.label}: ${u.quest} started — returning to gate`);

    const back = await walkTo(approach, {
        radius: 2,
        timeoutMs: 180_000,
        log: m => log(`  ${m}`)
    });
    if (!back) {
        log(`${sc.label}: could not return to gate after unlock`);
        return false;
    }
    return true;
}

async function ensureUnlockPackSpace(
    sc: SpecialCrossing,
    need: number,
    log: (msg: string) => void
): Promise<boolean> {
    if (Inventory.free() >= need) {
        return true;
    }

    const junk = Inventory.items().filter(i => isDisposableGatherJunk(i.name, i.id));
    if (junk.length === 0) {
        log(
            `${sc.label}: need ${need} free slots for quest items `
                + `(have ${Inventory.free()}, no bankable junk) — giving up`
        );
        return false;
    }

    log(`${sc.label}: pack tight (${Inventory.free()}/${need} free) — banking ${junk.length} junk stack(s)`);
    if (
        !(await Banking.open({
            preferNearby: true,
            log: m => log(`  ${m}`)
        }))
    ) {
        log(`${sc.label}: could not open bank to free space — giving up`);
        return false;
    }
    await Bank.depositAllMatching((name, id) => isDisposableGatherJunk(name, id));
    await Execution.delayTicks(1);
    if (Bank.isOpen()) {
        await Bank.close().catch(() => undefined);
    }

    if (Inventory.free() < need) {
        log(
            `${sc.label}: still ${Inventory.free()} free after banking junk (need ${need}) — giving up`
        );
        return false;
    }
    log(`${sc.label}: pack ok (${Inventory.free()} free) after banking junk`);
    return true;
}
