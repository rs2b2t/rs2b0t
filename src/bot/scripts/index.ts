import { AGILITY_SETTINGS } from './AgilityBot.js';
import { GATHERING_SETTINGS } from './GatheringBot.js';
import { LOCATION_OPTIONS } from './FishingLocations.js';
import { FISHING_METHOD_OPTIONS } from './FishingMethods.js';
import { ROCK_OPTIONS } from './MiningRocks.js';
import { PROCESSING_SETTINGS } from './ProcessingBot.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import AgilityBot from './AgilityBot.js';
import ArdyFighter, { SETTINGS as ARDY_SETTINGS } from './ArdyFighter.js';
import ArdyThiever, { SETTINGS as ARDYTHIEVER_SETTINGS } from './ArdyThiever.js';
import ChaosDruidKiller, { SETTINGS as CHAOSDRUID_SETTINGS } from './ChaosDruidKiller.js';
import ChickenKiller, { SETTINGS as CHICKEN_SETTINGS } from './ChickenKiller.js';
import CookBot, { SETTINGS as COOKBOT_SETTINGS } from './CookBot.js';
import CooksAssistant from './CooksAssistant.js';
import GatheringBot from './GatheringBot.js';
import ProcessingBot from './ProcessingBot.js';
import QuestDashboard from '../quests/QuestDashboard.js';
import RockCrab, { SETTINGS as ROCKCRAB_SETTINGS } from './RockCrab.js';
import ThievingBot, { SETTINGS as THIEVING_SETTINGS } from './ThievingBot.js';
import TutorialBot from './TutorialBot.js';
import WalkToBot, { WALKTO_SETTINGS } from './WalkToBot.js';
import WildyAgility, { WILDY_AGILITY_SETTINGS } from './WildyAgility.js';
import Woodcutter, { SETTINGS as WOODCUTTER_SETTINGS } from './Woodcutter.js';
import type { SettingsSchema } from '../runtime/Settings.js';

// --- tutorial ---
ScriptRegistry.register({
    name: 'TutorialBot',
    description: 'Completes Tutorial Island unassisted (no cheats)',
    category: 'Tutorial',
    tags: ['tutorial', 'onboarding'],
    create: () => new TutorialBot()
});

// --- quest ---
ScriptRegistry.register({
    name: 'CooksAssistant',
    description: "Works the Cook's Assistant quest around Lumbridge — starts it, then gathers egg/milk/grain",
    category: 'Quest',
    tags: ['f2p', 'quest', 'lumbridge', 'newbie'],
    create: () => new CooksAssistant()
});

ScriptRegistry.register({
    name: 'QuestDashboard',
    description: 'Reports DONE/READY/BLOCKED eligibility for all quests',
    category: 'Quest',
    tags: ['quests', 'overlay', 'dashboard'],
    create: () => new QuestDashboard()
});

// --- combat ---
ScriptRegistry.register({
    name: 'ChickenKiller',
    description: 'Kills chickens, loots and buries bones (anchor = start tile)',
    category: 'Combat',
    tags: ['f2p', 'lumbridge', 'bones', 'feathers', 'afk'],
    settingsSchema: CHICKEN_SETTINGS,
    create: () => new ChickenKiller()
});

/** Build a ChickenKiller-based combat preset: CHICKEN_SETTINGS with overridden defaults. */
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
    tags: ['f2p', 'lumbridge', 'cowhide', 'bones', 'afk'],
    // 274 content: [cow] name=Cow; the hide drop is obj [cow_hide] name="Cow hide"
    // (confirmed in content/scripts/skill_crafting/configs/crafting.obj -- NOT
    // the one-word "Cowhide" the plan guessed).
    settingsSchema: chickenPreset({ targetName: 'Cow', lootMatch: 'cow hide|bones', buryBones: false, gatherFeathers: false }),
    create: () => new ChickenKiller()
});

ScriptRegistry.register({
    name: 'ChaosDruidKiller',
    description: 'Kills Chaos druids in the Edgeville dungeon, loots herbs/law runes, banks them',
    category: 'Combat',
    tags: ['members', 'wilderness', 'edgeville', 'herbs', 'banking'],
    settingsSchema: CHAOSDRUID_SETTINGS,
    create: () => new ChaosDruidKiller()
});

ScriptRegistry.register({
    name: 'RockCrab',
    description: 'Rellekka rock crabs: aggro-stack-kill-reset, loots key halves',
    category: 'Combat',
    tags: ['members', 'rellekka', 'keys', 'afk'],
    settingsSchema: ROCKCRAB_SETTINGS,
    create: () => new RockCrab()
});

ScriptRegistry.register({
    name: 'ArdyFighter',
    description: 'Fights East Ardougne market guards, feeds itself from the Baker\'s stall, loots rares, banks them at the south bank (needs melee stats that beat the 60s guard respawn — ~str 80 unarmed)',
    category: 'Combat',
    tags: ['members', 'ardougne', 'thieving', 'banking', 'afk'],
    settingsSchema: ARDY_SETTINGS,
    create: () => new ArdyFighter()
});

