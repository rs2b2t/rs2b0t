import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { Skills } from '#/bot/api/hud/Skills.js';

const TOGGLE_MS = 2000;

interface PrayerDef {
    com: number;
    varp: number;
    level: number;
}

/**
 * The prayer overlay's toggle buttons and the varps that mirror them. Buttons
 * are tab-bound, and the engine treats any tab root as visible, so a prayer can
 * be toggled without switching to the prayer tab.
 * @see docs/API.md#prayer
 */
const PRAYERS: Record<string, PrayerDef> = {
    'thick skin': { com: 5609, varp: 83, level: 1 },
    'burst of strength': { com: 5610, varp: 84, level: 4 },
    'clarity of thought': { com: 5611, varp: 85, level: 7 },
    'rock skin': { com: 5612, varp: 86, level: 10 },
    'superhuman strength': { com: 5613, varp: 87, level: 13 },
    'improved reflexes': { com: 5614, varp: 88, level: 16 },
    'rapid restore': { com: 5615, varp: 89, level: 19 },
    'rapid heal': { com: 5616, varp: 90, level: 22 },
    'protect item': { com: 5617, varp: 91, level: 25 },
    'steel skin': { com: 5618, varp: 92, level: 28 },
    'ultimate strength': { com: 5619, varp: 93, level: 31 },
    'incredible reflexes': { com: 5620, varp: 94, level: 34 },
    'protect from magic': { com: 5621, varp: 95, level: 37 },
    'protect from missiles': { com: 5622, varp: 96, level: 40 },
    'protect from melee': { com: 5623, varp: 97, level: 43 }
};

export const PROTECT_FROM_MAGIC = 'Protect from Magic';

function def(name: string): PrayerDef | null {
    return PRAYERS[name.trim().toLowerCase()] ?? null;
}

/**
 * Prayer points and the protection prayers.
 * @see docs/API.md#prayer
 */
export const Prayer = {
    points(): number {
        return Skills.effective('prayer');
    },

    max(): number {
        return Skills.level('prayer');
    },

    full(): boolean {
        const max = this.max();
        return max > 0 && this.points() >= max;
    },

    known(name: string): boolean {
        return def(name) !== null;
    },

    /** Whether the prayer's level requirement is met and points remain. */
    available(name: string): boolean {
        const d = def(name);
        return d !== null && this.max() >= d.level && this.points() > 0;
    },

    active(name: string): boolean {
        const d = def(name);
        return d !== null && reader.varp(d.varp) === 1;
    },

    async set(name: string, on: boolean): Promise<boolean> {
        const d = def(name);
        if (!d) {
            return false;
        }
        if (this.active(name) === on) {
            return true;
        }
        if (on && !this.available(name)) {
            return false;
        }
        actions.ifButton(d.com);
        return Execution.delayUntil(() => this.active(name) === on, TOGGLE_MS);
    },

    /** Turn off every prayer that is currently draining points. */
    async clear(): Promise<void> {
        for (const name of Object.keys(PRAYERS)) {
            if (this.active(name)) {
                await this.set(name, false);
            }
        }
    }
};
