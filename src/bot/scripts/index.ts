import { AGILITY_SETTINGS } from './AgilityBot.js';
import { GATHERING_SETTINGS } from './GatheringBot.js';
import { LOCATION_OPTIONS } from './FishingLocations.js';
import { PROCESSING_SETTINGS } from './ProcessingBot.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import AgilityBot from './AgilityBot.js';
import ChaosDruidKiller, { SETTINGS as CHAOSDRUID_SETTINGS } from './ChaosDruidKiller.js';
import ChickenKiller, { SETTINGS as CHICKEN_SETTINGS } from './ChickenKiller.js';
import CooksAssistant from './CooksAssistant.js';
import CrashTestBot from './CrashTestBot.js';
import DebugBot from './DebugBot.js';
import GatheringBot from './GatheringBot.js';
import IronBanker, { SETTINGS as IRONBANKER_SETTINGS } from './IronBanker.js';
import LifeBot, { SETTINGS as LIFE_SETTINGS } from './LifeBot.js';
import NavDemo from './NavDemo.js';
import ProcessingBot from './ProcessingBot.js';
import QuestDashboard from '../quests/QuestDashboard.js';
import RockCrab, { SETTINGS as ROCKCRAB_SETTINGS } from './RockCrab.js';
import ThievingBot, { SETTINGS as THIEVING_SETTINGS } from './ThievingBot.js';
import TutorialBot from './TutorialBot.js';
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

// --- life (roams the world, switches activities, chats) ---
ScriptRegistry.register({
    name: 'LifeBot',
    description: 'Roams Lumbridge doing varied things (mine, fight chickens/cows, loiter) and chats — a believable person rather than a farmer',
    category: 'Life',
    tags: ['roaming', 'human', 'social', 'varied'],
    settingsSchema: LIFE_SETTINGS,
    create: () => new LifeBot()
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

// --- thieving ---
ScriptRegistry.register({
    name: 'Thiever',
    description: 'Pickpockets an NPC (Man by default); eats food when a failed steal hurts (anchor = start tile)',
    category: 'Thieving',
    tags: ['f2p', 'pickpocket', 'coins'],
    settingsSchema: THIEVING_SETTINGS,
    create: () => new ThievingBot()
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

/** Build a gathering preset: GATHERING_SETTINGS with overridden defaults. */
function gathering(overrides: Record<string, unknown>): SettingsSchema {
    const schema: SettingsSchema = {};
    for (const [key, def] of Object.entries(GATHERING_SETTINGS)) {
        schema[key] = key in overrides ? { ...def, default: overrides[key] } : def;
    }
    return schema;
}

ScriptRegistry.register({
    name: 'Miner',
    description: 'Mines rocks and drops the ore (anchor = start tile, needs a pickaxe)',
    category: 'Mining',
    tags: ['f2p', 'gathering', 'drop'],
    settingsSchema: gathering({ targetType: 'loc', target: 'Rocks', action: 'Mine', dropMatch: 'ore', leashRadius: 8 }),
    create: () => new GatheringBot()
});

// The banking half of a mining→banking pair: run `Miner` at an iron mine and
// `IronBanker` alongside it (set IronBanker.bankTile to a booth-adjacent tile).
// No IPC — the miner's dropped ore is the shared signal.
ScriptRegistry.register({
    name: 'IronBanker',
    description: 'Sweeps ore a nearby Miner bot drops and shuttles it to a bank (set bankTile; pairs with Miner)',
    category: 'Mining',
    tags: ['f2p', 'banking', 'coordination'],
    settingsSchema: IRONBANKER_SETTINGS,
    create: () => new IronBanker()
});

ScriptRegistry.register({
    name: 'Fisher',
    description: 'Net/bait-fishes a spot; banks the catch at a known location (Draynor etc.), else drops it',
    category: 'Fishing',
    tags: ['f2p', 'gathering', 'drop', 'banking'],
    settingsSchema: {
        ...gathering({ targetType: 'npc', target: 'Fishing spot', action: 'Net', dropMatch: 'raw', leashRadius: 12 }),
        location: {
            type: 'string',
            default: 'Auto',
            options: LOCATION_OPTIONS,
            label: 'Fishing location',
            help: 'Auto = bank the catch when started at a known fishing location; None = always drop (power-fishing)'
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
    name: 'Cook',
    description: 'Cooks raw food on a nearby range or fire (anchor = start tile)',
    category: 'Cooking',
    tags: ['f2p', 'processing'],
    settingsSchema: processing({ material: 'Raw', targetType: 'loc', target: 'Range', product: '', leashRadius: 8 }),
    create: () => new ProcessingBot()
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

// --- navigation / develop ---
ScriptRegistry.register({
    name: 'NavDemo',
    description: 'Web-walks Lumbridge -> castle stairs -> chicken pen -> Varrock -> Falador',
    category: 'Navigation',
    tags: ['demo', 'web-walk'],
    create: () => new NavDemo()
});

ScriptRegistry.register({
    name: 'DebugBot',
    description: 'Logs nearest NPCs each tick and paints an overlay box',
    category: 'Develop',
    tags: ['debug', 'overlay'],
    create: () => new DebugBot()
});

ScriptRegistry.register({
    name: 'CrashTestBot',
    description: 'Throws on iteration 3 to demonstrate crash isolation',
    category: 'Develop',
    tags: ['test'],
    create: () => new CrashTestBot()
});
