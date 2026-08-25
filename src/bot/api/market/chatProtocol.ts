export type Command =
    | { kind: 'quoteSell'; qty: number | 'all'; query: string }
    | { kind: 'quoteBuy'; qty: number | 'all'; query: string }
    | { kind: 'prices' }
    | { kind: 'buying' }
    | { kind: 'selling' }
    | { kind: 'none' };

/** 2004 chat input cap. */
export const CHAT_LIMIT = 80;

const NONE: Command = { kind: 'none' };

export function parseCount(token: string): number | 'all' | null {
    const t = token.trim().toLowerCase();
    if (t === 'all') {
        return 'all';
    }
    const m = /^(\d+)([km])?$/.exec(t);
    if (!m) {
        return null;
    }
    const scale = m[2] === 'k' ? 1000 : m[2] === 'm' ? 1_000_000 : 1;
    const n = Number(m[1]) * scale;
    return n > 0 ? n : null;
}

// Why: a line only counts as a command when every part parses, so ordinary chat like "buy me a beer" is ignored in silence rather than answered.
export function parseCommand(text: string): Command {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return NONE;
    }
    const head = parts[0].toLowerCase();

    if (parts.length === 1) {
        if (head === 'prices') {
            return { kind: 'prices' };
        }
        if (head === 'buying') {
            return { kind: 'buying' };
        }
        if (head === 'selling') {
            return { kind: 'selling' };
        }
        return NONE;
    }

    if (head !== 'buy' && head !== 'sell') {
        return NONE;
    }
    const qty = parseCount(parts[1]);
    if (qty === null) {
        return NONE;
    }
    const query = parts.slice(2).join(' ');
    if (query.length === 0) {
        return NONE;
    }
    return head === 'buy' ? { kind: 'quoteSell', qty, query } : { kind: 'quoteBuy', qty, query };
}

export function truncateChat(text: string): string {
    return text.length <= CHAT_LIMIT ? text : text.slice(0, CHAT_LIMIT);
}

export function formatGp(n: number): string {
    return n.toLocaleString('en-US');
}

export function formatSellQuote(name: string, qty: number, each: number): string {
    return truncateChat(`${formatGp(qty)} x ${name} = ${formatGp(qty * each)}gp (${formatGp(each)}ea). Trade me.`);
}

export function formatBuyQuote(name: string, qty: number, each: number): string {
    return truncateChat(
        `I'll pay ${formatGp(qty * each)}gp for ${formatGp(qty)} ${name} (${formatGp(each)}ea). Trade me.`
    );
}

/** Lists the matches, tagging with `#id` only when two of them read the same. */
export function formatAmbiguous(items: readonly { name: string; id: number }[]): string {
    const seen = new Map<string, number>();
    for (const i of items) {
        seen.set(i.name, (seen.get(i.name) ?? 0) + 1);
    }
    const shown = items
        .slice(0, 3)
        .map(i => ((seen.get(i.name) ?? 0) > 1 ? `'${i.name}' #${i.id}` : `'${i.name}'`))
        .join(', ');
    return truncateChat(`${items.length} matches: ${shown}. Which?`);
}

export function formatPriceList(
    entries: readonly { name: string; buy: number; sell: number }[],
    side: 'both' | 'buy' | 'sell'
): string[] {
    const parts = entries.map(e => {
        if (side === 'buy') {
            return `${e.name} ${formatGp(e.buy)}`;
        }
        if (side === 'sell') {
            return `${e.name} ${formatGp(e.sell)}`;
        }
        return `${e.name} ${formatGp(e.buy)}/${formatGp(e.sell)}`;
    });

    const lines: string[] = [];
    let current = '';
    for (const part of parts) {
        const next = current === '' ? part : `${current}, ${part}`;
        if (next.length > CHAT_LIMIT) {
            if (current !== '') {
                lines.push(current);
            }
            current = truncateChat(part);
        } else {
            current = next;
        }
    }
    if (current !== '') {
        lines.push(current);
    }
    return lines;
}
