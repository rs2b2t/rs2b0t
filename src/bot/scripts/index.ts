import { AGILITY_SETTINGS } from './AgilityBot.js';
import { FISHING_LOCATION_OPTIONS } from '../api/FishingLocations.js';
import { FISHING_METHOD_OPTIONS } from '../api/FishingMethods.js';
import { MINING_LOCATION_OPTIONS } from '../api/MiningLocations.js';
import {
    AFTER_COOK_OPTIONS,
    BURNT_POLICY_OPTIONS,
    COOK_FISH_OPTIONS,
    COOK_MODE_OPTIONS
} from './FishCookLogic.js';
import {
    FISH_TICK_MANIP_OPTIONS,
    MINE_TICK_MANIP_OPTIONS,
    TICK_MANIP_UNSHIPPED_HELP,
    tickManipUiOptions
} from './TickManipLogic.js';
import { ROCK_OPTIONS } from '../api/MiningRocks.js';
import EdgevilleMonkeyBars, { EDGEVILLE_MONKEYBARS_SETTINGS } from './EdgevilleMonkeyBars.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import AgilityBot from './AgilityBot.js';
import ArdyFighter, { SETTINGS as ARDY_SETTINGS } from './ArdyFighter.js';
import AutoFighter, { SETTINGS as AUTOFIGHTER_SETTINGS } from './AutoFighter.js';
import ArdyThiever, { SETTINGS as ARDYTHIEVER_SETTINGS } from './ArdyThiever.js';
import ArdyCakes, { SETTINGS as ARDYCAKES_SETTINGS } from './ArdyCakes.js';
import ChaosDruidKiller, { SETTINGS as CHAOSDRUID_SETTINGS } from './ChaosDruidKiller.js';
import ChickenKiller, { SETTINGS as CHICKEN_SETTINGS } from './ChickenKiller.js';
import CowKiller, { SETTINGS as COWKILLER_SETTINGS } from './CowKiller.js';
import ClueSolver, { SETTINGS as CLUESOLVER_SETTINGS } from './ClueSolver.js';
import CookBot, { SETTINGS as COOKBOT_SETTINGS } from './CookBot.js';
import GatheringBot, { GATHERING_SETTINGS } from './GatheringBot.js';
import Woodcutter, { WOODCUTTER_SETTINGS } from './Woodcutter.js';
import { FORGETFUL_BANK_SETTING, TOOL_ACQUIRE_SETTING } from '../api/ToolAcquire.js';
import QuestDashboard from '../quests/QuestDashboard.js';
import AIOQuester, { AIO_SETTINGS } from './AIOQuester.js';
import MossGiant, { SETTINGS as MOSSGIANT_SETTINGS } from './MossGiant.js';
import GreenDragon, { SETTINGS as GREENDRAGON_SETTINGS } from './GreenDragon.js';
import FireGiant, { SETTINGS as FIREGIANT_SETTINGS } from './FireGiant.js';
import RockCrab, { SETTINGS as ROCKCRAB_SETTINGS } from './RockCrab.js';
import ThievingBot, { SETTINGS as THIEVING_SETTINGS } from './ThievingBot.js';
import TutorialBot from './TutorialBot.js';
import WalkToBot, { WALKTO_SETTINGS } from './WalkToBot.js';
import WildyAgility, { WILDY_AGILITY_SETTINGS } from './WildyAgility.js';
import SmelterBot, { SETTINGS as SMELTER_SETTINGS } from './SmelterBot.js';
import TannerBot, { TANNER_SETTINGS } from './TannerBot.js';
import VialFiller, { VIAL_FILLER_SETTINGS } from './VialFiller.js';
import LeatherCrafter, { CRAFTER_SETTINGS } from './LeatherCrafter.js';
import Firemaker, { FIREMAKER_SETTINGS } from './Firemaker.js';
import SmithingBot, { SETTINGS as SMITHING_SETTINGS } from './SmithingBot.js';
import BankFletcher, { SETTINGS as BANKFLETCHER_SETTINGS } from './BankFletcher.js';
import DartFletcher, { DART_FLETCHER_SETTINGS } from './DartFletcher.js';
import BoneBurier, { BONE_BURIER_SETTINGS } from './BoneBurier.js';
import FlaxPicker, { SETTINGS as FLAXPICKER_SETTINGS } from './FlaxPicker.js';
import FlaxSpinner, { SETTINGS as FLAXSPINNER_SETTINGS } from './FlaxSpinner.js';
import EssMiner, { SETTINGS as ESSMINER_SETTINGS } from './EssMiner.js';
import CoalTrucks from './CoalTrucks.js';
import RuneCrafter, { SETTINGS as RUNECRAFTER_SETTINGS } from './RuneCrafter.js';
import NatureCrafter, { SETTINGS as NATURECRAFTER_SETTINGS } from './NatureCrafter.js';
import MuleCrafter, { SETTINGS as MULECRAFTER_SETTINGS } from './MuleCrafter.js';
import RoguesPurse from './RoguesPurse.js';
import ShopBuyout, { SHOPBUYOUT_SETTINGS } from './ShopBuyout.js';
import FlaxRunner, { SETTINGS as FLAXRUNNER_SETTINGS } from './FlaxRunner.js';
import { ShopRunner, SHOPRUNNER_SETTINGS } from './ShopRunner.js';

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

