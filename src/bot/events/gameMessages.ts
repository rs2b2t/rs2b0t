// Monotonic feed of type-0 server game messages ("I can't reach that!",
// "Nothing interesting happens", ...). BotHost records one entry per
// MESSAGE_GAME packet; consumers snapshot mark() before an interaction and
// poll sawSince(mark, pattern) to react to a message CAUSED by that
// interaction. A plain diff of the client's chat ring can't do this — it
// holds bare strings and the interesting lines repeat verbatim — hence the
// seq. Pure module (no client imports) so it runs under plain `bun test`.

export interface GameMessage {
    seq: number;
    text: string;
}

/** The server's reach-failure line for an unreachable interaction target. */
export const CANT_REACH = /^i can't reach that/i;

const CAP = 64;

class GameMessagesImpl {
    private ring: GameMessage[] = [];
    private lastSeq = 0;

    /** BotHost-only: append one just-arrived game message. */
    record(text: string): void {
        this.ring.push({ seq: ++this.lastSeq, text });
        if (this.ring.length > CAP) {
            this.ring.shift();
        }
    }

    /** Watermark: seq of the newest message so far (0 = none yet). */
    mark(): number {
        return this.lastSeq;
    }

    /** Messages recorded strictly after `mark`, oldest first. */
    since(mark: number): GameMessage[] {
        return this.ring.filter(m => m.seq > mark);
    }

    /** Any message after `mark` matching `pattern`? */
    sawSince(mark: number, pattern: RegExp): boolean {
        return this.ring.some(m => m.seq > mark && pattern.test(m.text));
    }

    /** Test-only: drop all state. */
    reset(): void {
        this.ring = [];
        this.lastSeq = 0;
    }
}

export const GameMessages = new GameMessagesImpl();
