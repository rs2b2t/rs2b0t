import { Execution } from '../../api/execution/Execution.js';
import { ROCK_OPTIONS } from '../../data/miningRocks.js';
import { SettingsBag, type SettingsSchema } from '../../runtime/Settings.js';
import GatheringBot from './GatheringBot.js';
import { MINER_SETTINGS } from './MinerSettings.js';

const ORE_NAMES = new Set(ROCK_OPTIONS.map(ore =>
    ['Clay', 'Coal'].includes(ore) ? ore.toLowerCase() : `${ore.toLowerCase()} ore`
));

export const JIVEPOWER_SETTINGS: SettingsSchema = {
    rocks: MINER_SETTINGS.rocks,
    location: {
        ...MINER_SETTINGS.location,
        label: 'Mining location',
        help: 'Uses the same camps as Miner. Drops selected ore when full, then resumes mining.'
    },
    customLocation: MINER_SETTINGS.customLocation,
    leashRadius: MINER_SETTINGS.leashRadius,
    food: {
        ...MINER_SETTINGS.food,
        help: 'Eaten when its full heal fits or HP is low. Kept when dropping ore.'
    },
    foodWithdraw: {
        ...MINER_SETTINGS.foodWithdraw,
        help: 'Restock to this food count when supplies run out. 0 carries no food. Desert camps require at least 2.'
    },
    toolAcquire: MINER_SETTINGS.toolAcquire
};

export default class JivePower extends GatheringBot {
    override async onStart(): Promise<void> {
        this.settings = new SettingsBag({
            ...this.settings.raw(),
            bank: false,
            muleMode: 'Off',
            tickManip: 'Off',
            purgePackOnStart: false,
            packJunk: 'Off'
        });
        await super.onStart();
    }

    protected override paintKind(): string {
        return 'JivePower';
    }

    protected override keepMinerFood(): boolean {
        return true;
    }

    override fullHaulNeedsBank(): boolean {
        return false;
    }

    override isProduct(name: string | null | undefined): boolean {
        return ORE_NAMES.has((name ?? '').toLowerCase()) && super.isProduct(name);
    }

    override async dropProducts(): Promise<void> {
        this.setStatus('dropping');
        for (let attempt = 0; attempt < 3; attempt++) {
            const items = this.products();
            if (items.length === 0) return;
            await Promise.all(items.map(item => item.interact('Drop')));
            if (await Execution.delayUntil(() => this.products().length === 0, 6000)) {
                this.log('drop: haul cleared');
                return;
            }
        }
        throw new Error('JivePower could not clear the ore after three drop batches');
    }
}
