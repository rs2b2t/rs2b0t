export function groundItemQuery<T extends { name: string; distance(): number }>(items: readonly T[]) {
    let matches = [...items];
    const chain = {
        name: (...names: string[]) => {
            matches = matches.filter(item => names.includes(item.name));
            return chain;
        },
        where: (predicate: (item: T) => boolean) => {
            matches = matches.filter(predicate);
            return chain;
        },
        within: (distance: number) => {
            matches = matches.filter(item => item.distance() <= distance);
            return chain;
        },
        nearest: (): T | null => matches.sort((a, b) => a.distance() - b.distance())[0] ?? null
    };
    return chain;
}
