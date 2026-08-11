let provider: (() => boolean) | null = null;
/** Extra OR-clause for script-local interrupts (e.g. AIOQuester Skip or death). */
let interrupt: (() => boolean) | null = null;

/**
 * Cooperative interrupt. A long-running loop polls `pending()` and yields so a
 * random event is handled instead of walked away from.
 * @see docs/CLUES.md#yielding-to-the-host-loop
 */
export const EventSignal = {
    setProvider(p: () => boolean): void {
        provider = p;
    },

    /**
     * Optional second signal (OR'd with the main provider). Used so a UI action
     * like "Skip quest" or death can abort a walk without stopping the whole script.
     * Pass `null` to clear.
     */
    setInterrupt(p: (() => boolean) | null): void {
        interrupt = p;
    },

    pending(): boolean {
        return (provider !== null && provider()) || (interrupt !== null && interrupt());
    }
};
