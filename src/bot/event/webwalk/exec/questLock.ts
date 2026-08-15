/**
 * Quest-locked door dialogue detection.
 * After Open with no movement, mesbox/chat phrases → session blacklist + repath.
 */

import { ChatDialog } from '../../../api/ui/dialogue/ChatDialog.js';
import { Execution } from '../../../api/execution/Execution.js';

/** Phrases that mean "this door will never open for you right now". */
const QUEST_LOCK_PATTERNS: RegExp[] = [
    /\block(ed|s)?\b/i,
    /\bneed(s)? a (key|quest)\b/i,
    /\b(you )?(can'?t|cannot|do not|don't) (open|go|pass|enter)\b/i,
    /\bmembers['’]? (only|area|content)\b/i,
    /\b(complete|finish|start).{0,40}quest\b/i,
    /\bquest.{0,40}(complete|finish|required|before)\b/i,
    /\byou (must|need to|have to).{0,30}(quest|key|level)\b/i,
    /\bnothing interesting happens\b/i,
    /\byou are not (worthy|allowed|ready)\b/i,
    /\bcome back (when|after)\b/i
];

export function isQuestLockText(line: string): boolean {
    const t = line.trim();
    if (t.length < 4) {
        return false;
    }
    return QUEST_LOCK_PATTERNS.some(re => re.test(t));
}

export function isQuestLockDialogue(texts: readonly string[]): boolean {
    return texts.some(isQuestLockText);
}

/** True if any current chat modal line matches a lock phrase. */
export function chatShowsQuestLock(): boolean {
    try {
        if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
            return false;
        }
        return isQuestLockDialogue(ChatDialog.texts());
    } catch {
        return false;
    }
}

/** Click through mesbox so walk can repath. */
export async function dismissQuestLockDialogue(maxSteps = 8): Promise<void> {
    for (let i = 0; i < maxSteps; i++) {
        if (!ChatDialog.isOpen() && !ChatDialog.canContinue()) {
            return;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
        } else {
            await Execution.delayTicks(1);
        }
    }
}