ScriptRegistry.register({
    name: 'CowKiller',
    description: 'Walks to Lumbridge or south-Falador cows, loots hides + bones, and supports Al Kharid toll banking',
    category: 'Combat',
    tags: ['lumbridge', 'falador', 'cowhide', 'bones', 'banking', 'afk'],
    settingsSchema: COWKILLER_SETTINGS,
    create: () => new CowKiller()
});

ScriptRegistry.register({
    name: 'ChaosDruidKiller',
    description: 'Kills Chaos druids — Edgeville dungeon, the picklocked Chaos Druid Tower (46 Thieving), or Yanille dungeon Chaos druid warriors past the 40 Agility ledge — loots Herb/Law/Nature rune drops, banks them',
    category: 'Combat',
    tags: ['wilderness', 'edgeville', 'ardougne', 'yanille', 'herbs', 'banking'],
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
    name: 'FireGiant',
    description: 'Waterfall Dungeon fire giants: range/mage safespot or melee, enters by raft + rope + Glarial\'s amulet, rides the barrel out to bank',
    category: 'Combat',
    tags: ['waterfall', 'safespot', 'members', 'banking'],
    settingsSchema: FIREGIANT_SETTINGS,
    create: () => new FireGiant()
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
    description: 'Pickpockets an NPC (Man by default), eats after failed steals, and optionally banks to restock food before returning to the start tile',
    category: 'Thieving',
    tags: ['pickpocket', 'coins', 'banking', 'food'],
    settingsSchema: THIEVING_SETTINGS,
    create: () => new ThievingBot()
});

ScriptRegistry.register({
    name: 'AutoFighter',
    description: 'Start-or-coordinate fighter — kills any named NPC in its leash, loots selected drops, auto-banks, solves clues, and returns to the killing spot',
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
    description:
        'Chops the chosen tree type, then banks logs, drops them, or burns a full load (chop-then-burn). Needs an axe; burn mode also needs a tinderbox (both restock from the bank when Full inventory is Auto). Optional Buy/repair acquires axes from Bob or smiths mith+ from bars.',
    category: 'Woodcutting',
    tags: ['gathering', 'banking', 'drop', 'firemaking'],
    settingsSchema: WOODCUTTER_SETTINGS,
    create: () => new Woodcutter()
});

ScriptRegistry.register({
    name: 'Miner',
    description:
        'Mines the selected rock types, then banks the ore at the nearest bank or drops it (power-mining). Needs a pickaxe (best available is restocked from the bank when Full inventory is Auto). Optional Buy/repair acquires picks from Nurmof (and repairs broken picks).',
    category: 'Mining',
    tags: ['gathering', 'banking', 'drop'],
    settingsSchema: {
        rocks: {
            type: 'string[]',
            default: ['Iron'],
            options: ROCK_OPTIONS,
            label: 'Rock types',
            help:
                'Which rocks to mine — every rock is named "Rocks" in-game, so pick the ore types here (multi-select). Empty = mine any rock.'
        },
        leashRadius: GATHERING_SETTINGS.leashRadius,
        location: {
            type: 'string',
            default: 'Auto',
            options: MINING_LOCATION_OPTIONS,
            label: 'Location / full inventory',
            help:
                'Mine camp + full-pack behaviour. Auto = if you start in the same 64×64 map square as a known mine camp, snap to the nearest such camp and bank there; otherwise freeform (start-tile leash + nearest bank). Named camps pin spot + bank. None = power-mine (drop ore; bank only for missing tools).'
        },
        tickManip: {
            type: 'string',
            default: 'Off',
            options: tickManipUiOptions(MINE_TICK_MANIP_OPTIONS),
            label: 'Tick manip',
            group: 'Tick manip',
            help: TICK_MANIP_UNSHIPPED_HELP
        },
        muleMode: GATHERING_SETTINGS.muleMode,
        mulePartner: GATHERING_SETTINGS.mulePartner,
        toolAcquire: TOOL_ACQUIRE_SETTING,
        forgetfulBank: FORGETFUL_BANK_SETTING
    },
    create: () => new GatheringBot()
});

