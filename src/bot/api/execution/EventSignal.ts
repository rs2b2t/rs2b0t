let provider: (() => boolean) | null = null;
/** Extra OR-clause for script-local interrupts (e.g. AIOQuester Skip or death). */
let interrupt: (() => boolean) | null = null;

/**
 * Cooperative interrupt. A long loop polls `pending()` and yields so the
 * random event gets handled before the loop walks off.
 * @see docs/decisions/clue-host-yielding.md
 */
export const EventSignal = {
    setProvider(p: () => boolean): void {
        provider = p;
    },

    /**
     * Optional second signal, OR'd with the main provider; pass `null` to clear.
     * Why: lets a UI action such as "Skip quest", or a death, abort a walk without stopping the script.
     */
    setInterrupt(p: (() => boolean) | null): void {
        interrupt = p;
    },

    pending(): boolean {
        return (provider !== null && provider()) || (interrupt !== null && interrupt());
    }
};
