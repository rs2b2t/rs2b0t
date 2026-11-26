import { Bank, EntityQuery, Npcs, type SettingsSchema } from '@rs2b0t/api';

Npcs.query().results();
// @ts-expect-error EntityQuery must be created by a query factory.
new EntityQuery();

export const settings = {
    opacity: { type: 'number', default: 0.5, step: 0.05 },
    tint: { type: 'string', default: '#ffffff', color: true },
    filters: { type: 'string[]', default: [], selectionMode: 'includeExclude' },
    tasks: { type: 'string[]', default: [], optionStatuses: () => ({ a: 'complete', b: 'incomplete', c: 'unknown' }) },
    loadout: { type: 'string', default: '', optionsFrom: 'loadouts' },
    prices: { type: 'string', default: '', optionsFrom: 'priceBooks' },
    items: { type: 'string[]', default: [], csvToggle: 'inputMode' },
    // @ts-expect-error The panel only supports named option sources.
    invalidSource: { type: 'string', default: '', optionsFrom: 'other' }
} satisfies SettingsSchema;

const match = () => true;
Bank.depositAllMatching(match);
Bank.depositAllMatching(match, message => message.toUpperCase());
Bank.depositAllMatching(match, undefined, 1);
Bank.depositAllMatching(match, undefined, 5);
// @ts-expect-error Only batches of one or five are supported.
Bank.depositAllMatching(match, undefined, 2);
