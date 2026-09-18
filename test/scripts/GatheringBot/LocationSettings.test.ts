import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import '#/bot/scripts/index.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { SettingsBag, SettingsStore } from '#/bot/runtime/Settings.js';
import Tile from '#/bot/geometry/Tile.js';
import { Game } from '#/bot/api/game/Game.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';

afterEach(() => mock.restore());

test.each(['Miner', 'Fisher', 'Woodcutter'])('%s preserves saved gathering modes and exposes bank/custom settings', name => {
    const schema = ScriptRegistry.get(name)!.settingsSchema!;
    expect(schema.location.default).toBe('Auto');
    for (const mode of ['Auto', 'None', 'Use Closest', 'Use Start Position', 'Use Custom Position']) {
        spyOn(SettingsStore, 'saved').mockImplementation((_name, key) => key === 'location' ? mode : key === 'bank' ? 'false' : undefined);
        const bag = new SettingsBag(SettingsStore.resolve(name, schema));
        expect(bag.str('location')).toBe(mode);
        expect(bag.bool('bank', true)).toBe(false);
        expect(bag.tile('customLocation', new Tile(1, 1))).toEqual(new Tile(3200, 3200, 0));
    }
});

test('a named bank cannot be replaced by a nearby bank', async () => {
    const bot = new GatheringBot();
    const bank = BANK_LOCATIONS[0]!;
    bot['forcedBank'] = bank;
    const open = spyOn(Banking, 'open').mockResolvedValue(true);
    await bot.openScriptBank();
    expect(open.mock.calls[0]![0]).toMatchObject({ destination: { name: bank.name }, preferNearby: false });
});

test('nearest banking leaves route selection to Banking', async () => {
    const bot = new GatheringBot();
    bot['bankLocation'] = 'Nearest';
    spyOn(Game, 'tile').mockReturnValue(new Tile(3100, 9570, 0));
    const open = spyOn(Banking, 'open').mockResolvedValue(true);
    await bot.openScriptBank();
    expect(open.mock.calls[0]![0]!.destination).toBeUndefined();
});
