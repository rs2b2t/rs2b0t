import type { Task } from '../bot/Bot.js';
import { Equipment } from '../equipment/Equipment.js';
import { Autocast } from '../magic/Autocast.js';

interface AutocastOptions {
    enabled?: () => boolean;
    castsLeft: () => number;
    spell: () => string;
    staff?: () => string;
    warning?: (spell: string) => string;
    label?: string;
}

export class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    readonly label?: string;

    constructor(private readonly bot: { setStatus(s: string): void; log(m: string): void }, private readonly options: AutocastOptions) {
        this.label = options.label;
    }

    validate(): boolean {
        if (this.options.enabled?.() === false || Autocast.armed() || Date.now() < this.retryAt || this.options.castsLeft() < 1) {
            return false;
        }
        if (Autocast.staffTabAttached()) return true;
        const staff = this.options.staff?.();
        return !!staff && Equipment.contains(staff);
    }

    async execute(): Promise<void> {
        const spell = this.options.spell();
        this.bot.setStatus(`arming autocast: ${spell}`);
        if (await Autocast.arm(spell, m => this.bot.log(m))) {
            this.fails = 0;
        } else if (++this.fails >= 5) {
            this.fails = 0;
            this.retryAt = Date.now() + 60_000;
            this.bot.log(this.options.warning?.(spell) ?? `WARNING: could not arm autocast for '${this.options.spell()}'. Retrying in 60s.`);
        }
    }
}