ScriptRegistry.register({
    name: 'EssMiner',
    description: 'Rune essence loop — Aubury teleport, one-click mine to a full pack, portal back, bank at Varrock East. Needs Rune Mysteries; uses your best pickaxe and buys the exact best usable tier from Nurmof when banked coins cover it',
    category: 'Mining',
    tags: ['varrock', 'mining', 'banking', 'afk'],
    settingsSchema: ESSMINER_SETTINGS,
    create: () => new EssMiner()
});

ScriptRegistry.register({
    name: 'CoalTrucks',
    description: 'Mines coal at the Coal Trucks, buffers 120 in the trucks, then drains them into the Seers bank — needs Mining 30 and a pickaxe. No combat handling: the level-27 giant bats are aggressive below 55 combat.',
    category: 'Mining',
    tags: ['mining', 'coal', 'seers', 'banking'],
    create: () => new CoalTrucks()
});

ScriptRegistry.register({
    name: 'RuneCrafter',
    description: 'AIO Runecrafting (Air/Earth) — Solo banks its own essence and crafts at the altar; Runner ferries bank essence to a Mule Recipient by trade; Mule Recipient camps the ruins, takes every essence trade and crafts between trades',
    category: 'Runecrafting',
    tags: ['runecrafting', 'banking', 'trade', 'runner', 'mule', 'afk'],
    settingsSchema: RUNECRAFTER_SETTINGS,
    create: () => new RuneCrafter()
});

ScriptRegistry.register({
    name: 'NatureCrafter',
    description: 'Master Nature Crafter — a master stands at the nature altar (Karamja), takes essence from configured runners via trade, and crafts natures; runners bank essence at Ardougne, un-note it at the general store, and ship it to the master. Mode + partner name(s) via settings',
    category: 'Runecrafting',
    tags: ['runecrafting', 'nature', 'trade', 'master', 'runner', 'karamja'],
    settingsSchema: NATURECRAFTER_SETTINGS,
    create: () => new NatureCrafter()
});

