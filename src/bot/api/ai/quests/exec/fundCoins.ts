// Default AIOQuester "need quest money" route: pickpocket Men, heal with Kebabs.
// Why: the anchors match the Waterfall and Goblin Diplomacy funding legs — the Al Kharid Man stands next to the kebab shop, and the Varrock Man is used only to afford the 10 gp toll.
import { Execution } from '../../../execution/Execution.js';
import { EventSignal } from '../../../execution/EventSignal.js';
import { Game } from '../../../game/Game.js';
import Tile from '../../../../geometry/Tile.js';
import { ChatDialog } from '../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../inventory/Inventory.js';
import { Skills } from '../../../skills/Skills.js';
import { Npcs } from '../../../npcs/Npcs.js';
import { Sustain } from '../../../sustain/Sustain.js';
import { Traversal } from '../../../walking/Traversal.js';
import type { QuestStep } from '../engine/types.js';

export const VARROCK_FUNDING_MAN = new Tile(3240, 3405, 0);
/** Man tiles immediately north of the Al Kharid kebab shop. */
export const AL_KHARID_FUNDING_MAN = new Tile(3279, 3188, 0);
export const KEBAB_SELLER = new Tile(3272, 3182, 0);

export const AL_KHARID_TOLL = 10;
/** Toll + a few spare gp for one Kebab after the gate. */
export const AL_KHARID_ENTRY_CASH = AL_KHARID_TOLL + 3;
export const SAFE_PICKPOCKET_HP = 3;

const FUNDING_MAN_LEASH = 24;
const FUNDING_STALL_MS = 120_000;
const FUNDING_REGEN_WAIT_MS = 60_000;
const KEBAB = 'Kebab';

export function inAlKharidFundingArea(tile: ReturnType<typeof Game.tile>): boolean {
    // Town proper around the Man + kebab shop — not Shantay Pass (z≈3116–3124).
    return tile !== null
        && tile.level === 0
        && tile.x >= 3260
        && tile.x <= 3305
        && tile.z >= 3155
        && tile.z <= 3210;
}

function fundingMan(anchor: Tile) {
    return Npcs.query()
        .name('Man')
        .action('Pickpocket')
        .where(npc => npc.tile().distanceTo(anchor) <= FUNDING_MAN_LEASH)
        .nearest();
}

