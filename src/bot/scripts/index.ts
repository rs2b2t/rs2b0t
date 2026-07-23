import { AGILITY_SETTINGS } from './AgilityBot.js';
import { GATHERING_SETTINGS } from './GatheringBot.js';
import { LOCATION_OPTIONS } from './FishingLocations.js';
import { FISHING_METHOD_OPTIONS } from './FishingMethods.js';
import { ROCK_OPTIONS } from './MiningRocks.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import AgilityBot from './AgilityBot.js';
import ArdyFighter, { SETTINGS as ARDY_SETTINGS } from './ArdyFighter.js';
import AutoFighter, { SETTINGS as AUTOFIGHTER_SETTINGS } from './AutoFighter.js';
import ArdyThiever, { SETTINGS as ARDYTHIEVER_SETTINGS } from './ArdyThiever.js';
import ArdyCakes, { SETTINGS as ARDYCAKES_SETTINGS } from './ArdyCakes.js';
import ChaosDruidKiller, { SETTINGS as CHAOSDRUID_SETTINGS } from './ChaosDruidKiller.js';
import ChickenKiller, { SETTINGS as CHICKEN_SETTINGS } from './ChickenKiller.js';
import ClueSolver, { SETTINGS as CLUESOLVER_SETTINGS } from './ClueSolver.js';
import CookBot, { SETTINGS as COOKBOT_SETTINGS } from './CookBot.js';
import GatheringBot from './GatheringBot.js';
import QuestDashboard from '../quests/QuestDashboard.js';
import AIOQuester, { AIO_SETTINGS } from './AIOQuester.js';
import MossGiant, { SETTINGS as MOSSGIANT_SETTINGS } from './MossGiant.js';
import GreenDragon, { SETTINGS as GREENDRAGON_SETTINGS } from './GreenDragon.js';
import RockCrab, { SETTINGS as ROCKCRAB_SETTINGS } from './RockCrab.js';
import ThievingBot, { SETTINGS as THIEVING_SETTINGS } from './ThievingBot.js';
import TutorialBot from './TutorialBot.js';
import WalkToBot, { WALKTO_SETTINGS } from './WalkToBot.js';
import WildyAgility, { WILDY_AGILITY_SETTINGS } from './WildyAgility.js';
import Woodcutter, { SETTINGS as WOODCUTTER_SETTINGS } from './Woodcutter.js';
import SmelterBot, { SETTINGS as SMELTER_SETTINGS } from './SmelterBot.js';
import SmithingBot, { SETTINGS as SMITHING_SETTINGS } from './SmithingBot.js';
import BankFletcher, { SETTINGS as BANKFLETCHER_SETTINGS } from './BankFletcher.js';
import FlaxPicker, { SETTINGS as FLAXPICKER_SETTINGS } from './FlaxPicker.js';
import FlaxSpinner, { SETTINGS as FLAXSPINNER_SETTINGS } from './FlaxSpinner.js';
import EssMiner, { SETTINGS as ESSMINER_SETTINGS } from './EssMiner.js';
import RuneCrafter, { SETTINGS as RUNECRAFTER_SETTINGS } from './RuneCrafter.js';
import ShopBuyout, { SHOPBUYOUT_SETTINGS } from './ShopBuyout.js';
import { ShopRunner, SHOPRUNNER_SETTINGS } from './ShopRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';

ScriptRegistry.register({
    name: 'TutorialBot',
    description: 'Completes Tutorial Island unassisted (no cheats)',
    category: 'Tutorial',
    tags: ['tutorial', 'onboarding'],
    create: () => new TutorialBot()
});

ScriptRegistry.register({
    name: 'QuestDashboard',
    description: 'Reports DONE/READY/BLOCKED eligibility for all quests',
    category: 'Quest',
    tags: ['quests', 'overlay', 'dashboard'],
    create: () => new QuestDashboard()
});

ScriptRegistry.register({
    name: 'AIOQuester',
    description: 'All-in-one quest completer — queues the implemented quests (empty selection = all), provisions items bank-first, runs each to journal-complete',
    category: 'Quest',
    tags: ['quest', 'queue', 'aio'],
    settingsSchema: AIO_SETTINGS,
    create: () => new AIOQuester()
});

