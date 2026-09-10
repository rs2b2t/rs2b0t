import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../execution/Execution.js';
import { Bank } from './Bank.js';
import { planBankSort, type BankSortMode } from './bankSortPlan.js';
import type { BankCategory, SortableItem } from './bankSortRules.js';

// bank_main:com_99/com_100 (8130/8131) = Swap/Insert. They sit late in interface.pack, so they are not root + 99.
export const ARRANGE_SWAP_COM = 8130;
export const ARRANGE_INSERT_COM = 8131;
export const BANK_INSERT_VARP = 304;

const MOVES_PER_BATCH = 4;
// Why: a full 240-slot bank is 239 moves, which is 60 rounds before any re-plan.
const MAX_ROUNDS = 200;
const STALL_LIMIT = 3;

export interface BankSortResult {
    sorted: boolean;
    moves: number;
    mode: BankSortMode | null;
    unmatched: number[];
    reason: string;
}

export interface SortBankOptions {
    log?: (msg: string) => void;
    categoryOverrides?: ReadonlyMap<number, BankCategory>;
}

function snapshot(): SortableItem[] {
    const costs = new Map(reader.objCatalog().map(rec => [rec.id, rec.cost]));
    return reader.bankItems().map(item => ({
        slot: item.slot,
        id: item.id,
        name: item.name,
        cost: costs.get(item.id) ?? 0
    }));
}

function signature(items: readonly SortableItem[]): string {
    return items.map(item => `${item.slot}:${item.id}`).join(',');
}

// Why: the server reads %bankinsert, not the packet's mode byte, so an unconfirmed varp desyncs the bank silently.
async function setArrangeMode(want: BankSortMode): Promise<boolean> {
    const wanted = want === 'insert' ? 1 : 0;
    if (reader.varp(BANK_INSERT_VARP) === wanted) {
        return true;
    }

    actions.ifButton(wanted === 1 ? ARRANGE_INSERT_COM : ARRANGE_SWAP_COM);
    return Execution.delayUntil(() => reader.varp(BANK_INSERT_VARP) === wanted, 2000);
}

export async function sortBank(opts: SortBankOptions = {}): Promise<BankSortResult> {
    const log = opts.log;
    const idle: BankSortResult = { sorted: false, moves: 0, mode: null, unmatched: [], reason: '' };
    if (!Bank.isOpen()) {
        return { ...idle, reason: 'bank not open' };
    }
    if (!Bank.snapshotReady()) {
        return { ...idle, reason: 'snapshot not ready' };
    }

    const restoreTo = reader.varp(BANK_INSERT_VARP);
    let sent = 0;
    let mode: BankSortMode | null = null;
    let unmatched: number[] = [];
    let swapOnly = false;
    let stalled = 0;
    let reason = 'round limit';
    let sorted = false;

    for (let round = 0; round < MAX_ROUNDS; round++) {
        if (!Bank.isOpen()) {
            reason = 'bank closed';
            sorted = false;
            break;
        }

        const items = snapshot();
        const before = signature(items);
        const plan = planBankSort(items, {
            overrides: opts.categoryOverrides,
            force: swapOnly ? 'swap' : undefined
        });
        unmatched = plan.unmatched;
        if (plan.moves.length === 0) {
            reason = 'sorted';
            sorted = true;
            break;
        }

        if (!(await setArrangeMode(plan.mode))) {
            if (swapOnly) {
                reason = 'arrange mode stuck';
                break;
            }
            log?.('bank sort: arrange mode did not stick, falling back to swaps');
            swapOnly = true;
            continue;
        }

        mode = plan.mode;
        let applied = 0;
        for (const move of plan.moves.slice(0, MOVES_PER_BATCH)) {
            if (!actions.dragInvSlot(reader.bankComId(), move.from, move.to, plan.mode === 'insert' ? 1 : 0)) {
                break;
            }
            applied += 1;
            sent += 1;
        }

        await Execution.delayTicks(1);
        log?.(`bank sort: round ${round + 1}, ${plan.mode}, ${applied} sent, ${plan.moves.length} to go`);

        stalled = signature(snapshot()) === before ? stalled + 1 : 0;
        if (stalled >= STALL_LIMIT) {
            reason = 'no progress';
            sorted = false;
            break;
        }
    }

    await setArrangeMode(restoreTo === 1 ? 'insert' : 'swap');
    return { sorted, moves: sent, mode, unmatched, reason };
}
