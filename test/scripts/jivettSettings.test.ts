import { expect, test } from 'bun:test';
import { SettingsBag } from '../../src/bot/runtime/Settings.js';
import { readSettings } from '../../src/bot/scripts/JiveTT/settings.js';

test('market targets must cover the next hunting and clue packs', () => {
    expect(() => readSettings(new SettingsBag({ stockSharks: 8 }))).toThrow('stock targets');
    expect(() => readSettings(new SettingsBag({ prayerDoses: 40, stockPrayerDoses: 8 }))).toThrow('stock targets');
    expect(() => readSettings(new SettingsBag({ superDoses: 8, stockSuperSets: 1 }))).toThrow('stock targets');
    expect(readSettings(new SettingsBag({ marketEnabled: false, stockSharks: 8 })).marketEnabled).toBe(false);
});
