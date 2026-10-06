import { BANK_LOCATIONS, type BankLocation } from '../../api/bank/BankLocations.js';
import type Tile from '../../geometry/Tile.js';

// Why: the depot is one bank and one item list, so every role difference is a mode, a designation,
// or a parsed CSV. Keeping them here keeps the policy layer unit testable without the client.

/** Slots in a backpack, and slots on one side of a trade window. */
export const PACK = 28;

export const DEFAULT_BANK = 'Seers';

export const MODE_OPTIONS = ['Dump', 'Supply'] as const;
export type Mode = typeof MODE_OPTIONS[number];

/** UI labels for the designation dropdown. A designation is a role once the mode agrees with it. */
export const ROLE_OPTIONS = ['Mule', 'Supermule', 'Supplier', 'Client'] as const;
export type Role = typeof ROLE_OPTIONS[number];

export const BANK_OPTIONS: string[] = BANK_LOCATIONS.map(bank => bank.name);

/** One accepted (mode, designation) pair. */
const ROLE_BY_PAIR: Record<string, Role> = {
    'dump:mule': 'Mule',
    'dump:supermule': 'Supermule',
    'supply:supplier': 'Supplier',
    'supply:client': 'Client'
};

/** The role a (mode, designation) pair means, or null when the pairing makes no sense. */
export function resolveRole(mode: string, designation: string): Role | null {
    // Why: null rather than a guess, so a caller refuses a nonsense pair at startup instead of
    // running a role that has nothing to do.
    return ROLE_BY_PAIR[`${mode.trim().toLowerCase()}:${designation.trim().toLowerCase()}`] ?? null;
}

/** Giver roles stake items; receiver roles take them. */
export function isGiverRole(role: Role): boolean {
    return role === 'Mule' || role === 'Supplier';
}

export function isReceiverRole(role: Role): boolean {
    return !isGiverRole(role);
}

/** The bank a setting names, or the default when the name is blank or unknown. */
export function bankChoice(name: string): BankLocation {
    const want = name.trim().toLowerCase();
    return BANK_LOCATIONS.find(bank => bank.name.toLowerCase() === want)
        ?? BANK_LOCATIONS.find(bank => bank.name === DEFAULT_BANK)
        ?? BANK_LOCATIONS[0]!;
}

export function bankTile(name: string): Tile {
    return bankChoice(name).tile;
}

/** The name the client shows, which is what `Players.query().name()` matches on. */
export function normalizeAccount(name: string): string {
    return name.toLowerCase().replace(/[\u00A0_]/g, ' ').trim();
}

/** Configured partner names, split on commas, normalized and deduped. */
export function parseAccounts(raw: string): string[] {
    const out: string[] = [];
    for (const part of raw.split(',')) {
        const name = normalizeAccount(part);
        if (name.length > 0 && !out.includes(name)) {
            out.push(name);
        }
    }
    return out;
}

/** True when `name` is one of the configured accounts. */
export function isConfiguredAccount(name: string | null | undefined, accounts: readonly string[]): boolean {
    if (name == null || accounts.length === 0) {
        return false;
    }
    return accounts.includes(normalizeAccount(name));
}

/**
 * Item names from the dump list: trimmed, blanks dropped, deduped case-insensitively.
 *
 * First-seen casing wins, so the log lines read as the operator wrote them.
 */
export function parseItemNames(raw: readonly string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        const name = entry.trim();
        const key = name.toLowerCase();
        if (name.length === 0 || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(name);
    }
    return out;
}

export interface LoadoutLine {
    /** Resolved obj id, or -1 when the CSV named the item instead. */
    id: number;
    /** Display name as written, or '' when the line was id-only. */
    name: string;
    quantity: number;
    /** The line as written, for logs and for naming a problem. */
    raw: string;
}

export interface LoadoutProblem {
    /** 1-based position in the pasted list. */
    line: number;
    raw: string;
    reason: string;
}

export interface ParsedLoadout {
    lines: LoadoutLine[];
    problems: LoadoutProblem[];
}

