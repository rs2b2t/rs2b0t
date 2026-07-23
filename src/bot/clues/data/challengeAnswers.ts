export interface ChallengeAnswer {
    clue: string;
    id: number;
    answer: number;
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

export function challengeAnswer(clueId: number): number | null {
    return BY_ID.get(clueId) ?? null;
}
