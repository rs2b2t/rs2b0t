export function restockQuantity(
    name: string,
    target: number,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): number {
    const need = target - invCount(name);
    if (need <= 0) {
        return 0;
    }
    const available = bankCount(name);
    return available <= 0 ? 0 : Math.min(need, available);
}
