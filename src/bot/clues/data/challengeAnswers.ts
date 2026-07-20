/**
 * Medium "challenge"-scroll answers, keyed by the HELD anagram clue's obj id.
 *
 * Six of the 20 medium anagram clues gate on a maths question: talking to the
 * NPC runs `~trail_challengenpc_prompt(...)` (trail_clue_medium.rs2:189), which
 *   ~chatnpc($prompt_chat);   // shows the question (a chat page)
 *   if_close;                 // the question chat CLOSES
 *   p_countdialog;            // an integer-input "Enter amount" dialog opens
 *   if(last_int = oc_param($challenge, trail_challenge_answer)) { ...advance... }
 *
 * The question text is GONE by the time that count dialog is open (the if_close
 * precedes p_countdialog), so matching on the prompt string is fragile. Instead
 * we key on something stable the executor already holds while the count dialog
 * is open: the anagram clue's obj id — the talk step's `step.id`, the held-item
 * discriminator. Each challenge clue has exactly ONE fixed answer:
 * `oc_param(<clue>_challenge, trail_challenge_answer)`.
 *
 * Answers were read from the content pack (trail_medium.obj's `_challenge` obj
 * blocks) and each is paired with its held anagram clue by name (strip the
 * `_challenge` suffix); the ids mirror pack/obj.pack and CLUE_DB's talk rows,
 * cross-checked against the NPC each row talks to. A miss (unknown id) returns
 * null so the executor leaves the dialog alone rather than entering a wrong
 * number — a safe failure even if obj ids are ever renumbered.
 */
export interface ChallengeAnswer {
    /** The held anagram clue's obj name (documentation; the `_challenge` scroll
     *  that carries `trail_challenge_answer` is this name + '_challenge'). */
    clue: string;
    /** Its obj id — the deterministic key, equal to the talk step's `step.id`. */
    id: number;
    /** The fixed answer = oc_param(<clue>_challenge, trail_challenge_answer). */
    answer: number;
    /** The NPC + question, for humans. */
    note: string;
}

export const CHALLENGE_ANSWERS: ChallengeAnswer[] = [
    { clue: 'trail_clue_medium_anagram001', id: 2841, answer: 6859, note: 'Hazelmere — what is 19 to the power of 3?' },
    { clue: 'trail_clue_medium_anagram002', id: 2843, answer: 9, note: 'Cook — how many cannons does Lumbridge Castle have?' },
    { clue: 'trail_clue_medium_anagram003', id: 2845, answer: 40, note: 'Zoo keeper — how many animals in total are there in the zoo?' },
    { clue: 'trail_clue_medium_anagram006', id: 2849, answer: 5, note: 'Kebab seller — 16 kebabs, eat one, share the rest between 3 friends' },
    { clue: 'trail_clue_medium_anagram007', id: 2851, answer: 48, note: 'Oracle — if x is 15 and y is 3, what is 3x + y?' },
    { clue: 'trail_clue_medium_anagram008', id: 2853, answer: 5096, note: 'Gnome ball referee — what is 57 x 89 + 23?' }
];

const BY_ID = new Map<number, number>(CHALLENGE_ANSWERS.map(c => [c.id, c.answer]));

/**
 * The fixed answer for the held challenge anagram clue `clueId`, or null when
 * `clueId` isn't one of the six challenge clues — the caller must then leave any
 * open count dialog untouched rather than risk a wrong number.
 */
export function challengeAnswer(clueId: number): number | null {
    return BY_ID.get(clueId) ?? null;
}
