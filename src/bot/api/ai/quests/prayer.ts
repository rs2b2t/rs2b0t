// docs/reference/quest-provisioning.md
import { reader } from '../../../adapter/ClientAdapter.js';
import { Inventory } from '../../inventory/Inventory.js';
import { Prayer } from '../../prayer/Prayer.js';
import type { QuestPrayer, ProtectionKind } from './engine/types.js';

/** Points at which a dose is worth more than the swing it costs. */
export const PRAYER_FLOOR = 25;

/** Level 43 gates Protect from Melee, the highest of the three. */
export const PROTECT_LEVEL: Record<ProtectionKind, number> = {
    magic: 37,
    missiles: 40,
    melee: 43
};

export const PROTECTION_NAME: Record<ProtectionKind, string> = {
    melee: 'Protect from Melee',
    magic: 'Protect from Magic',
    missiles: 'Protect from Missiles'
};

/** The dose the engine draws into the float; the smaller flasks are drunk if the bank only has those. */
export const PRAYER_POTION = 'Prayer potion(4)';

/** Every dose form, so a half-used flask still counts as a dose in the pack. */
export const PRAYER_POTION_IDS: readonly number[] = [2434, 139, 141, 143];

export type PrayerAction = 'none' | 'protect' | 'drink' | 'drop';

export interface PrayerUpkeepInput {
    inCombat: boolean;
    protectActive: boolean;
    protectAvailable: boolean;
    points: number;
    doses: number;
}

/**
 * Why: the server runs one op per tick and drops the rest, so upkeep names a single action and the caller spends the tick on it.
 * Why: protection is dropped as soon as a fight ends; held through the walk out it empties the flask the next fight needed.
 */
export function prayerUpkeepAction(input: PrayerUpkeepInput): PrayerAction {
    if (!input.inCombat) {
        return input.protectActive ? 'drop' : 'none';
    }
    if (input.points <= PRAYER_FLOOR && input.doses > 0) {
        return 'drink';
    }
    if (!input.protectActive && input.protectAvailable) {
        return 'protect';
    }
    return 'none';
}

export function protectionName(pray: QuestPrayer): string {
    return PROTECTION_NAME[pray.protect];
}

export function protectionLevel(pray: QuestPrayer): number {
    return PROTECT_LEVEL[pray.protect];
}

/** Shared Prayer upkeep for one-shot steps, Sustain loops, and long-running fight loops. */
export const QuestPrayerState = {
    current: null as QuestPrayer | null,
    warned: false,
    log: null as ((m: string) => void) | null
};

/** Point the upkeep at a quest's declaration; null for a quest that declares none. */
export function setQuestPrayer(pray: QuestPrayer | null | undefined, log: ((m: string) => void) | null): void {
    QuestPrayerState.current = pray ?? null;
    QuestPrayerState.warned = false;
    QuestPrayerState.log = log;
}

/** Spend at most one tick holding the running quest's protection prayer. True when a tick was spent. */
export async function prayerUpkeep(): Promise<boolean> {
    const pray = QuestPrayerState.current;
    if (!pray) {
        return false;
    }
    const name = protectionName(pray);
    if (Prayer.max() < protectionLevel(pray)) {
        if (!QuestPrayerState.warned) {
            QuestPrayerState.warned = true;
            QuestPrayerState.log?.(`Prayer ${Prayer.max()}, no ${name}, fighting on food alone`);
        }
        return false;
    }
    const doses = Inventory.items().filter(item => PRAYER_POTION_IDS.includes(item.id));
    switch (prayerUpkeepAction({
        inCombat: reader.inCombat(),
        protectActive: Prayer.active(name),
        protectAvailable: Prayer.available(name),
        points: Prayer.points(),
        doses: doses.length
    })) {
        case 'drink':
            QuestPrayerState.log?.(`drinking a prayer dose (${Prayer.points()}/${Prayer.max()})`);
            return doses[0].interact('Drink');
        case 'protect':
            QuestPrayerState.log?.(`raising ${name} (${Prayer.points()}/${Prayer.max()})`);
            return Prayer.set(name, true);
        case 'drop':
            return Prayer.set(name, false);
        default:
            return false;
    }
}
