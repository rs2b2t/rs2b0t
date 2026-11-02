import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { LOADOUT_SETTING, selectedLoadout } from '#/bot/api/loadout/loadoutSetting.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import type { Loadout } from '#/bot/api/loadout/loadouts.js';

const melee: Loadout = { name: 'melee', worn: { righthand: 'Rune scimitar' }, carry: [] };
const range: Loadout = { name: 'range', worn: {}, carry: [] };

beforeEach(() => {
    Loadouts.save([melee, range]);
});

afterEach(() => Loadouts.save([]));

describe('LOADOUT_SETTING', () => {
    test('is a dropdown fed from the loadout list', () => {
        expect(LOADOUT_SETTING.type).toBe('string');
        expect(LOADOUT_SETTING.optionsFrom).toBe('loadouts');
    });
});

describe('selectedLoadout', () => {
    test('picks the named loadout', () => {
        expect(selectedLoadout(new SettingsBag({ loadout: 'range' }))!.name).toBe('range');
    });

    test('is case-insensitive', () => {
        expect(selectedLoadout(new SettingsBag({ loadout: 'MELEE' }))!.name).toBe('melee');
    });

    test('falls back to the first loadout when unset', () => {
        expect(selectedLoadout(new SettingsBag({}))!.name).toBe('melee');
    });

    test('falls back to the first loadout when the name no longer exists', () => {
        expect(selectedLoadout(new SettingsBag({ loadout: 'deleted' }))!.name).toBe('melee');
    });

    test('is null when there are no loadouts at all', () => {
        Loadouts.save([]);
        expect(selectedLoadout(new SettingsBag({ loadout: 'melee' }))).toBeNull();
    });
});
