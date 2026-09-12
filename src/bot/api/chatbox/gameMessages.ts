interface GameMessage {
    seq: number;
    text: string;
}

export const CANT_REACH = /^i can't reach that/i;
/** The op reached the loc and the server refused the side it came from; retry from a different tile. */
// Why: both spellings. `[oploc1,loc_2274]` (the swamp rope swing) says "You cannot do that from here." and the orb trap says "You can't do that from here.", so keying on the contraction alone misses the swing.
export const WRONG_SIDE = /can(?:'t|not) do that from here/i;

const CAP = 64;

function matches(pattern: RegExp, text: string): boolean {
    pattern.lastIndex = 0;
    return pattern.test(text);
}

class GameMessagesImpl {
    private ring: GameMessage[] = [];
    private lastSeq = 0;

    record(text: string): void {
        this.ring.push({ seq: ++this.lastSeq, text });
        if (this.ring.length > CAP) {
            this.ring.shift();
        }
    }

    mark(): number {
        return this.lastSeq;
    }

    since(mark: number): GameMessage[] {
        return this.ring.filter(m => m.seq > mark);
    }

    sawSince(mark: number, pattern: RegExp): boolean {
        return this.ring.some(m => m.seq > mark && matches(pattern, m.text));
    }

    firstSince(mark: number, pattern: RegExp): GameMessage | undefined {
        return this.ring.find(m => m.seq > mark && matches(pattern, m.text));
    }

    /** Newest-first slice of the ring (for death / failure dumps). */
    recent(limit = 8): GameMessage[] {
        if (limit <= 0 || this.ring.length === 0) {
            return [];
        }
        return this.ring.slice(-limit).reverse();
    }

    reset(): void {
        this.ring = [];
        this.lastSeq = 0;
    }
}

export const GameMessages = new GameMessagesImpl();
