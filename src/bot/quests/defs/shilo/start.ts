import { Execution } from '../../../api/Execution.js';
import { Traversal } from '../../../api/Traversal.js';
import { ChatDialog } from '../../../api/hud/ChatDialog.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { talkStrict } from '../../exec/primitives.js';
import { SV_ITEM, SV_NPC, SV_TILE } from './areas.js';
import { driveChoice, heldId } from './scene.js';

/**
 * Deepest option first: `pickPreferred` takes the earliest preference that appears,
 * and several of Mosol's menus re-offer an earlier one. Listing "What can we do?"
 * ahead of "I'll go to see the Shaman." would loop forever on his fourth menu.
 *
 * "What danger is there around here?" is deliberately absent — it spawns one to
 * three aggressive Undead Ones, which is why this uses `talkStrict`.
 */
const MOSOL_DIALOGUE = [
    "Yes, I'm sure and I'll take the Wampum belt to Trufitus.",
    "I'll go to see the Shaman.",
    'What can we do?',
    'Rashiliyia? Who is she?',
    'Why do I need to run?'
];

/** Same rule: the option that advances furthest comes first. */
const TRUFITUS_DIALOGUE = [
    'Yes, I will seriously look for Ah Za Rhoon',
    'I am going to search for Ah Za Rhoon!',
    'Why was it called Ah Za Rhoon?',
    'Mosol Rei said something about a legend?'
];

export async function takeWampumBelt(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.WAMPUM_BELT.id) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(SV_TILE.MOSOL_REI, { radius: 3, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    if (!(await talkStrict(SV_NPC.MOSOL_REI, MOSOL_DIALOGUE, log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(SV_ITEM.WAMPUM_BELT.id) > 0, 10_000);
}

/**
 * The quest starts from `opnpcu`, not from talking: the belt has to be used on
 * Trufitus, and only then does the Ah Za Rhoon thread appear in his options.
 */
export async function startQuest(log: (m: string) => void): Promise<boolean> {
    if (heldId(SV_ITEM.WAMPUM_BELT.id) === 0) {
        log('no Wampum belt to show Trufitus');
        return false;
    }
    if (!(await Traversal.walkResilient(SV_TILE.TRUFITUS, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const trufitus = Npcs.query().name(SV_NPC.TRUFITUS).nearest();
    const belt = Inventory.items().find(item => item.id === SV_ITEM.WAMPUM_BELT.id);
    if (!trufitus || !belt) {
        log('Trufitus is not in range');
        return false;
    }
    if (!(await belt.useOn(trufitus))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 8000))) {
        log('showing the belt opened no dialogue');
        return false;
    }
    if (!(await driveChoice(TRUFITUS_DIALOGUE, log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(SV_ITEM.WAMPUM_BELT.id) === 0, 10_000);
}