async function reachFundingMan(anchor: Tile, log: (m: string) => void): Promise<boolean> {
    if (EventSignal.pending()) return false;
    if (!(await Traversal.walkResilient(anchor, { radius: 6, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    if (EventSignal.pending()) return false;
    if (fundingMan(anchor) || (await Execution.delayUntil(() => fundingMan(anchor) !== null, 15_000))) {
        return true;
    }
    log(`no pickpocketable Man within ${FUNDING_MAN_LEASH} tiles of (${anchor.x},${anchor.z})`);
    return false;
}

async function clearFundingDialog(): Promise<boolean> {
    for (let pages = 0; pages < 12 && ChatDialog.canContinue(); pages++) {
        if (EventSignal.pending()) return false;
        await ChatDialog.continue();
        await Execution.delayTicks(1);
    }
    return !EventSignal.pending();
}

async function pickpocketFundingMan(anchor: Tile, log: (m: string) => void): Promise<boolean> {
    if (EventSignal.pending()) return false;
    let man = fundingMan(anchor);
    if (!man) {
        if (!(await reachFundingMan(anchor, log))) return false;
        man = fundingMan(anchor);
    }
    if (!man || EventSignal.pending()) return false;

    const coinsBefore = Inventory.count('Coins');
    const xpBefore = Skills.xp('thieving');
    const hpBefore = Skills.effective('hitpoints');
    if (!(await man.interact('Pickpocket'))) {
        await Execution.delayTicks(2);
        return true;
    }
    const resolved = await Execution.delayUntil(
        () => Inventory.count('Coins') > coinsBefore
            || Skills.xp('thieving') > xpBefore
            || Skills.effective('hitpoints') < hpBefore
            || ChatDialog.canContinue()
            || EventSignal.pending(),
        8000
    );
    if (EventSignal.pending()) return false;
    if (!resolved) {
        log(`pickpocketing Man at ${man.tile()} produced no coin, XP, health, or dialogue change`);
        await Execution.delayTicks(2);
        return true;
    }
    if (!(await clearFundingDialog())) return false;
    if (Skills.effective('hitpoints') < hpBefore) {
        // Failed level-1 Man pickpocket stuns for eight server ticks.
        await Execution.delayTicks(8);
    }
    return true;
}

/** Buy one Kebab from the Al Kharid seller (exact "Yes please." dialogue). */
async function buyKebab(log: (m: string) => void): Promise<boolean> {
    if (EventSignal.pending()) return false;
    if (!(await Traversal.walkResilient(KEBAB_SELLER, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const seller = Npcs.query().name('Kebab seller').action('Talk-to').within(8).nearest();
    if (!seller) {
        log(`no talkable Kebab seller near (${KEBAB_SELLER.x},${KEBAB_SELLER.z})`);
        return false;
    }
    const before = Inventory.count(KEBAB);
    if (!(await seller.interact('Talk-to'))) return false;
    for (let step = 0; step < 40; step++) {
        if (EventSignal.pending()) return false;
        if (Inventory.count(KEBAB) > before) return true;
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const options = ChatDialog.options();
        if (options.length > 0) {
            const yes = options.find(option => option.trim().toLowerCase() === 'yes please.');
            if (!yes) {
                log(`Kebab seller offered unexpected options: [${options.join(' | ')}]`);
                return false;
            }
            if (!(await ChatDialog.chooseOption(yes))) return false;
            await Execution.delayTicks(1);
            continue;
        }
        await Execution.delayTicks(1);
    }
    log('Kebab seller did not complete a purchase within 40 dialogue steps');
    return false;
}

async function eatFundingKebab(): Promise<boolean> {
    const kebab = Inventory.items().find(i => i.name?.toLowerCase() === KEBAB.toLowerCase());
    if (!kebab) return false;
    const before = Inventory.count(KEBAB);
    if (!(await kebab.interact('Eat'))) return false;
    return Execution.delayUntil(() => Inventory.count(KEBAB) < before, 5000);
}

async function restoreFundingHealth(canBuyKebabs: boolean, log: (m: string) => void): Promise<boolean> {
    while (Skills.effective('hitpoints') < SAFE_PICKPOCKET_HP) {
        if (EventSignal.pending()) return false;
        await Sustain.run();
        if (EventSignal.pending()) return false;
        if (Skills.effective('hitpoints') >= SAFE_PICKPOCKET_HP) continue;
        if (canBuyKebabs && Inventory.count('Coins') > 0) {
            if (!(await buyKebab(log)) || !(await eatFundingKebab())) return false;
            continue;
        }
        log(`waiting up to ${FUNDING_REGEN_WAIT_MS / 1000}s for ${SAFE_PICKPOCKET_HP} HP before another Man pickpocket`);
        if (!(await Execution.delayUntil(
            () => Skills.effective('hitpoints') >= SAFE_PICKPOCKET_HP || EventSignal.pending(),
            FUNDING_REGEN_WAIT_MS
        ))) {
            log(`still below ${SAFE_PICKPOCKET_HP} HP with no food or Kebab funds — funding paused`);
            return false;
        }
        if (EventSignal.pending()) return false;
    }
    return true;
}

async function farmFundingCoins(
    anchor: Tile,
    target: number,
    canBuyKebabs: boolean,
    log: (m: string) => void,
    label: string
): Promise<boolean> {
    if (!(await reachFundingMan(anchor, log))) return false;
    let reportedHundreds = Math.floor(Inventory.count('Coins') / 100);
    let lastEvidenceAt = performance.now();
    while (Inventory.count('Coins') < target) {
        if (EventSignal.pending()) return false;
        const coinsBefore = Inventory.count('Coins');
        const xpBefore = Skills.xp('thieving');
        const hpBefore = Skills.effective('hitpoints');
        if (!(await restoreFundingHealth(canBuyKebabs, log))) return false;
        if (!(await pickpocketFundingMan(anchor, log))) return false;
        if (EventSignal.pending()) return false;
        if (
            Inventory.count('Coins') !== coinsBefore
            || Skills.xp('thieving') !== xpBefore
            || Skills.effective('hitpoints') !== hpBefore
        ) {
            lastEvidenceAt = performance.now();
        } else if (performance.now() - lastEvidenceAt >= FUNDING_STALL_MS) {
            log(`no cash, Thieving XP, or Hitpoints change for ${FUNDING_STALL_MS / 1000}s at the verified Man`);
            return false;
        }
        const hundreds = Math.floor(Inventory.count('Coins') / 100);
        if (hundreds > reportedHundreds) {
            reportedHundreds = hundreds;
            log(`${label} funding: ${Inventory.count('Coins')}/${target} gp`);
        }
    }
    return true;
}

/** East of the Al Kharid toll gate (incl. Shantay north) — no 10gp fee to reach the Man. */
export function eastOfAlKharidGate(tile: ReturnType<typeof Game.tile>): boolean {
    return tile !== null
        && tile.level === 0
        && tile.x >= 3265
        && tile.z >= 3110
        && tile.z <= 3350;
}

/**
 * Earn pack coins up to `target` via Men pickpockets.
 * Uses Al Kharid Man + Kebab seller once inside the gate; Varrock Man only for the toll.
 */
export async function fundQuestCoins(
    target: number,
    log: (m: string) => void,
    opts?: { label?: string }
): Promise<boolean> {
    if (EventSignal.pending()) return false;
    if (target <= 0) return true;
    if (Inventory.count('Coins') >= target) return true;

    const label = opts?.label ?? 'quest';
    const here = Game.tile();

    if (!inAlKharidFundingArea(here)) {
        // Only farm the Varrock Man when we still need the western→eastern toll.
        if (!eastOfAlKharidGate(here) && Inventory.count('Coins') < AL_KHARID_ENTRY_CASH) {
            log(`earning ${AL_KHARID_ENTRY_CASH} gp (Al Kharid toll + food reserve) from a Varrock Man`);
            if (!(await farmFundingCoins(VARROCK_FUNDING_MAN, AL_KHARID_ENTRY_CASH, false, log, label))) {
                return false;
            }
        }
        if (Inventory.count('Coins') >= target) return true;
        if (!(await Traversal.walkResilient(AL_KHARID_FUNDING_MAN, {
            radius: 6,
            attempts: 4,
            timeoutMs: 240_000,
            log
        }))) {
            return false;
        }
        if (EventSignal.pending()) return false;
        if (!inAlKharidFundingArea(Game.tile())) {
            log('did not reach the Al Kharid Man/Kebab funding area');
            return false;
        }
    }

    log(`pickpocketing the Al Kharid Man to ${target} gp, buying Kebabs below ${SAFE_PICKPOCKET_HP} HP`);
    return farmFundingCoins(AL_KHARID_FUNDING_MAN, target, true, log, label);
}

/** Decide-time step: earn coins when bank has none and the pack is short. */
export function earnQuestCoinsStep(target: number, label = 'quest'): QuestStep {
    return {
        kind: 'custom',
        name: `earn ${target} gp (Al Kharid Man + Kebabs)`,
        run: log => fundQuestCoins(target, log, { label })
    };
}