ScriptRegistry.register({
    name: 'Fisher',
    description:
        'Fishes a chosen method at the spot that offers it; banks the catch, optionally cooks at a nearby range, or drops it. Change Cook mode to reveal fish filter, burnt policy, and (for bank-raw-then-cook) the N quantity. Optional Buy/repair buys missing gear from the nearest fishing shop (Harry at Catherby, Gerrant for feathers/fly rod) and can buy bait/feathers up to Bait qty.',
    category: 'Fishing',
    tags: ['gathering', 'drop', 'banking', 'cooking'],
    settingsSchema: {
        fishMethod: {
            type: 'string',
            default: FISHING_METHOD_OPTIONS[0],
            options: FISHING_METHOD_OPTIONS,
            label: 'Fishing method',
            help:
                'What to fish — picks the right spot (each spot offers a PAIR of ops) and the correct op of the two, e.g. small net (shrimp) vs big net (mackerel).'
        },
        baitQty: {
            type: 'number',
            default: 1000,
            min: 1,
            label: 'Bait / feathers qty',
            group: 'Tools',
            showIf: {
                key: 'fishMethod',
                anyOf: [
                    'Bait rod — sardine/herring',
                    'Fly fishing — trout/salmon',
                    'Bait rod — pike',
                    'Oily rod — lava eel'
                ]
            },
            help:
                'Shown when the method needs bait or feathers. Restock withdraws up to this many from the bank; with Buy/repair, buys up to this many from Harry (bait) or Gerrant (feathers) when bank+inv are short. No upper limit. Ignored for cage/net/harpoon methods.'
        },
        leashRadius: {
            type: 'number',
            default: 18,
            min: 2,
            max: 64,
            label: 'Leash radius (tiles)',
            help:
                'How far from the camp/start anchor to prefer fishing spots. Only Location Auto uses this as-is. Named camps and None floor to 64 (Fishing Guild / Catherby piers are huge). The bot still hunts past the leash when spots hop along the pier. Location Auto does not mob-flee (expert / may-die).'
        },
        tickManip: {
            type: 'string',
            default: 'Off',
            options: tickManipUiOptions(FISH_TICK_MANIP_OPTIONS),
            label: 'Tick manip',
            group: 'Tick manip',
            help: TICK_MANIP_UNSHIPPED_HELP
        },
        location: {
            type: 'string',
            default: 'Auto',
            options: FISHING_LOCATION_OPTIONS,
            label: 'Location / full inventory',
            help:
                'Fishing camp + full-pack behaviour. Auto = if you start in the same 64×64 map square as a known camp, snap to the nearest such camp and bank there; otherwise freeform (start-tile leash + nearest bank). Named camps pin pier + bank (and range for Catherby cook). None = power-fish (always drop; cook is disabled).'
        },
        cookMode: {
            type: 'string',
            default: 'Off',
            options: [...COOK_MODE_OPTIONS],
            label: 'Cook mode',
            group: 'Cooking',
            help:
                'More options appear below when you leave Off. Off = bank or drop raw only (see Location). Cook then bank = fish a full pack, cook it, bank cooked — reveals Fish to cook + Burnt fish. Bank raw then cook = fish+bank raw until the bank holds N of the cook filter, then withdraw/cook/bank — also reveals Bank N raw before cook + After cook cycle. Needs a Range near the bank (Catherby preset works well). Cook requires Location not None.'
        },
        cookFish: {
            type: 'string',
            default: 'All raw',
            options: [...COOK_FISH_OPTIONS],
            label: 'Fish to cook',
            group: 'Cooking',
            showIf: { key: 'cookMode', anyOf: ['Cook then bank', 'Bank raw then cook'] },
            help:
                'Shown when Cook mode is on. Which raw fish to cook; other raw species are banked as-is (e.g. cook Swordfish, bank Tuna raw). Choose Custom to reveal a free-text filter.'
        },
        cookFishCustom: {
            type: 'string',
            default: '',
            label: 'Custom cook filter',
            group: 'Cooking',
            showIf: { key: 'cookFish', anyOf: ['Custom'] },
            help:
                'Shown when Fish to cook is Custom. Contains-match against raw names, e.g. "swordfish" or "Raw tuna". Empty = all raw.'
        },
        burntPolicy: {
            type: 'string',
            default: 'Drop',
            options: [...BURNT_POLICY_OPTIONS],
            label: 'Burnt fish',
            group: 'Cooking',
            showIf: { key: 'cookMode', anyOf: ['Cook then bank', 'Bank raw then cook'] },
            help: 'Shown when Cook mode is on. Drop (default) or bank burnt fish after cooking.'
        },
        bankRawBeforeCook: {
            type: 'number',
            default: 56,
            min: 1,
            label: 'Bank N raw before cook',
            group: 'Cooking',
            showIf: { key: 'cookMode', anyOf: ['Bank raw then cook'] },
            help:
                'Shown only for Bank raw then cook. Live bank total of the cook-filter raw (after each deposit). When the bank holds ≥ N, withdraw a load and cook. Type any amount (no artificial max).'
        },
        afterCookCycle: {
            type: 'string',
            default: 'Stop',
            options: [...AFTER_COOK_OPTIONS],
            label: 'After cook cycle',
            group: 'Cooking',
            showIf: { key: 'cookMode', anyOf: ['Bank raw then cook'] },
            help:
                'Shown only for Bank raw then cook. Stop = end the script after one cook cycle of the accumulated batch. Continue = keep fishing/banking/cooking in increments of N.'
        },
        muleMode: GATHERING_SETTINGS.muleMode,
        mulePartner: GATHERING_SETTINGS.mulePartner,
        toolAcquire: TOOL_ACQUIRE_SETTING,
        forgetfulBank: FORGETFUL_BANK_SETTING
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
    name: 'DartFletcher',
    description: 'Spam-attaches feathers to stackable dart tips at the five-action-per-tick server ceiling; runs anywhere until either input stack is empty',
    category: 'Fletching',
    tags: ['fletching', 'darts', 'members', 'fast'],
    settingsSchema: DART_FLETCHER_SETTINGS,
    create: () => new DartFletcher()
});

ScriptRegistry.register({
    name: 'RoguesPurse',
    description: 'Infinite Herblore grind at the fungus-covered cavern wall under the Karamja jungle — searches, identifies, and drops Rogues purse on the tick. Walks itself there; needs Herblore 3 and Jungle Potion past the point where Trufitus asks for the purse',
    category: 'Herblore',
    tags: ['herblore', 'karamja', 'members', 'afk'],
    create: () => new RoguesPurse()
});

ScriptRegistry.register({
    name: 'BoneBurier',
    description: 'Bank-standing Prayer trainer — withdraws full loads of an exact bone name and buries them until the bank is empty',
    category: 'Prayer',
    tags: ['prayer', 'bones', 'banking', 'afk'],
    settingsSchema: BONE_BURIER_SETTINGS,
    create: () => new BoneBurier()
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
    description: 'Travels to and runs the Gnome Stronghold agility course',
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
    name: 'EdgevilleMonkeyBars',
    description: 'Edgeville dungeon monkey bars — restock via dungeon ladder or after death. NOT RECOMMENDED FOR 10HP ACCOUNTS.',
    category: 'Agility',
    tags: ['edgeville', 'dungeon', 'monkey-bars', 'wilderness', 'banking'],
    settingsSchema: EDGEVILLE_MONKEYBARS_SETTINGS,
    create: () => new EdgevilleMonkeyBars()
});

ScriptRegistry.register({
    name: 'MuleCrafter',
    description: 'Crafter + mule runecrafting loop — both run bank→ruins→bank each cycle. Crafter has the talisman, crafts at the altar, trades runes for essence at the ruins. Mule ferries essence to the ruins and runes back to the bank. Dry mule signals at the bank and the crafter shares 1/N essence. Multi-mule round-robin with comma-separated partner names.',
    category: 'Runecrafting',
    tags: ['runecrafting', 'trade', 'crafter', 'mule', 'falador', 'edgeville'],
    settingsSchema: MULECRAFTER_SETTINGS,
    create: () => new MuleCrafter()
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
    description: 'World shop-run supply loop — cycles shop clusters buying Herblore supplies, feathers, runes, and arrows/arrowtips, banking between clusters with capped gp withdrawals; skips shops until stock regenerates',
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

ScriptRegistry.register({
    name: 'TannerBot',
    description: 'Al Kharid tanning loop — banks hides, tans the whole load in one click at the Tanner, and every Nth trip keeps a slot free to buy out Dommik\'s thread',
    category: 'Crafting',
    tags: ['alkharid', 'leather', 'dragonhide', 'banking', 'afk'],
    settingsSchema: TANNER_SETTINGS,
    create: () => new TannerBot()
});

ScriptRegistry.register({
    name: 'VialFiller',
    description: 'Falador vial-filling loop — banks empty vials, fills them one by one at the fountain, and can restock from Jatix in Taverley every Nth trip',
    category: 'Herblore',
    tags: ['falador', 'vials', 'water', 'banking', 'afk'],
    settingsSchema: VIAL_FILLER_SETTINGS,
    create: () => new VialFiller()
});

ScriptRegistry.register({
    name: 'LeatherCrafter',
    description: 'Needle-and-thread crafting loop — banks for leather and makes the best item your Crafting level allows for it',
    category: 'Crafting',
    tags: ['crafting', 'leather', 'dragonhide', 'banking', 'afk'],
    settingsSchema: CRAFTER_SETTINGS,
    create: () => new LeatherCrafter()
});

ScriptRegistry.register({
    name: 'Firemaker',
    description: 'Banks logs and burns them along the longest clear lane next to the bank — Varrock east/west, Draynor or Seers',
    category: 'Firemaking',
    tags: ['firemaking', 'banking', 'varrock', 'draynor', 'seers', 'afk'],
    settingsSchema: FIREMAKER_SETTINGS,
    create: () => new Firemaker()
});

ScriptRegistry.register({
    name: 'FlaxRunner',
    description: 'Two-player cooperative flax picking and spinning — Runner picks flax and delivers to Spinner; Spinner spins flax into bow strings and banks them',
    category: 'Crafting',
    tags: ['crafting', 'fletching', 'flax', 'bow-strings', 'trade', 'two-player', 'afk'],
    settingsSchema: FLAXRUNNER_SETTINGS,
    create: () => new FlaxRunner()
});
