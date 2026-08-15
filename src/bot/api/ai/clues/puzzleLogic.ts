// docs/reference/clues-mechanics.md#puzzle-boxes
export const PUZZLE_WIDTH = 5;
export const PUZZLE_SIZE = PUZZLE_WIDTH * PUZZLE_WIDTH;
export const PUZZLE_BLANK_SLOT = PUZZLE_SIZE - 1;

/** Slot -> the slot the piece sitting there belongs in, or null for the gap. */
export type PuzzleBoard = (number | null)[];

/**
 * Cells are placed in these batches, each batch frozen once solved.
 * Why: batching the awkward ones (a row's last two, the final 3x3) lets the search find the rotation that frees them instead of hard-coding escape sequences.
 */
const GROUPS: number[][] = [
    [0], [1], [2], [3, 4],
    [5], [10], [15, 20],
    [6], [7], [8, 9],
    [11], [16, 21],
    [12, 13, 14],
    [17, 18, 19, 22, 23]
];

const NEIGHBOURS: number[][] = (() => {
    const out: number[][] = [];
    for (let slot = 0; slot < PUZZLE_SIZE; slot++) {
        const col = slot % PUZZLE_WIDTH;
        const n: number[] = [];
        if (col > 0) {
            n.push(slot - 1);
        }
        if (col < PUZZLE_WIDTH - 1) {
            n.push(slot + 1);
        }
        if (slot >= PUZZLE_WIDTH) {
            n.push(slot - PUZZLE_WIDTH);
        }
        if (slot < PUZZLE_SIZE - PUZZLE_WIDTH) {
            n.push(slot + PUZZLE_WIDTH);
        }
        out.push(n);
    }
    return out;
})();

export function puzzleNeighbours(slot: number): number[] {
    return NEIGHBOURS[slot] ?? [];
}

export function isPuzzleSolved(board: PuzzleBoard): boolean {
    if (board.length !== PUZZLE_SIZE) {
        return false;
    }
    for (let slot = 0; slot < PUZZLE_SIZE; slot++) {
        if (board[slot] !== (slot === PUZZLE_BLANK_SLOT ? null : slot)) {
            return false;
        }
    }
    return true;
}

function isValidBoard(board: PuzzleBoard): boolean {
    if (board.length !== PUZZLE_SIZE) {
        return false;
    }
    const seen = new Set<number>();
    let gaps = 0;
    for (const value of board) {
        if (value === null) {
            gaps++;
            continue;
        }
        if (!Number.isInteger(value) || value < 0 || value >= PUZZLE_BLANK_SLOT || seen.has(value)) {
            return false;
        }
        seen.add(value);
    }
    return gaps === 1 && seen.size === PUZZLE_BLANK_SLOT;
}

/** Slide the piece at `slot` into the gap beside it. */
export function applyPuzzleMove(board: PuzzleBoard, slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= PUZZLE_SIZE || board[slot] === null) {
        return false;
    }
    const gap = NEIGHBOURS[slot].find(n => board[n] === null);
    if (gap === undefined) {
        return false;
    }
    board[gap] = board[slot];
    board[slot] = null;
    return true;
}

/**
 * Turn the interface's slot/id pairs into a board.
 * Why: every piece must be known and every slot but one filled, so a half-transmitted interface reads as null rather than as a board with extra gaps.
 */
export function readPuzzleBoard(
    slots: { slot: number; id: number }[],
    slotOfPiece: Record<number, number>,
    size = PUZZLE_SIZE
): PuzzleBoard | null {
    const board: PuzzleBoard = new Array(size).fill(null);
    let filled = 0;
    for (const { slot, id } of slots) {
        const target = slotOfPiece[id];
        if (target === undefined || slot < 0 || slot >= size || board[slot] !== null) {
            return null;
        }
        board[slot] = target;
        filled++;
    }
    return filled === size - 1 ? board : null;
}

function search(start: number[], startGap: number, group: number[], frozen: boolean[]): number[] | null {
    const encode = (pieces: number[], gap: number): number => {
        let key = gap;
        for (const p of pieces) {
            key = key * PUZZLE_SIZE + p;
        }
        return key;
    };
    const inGroup = new Set(group);
    const done = (pieces: number[], gap: number): boolean => !inGroup.has(gap) && pieces.every((p, i) => p === group[i]);

    if (done(start, startGap)) {
        return [];
    }

    const startKey = encode(start, startGap);
    const from = new Map<number, { key: number; move: number }>([[startKey, { key: -1, move: -1 }]]);
    let frontier = [{ pieces: start, gap: startGap, key: startKey }];

    while (frontier.length > 0) {
        const next: typeof frontier = [];
        for (const state of frontier) {
            for (const move of NEIGHBOURS[state.gap]) {
                if (frozen[move]) {
                    continue;
                }
                const pieces = state.pieces.slice();
                const moved = pieces.indexOf(move);
                if (moved !== -1) {
                    pieces[moved] = state.gap;
                }
                const key = encode(pieces, move);
                if (from.has(key)) {
                    continue;
                }
                from.set(key, { key: state.key, move });
                if (done(pieces, move)) {
                    const path: number[] = [];
                    for (let cur = key; cur !== startKey; ) {
                        const step = from.get(cur)!;
                        path.push(step.move);
                        cur = step.key;
                    }
                    return path.reverse();
                }
                next.push({ pieces, gap: move, key });
            }
        }
        frontier = next;
    }
    return null;
}

/**
 * The slots to click, in order, to solve the board. Each click slides the piece
 * in that slot into the gap beside it.
 */
export function solvePuzzle(board: PuzzleBoard): number[] | null {
    if (!isValidBoard(board)) {
        return null;
    }

    const work = board.slice();
    const frozen: boolean[] = new Array(PUZZLE_SIZE).fill(false);
    const moves: number[] = [];

    for (const group of GROUPS) {
        const pieces = group.map(target => work.indexOf(target));
        if (pieces.some(p => p < 0)) {
            return null;
        }
        const leg = search(pieces, work.indexOf(null), group, frozen);
        if (leg === null) {
            return null;
        }
        for (const move of leg) {
            applyPuzzleMove(work, move);
        }
        moves.push(...leg);
        for (const target of group) {
            frozen[target] = true;
        }
    }

    return isPuzzleSolved(work) ? moves : null;
}
