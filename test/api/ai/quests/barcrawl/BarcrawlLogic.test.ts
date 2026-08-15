import { describe, expect, test } from 'bun:test';

import Tile from '#/bot/geometry/Tile.js';
import { BARCRAWL_GP, BARS, nextBar, parseCard } from '#/bot/api/ai/quests/barcrawl/BarcrawlLogic.js';

/** Verbatim from scroll.rs2's `scroll_barcrawl_card`. */
function card(done: readonly string[]): string[] {
    const label: Record<string, string> = {
        bluemoon: 'BlueMoon Inn',
        blurberry: "Blurberry's Bar",
        deadman: "Dead Man's Chest",
        dragoninn: 'Dragon Inn',
        flyinghorse: 'Flying Horse Inn',
        forestersarms: 'Foresters Arms',
        jollyboar: 'Jolly Boar Inn',
        karamjaspirits: 'Karamja Spirits Bar',
        risingsun: 'Rising Sun Inn',
        rustyanchor: 'Rusty Anchor Inn'
    };
    return [
        '@blu@The Official Alfred Grimhand Barcrawl!',
        ...Object.entries(label).map(([key, name]) =>
            done.includes(key) ? `@gre@${name} - Completed!` : `@red@${name} - Not Completed...`)
    ];
}

describe('barcrawl card', () => {
    test('an untouched card leaves every bar outstanding', () => {
        const progress = parseCard(card([]));
        expect(progress?.remaining.length).toBe(BARS.length);
        expect(progress?.done).toBe(false);
    });

    test('a fully signed card is done', () => {
        const progress = parseCard(card(Object.keys({
            bluemoon: 0, blurberry: 0, deadman: 0, dragoninn: 0, flyinghorse: 0,
            forestersarms: 0, jollyboar: 0, karamjaspirits: 0, risingsun: 0, rustyanchor: 0
        })));
        expect(progress?.done).toBe(true);
        expect(progress?.remaining).toEqual([]);
    });

    test('signed bars drop out one at a time', () => {
        // "Completed!" is a substring of "Not Completed...", so a naive match
        // reads every red line as green and the tour stops after one bar.
        const progress = parseCard(card(['jollyboar', 'risingsun']));
        expect(progress?.remaining.map(b => b.line)).not.toContain('jolly boar');
        expect(progress?.remaining.map(b => b.line)).not.toContain('rising sun');
        expect(progress?.remaining.length).toBe(BARS.length - 2);
    });

    test('a page that is not the card reads as nothing', () => {
        expect(parseCard(['@dbl@Some other scroll.'])).toBeNull();
    });
});

describe('barcrawl tour order', () => {
    test('heads for the nearest outstanding bar', () => {
        expect(nextBar(BARS, new Tile(3213, 3424, 0))?.line).toBe('bluemoon');
    });

    test('falls back to list order when the tile is unknown', () => {
        expect(nextBar(BARS, null)?.line).toBe(BARS[0]!.line);
    });

    test('never picks a bar that is already signed', () => {
        const outstanding = BARS.filter(b => b.line !== 'bluemoon');
        expect(nextBar(outstanding, new Tile(3213, 3424, 0))?.line).not.toBe('bluemoon');
    });

    test('the coin float covers every drink with slack', () => {
        expect(BARCRAWL_GP).toBeGreaterThan(BARS.reduce((sum, b) => sum + b.gp, 0));
    });
});
