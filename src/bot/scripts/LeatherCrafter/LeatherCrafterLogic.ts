export const HARD_LEATHER_BURST = 60;

// Why: hard-leather bodies are crafted synchronously by the server.
// Why: queue every needle-on-leather slot without awaiting each send (GemCutter's packet-burst pattern); the settle in craftLeg waits for the leather to move instead.

/** Queues needle-on-leather actions across the slots, without awaiting each send. */
export async function issueHardLeatherBurst<T>(targets: readonly T[], useNeedleOn: (target: T) => boolean | Promise<boolean>, limit = HARD_LEATHER_BURST): Promise<number> {
    let sent = 0;
    for (const target of targets.slice(0, Math.max(0, limit))) {
        const queued = useNeedleOn(target);
        if (queued === false) {
            break;
        }
        sent++;
    }
    return sent;
}
