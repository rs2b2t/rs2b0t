import { Execution } from '../../../../execution/Execution.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import { talkStrict } from '../../exec/primitives.js';
import { SV_ITEM, SV_NPC, SV_TILE } from './areas.js';
import { driveChoice, heldId } from './scene.js';

// Why: `pickPreferred` takes the earliest preference that appears and Mosol's menus re-offer earlier ones, so the deepest option comes first or his 4th menu loops.
// Why: "What danger is there around here?" spawns 1 to 3 aggressive Undead Ones, hence `talkStrict`.
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

/** The quest starts from `opnpcu`: the belt is used on Trufitus, and only then does the Ah Za Rhoon thread appear. */
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
