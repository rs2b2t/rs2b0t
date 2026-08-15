import { describe, expect, test } from 'bun:test';
import { contributionOf, findCrossDirImports } from '../../tools/audit-script-dirs.js';

describe('contributionOf', () => {
    test('names the directory directly under scripts/', () => {
        expect(contributionOf('src/bot/scripts/RockCrab/RockCrab.ts')).toBe('RockCrab');
    });

    test('reaches through a nested directory', () => {
        expect(contributionOf('src/bot/scripts/GatheringBot/tasks/Fish.ts')).toBe('GatheringBot');
    });

    test('returns null for the registry barrel', () => {
        expect(contributionOf('src/bot/scripts/index.ts')).toBeNull();
    });
});

describe('findCrossDirImports', () => {
    test('flags an import of a sibling contribution', () => {
        const sources = new Map([
            ['src/bot/scripts/MossGiant/MossGiant.ts', "import { x } from '../RockCrab/RockCrabRangeLogic.js';"]
        ]);
        expect(findCrossDirImports(sources)).toEqual([
            'src/bot/scripts/MossGiant/MossGiant.ts\t../RockCrab/RockCrabRangeLogic.js'
        ]);
    });

    test('flags a sibling reached from a nested file', () => {
        const sources = new Map([
            ['src/bot/scripts/GatheringBot/tasks/Fish.ts', "import { x } from '../../RockCrab/RockCrabSpots.js';"]
        ]);
        expect(findCrossDirImports(sources)).toEqual([
            'src/bot/scripts/GatheringBot/tasks/Fish.ts\t../../RockCrab/RockCrabSpots.js'
        ]);
    });

    test('allows a same-contribution sibling', () => {
        const sources = new Map([['src/bot/scripts/RockCrab/RockCrab.ts', "import { x } from './RockCrabSpots.js';"]]);
        expect(findCrossDirImports(sources)).toEqual([]);
    });

    test('allows a nested file reaching its own contribution root', () => {
        const sources = new Map([['src/bot/scripts/GatheringBot/tasks/Fish.ts', "import { x } from '../GatheringBotLogic.js';"]]);
        expect(findCrossDirImports(sources)).toEqual([]);
    });

    test('allows reaching out of scripts/ entirely', () => {
        const sources = new Map([['src/bot/scripts/RockCrab/RockCrab.ts', "import { food } from '../../api/combat/food.js';"]]);
        expect(findCrossDirImports(sources)).toEqual([]);
    });

    test('exempts the registry barrel, which names every bot', () => {
        const sources = new Map([
            [
                'src/bot/scripts/index.ts',
                "import RockCrab from './RockCrab/RockCrab.js';\nimport MossGiant from './MossGiant/MossGiant.js';"
            ]
        ]);
        expect(findCrossDirImports(sources)).toEqual([]);
    });

    test('catches a dynamic import', () => {
        const sources = new Map([
            ['src/bot/scripts/MossGiant/MossGiant.ts', "const m = await import('../RockCrab/RockCrabSpots.js');"]
        ]);
        expect(findCrossDirImports(sources)).toEqual([
            'src/bot/scripts/MossGiant/MossGiant.ts\t../RockCrab/RockCrabSpots.js'
        ]);
    });

    test('reports every offender, sorted', () => {
        const sources = new Map([
            ['src/bot/scripts/MossGiant/MossGiant.ts', "import { a } from '../RockCrab/A.js';"],
            ['src/bot/scripts/CowKiller/CowKiller.ts', "import { b } from '../ArdyFighter/B.js';"]
        ]);
        expect(findCrossDirImports(sources)).toEqual([
            'src/bot/scripts/CowKiller/CowKiller.ts\t../ArdyFighter/B.js',
            'src/bot/scripts/MossGiant/MossGiant.ts\t../RockCrab/A.js'
        ]);
    });
});
