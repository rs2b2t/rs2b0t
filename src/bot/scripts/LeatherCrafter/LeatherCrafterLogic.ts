export const HARD_LEATHER_BURST = 10;

// Why: hard-leather bodies are crafted synchronously by the server.
// Why: one needle-on-leather action goes out per distinct inventory slot before yielding to the next game tick, matching the ten-at-a-time interface recipes.

/** Sends a burst of needle-on-leather actions, one per distinct slot. */
export async function issueHardLeatherBurst<T>(targets: readonly T[], useNeedleOn: (target: T) => boolean | Promise<boolean>, limit = HARD_LEATHER_BURST): Promise<number> {
    let sent = 0;
    for (const target of targets.slice(0, Math.max(0, limit))) {
        if (!(await useNeedleOn(target))) {
            break;
        }
        sent++;
    }
    return sent;
}
