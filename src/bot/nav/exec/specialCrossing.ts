/**
 * Special crossings: tolls, ships, quest unlock, use-item gates (extracted from WalkExecutor).
 */

import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { Banking, isDisposableGatherJunk } from '../../api/Banking.js';
import { Execution } from '../../api/Execution.js';
import { Bank } from '../../api/hud/Bank.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { Skills } from '../../api/hud/Skills.js';
import { Npcs } from '../../api/queries/Npcs.js';
import {
    matchesUseItem,
    meetsRequirement,
    meetsSkill,
    pickChoice,
    type SpecialCrossing
} from '../data/specialCrossings.js';
import { isOnFarSide } from '../followMath.js';
import type { TransportInfo } from '../PathFinder.js';
import { findTransportLoc } from './transportLoc.js';

const DIALOGUE_STEPS = 24;
const SHIP_DIALOGUE_STEPS = 40;
const GATE_REOPENS = 2;

export interface PathStepTile extends WorldTile {
    transport?: TransportInfo;
}

export type WalkToFn = (
    dest: WorldTile,
    opts?: { radius?: number; timeoutMs?: number; log?: (msg: string) => void }
) => Promise<boolean>;

export async function handleSpecialCrossing(
    approach: PathStepTile,
    step: PathStepTile,
    sc: SpecialCrossing,
    log: (msg: string) => void,
    walkTo: WalkToFn
): Promise<boolean> {
    if (sc.requires && !meetsRequirement(Inventory.count(sc.requires.item), sc.requires)) {
        log(`${sc.label}: need ${sc.requires.count} ${sc.requires.item} — skipping`);
        return false;
    }

    if (sc.requiresSkill && !meetsSkill(Skills.level(sc.requiresSkill.name), sc.requiresSkill)) {
        log(`${sc.label}: need ${sc.requiresSkill.name} ${sc.requiresSkill.level} — skipping`);
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

    if (sc.npc) {
        const npc = Npcs.query().name(sc.npc).action('Talk-to').nearest();
        if (!npc || !(await npc.interact('Talk-to'))) {
            log(`${sc.label}: '${sc.npc}' not talkable`);
            return false;
        }
        const arrived = (): boolean => {
            const me = reader.worldTile();
            return me !== null && sc.toTile !== undefined && me.level === sc.toTile.level && isNear(me, sc.toTile, 2);
        };
        for (let i = 0; i < SHIP_DIALOGUE_STEPS && !arrived(); i++) {
            const pick = sc.dialogue ? pickChoice(ChatDialog.options(), sc.dialogue.choose) : null;
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
        }
        if (arrived()) {
            log(`${sc.label}: sailed`);
            return true;
        }
        log(`${sc.label}: voyage did not resolve — repathing`);
        return false;
    }

    const crossed = (): boolean => isOnFarSide(reader.worldTile(), approach, step);
    const maxOpens = sc.reopenAfterDialogue ? GATE_REOPENS : 1;
    for (let open = 0; open < maxOpens && !crossed(); open++) {
        const loc = findTransportLoc({ locName: sc.locName, action: sc.action, locX: sc.x, locZ: sc.z });
        if (!loc) {
            log(`${sc.label}: '${sc.locName}' not found at (${sc.x},${sc.z})`);
            return false;
        }
        if (sc.useItem) {
            const item = Inventory.items().find(candidate => matchesUseItem(candidate, sc.useItem!));
            if (!item) {
                log(`${sc.label}: need ${sc.useItem.name} (id ${sc.useItem.id}) — skipping`);
                return false;
            }
            if (!(await item.useOn(loc))) {
                log(`${sc.label}: could not use ${sc.useItem.name} on ${sc.locName}`);
                return false;
            }
        } else if (!loc.interact(sc.action)) {
            log(`${sc.label}: '${sc.action}' not offered (ops: ${loc.actions().join(', ')})`);
            return false;
        }
        for (let i = 0; i < DIALOGUE_STEPS && !crossed(); i++) {
            const pick = sc.dialogue ? pickChoice(ChatDialog.options(), sc.dialogue.choose) : null;
            if (pick) {
                await ChatDialog.chooseOption(pick);
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
        }
    }
    if (crossed()) {
        log(`${sc.label}: crossed`);
        return true;
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

function isNear(a: { x: number; z: number }, b: { x: number; z: number }, r: number): boolean {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= r;
}
