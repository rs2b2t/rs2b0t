import type { NavPoint } from '../PathFinder.js';

/**
 * Tiles bots web-walk to (bank stands, skill-station stands, quest stands).
 * The coverage harness (tools/nav/coverage.ts) checks each is walkable AND
 * connected to the main graph, so a sealed-nook config (a tile a bot can't
 * actually reach by walking) is caught. Hand-maintained: when a bot adds a
 * nav-target constant, add it here. `expected:'island'` marks a KNOWN,
 * runtime-handled island so the gate fails only on NEW offenders.
 */
export interface NavTarget {
    bot: string;
    label: string;
    tile: NavPoint;
    expected?: 'island';
}

export const NAV_TARGETS: NavTarget[] = [
    // NOTE: this entry starts at the KNOWN-BAD nook tile so the harness proves it
    // catches it (Task 2 run FAILs here); Task 3 repoints it to (3251,3420).
    { bot: 'EssMiner', label: 'Varrock East bank stand', tile: { x: 3253, z: 3418, level: 0 } },
    { bot: 'ArdyThiever/ArdyFighter', label: 'Ardougne south bank stand', tile: { x: 2655, z: 3286, level: 0 } },
    { bot: 'ArdyFighter', label: "Baker's stall stand", tile: { x: 2668, z: 3312, level: 0 } },
    { bot: 'CookBot', label: 'Catherby bank stand', tile: { x: 2809, z: 3441, level: 0 } },
    { bot: 'CookBot', label: 'Catherby range stand', tile: { x: 2817, z: 3443, level: 0 } },
    { bot: 'SmelterBot', label: 'Al Kharid furnace stand', tile: { x: 3275, z: 3185, level: 0 } },
    { bot: 'SmithingBot', label: 'Varrock West anvil stand', tile: { x: 3188, z: 3425, level: 0 } },
    { bot: 'BankFletcher', label: 'Varrock West bank stand', tile: { x: 3185, z: 3440, level: 0 } },
    { bot: 'FlaxSpinner', label: 'Seers bank stand', tile: { x: 2722, z: 3493, level: 0 } },
    { bot: 'FlaxPicker', label: 'Seers bank stand', tile: { x: 2725, z: 3493, level: 0 } },
    { bot: 'ChaosDruidKiller', label: 'Edgeville bank stand', tile: { x: 3094, z: 3491, level: 0 } },
    { bot: 'ChaosDruidKiller', label: 'trapdoor stand', tile: { x: 3096, z: 3468, level: 0 } },
    { bot: 'RockCrab', label: 'Rellekka area', tile: { x: 2586, z: 3420, level: 0 } },
    { bot: 'RuneMysteries', label: 'wizard-tower surface ladder stand', tile: { x: 3105, z: 3162, level: 0 } },
    // KNOWN island: the wizard-tower BASEMENT ladder landing is a separate
    // underground region reached via the ladder transport; RuneMysteries handles
    // the trapped-landing at runtime (climb-up re-roll). Expected, not a defect.
    { bot: 'RuneMysteries', label: 'wizard-tower basement ladder landing', tile: { x: 3104, z: 9576, level: 0 }, expected: 'island' }
];
