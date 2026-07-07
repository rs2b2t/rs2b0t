/**
 * Leaf module breaking the RandomEvents ⇄ Traversal/WalkExecutor import
 * cycle: the walker (and long script loops) poll `pending()` to yield at a
 * safe point; RandomEvents registers itself as the provider at module init
 * (Task 6). No provider ⇒ never pending.
 */
let provider: (() => boolean) | null = null;

export const EventSignal = {
    setProvider(p: () => boolean): void {
        provider = p;
    },

    pending(): boolean {
        return provider !== null && provider();
    }
};
