export type KbdDose = { at: number; tick: number; tile: { x: number; z: number; level: number } | null };
export interface KbdDoseSource {
    __rs2b0t: { Game: { tile(): KbdDose['tile'] } };
    rs2b0t: { host: { tickCount: number }; runner: { bot: { drinkAntipoison(): Promise<boolean> } | null } };
    __jiveKbdDoseTrace?: { events: KbdDose[]; restore(): void };
}

export function installKbdDoseTrace(source: KbdDoseSource = globalThis as typeof globalThis & KbdDoseSource): void {
    const bot = source.rs2b0t.runner.bot;
    if (!bot || typeof bot.drinkAntipoison !== 'function') throw new Error('JiveKBD dose observer requires the active bot');
    source.__jiveKbdDoseTrace?.restore();
    const events: KbdDose[] = [];
    const drink = bot.drinkAntipoison;
    const descriptor = Object.getOwnPropertyDescriptor(bot, 'drinkAntipoison');
    bot.drinkAntipoison = async function () {
        const confirmed = await drink.call(this);
        if (confirmed) {
            const tile = source.__rs2b0t.Game.tile();
            events.push({ at: Date.now(), tick: source.rs2b0t.host.tickCount, tile: tile === null ? null : { x: tile.x, z: tile.z, level: tile.level } });
        }
        return confirmed;
    };
    source.__jiveKbdDoseTrace = { events, restore() {
        if (descriptor) Object.defineProperty(bot, 'drinkAntipoison', descriptor);
        else Reflect.deleteProperty(bot, 'drinkAntipoison');
    } };
}
