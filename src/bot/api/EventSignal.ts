let provider: (() => boolean) | null = null;

/**
 * Cooperative interrupt. A long-running loop polls `pending()` and yields so a
 * random event is handled instead of walked away from.
 * @see docs/CLUES.md#yielding-to-the-host-loop
 */
export const EventSignal = {
    setProvider(p: () => boolean): void {
        provider = p;
    },

    pending(): boolean {
        return provider !== null && provider();
    }
};
