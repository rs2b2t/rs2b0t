// docs/reference/clues-mechanics.md#puzzle-boxes
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { PUZZLE_SIZE, applyPuzzleMove, isPuzzleSolved, readPuzzleBoard, solvePuzzle, type PuzzleBoard } from '#/bot/api/ai/clues/puzzleLogic.js';
import { PUZZLE_PIECE_SLOT } from '#/bot/api/ai/clues/data/puzzlePieces.js';

const MOVE_OP = 'Move';
// Why: every trail_slidingpuzzle* obj declares iop5=Move, and the server validates the op against the obj rather than against what the client renders, so a board whose labels did not reach us is still driveable.
const MOVE_OP_INDEX = 5;
const OPEN_OP = 'Open';
const OPEN_WAIT_MS = 5000;
const CLOSE_WAIT_MS = 3000;
// Why: the engine silently drops an OPHELD whose slot no longer holds that obj, so the board is re-read and re-planned after every move.
// Why: a batch of clicks is faster but wedges the moment one is dropped, while replanning costs a few milliseconds and cannot desynchronise.
const MOVE_SETTLE_MS = 2000;
const MAX_MOVES = 600;
const STALL_LIMIT = 8;

function boardNow(): PuzzleBoard | null {
    const size = reader.puzzleBoardSize();
    if (size !== PUZZLE_SIZE) {
        return null;
    }
    return readPuzzleBoard(reader.puzzleBoard().map(s => ({ slot: s.slot, id: s.id })), PUZZLE_PIECE_SLOT);
}

function clickPiece(slot: number): boolean {
    const comId = reader.puzzleBoardComId();
    const piece = reader.puzzleBoard().find(s => s.slot === slot);
    if (comId === -1 || !piece) {
        return false;
    }
    const labelled = piece.ops.findIndex(o => o?.toLowerCase() === MOVE_OP.toLowerCase());
    return Input.heldOp(piece.id, slot, comId, labelled === -1 ? MOVE_OP_INDEX : labelled + 1);
}

export const PuzzleBox = {
    open(): boolean {
        return boardNow() !== null;
    },

    /**
     * Open the held box and slide it into the solved arrangement.
     * Why: false is returned without a claim when the box could not be opened or the board never converged; the caller re-talks to the NPC either way.
     */
    async solveHeld(puzzleId: number, log: (m: string) => void): Promise<boolean> {
        const box = Inventory.items().find(i => i.id === puzzleId);
        if (!box) {
            log('no puzzle box held');
            return false;
        }

        if (!this.open()) {
            await box.interact(OPEN_OP);
            if (!(await Execution.delayUntil(() => this.open(), OPEN_WAIT_MS))) {
                log('puzzle box did not open');
                return false;
            }
        }

        const sample = reader.puzzleBoard()[0];
        if (sample && !sample.ops.some(o => o?.toLowerCase() === MOVE_OP.toLowerCase())) {
            log(`puzzle pieces expose ops [${sample.ops.filter(Boolean).join(', ')}] — sending op ${MOVE_OP_INDEX} directly`);
        }

        let moved = 0;
        let stalled = 0;
        try {
            while (moved < MAX_MOVES && stalled < STALL_LIMIT) {
                const board = boardNow();
                if (board === null) {
                    log('puzzle board went unreadable mid-solve');
                    return false;
                }
                if (isPuzzleSolved(board)) {
                    // Re-entered to hand a finished box back — not a fresh solve.
                    log(moved === 0 ? 'puzzle already solved' : `puzzle solved in ${moved} moves`);
                    return true;
                }

                const plan = solvePuzzle(board);
                if (plan === null || plan.length === 0) {
                    log('puzzle board is not solvable as read — retrying from a fresh read');
                    stalled++;
                    await Execution.delayTicks(1);
                    continue;
                }
                if (moved === 0) {
                    log(`puzzle: ${plan.length} moves to solve`);
                }

                const want = board.slice();
                applyPuzzleMove(want, plan[0]);
                if (!clickPiece(plan[0])) {
                    stalled++;
                    await Execution.delayTicks(1);
                    continue;
                }
                const landed = await Execution.delayUntil(() => {
                    const live = boardNow();
                    return live !== null && live.every((v, slot) => v === want[slot]);
                }, MOVE_SETTLE_MS);
                if (landed) {
                    moved++;
                    stalled = 0;
                } else {
                    stalled++;
                }
            }
        } finally {
            // Any path out must leave the modal shut, or the hand-back talk and
            // every walk after it is blocked by an open main interface.
            await this.close();
        }

        log(`puzzle stalled after ${moved} moves (${stalled} refused in a row)`);
        return false;
    },

    async close(): Promise<void> {
        if (!this.open()) {
            return;
        }
        actions.closeModal();
        await Execution.delayUntil(() => !this.open(), CLOSE_WAIT_MS);
    }
};
