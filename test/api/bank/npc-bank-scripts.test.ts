import { afterEach, expect, test } from 'bun:test';
import HerbCleaner from '#/bot/scripts/HerbCleaner/HerbCleaner.js';
import ThievingBot from '#/bot/scripts/ThievingBot/ThievingBot.js';
import GemCutter from '#/bot/scripts/GemCutter/GemCutter.js';
import PotionMaker from '#/bot/scripts/PotionMaker/PotionMaker.js';
import Superheater from '#/bot/scripts/Superheater/Superheater.js';
import Alcher from '#/bot/scripts/Alcher/Alcher.js';
import LeatherCrafter from '#/bot/scripts/LeatherCrafter/LeatherCrafter.js';
import RoguesPurse from '#/bot/scripts/RoguesPurse/RoguesPurse.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../lib/stubSingletons.js';

class Cleaner extends HerbCleaner {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

class Thiever extends ThievingBot {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

class Cutter extends GemCutter {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

class Mixer extends PotionMaker {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

class Heater extends Superheater {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

class Alchemist extends Alcher {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

class Crafter extends LeatherCrafter {
    registered: Task[] = [];
}

class Collector extends RoguesPurse {
    registered: Task[] = [];
}

let restores: (() => void)[] = [];
afterEach(() => {
    for (const restore of restores.reverse()) restore();
    restores = [];
});

for (const [Bot, taskName] of [[Cleaner, 'BankTrip'], [Thiever, 'FoodBank'], [Cutter, 'BankTrip'], [Mixer, 'RestockIngredients'], [Mixer, 'FinishPotions'], [Heater, 'openBank'], [Alchemist, 'openBank'], [Crafter, 'bankLeg'], [Collector, 'fetchFare']] as const) {
    test(`${Bot.name}.${taskName} opens the Legends Guild banker without looking for a booth`, async () => {
        const opened: string[] = [];
        const walked: WorldTile[] = [];
        let here: WorldTile = new Tile(2732, 3378, Bot === Collector ? 2 : 0);
        restores = [
            stubProps(Game, { tile: () => here, ingame: () => true }),
            stubProps(Skills, { level: () => 50, xp: () => 0 }),
            stubProps(Quests, { status: () => 'complete' }),
            stubProps(Execution, { delayUntil: async check => check() }),
            stubProps(Traversal, { walkResilient: async tile => { walked.push(tile); here = tile; return true; } }),
            stubProps(Navigator, { findPath: async (_from, to) => ({ ok: true, waypoints: [], hops: [], expanded: 0, cost: to.level === 2 ? 1 : 300 }) }),
            stubProps(WalkExecutor, { probeDest: async terminal => ({ ok: true, terminal }) }),
            stubProps(ScriptRunner, { stop: () => {} }),
            stubProps(Bank, {
                isOpen: () => false,
                openNpcAccess: async access => { opened.push(`${access.name}:${access.op}`); return false; },
                openNearestAccess: async () => { opened.push('booth'); return false; },
                openNearest: async () => { opened.push('booth'); return false; }
            })
        ];
        const bot = new Bot();
        bot.settings = new SettingsBag({ banking: 'None', herb: 'Guam leaf', secondary: 'Eye of newt' });
        bot.bindLog(() => {});
        try {
            if (bot instanceof Crafter) await bot['bankLeg']();
            else if (bot instanceof Collector) await bot['fetchFare'](() => {});
            else if (bot instanceof Alchemist) {
                await bot.resolveBank();
                await bot.openBank();
            } else {
                await bot.onStart();
                if (bot instanceof Heater) await bot.openBank();
                else await bot.registered.find(task => task.constructor.name === taskName)!.execute();
            }
            expect(walked).toEqual([new Tile(2732, 3378, 2)]);
            expect(opened).toEqual(['Banker:Bank']);
        } finally {
            bot.disposeSubscriptions();
        }
    });
}
