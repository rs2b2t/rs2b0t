export interface TravelSupply { item: string; count: number }

export async function restockTravelSupplies(needs: readonly TravelSupply[], port: {
    count(item: string): number;
    withdraw(item: string, target: number): Promise<void>;
}): Promise<string | null> {
    for (const need of needs) {
        if (port.count(need.item) >= need.count) continue;
        await port.withdraw(need.item, need.count);
        if (port.count(need.item) < need.count) return need.item;
    }
    return null;
}