/** A leading integer is the quantity; the rest is the item, an id when it is all digits. */
const QUANTITY_PREFIX = /^(\d+)\s+(.+)$/;

/**
 * Parse the supply list, where a leading integer is the quantity and the rest is a name or an id.
 * Duplicate entries merge, and an unreadable line becomes a `problem` rather than being dropped.
 */
export function parseLoadout(raw: readonly string[]): ParsedLoadout {
    const lines: LoadoutLine[] = [];
    const byKey = new Map<string, LoadoutLine>();
    const problems: LoadoutProblem[] = [];

    raw.forEach((entry, index) => {
        const text = entry.trim();
        if (text.length === 0 || text.startsWith('#')) {
            return;
        }
        const match = QUANTITY_PREFIX.exec(text);
        const quantity = match ? Number(match[1]) : 1;
        const item = (match ? match[2]! : text).trim();

        if (!Number.isSafeInteger(quantity) || quantity < 1) {
            // Why: reported rather than dropped, since a typo that quietly withdraws nothing runs
            // all night without stopping.
            problems.push({ line: index + 1, raw: text, reason: 'quantity must be 1 or more' });
            return;
        }

        const id = /^\d+$/.test(item) ? Number(item) : -1;
        const line: LoadoutLine = { id, name: id === -1 ? item : '', quantity, raw: text };
        const key = id === -1 ? `n:${item.toLowerCase()}` : `i:${id}`;
        const existing = byKey.get(key);
        if (existing) {
            // Why: a repeated item costs one trade slot, not two, so the merge is worth the dedupe.
            existing.quantity += quantity;
            return;
        }
        byKey.set(key, line);
        lines.push(line);
    });

    return { lines, problems };
}

/** A line's share of a trade slot; the caller resolves it, since stackability needs the catalog. */
export type SlotsFor = (line: LoadoutLine) => number;

export interface DeliveryLine {
    id: number;
    name: string;
    quantity: number;
}

export interface DeliveryBatch {
    /** 0-based, and the order the supplier works through. */
    index: number;
    lines: DeliveryLine[];
}

/** The batches that carry a whole loadout, splitting an oversized line instead of truncating it. */
export function planDeliveries(lines: readonly LoadoutLine[], slotsFor: SlotsFor, slots: number = PACK): DeliveryBatch[] {
    const width = Math.max(1, Math.floor(slots));
    const batches: DeliveryBatch[] = [];
    let current: DeliveryLine[] = [];
    let used = 0;

    const flush = (): void => {
        if (current.length > 0) {
            batches.push({ index: batches.length, lines: current });
            current = [];
            used = 0;
        }
    };

    for (const line of lines) {
        let remaining = Math.max(0, Math.floor(line.quantity));
        while (remaining > 0) {
            if (used >= width) {
                flush();
            }
            // Why: carry the remainder into a new batch rather than cutting the line, because a
            // client left short of gear while the supplier reports success is the failure avoided.
            const per = Math.max(1, Math.floor(slotsFor({ ...line, quantity: remaining })));
            if (per <= 1) {
                current.push({ id: line.id, name: line.name, quantity: remaining });
                used += 1;
                remaining = 0;
                continue;
            }
            const take = Math.min(remaining, width - used);
            current.push({ id: line.id, name: line.name, quantity: take });
            used += take;
            remaining -= take;
        }
    }
    flush();

    return batches;
}

/** A line of goods: one item and how many of it. Both planners speak this. */
export interface CountedLine {
    id: number;
    name: string;
    quantity: number;
}

export interface BankRow {
    id: number;
    name: string | null;
    count: number;
}

export type WithdrawalLine = CountedLine;

/**
 * Every bank row a name means, unnoted first. Why: one name can sit on several rows, and taking
 * the first alone leaves the rest for a later trip, so the mule looks stalled between passes.
 */