ScriptRegistry.register({
    name: 'ChickenKiller',
    description: 'Kills chickens, loots and buries bones (anchor = start tile)',
    category: 'Combat',
    tags: ['lumbridge', 'bones', 'feathers', 'afk'],
    settingsSchema: CHICKEN_SETTINGS,
    create: () => new ChickenKiller()
});

function chickenPreset(overrides: Record<string, unknown>): SettingsSchema {
    const schema: SettingsSchema = {};
    for (const [key, def] of Object.entries(CHICKEN_SETTINGS)) {
        schema[key] = key in overrides ? { ...def, default: overrides[key] } : def;
    }
    return schema;
}

ScriptRegistry.register({
    name: 'CowKiller',
    description: 'Kills cows in the Lumbridge field, loots cow hides + bones (anchor = start tile)',
    category: 'Combat',
    tags: ['lumbridge', 'cowhide', 'bones', 'afk'],
    settingsSchema: chickenPreset({ targetName: 'Cow', lootMatch: 'cow hide|bones', buryBones: false, gatherFeathers: false }),
    create: () => new ChickenKiller()
});

ScriptRegistry.register({
    name: 'ChaosDruidKiller',
    description: 'Kills Chaos druids in the Edgeville dungeon, loots herbs/law runes, banks them',
    category: 'Combat',
    tags: ['wilderness', 'edgeville', 'herbs', 'banking'],
    settingsSchema: CHAOSDRUID_SETTINGS,
    create: () => new ChaosDruidKiller()
});

ScriptRegistry.register({
    name: 'RockCrab',
    description: 'Rellekka rock crabs: aggro-stack-kill-reset, loots key halves',
    category: 'Combat',
    tags: ['rellekka', 'keys', 'afk'],
    settingsSchema: ROCKCRAB_SETTINGS,
    create: () => new RockCrab()
});

ScriptRegistry.register({
    name: 'MossGiant',
    description: 'Moss giants N of Ardougne: range/mage safespot or melee, banks all loot',
    category: 'Combat',
    tags: ['ardougne', 'safespot', 'afk'],
    settingsSchema: MOSSGIANT_SETTINGS,
    create: () => new MossGiant()
});

ScriptRegistry.register({
    name: 'GreenDragon',
    description: 'Wilderness green dragons N of Edgeville: melee/mage w/ anti-dragon shield, banks bones + hides',
    category: 'Combat',
    tags: ['wilderness', 'dragons', 'hides'],
    settingsSchema: GREENDRAGON_SETTINGS,
    create: () => new GreenDragon()
});

ScriptRegistry.register({
    name: 'ArdyFighter',
    description: 'Fights East Ardougne market guards, feeds itself from the Baker\'s stall, loots rares, banks them at the south bank, solves clue drops (needs melee stats that beat the 60s guard respawn — ~str 80 unarmed)',
    category: 'Combat',
    tags: ['ardougne', 'thieving', 'banking', 'clues', 'afk'],
    settingsSchema: ARDY_SETTINGS,
    create: () => new ArdyFighter()
});

ScriptRegistry.register({
    name: 'Thiever',
    description: 'Pickpockets an NPC (Man by default); eats food when a failed steal hurts (anchor = start tile)',
    category: 'Thieving',
    tags: ['pickpocket', 'coins'],
    settingsSchema: THIEVING_SETTINGS,
    create: () => new ThievingBot()
});

ScriptRegistry.register({
    name: 'AutoFighter',
    description: 'Anchor-based clue farmer — kills the chosen target at a chosen guard spot, loots ONLY gem-table items + clue scrolls, solves clues on pickup (shared SolveClue), banks after each solve, returns to killing',
    category: 'Combat',
    tags: ['combat', 'clues', 'banking', 'afk'],
    settingsSchema: AUTOFIGHTER_SETTINGS,
    create: () => new AutoFighter()
});

ScriptRegistry.register({
    name: 'ArdyThiever',
    description: 'Low-level East Ardougne pickpocket bot — steals cake for food, pickpockets Guard/Knight/Paladin/Hero, flees (kites) or fights the guard per the guardResponse setting, banks loot + junk, grabs ground coins, solves clue drops',
    category: 'Thieving',
    tags: ['ardougne', 'thieving', 'banking', 'clues', 'afk'],
    settingsSchema: ARDYTHIEVER_SETTINGS,
    create: () => new ArdyThiever()
});