// --- thieving ---
ScriptRegistry.register({
    name: 'Thiever',
    description: 'Pickpockets an NPC (Man by default); eats food when a failed steal hurts (anchor = start tile)',
    category: 'Thieving',
    tags: ['f2p', 'pickpocket', 'coins'],
    settingsSchema: THIEVING_SETTINGS,
    create: () => new ThievingBot()
});

ScriptRegistry.register({
    name: 'ArdyThiever',
    description: 'Low-level East Ardougne pickpocket bot — steals cake for food, pickpockets Guard/Knight/Hero, flees all combat, banks loot + junk, grabs ground coins',
    category: 'Thieving',
    tags: ['members', 'ardougne', 'thieving', 'banking', 'afk'],
    settingsSchema: ARDYTHIEVER_SETTINGS,
    create: () => new ArdyThiever()
});

// --- woodcutting ---
ScriptRegistry.register({
    name: 'Woodcutter',
    description: 'Chops trees and drops logs (anchor = start tile, needs an axe)',
    category: 'Woodcutting',
    tags: ['f2p', 'gathering', 'drop'],
    settingsSchema: WOODCUTTER_SETTINGS,
    create: () => new Woodcutter()
});

// --- gathering presets (all GatheringBot, varied by settings defaults) ---

ScriptRegistry.register({
    name: 'Miner',
    description: 'Mines the selected rock types and banks the ore at the nearest bank (auto-detected), or drops it. Needs a pickaxe.',
    category: 'Mining',
    tags: ['f2p', 'gathering', 'banking', 'drop'],
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
    name: 'Fisher',
    description: 'Fishes a chosen method at the spot that offers it (each spot has a pair of ops); banks the catch at the nearest bank, or drops it (location: None)',
    category: 'Fishing',
    tags: ['f2p', 'gathering', 'drop', 'banking'],
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

// --- processing presets (all ProcessingBot, varied by settings defaults) ---

/** Build a processing preset: PROCESSING_SETTINGS with overridden defaults. */
function processing(overrides: Record<string, unknown>): SettingsSchema {
    const schema: SettingsSchema = {};
    for (const [key, def] of Object.entries(PROCESSING_SETTINGS)) {
        schema[key] = key in overrides ? { ...def, default: overrides[key] } : def;
    }
    return schema;
}

ScriptRegistry.register({
    name: 'CookBot',
    description: 'Catherby cook loop — withdraw raw fish, cross to the range, cook it all one at a time, bank everything, repeat',
    category: 'Cooking',
    tags: ['catherby', 'cooking', 'banking', 'afk'],
    settingsSchema: COOKBOT_SETTINGS,
    create: () => new CookBot()
});

ScriptRegistry.register({
    name: 'Fletcher',
    description: 'Knife-fletches logs into the chosen product (needs a knife + logs)',
    category: 'Fletching',
    tags: ['f2p', 'processing', 'make-x'],
    settingsSchema: processing({ material: 'Logs', targetType: 'item', target: 'Knife', product: 'arrow shaft', leashRadius: 4 }),
    create: () => new ProcessingBot()
});

// NOTE: Smithing is intentionally not registered yet — use-bar-on-anvil opens
// the dedicated `smithing` interface (inv-transmit item columns), not the
// skill-multi chat menu ProcessingBot drives. It needs a bespoke handler.

ScriptRegistry.register({
    name: 'Herbalist',
    description: 'Identifies unidentified herbs in the inventory (Herblore, no tools)',
    category: 'Herblore',
    tags: ['processing', 'identify'],
    settingsSchema: processing({ material: 'Herb', targetType: 'self', target: 'Identify', product: '', leashRadius: 4 }),
    create: () => new ProcessingBot()
});

ScriptRegistry.register({
    name: 'Runecrafter',
    description: 'Crafts runes from essence at an altar (needs rune essence + the altar)',
    category: 'Runecrafting',
    tags: ['f2p', 'processing'],
    settingsSchema: processing({ material: 'essence', targetType: 'loc', target: 'Altar', product: '', leashRadius: 8 }),
    create: () => new ProcessingBot()
});

// --- agility ---
ScriptRegistry.register({
    name: 'GnomeCourse',
    description: 'Runs the Gnome Stronghold agility course (start at the log balance)',
    category: 'Agility',
    tags: ['members', 'course', 'gnome'],
    settingsSchema: AGILITY_SETTINGS,
    create: () => new AgilityBot()
});

ScriptRegistry.register({
    name: 'WildyAgility',
    description: 'Runs the Wilderness Agility Course, eats while running, and on death banks (food-only) then returns — needs Agility 52 + carried food (start at the entrance)',
    category: 'Agility',
    tags: ['members', 'course', 'wilderness', 'food', 'death-recovery'],
    settingsSchema: WILDY_AGILITY_SETTINGS,
    create: () => new WildyAgility()
});

// --- navigation ---
ScriptRegistry.register({
    name: 'WalkTo',
    description: 'Walks to a chosen destination and stops — Lumbridge, Varrock, Falador, Ardougne, Rellekka, Taverley (centre); Draynor, Al Kharid, Edgeville, Seers, Yanille (bank); or a custom tile',
    category: 'Navigation',
    tags: ['navigation', 'utility', 'web-walk'],
    settingsSchema: WALKTO_SETTINGS,
    create: () => new WalkToBot()
});
