export type Command =
    | { kind: 'quoteSell'; qty: number | 'all'; query: string; qtyImplied: boolean }
    | { kind: 'quoteBuy'; qty: number | 'all'; query: string; qtyImplied: boolean }
    | { kind: 'prices' }
    | { kind: 'buying' }
    | { kind: 'selling' }
    | { kind: 'help' }
    | { kind: 'reset' }
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

/** Words that mean the speaker wants to buy, and the speaker wants to sell. */
const BUYING = new Set(['buy', 'buying']);
const SELLING = new Set(['sell', 'selling']);
/** Ways of asking for the book. */
const LISTING = new Set(['list', 'book', 'rates', 'stock', 'prices']);
// Why: the engine filters every public message before broadcasting it (MessagePublicHandler), and it reads "pric" as an obfuscated slur, so "prices" reaches the shop as "****es" and never parses.
const CENSORED_PRICES = /^\*+es$/;

// Why: the keyword has to lead, so ordinary chat is not a command. A line with no count still parses, and the shop checks the name against its book before it answers.
export function parseCommand(text: string): Command {
    // Why: players reach for a slash out of habit, and refusing it looks like the shop is broken.
    const parts = text.trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
        return NONE;
    }
    const head = parts[0].toLowerCase();

    if (parts.length === 1) {
        if (LISTING.has(head) || CENSORED_PRICES.test(head)) {
            return { kind: 'prices' };
        }
        if (head === 'buying') {
            return { kind: 'buying' };
        }
        if (head === 'selling') {
            return { kind: 'selling' };
        }
        if (head === 'help' || head === 'commands' || head === 'shop') {
            return { kind: 'help' };
        }
        // Why: a shop that has tied itself up answers nothing else, so the way out has to be one bare word.
        if (head === 'reset' || head === 'unstick') {
            return { kind: 'reset' };
        }
        return NONE;
    }

    if (!BUYING.has(head) && !SELLING.has(head)) {
        return NONE;
    }
    // Why: 'buying rune scimitar' means one of them, so a missing count is a count of one rather than a parse failure.
    const stated = parseCount(parts[1]);
    const query = parts.slice(stated === null ? 1 : 2).join(' ');
    if (query.length === 0) {
        return NONE;
    }
    const qty = stated ?? 1;
    const qtyImplied = stated === null;
    return BUYING.has(head)
        ? { kind: 'quoteSell', qty, query, qtyImplied }
        : { kind: 'quoteBuy', qty, query, qtyImplied };
}

/** How to use the shop, in lines that fit the chat limit. */
// Why: the engine's filter eats "pric" and a line leading with buy or sell parses back as a command, so the shop values things rather than pricing them and no line starts on a keyword.
export const HELP_LINES: readonly string[] = [
    'To SELL to me: trade me and add items. I value each one as you put it up.',
    "To BUY from me: say 'buying 100 iron ore', then trade me and put up coins.",
    "Say 'list' for what I hold now. 'buying' and 'selling' show one side each.",
    "Repeated names need a word: 'blue dragonhide', 'loop half of key', 'yew u'.",
    "If I name several and ask which, answer with the '#number' I gave you.",
    "Say 'reset' if I get stuck, or 'help' for this again."
];

export function truncateChat(text: string): string {
    return text.length <= CHAT_LIMIT ? text : text.slice(0, CHAT_LIMIT);
}

export function formatGp(n: number): string {
    return n.toLocaleString('en-US');
}

/** One candidate the shop could not narrow to a single obj. */
export interface Candidate {
    id: number;
    /** What the shop calls it. */
    name: string;
    /** The plain display name, which its siblings share. */
    base: string;
    /** The one word separating it from them, where a word exists. */
    word: string | null;
}

/** Fits as many parts as the chat limit allows, and says how many it left out. */
// Why: the "+N more" it ends with costs characters of its own, so the count has to be inside the measurement.
function fitParts(parts: readonly string[], head: string, tail: string): string {
    const compose = (n: number): string =>
        `${head}${parts.slice(0, n).join(', ')}${n < parts.length ? ` +${parts.length - n} more` : ''}${tail}`;
    for (let n = parts.length; n > 0; n--) {
        const line = compose(n);
        if (line.length <= CHAT_LIMIT) {
            return line;
        }
    }
    return truncateChat(compose(1));
}

/** Asks which one, naming the words that separate them, and falling back to `#id` where no word does. */
// Why: four objs are called "Dragonhide", so listing the name four times says nothing; the colour is the answer.
export function formatAmbiguous(items: readonly Candidate[]): string {
    const oneName = items.every(i => i.base === items[0]!.base);
    if (oneName && items.every(i => i.word !== null)) {
        return fitParts(
            items.map(i => i.word!),
            `${items.length} matches: `,
            ` '${items[0]!.base}'. Which?`
        );
    }
    const seen = new Map<string, number>();
    for (const i of items) {
        seen.set(i.name, (seen.get(i.name) ?? 0) + 1);
    }
    const parts = items.map(i => ((seen.get(i.name) ?? 0) > 1 ? `'${i.name}' #${i.id}` : `'${i.name}'`));
    return fitParts(parts, `${items.length} matches: `, '. Which?');
}

// Why: WordPack's alphabet has no '/', and a character it cannot carry is silently sent as a space, so 18/22 arrives as "18 22".
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
        return `${e.name} ${formatGp(e.buy)}-${formatGp(e.sell)}`;
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