ScriptRegistry.register({
    name: 'ArdyCakes',
    description: 'Baker\'s-stall cake thiever — steals on the golden stand, resets nearby when watched, banks full packs, flees (kites) or fights a catching guard per guardResponse, solves clue drops',
    category: 'Thieving',
    tags: ['ardougne', 'thieving', 'banking', 'clues', 'afk'],
    settingsSchema: ARDYCAKES_SETTINGS,
    create: () => new ArdyCakes()
});

ScriptRegistry.register({
    name: 'Woodcutter',
    description: 'Chops trees and drops logs (anchor = start tile, needs an axe)',
    category: 'Woodcutting',
    tags: ['gathering', 'drop'],
    settingsSchema: WOODCUTTER_SETTINGS,
    create: () => new Woodcutter()
});

ScriptRegistry.register({
    name: 'Miner',
    description: 'Mines the selected rock types and banks the ore at the nearest bank (auto-detected), or drops it. Needs a pickaxe.',
    category: 'Mining',
    tags: ['gathering', 'banking', 'drop'],
    settingsSchema: {
        rocks: {
            type: 'string[]',
            default: ['Iron'],
            options: ROCK_OPTIONS,
            label: 'Rock types',
            help: 'which rocks to mine — every rock is named "Rocks" in-game, so pick the ore types here (multi-select). Empty = mine any rock.'
        },
        leashRadius: GATHERING_SETTINGS.leashRadius,
        location: {
            type: 'string',
            default: 'Auto',
            options: ['Auto', 'None'],
            label: 'Banking',
            help: 'Auto = bank the ore at the nearest bank booth in the loaded scene; None = drop it (power-mining). For Auto, mine within ~a screen of a bank.'
        }
    },
    create: () => new GatheringBot()
});

ScriptRegistry.register({
    name: 'EssMiner',
    description: 'Rune essence loop — Aubury teleport, one-click mine to a full pack, portal back, bank at Varrock East. Needs Rune Mysteries + a usable pickaxe (picks your best by default)',
    category: 'Mining',
    tags: ['varrock', 'mining', 'banking', 'afk'],
    settingsSchema: ESSMINER_SETTINGS,
    create: () => new EssMiner()
});

ScriptRegistry.register({
    name: 'RuneCrafter',
    description: 'AIO Runecrafting — withdraw essence + talisman, walk to the Mysterious ruins, use the talisman to enter, craft-rune at the altar, portal back, bank. Rune type via dropdown (Air for now, south of Falador)',
    category: 'Runecrafting',
    tags: ['runecrafting', 'banking', 'falador', 'afk'],
    settingsSchema: RUNECRAFTER_SETTINGS,
    create: () => new RuneCrafter()
});

ScriptRegistry.register({
    name: 'Fisher',
    description: 'Fishes a chosen method at the spot that offers it (each spot has a pair of ops); banks the catch at the nearest bank, or drops it (location: None)',
    category: 'Fishing',
    tags: ['gathering', 'drop', 'banking'],
    settingsSchema: {
        fishMethod: {
            type: 'string',
            default: FISHING_METHOD_OPTIONS[0],
            options: FISHING_METHOD_OPTIONS,
            label: 'Fishing method',
            help: 'what to fish — picks the right spot (each spot offers a PAIR of ops) and the correct op of the two, e.g. small net (shrimp) vs big net (mackerel)'
        },
        leashRadius: { type: 'number', default: 12, min: 2, max: 30, label: 'Leash radius (tiles)' },
        location: {
            type: 'string',
            default: 'Auto',
            options: LOCATION_OPTIONS,
            label: 'Fishing location',
            help: 'Auto = bank the catch at the nearest bank (a known location if started at one, else the nearest booth in the scene); None = always drop (power-fishing)'
        }
    },
    create: () => new GatheringBot()
});

ScriptRegistry.register({
    name: 'CookBot',
    description: 'Catherby cook loop — withdraw raw fish, cross to the range, cook it all one at a time, bank everything, repeat',
    category: 'Cooking',
    tags: ['catherby', 'cooking', 'banking', 'afk'],
    settingsSchema: COOKBOT_SETTINGS,
    create: () => new CookBot()
});

