import { describe, expect, test } from 'bun:test';
import { DRAGON_SITES, GUTANOTH_BLUE, enclaveTargets, huntNames, needsShield, standFor } from '#/bot/scripts/JiveDragons/sites.js';

describe('enclaveTargets', () => {
    test('dragon-only mode excludes greater demons', () => {
        const site = enclaveTargets(GUTANOTH_BLUE, 'dragons');
        expect(huntNames(site)).toEqual(['Blue dragon']);
        expect(site.bones).toBe('Dragon bones');
        expect(site.alsoHunt).toBeUndefined();
    });

    test('demon-only mode excludes blue dragons and uses ashes', () => {
        const site = enclaveTargets(GUTANOTH_BLUE, 'demons');
        expect(huntNames(site)).toEqual(['Greater demon']);
        expect(site.bones).toBe('Ashes');
        expect(site.alsoHunt).toBeUndefined();
    });

    test('both mode restores dragons first and greater demons as filler', () => {
        const demons = enclaveTargets(GUTANOTH_BLUE, 'demons');
        const site = enclaveTargets(demons, 'both');
        expect(huntNames(site)).toEqual(['Blue dragon', 'Greater demon']);
        expect(site.bones).toBe('Dragon bones');
    });

    test('missing and unknown saved modes preserve both targets', () => {
        for (const mode of [undefined, '', 'unknown']) {
            expect(huntNames(enclaveTargets(GUTANOTH_BLUE, mode))).toEqual(['Blue dragon', 'Greater demon']);
        }
    });

    test('changing mode does not change another run or the shared site', () => {
        const demons = enclaveTargets(GUTANOTH_BLUE, 'demons');
        const dragons = enclaveTargets(demons, 'dragons');
        expect(huntNames(GUTANOTH_BLUE)).toEqual(['Blue dragon', 'Greater demon']);
        expect(huntNames(demons)).toEqual(['Greater demon']);
        expect(huntNames(dragons)).toEqual(['Blue dragon']);
    });

    test('preserves the selected stand, transport, loot setting and shield behavior', () => {
        const stand = standFor(GUTANOTH_BLUE, 3);
        const source = { ...GUTANOTH_BLUE, safespots: stand.tiles, meleeAnchor: stand.anchor };
        for (const mode of ['dragons', 'demons', 'both']) {
            const site = enclaveTargets(source, mode);
            const { target: _target, bones: _bones, alsoHunt: _alsoHunt, ...rest } = site;
            const { target: _sourceTarget, bones: _sourceBones, alsoHunt: _sourceAlsoHunt, ...original } = source;
            expect(rest).toEqual(original);
            expect(needsShield(site, 'melee')).toBe(true);
            expect(needsShield(site, 'mage')).toBe(false);
            expect(needsShield(site, 'range')).toBe(false);
        }
    });

    test('does not apply Enclave targets to another site', () => {
        for (const site of Object.values(DRAGON_SITES).filter(site => site.key !== 'gutanoth-blue')) {
            for (const mode of ['dragons', 'demons', 'both']) {
                expect(enclaveTargets(site, mode)).toBe(site);
            }
        }
    });
});
