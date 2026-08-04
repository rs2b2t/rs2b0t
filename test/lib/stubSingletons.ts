/**
 * Temporarily replace properties on a live singleton.
 *
 * Prefer this over `mock.module`: Bun's module mocks are **global and permanent**
 * for the process (docs/TESTING.md#unit-tests). Spreading the real module only
 * fixes missing named exports — the stub still poisons every later file that
 * needs the real behaviour.
 *
 * Usage:
 *   const restore = stubProps(Game, { tile: () => playerTile, inCombat: () => false });
 *   afterAll(restore);
 */
export function stubProps<T extends object>(target: T, props: Partial<T>): () => void {
    const keys = Object.keys(props) as (keyof T)[];
    const saved = new Map<keyof T, T[keyof T]>();
    for (const k of keys) {
        saved.set(k, target[k]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic prop rewrite
        (target as any)[k] = props[k];
    }
    return () => {
        for (const k of keys) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (target as any)[k] = saved.get(k);
        }
    };
}