ScriptRegistry.register({
    name: 'BankFletcher',
    description: 'Bank-standing fletcher — withdraw logs, knife-fletch the chosen product (arrow shafts / unstrung bow), deposit, repeat',
    category: 'Fletching',
    tags: ['fletching', 'banking', 'afk'],
    settingsSchema: BANKFLETCHER_SETTINGS,
    create: () => new BankFletcher()
});

ScriptRegistry.register({
    name: 'SmelterBot',
    description: 'Al Kharid smelter — withdraw ore, use it on the Furnace to smelt bars (all 8 bar types), bank, repeat',
    category: 'Smithing',
    tags: ['smithing', 'smelting', 'banking', 'afk'],
    settingsSchema: SMELTER_SETTINGS,
    create: () => new SmelterBot()
});

ScriptRegistry.register({
    name: 'SmithingBot',
    description: 'Varrock anvil smithing — withdraw bars + a hammer, make the chosen item at the anvil, bank the products, repeat',
    category: 'Smithing',
    tags: ['smithing', 'anvil', 'banking', 'afk'],
    settingsSchema: SMITHING_SETTINGS,
    create: () => new SmithingBot()
});

ScriptRegistry.register({
    name: 'FlaxPicker',
    description: 'Seers flax field picker — pick flax until full, bank it at Seers, repeat',
    category: 'Crafting',
    tags: ['seers', 'gathering', 'banking', 'afk'],
    settingsSchema: FLAXPICKER_SETTINGS,
    create: () => new FlaxPicker()
});

ScriptRegistry.register({
    name: 'FlaxSpinner',
    description: 'Seers flax spinner — withdraw flax, climb to the spinning wheel, Spin-X into bow string, bank, repeat',
    category: 'Crafting',
    tags: ['seers', 'crafting', 'banking', 'afk'],
    settingsSchema: FLAXSPINNER_SETTINGS,
    create: () => new FlaxSpinner()
});

ScriptRegistry.register({
    name: 'GnomeCourse',
    description: 'Runs the Gnome Stronghold agility course (start at the log balance)',
    category: 'Agility',
    tags: ['course', 'gnome'],
    settingsSchema: AGILITY_SETTINGS,
    create: () => new AgilityBot()
});

ScriptRegistry.register({
    name: 'WildyAgility',
    description: 'Runs the Wilderness Agility Course, eats while running, and on death banks (food-only) then returns — needs Agility 52 + carried food (start at the entrance)',
    category: 'Agility',
    tags: ['course', 'wilderness', 'food', 'death-recovery'],
    settingsSchema: WILDY_AGILITY_SETTINGS,
    create: () => new WildyAgility()
});

ScriptRegistry.register({
    name: 'ShopBuyout',
    description: "Parks at ONE shop and buys it out repeatedly on a total gp budget — no routing. Defaults to Lundail's Mage Arena rune shop (banks via Gundai's dialog); get the bot to the shop yourself.",
    category: 'Money making',
    tags: ['wilderness', 'shopping', 'banking', 'runes', 'afk'],
    settingsSchema: SHOPBUYOUT_SETTINGS,
    create: () => new ShopBuyout()
});

ScriptRegistry.register({
    name: 'ShopRunner',
    description: 'World shop-run supply loop — cycles shop clusters buying feathers, runes, and arrows/arrowtips, banking between clusters with capped gp withdrawals; skips shops until stock regenerates',
    category: 'Money making',
    tags: ['shopping', 'banking', 'worldwalker'],
    settingsSchema: SHOPRUNNER_SETTINGS,
    create: () => new ShopRunner()
});

ScriptRegistry.register({
    name: 'ClueSolver',
    description: 'Solves the easy clue scroll (or opens the casket) in your pack — banks everything except clue/food/spade at the nearest bank, walks the trail, opens the reward. Idles until you hand it a clue.',
    category: 'Treasure Trails',
    tags: ['clues', 'banking', 'utility'],
    settingsSchema: CLUESOLVER_SETTINGS,
    create: () => new ClueSolver()
});

ScriptRegistry.register({
    name: 'WalkTo',
    description: 'Walks to a chosen destination and stops — Lumbridge, Varrock, Falador, Ardougne, Rellekka, Taverley (centre); Draynor, Al Kharid, Edgeville, Seers, Yanille (bank); or a custom tile',
    category: 'Navigation',
    tags: ['navigation', 'utility', 'web-walk'],
    settingsSchema: WALKTO_SETTINGS,
    create: () => new WalkToBot()
});
