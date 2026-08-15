import { describe, expect, test } from 'bun:test';

import {
    PUZZLE_BLANK_SLOT,
    PUZZLE_SIZE,
    PUZZLE_WIDTH,
    applyPuzzleMove,
    isPuzzleSolved,
    puzzleNeighbours,
    readPuzzleBoard,
    solvePuzzle,
    type PuzzleBoard
} from '#/bot/api/ai/clues/puzzleLogic.js';

function solved(): PuzzleBoard {
    const board: PuzzleBoard = [];
    for (let i = 0; i < PUZZLE_SIZE; i++) {
        board.push(i === PUZZLE_BLANK_SLOT ? null : i);
    }
    return board;
}

/** Mirrors shuffle_trail_puzzle: 101 legal moves from the solved state. */
function shuffle(rand: () => number, moves = 101): PuzzleBoard {
    const board = solved();
    for (let i = 0; i < moves; i++) {
        const blank = board.indexOf(null);
        const options = puzzleNeighbours(blank);
        applyPuzzleMove(board, options[Math.floor(rand() * options.length)]);
    }
    return board;
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('board helpers', () => {
    test('the solved board is piece i in slot i with the blank last', () => {
        expect(isPuzzleSolved(solved())).toBe(true);
    });

    test('any single move leaves the board unsolved', () => {
        const board = solved();
        expect(applyPuzzleMove(board, PUZZLE_BLANK_SLOT - 1)).toBe(true);
        expect(isPuzzleSolved(board)).toBe(false);
    });

    test('a move is refused when the blank is not adjacent', () => {
        expect(applyPuzzleMove(solved(), 0)).toBe(false);
    });

    test('neighbours never wrap across a row edge', () => {
        expect(puzzleNeighbours(0).sort((a, b) => a - b)).toEqual([1, PUZZLE_WIDTH]);
        expect(puzzleNeighbours(PUZZLE_WIDTH - 1)).not.toContain(PUZZLE_WIDTH);
    });
});

describe('readPuzzleBoard', () => {
    test('maps piece obj ids to their target slots and leaves the gap null', () => {
        const slotOf: Record<number, number> = { 700: 0, 701: 1, 702: 2 };
        const board = readPuzzleBoard([{ slot: 2, id: 700 }, { slot: 0, id: 702 }, { slot: 1, id: 701 }], slotOf, 4);
        expect(board).toEqual([2, 1, 0, null]);
    });

    test('rejects a board holding a piece it cannot identify', () => {
        expect(readPuzzleBoard([{ slot: 0, id: 999 }], { 700: 0 }, 2)).toBeNull();
    });

    test('rejects a partially transmitted board', () => {
        expect(readPuzzleBoard([{ slot: 0, id: 700 }], { 700: 0, 701: 1 }, 3)).toBeNull();
    });
});

describe('solvePuzzle', () => {
    test('an already solved board needs no moves', () => {
        expect(solvePuzzle(solved())).toEqual([]);
    });

    test('rejects a malformed board', () => {
        expect(solvePuzzle([1, 2, 3])).toBeNull();
        const duplicated = solved();
        duplicated[0] = 1;
        expect(solvePuzzle(duplicated)).toBeNull();
    });

    // The engine shuffles by 101 legal moves from solved, so every board the
    // bot can be handed is solvable — the solver must never give up on one.
    test('solves 10,000 engine-style shuffles', () => {
        const rand = mulberry32(20260802);
        let worst = 0;
        for (let i = 0; i < 10_000; i++) {
            const board = shuffle(rand);
            const moves = solvePuzzle(board);
            expect(moves).not.toBeNull();

            const replay = board.slice();
            for (const slot of moves!) {
                expect(applyPuzzleMove(replay, slot)).toBe(true);
            }
            expect(isPuzzleSolved(replay)).toBe(true);
            worst = Math.max(worst, moves!.length);
        }
        expect(worst).toBeLessThan(400);
        // 10k solves plus a full replay of each is ~10s of honest work, over the
        // 5s default. Raised rather than trimmed: the point is the breadth.
    }, 30_000);

    test('solves deeply scrambled boards, not just 101-move ones', () => {
        const rand = mulberry32(7);
        for (let i = 0; i < 500; i++) {
            const board = shuffle(rand, 5000);
            const moves = solvePuzzle(board);
            expect(moves).not.toBeNull();
            const replay = board.slice();
            for (const slot of moves!) {
                applyPuzzleMove(replay, slot);
            }
            expect(isPuzzleSolved(replay)).toBe(true);
        }
    });
});
