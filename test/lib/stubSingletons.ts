/** Temporarily replace properties on a live singleton; the returned function restores them. */
// Why: Bun's `mock.module` is process-global and permanent, and spreading the live module fixes only missing named exports while the stub poisons every later file.
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
