let provider: (() => boolean) | null = null;

export const EventSignal = {
    setProvider(p: () => boolean): void {
        provider = p;
    },

    pending(): boolean {
        return provider !== null && provider();
    }
};
