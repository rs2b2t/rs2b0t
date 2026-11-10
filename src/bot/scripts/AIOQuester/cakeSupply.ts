export interface CakeSupplyPort {
    count(): number;
    full(): boolean;
    combat(): boolean;
    hungry(): boolean;
    stopped(): boolean;
    eat(): Promise<void>;
    flee(): Promise<void>;
    bank(): Promise<void>;
    steal(abort: () => boolean): Promise<void>;
}

export async function gatherCakes(port: CakeSupplyPort, target: number): Promise<void> {
    if (port.stopped()) return;
    if (port.combat()) { await port.flee(); return; }
    if (port.count() >= target) return;
    if (port.hungry()) { await port.eat(); return; }
    if (port.full()) { await port.bank(); return; }
    await port.steal(() => port.stopped() || port.count() >= target || port.hungry());
}
