import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import type { BankDestination } from '../api/Banking.js';
import { Traversal } from '../api/Traversal.js';
import type Tile from '../api/Tile.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import ChickenKiller, { SETTINGS as CHICKEN_SETTINGS } from './ChickenKiller.js';
import {
    AL_KHARID_BANK,
    COW_LOCATION_OPTIONS,
    isCowFieldLootTile,
    nearestCowLocation,
    needsTollCoins,
    resolveCowLocation,
    shouldBootstrapTollCoins,
    TOLL_COIN_TARGET,
    type CowLocation
} from '../api/CowKillerLocations.js';

function chickenPreset(overrides: Record<string, unknown>): SettingsSchema {
    const schema: SettingsSchema = {};
    for (const [key, def] of Object.entries(CHICKEN_SETTINGS)) {
        schema[key] = key in overrides ? { ...def, default: overrides[key] } : def;
    }
    return schema;
}

export const SETTINGS: SettingsSchema = {
    location: {
        type: 'string',
        default: 'Auto',
        options: COW_LOCATION_OPTIONS,
        label: 'Cow field',
        help: 'Auto picks the nearer supported field; Start tile keeps custom cow spots'
    },
    alKharidTollCoins: {
        type: 'boolean',
        default: true,
        label: 'Keep 20 coins for Al Kharid gate?',
        help: 'withdraws/top-ups 20 coins at Al Kharid bank for the Lumbridge round trip',
        showIf: { key: 'location', anyOf: ['Auto', 'Lumbridge cow field'] }
    },
    ...chickenPreset({
        leashRadius: 18,
        targetName: 'Cow',
        lootMatch: 'cow hide|bones',
        buryBones: false
    })
};

export default class CowKiller extends ChickenKiller {
    private location: CowLocation | null = null;

    protected override selectAnchor(here: Tile, hinted: Tile | null): Tile {
        const setting = this.settings.str('location', 'Auto');
        const selected = resolveCowLocation(setting, here);

        if (setting.trim().toLowerCase() === 'auto' && hinted) {
            this.location = nearestCowLocation(hinted);
            this.log(`recovery restart — resuming ${this.location.name}`);
            return hinted;
        }
        if (selected) {
            this.location = selected;
            this.log(`cow field: ${selected.name} at ${selected.anchor}`);
            return selected.anchor;
        }

        this.location = null;
        this.log('cow field: custom start tile');
        return hinted ?? here;
    }

    protected override async prepareForTravel(start: Tile): Promise<void> {
        const enabled = this.settings.bool('alKharidTollCoins', true);
        if (!shouldBootstrapTollCoins(this.location, start, Inventory.count('Coins'), enabled)) {
            return;
        }

        this.setStatus('preparing Al Kharid toll coins');
        this.log(`preparing ${TOLL_COIN_TARGET} toll coins before leaving Al Kharid`);
        const arrived = await Traversal.walkResilient(AL_KHARID_BANK, {
            radius: 4,
            timeoutMs: 90_000,
            log: message => this.log(`  ${message}`)
        });
        if (!arrived || !(await Bank.openNearest('Bank booth', 'Use-quickly', message => this.log(`  ${message}`)))) {
            this.log('could not open Al Kharid bank for toll coins — continuing without them');
            return;
        }
        await this.topUpTollCoins();
    }

    override keepList(): string[] {
        const keep = super.keepList();
        return this.usesTollCoins() ? [...keep, 'Coins'] : keep;
    }

    override acceptsLootAt(tile: Tile): boolean {
        return isCowFieldLootTile(this.getAnchor(), this.leashRadius(), tile);
    }

    protected override async afterBankDeposit(): Promise<void> {
        // Ammo / runes (ChickenKiller base), then toll float.
        await super.afterBankDeposit();
        if (this.usesTollCoins()) {
            await this.topUpTollCoins();
        }
    }

    protected override bankDestination(): BankDestination | null {
        return this.usesTollCoins() ? { name: 'Al Kharid', tile: AL_KHARID_BANK } : null;
    }

    private usesTollCoins(): boolean {
        return needsTollCoins(this.location, this.settings.bool('alKharidTollCoins', true));
    }

    private async topUpTollCoins(): Promise<void> {
        const before = Inventory.count('Coins');
        const need = TOLL_COIN_TARGET - before;
        if (need <= 0) {
            this.log(`Al Kharid toll float ready: ${before} coins`);
            return;
        }

        const available = Bank.count('Coins');
        if (available < need) {
            this.log(`Al Kharid toll float needs ${need} coins, but the bank only has ${available}`);
            return;
        }
        if (!(await Bank.withdrawX('Coins', need))) {
            this.log(`could not withdraw ${need} toll coins`);
            return;
        }

        const after = Inventory.count('Coins');
        if (after < TOLL_COIN_TARGET) {
            this.log(`toll coin withdrawal was short: ${after}/${TOLL_COIN_TARGET}`);
            return;
        }
        this.log(`Al Kharid toll float ready: ${after} coins`);
    }
}
