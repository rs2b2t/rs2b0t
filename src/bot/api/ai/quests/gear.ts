import type { Loadout } from '../../loadout/loadouts.js';

/** Modules have no settings bag, so AIOQuester resolves the selection and parks it here. */
export const QuestLoadout = { current: null as Loadout | null };
