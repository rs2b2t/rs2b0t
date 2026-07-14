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
    { bot: 'EssMiner', label: 'Varrock East bank stand', tile: { x: 3251, z: 3420, level: 0 } },
    { bot: 'ArdyThiever/ArdyFighter', label: 'Ardougne south bank stand', tile: { x: 2655, z: 3286, level: 0 } },
    { bot: 'ArdyFighter', label: "Baker's stall stand", tile: { x: 2668, z: 3312, level: 0 } },
    { bot: 'CookBot', label: 'Catherby bank stand', tile: { x: 2809, z: 3441, level: 0 } },
    { bot: 'CookBot', label: 'Catherby range stand', tile: { x: 2817, z: 3443, level: 0 } },
    { bot: 'SmelterBot', label: 'Al Kharid furnace stand', tile: { x: 3275, z: 3185, level: 0 } },
    { bot: 'SmelterBot', label: 'Al Kharid bank stand', tile: { x: 3269, z: 3167, level: 0 } },
    { bot: 'SmithingBot', label: 'Varrock West anvil stand', tile: { x: 3188, z: 3425, level: 0 } },
    { bot: 'BankFletcher', label: 'Varrock West bank stand', tile: { x: 3185, z: 3440, level: 0 } },
    { bot: 'FlaxSpinner', label: 'Seers bank stand', tile: { x: 2722, z: 3493, level: 0 } },
    { bot: 'FlaxPicker', label: 'Seers bank stand', tile: { x: 2725, z: 3493, level: 0 } },
    { bot: 'ChaosDruidKiller', label: 'Edgeville bank stand', tile: { x: 3094, z: 3491, level: 0 } },
    { bot: 'ChaosDruidKiller', label: 'trapdoor stand', tile: { x: 3096, z: 3468, level: 0 } },
    { bot: 'Fisher', label: 'Fishing Guild / Rellekka bank stand', tile: { x: 2586, z: 3420, level: 0 } },
    { bot: 'RockCrab', label: 'Rellekka crab field', tile: { x: 2710, z: 3720, level: 0 } },
    { bot: 'RockCrab', label: 'crab reset tile', tile: { x: 2712, z: 3699, level: 0 } },
    { bot: 'RockCrab', label: 'Seers bank stand', tile: { x: 2725, z: 3491, level: 0 } },
    { bot: 'RuneMysteries', label: 'wizard-tower surface ladder stand', tile: { x: 3105, z: 3162, level: 0 } },
    // KNOWN island: the wizard-tower BASEMENT ladder landing is a separate
    // underground region reached via the ladder transport; RuneMysteries handles
    // the trapped-landing at runtime (climb-up re-roll). Expected, not a defect.
    { bot: 'RuneMysteries', label: 'wizard-tower basement ladder landing', tile: { x: 3104, z: 9576, level: 0 }, expected: 'island' },
    { bot: 'ShopRunner', label: 'Aubury shop stand', tile: { x: 3253, z: 3401, level: 0 } },
    { bot: 'ShopRunner', label: "Lowe's archery stand", tile: { x: 3231, z: 3421, level: 0 } },
    { bot: 'ShopRunner', label: "Betty's magic shop stand", tile: { x: 3012, z: 3258, level: 0 } },
    { bot: 'ShopRunner', label: "Gerrant's fishing shop stand", tile: { x: 3013, z: 3224, level: 0 } },
    { bot: 'ShopRunner', label: 'Draynor bank stand', tile: { x: 3092, z: 3243, level: 0 } },
    { bot: 'ShopRunner', label: "Hickton's archery stand", tile: { x: 2821, z: 3442, level: 0 } },
    { bot: 'ShopRunner', label: 'Fishing Guild shop stand', tile: { x: 2596, z: 3399, level: 0 } },
    { bot: 'ShopRunner', label: "Dargaud's bow shop stand", tile: { x: 2678, z: 3440, level: 0 } },
    // ClueSolver: the 16 upstairs (L1/L2) easy-clue answers. Each is reachable
    // ONLY via a baked stair/ladder edge (src/bot/nav/data/stairEdges.json, wired
    // through PathFinder.addEdges' third param) — this block is the acceptance
    // gate for the upstairs-nav fix (docs/superpowers/plans/2026-07-14-clue-solver.md).
    // Tiles are the walkable STAND next to each clue object (the object tile
    // itself — chest/drawers/table — is non-walkable), ≤1 tile off the pinned
    // survey answer, on the answer's level; picked by verified connectivity.
    { bot: 'ClueSolver', label: 'simple001 Lumbridge Castle Duke bedroom', tile: { x: 3209, z: 3219, level: 1 } },
    { bot: 'ClueSolver', label: 'simple002 Lumbridge Castle tower', tile: { x: 3228, z: 3217, level: 1 } },
    { bot: 'ClueSolver', label: 'simple004 Al Kharid Palace', tile: { x: 3301, z: 3168, level: 1 } },
    { bot: 'ClueSolver', label: 'simple011 Varrock East bank upstairs', tile: { x: 3249, z: 3420, level: 1 } },
    { bot: 'ClueSolver', label: 'simple015 Falador house', tile: { x: 2971, z: 3387, level: 1 } },
    { bot: 'ClueSolver', label: 'vague001 Varrock Palace', tile: { x: 3206, z: 3418, level: 1 } },
    { bot: 'ClueSolver', label: 'vague010 Rimmington house', tile: { x: 2970, z: 3215, level: 1 } },
    { bot: 'ClueSolver', label: 'vague011 Port Sarim house', tile: { x: 3015, z: 3205, level: 1 } },
    { bot: 'ClueSolver', label: 'vague013 Falador-area house', tile: { x: 3040, z: 3364, level: 1 } },
    { bot: 'ClueSolver', label: 'vague014 Falador-area house', tile: { x: 3035, z: 3348, level: 1 } },
    { bot: 'ClueSolver', label: 'vague021 Ardougne house', tile: { x: 2657, z: 3323, level: 1 } },
    { bot: 'ClueSolver', label: 'vague023 Catherby house', tile: { x: 2810, z: 3451, level: 1 } },
    { bot: 'ClueSolver', label: 'vague024 Seers flax-house upstairs', tile: { x: 2716, z: 3473, level: 1 } },
    { bot: 'ClueSolver', label: 'vague003 Fishing Guild', tile: { x: 2574, z: 3325, level: 1 } },
    { bot: 'ClueSolver', label: 'simple027 Camelot tower (L2)', tile: { x: 2749, z: 3495, level: 2 } },
    { bot: 'ClueSolver', label: 'vague018 Draynor Manor (L2)', tile: { x: 3106, z: 3368, level: 2 } }
];
