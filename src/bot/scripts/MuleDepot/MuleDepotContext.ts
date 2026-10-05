import type { Player } from '../../api/model/Player.js';
import type Tile from '../../geometry/Tile.js';
import {
    PACK,
    type CountedLine,
    type DeliveryBatch,
    type DeliveryLine,
    type LoadoutLine,
    type Role,
    type WithdrawalLine
} from './MuleDepotLogic.js';

export { PACK };

/** How often a partner re-clicks Trade-with while the other side is busy. */
export const TRADE_REQUEST_INTERVAL_MS = 3_000;

/**
 * Tiles one side of the depot is willing to be from the other before it asks. Why: two, not one,
 * since a partner on a booth the walker cannot stand on leaves a one-tile approach walking forever.
 */
export const TRADE_RANGE = 2;

/** How close counts as standing at the bank. */
export const BANK_RADIUS = 6;

/** How far off to look for a partner before giving up on it entirely. */
export const APPROACH_RANGE = 12;

/** Fruitless approaches before the request goes out from wherever the partner turned out to be. */
export const STALL_LIMIT = 3;

/** How far a role may drift from the bank before it walks back. */
export const LEASH_RADIUS = 12;

/** How long an incoming trade request stays worth answering. */
export const ASK_TTL_MS = 15_000;

/** The chat line a client sends when it asks to trade. */
export const TRADE_REQUEST_CHAT = 4;
export const TRADE_REQUEST_TEXT = /wishes to trade with you/i;

/**
 * How long a receiver waits on a partner who has opened a window but staked nothing.
 * Why: a dumper staking twenty-eight lines is slow, and cutting it off reads as a failed trade.
 */
export const RECEIVER_OFFER_WAIT_MS = 30_000;

/** How long a giver waits before conceding it has nothing to put up. */
export const EMPTY_GIVER_WAIT_MS = 3_000;

/** How long to wait for the window to shut after confirming. */
export const TRADE_CONFIRM_WAIT_MS = 5_000;

/** Grace window after a window closes, so gathering or walking cannot be mistaken for one. */
export const TRADE_GRACE_MS = 2_000;

/** How many consecutive empty withdrawal reads stop a giver. */
export const EMPTY_WITHDRAWAL_READS = 3;

/**
 * Everything a task module is allowed to know about its host. Why: task modules `import type` this
 * and never the entry module, so a missing member is a gap in the contract rather than a cycle.
 */
export interface MuleDepotContext {
    // ── identity ──
    role(): Role;
    bankTile(): Tile;
    bankName(): string;
    accounts(): string[];

    // ── pack ──
    /** Total units in the pack, which is what a trade transfer is measured in. */
    packUnits(): number;
    packUsed(): number;
    packFree(): number;
    /** Distinct item names in the pack, for a dumper staking everything it holds. */
    packNames(): string[];
    /** True when the pack holds an item the role did not plan, which is what its bank task clears. */
    packStrays(): boolean;
    atBank(): boolean;

    // ── policy ──
    dumpItems(): string[];
    deliveries(): DeliveryBatch[];
    /** The batch the supplier is on, or null when every client has the whole loadout. */
    currentBatch(): DeliveryBatch | null;
    currentClient(): string | null;
    /** The withdrawal plan for the dump list against the rows the bank reports. */
    planDumpWithdrawal(): WithdrawalLine[];
    /** Whether a line's quantity is already in the pack, so a handoff is not staked twice. */
    loadoutInPack(): DeliveryLine[];

    // ── trade ──
    isPartner(name: string | null): boolean;
    /** Whether this role should trade with `name` right now; a supplier serves one client at a time. */
    acceptsTradeWith(name: string): boolean;
    /** Whether the role has drifted far enough from the bank to walk back. */
    awayFromDepot(): boolean;
    nearestPartner(range?: number): Player | null;
    /** The partner by name at any distance, since a request click carries its own range rules. */
    nearestAccount(): Player | null;
    /** The account a receiver should offer a window to next, rotating so none is starved. */
    offerTarget(): Player | null;
    tradeRequestDue(): boolean;
    markTradeRequest(): void;

    // ── metrics ──
    recordTradeScreenOpen(): number;
    recordTradeScreenSuccess(): number;
    recordTradeScreenFailure(): number;
    /** A completed transfer, signed so a giver's loss reads positive. */
    recordTransfer(amount: number): number;
    /** One batch landed; moves the supplier on to the next batch or the next client. */
    markBatchServed(amount: number): void;

    // ── actions ──
    walkTo(tile: Tile, radius?: number): Promise<void>;
    currentTile(): Tile | null;
    setStatus(status: string): void;
    log(message: string): void;
}

export type { CountedLine, DeliveryBatch, DeliveryLine, LoadoutLine, Role, WithdrawalLine };