export function pickBankRows(name: string, bank: readonly BankRow[], notedIds?: ReadonlySet<number>): BankRow[] {
    const want = name.trim().toLowerCase();
    const rows = bank.filter(row => (row.name ?? '').trim().toLowerCase() === want && row.count > 0);
    if (rows.length <= 1 || !notedIds || notedIds.size === 0) {
        return rows;
    }
    // Why: unnoted first, because it is the form a trade takes cleanly, but the noted rows are kept
    // so a bank that holds only the noted form still has something to give.
    const unnoted = rows.filter(row => !notedIds.has(row.id));
    const noted = rows.filter(row => notedIds.has(row.id));
    return unnoted.length > 0 ? [...unnoted, ...noted] : noted;
}

/** The first row a name means, for callers that want one row. */
export function pickBankRow(name: string, bank: readonly BankRow[], notedIds?: ReadonlySet<number>): BankRow | null {
    return pickBankRows(name, bank, notedIds)[0] ?? null;
}

/**
 * The bank rows the dump list names, in list order. Why: this is a dumper's keep set, and the
 * withdrawal plan cannot be, since it is empty on a full pack and would bank the carried haul.
 */
export function listedRows(
    csvNames: readonly string[],
    bank: readonly BankRow[],
    notedIds?: ReadonlySet<number>
): WithdrawalLine[] {
    const out: WithdrawalLine[] = [];
    const seen = new Set<number>();
    for (const name of csvNames) {
        for (const row of pickBankRows(name, bank, notedIds)) {
            if (!row.name || row.count < 1 || seen.has(row.id)) {
                continue;
            }
            seen.add(row.id);
            out.push({ id: row.id, name: row.name, quantity: row.count });
        }
    }
    return out;
}

/**
 * The lines one withdrawal pass takes, in CSV order. Why: a line costs one slot whatever its depth,
 * so free room admits entries rather than capping them, or the first entry eats the whole pack.
 */
export function planWithdrawal(
    csvNames: readonly string[],
    bank: readonly BankRow[],
    freeSlots: number,
    notedIds?: ReadonlySet<number>
): WithdrawalLine[] {
    const out: WithdrawalLine[] = [];
    let room = Math.max(0, Math.floor(freeSlots));
    for (const name of csvNames) {
        // Why: every row the name sits on, so one pass drains the name rather than one row of it.
        for (const row of pickBankRows(name, bank, notedIds)) {
            if (room <= 0) {
                return out;
            }
            if (!row.name || row.count < 1) {
                continue;
            }
            out.push({ id: row.id, name: row.name, quantity: row.count });
            room -= 1;
        }
    }
    return out;
}

/**
 * Where the batch cursor moves once a batch lands. Why: a client is only done when its last batch
 * is away, or advancing per batch serves everyone a partial loadout.
 */
export function nextBatchIndex(index: number, batchCount: number): { index: number; clientDone: boolean } {
    const next = index + 1;
    return next < batchCount ? { index: next, clientDone: false } : { index: 0, clientDone: true };
}

/**
 * Which account a receiver should ask next. Why: an account that asked goes first, and the cursor
 * advances on every attempt, or a stopped account keeps the rotation for ever.
 */
export function pickRequestTarget(input: {
    asker: string | null;
    accounts: readonly string[];
    cursor: number;
    acceptable: (name: string) => boolean;
    visible: (name: string) => boolean;
}): string | null {
    const eligible = input.accounts.filter(name => input.acceptable(name));
    if (eligible.length === 0) {
        return null;
    }
    if (input.asker !== null && eligible.includes(input.asker) && input.visible(input.asker)) {
        return input.asker;
    }
    for (let i = 0; i < eligible.length; i++) {
        const name = eligible[(input.cursor + i) % eligible.length]!;
        if (input.visible(name)) {
            return name;
        }
    }
    return null;
}

/** The next client still owed a loadout, in configured order, or null when everyone is served. */
export function nextUnserved(accounts: readonly string[], served: ReadonlySet<string>): string | null {
    return accounts.find(account => !served.has(normalizeAccount(account))) ?? null;
}

/** `500 Cooked meat`, for a log line. */
function describeLine(line: CountedLine): string {
    return `${line.quantity} ${line.name.length > 0 ? line.name : `#${line.id}`}`;
}

export function describeLines(lines: readonly CountedLine[]): string {
    return lines.length === 0 ? 'nothing' : lines.map(describeLine).join(' + ');
}
