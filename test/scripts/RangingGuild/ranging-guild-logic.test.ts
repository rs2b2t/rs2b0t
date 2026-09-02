import { describe, expect, test } from 'bun:test';
import {
    ARROW_RESTOCK_FEE,
    BOWS,
    ENTRY_FEE,
    JUDGE_PREFS,
    JUDGE_SPAWN,
    STAND,
    TARGETS,
    TICKETS_PER_RUNE_ARROWS,
    bestBow,
    classifyShot,
    decide,
    hitLabel,
    hitPoints,
    isBow,
    pickOption,
    roundPhase,
    ticketsForScore,
    type WorldView
} from '#/bot/scripts/RangingGuild/RangingGuildLogic.js';

const idle: WorldView = {
    targetCount: 0,
    tickets: 0,
    coins: 1000,
    bowWorn: true,
    bowHeld: false,
    bronzeWorn: 0,
    bronzeHeld: 0
};

describe('roundPhase', () => {
    test('0 is idle', () => expect(roundPhase(0)).toBe('idle'));
    test('1 through 10 are shooting', () => {
        expect(roundPhase(1)).toBe('shooting');
        expect(roundPhase(10)).toBe('shooting');
    });
    test('11 is finished', () => expect(roundPhase(11)).toBe('finished'));
    test('anything else reads as idle', () => expect(roundPhase(99)).toBe('idle'));
});

describe('decide', () => {
    test('enters a round when idle with the fee', () => {
        expect(decide(idle).kind).toBe('enter');
    });
    test('banks when idle without the fee', () => {
        expect(decide({ ...idle, coins: ENTRY_FEE - 1 }).kind).toBe('bank');
    });
    test('redeems once the tickets cover rune arrows, even mid-round', () => {
        expect(decide({ ...idle, tickets: TICKETS_PER_RUNE_ARROWS, targetCount: 4, bronzeWorn: 6 }).kind).toBe('redeem');
    });
    test('collects the reward before anything else once the round is over', () => {
        expect(decide({ ...idle, targetCount: 11, bowWorn: false, coins: 0 }).kind).toBe('collect');
    });
    test('wields a held bow before shooting', () => {
        expect(decide({ ...idle, bowWorn: false, bowHeld: true, targetCount: 3, bronzeWorn: 7 }).kind).toBe('wield-bow');
    });
    test('banks for a bow when none is held or worn', () => {
        expect(decide({ ...idle, bowWorn: false }).kind).toBe('bank');
    });
    test('shoots while arrows are in the quiver', () => {
        expect(decide({ ...idle, targetCount: 1, bronzeWorn: 10 }).kind).toBe('shoot');
    });
    test('wields arrows that sit in the pack', () => {
        expect(decide({ ...idle, targetCount: 1, bronzeHeld: 10 }).kind).toBe('wield-arrows');
    });
    test('buys more arrows from the judge when the quiver and pack are empty mid-round', () => {
        expect(decide({ ...idle, targetCount: 5, coins: ARROW_RESTOCK_FEE }).kind).toBe('restock-arrows');
    });
    test('banks when arrows are gone mid-round and the restock fee is not held', () => {
        expect(decide({ ...idle, targetCount: 5, coins: ARROW_RESTOCK_FEE - 1 }).kind).toBe('bank');
    });
});

describe('classifyShot', () => {
    test('standing inside five tiles', () => {
        expect(classifyShot(['You should probably be behind the haystack.'])).toBe('too-close');
    });
    test('no bow worn', () => {
        expect(classifyShot(['A bow might help here...'])).toBe('no-bow');
        expect(classifyShot(['You need a bow to take part in the competition.'])).toBe('no-bow');
    });
    test('no bronze arrows in the quiver', () => {
        expect(classifyShot(["You'll be needing those bronze arrows..."])).toBe('no-arrows');
        expect(classifyShot(['I suggest you use the 10 bronze arrows I gave you.'])).toBe('no-arrows');
    });
    test('all ten fired', () => {
        expect(classifyShot(["You've fired all your arrows, maybe you should talk to the Judge."])).toBe('round-over');
    });
    test('not entered', () => {
        expect(classifyShot(['Maybe you should ask before using those.'])).toBe('not-entered');
        expect(classifyShot(['Sorry, you may only use the targets for the competition, not for practicing.'])).toBe('not-entered');
    });
    test('cannot reach', () => {
        expect(classifyShot(["I can't reach that!"])).toBe('unreachable');
    });
    test('the aim line is not a refusal', () => {
        expect(classifyShot(['You carefully aim at the target...'])).toBeNull();
    });
    test('empty window', () => {
        expect(classifyShot([])).toBeNull();
    });
});

describe('hit table', () => {
    test('labels match the content script', () => {
        expect(hitLabel(0)).toBe('Bulls-Eye!');
        expect(hitLabel(1)).toBe('Hit Yellow!');
        expect(hitLabel(3)).toBe('Hit Red!');
        expect(hitLabel(7)).toBe('Hit Blue!');
        expect(hitLabel(10)).toBe('Hit Black!');
        expect(hitLabel(11)).toBe('Missed!');
    });
    test('points match the content script', () => {
        expect(hitPoints(0)).toBe(100);
        expect(hitPoints(1)).toBe(50);
        expect(hitPoints(4)).toBe(30);
        expect(hitPoints(5)).toBe(20);
        expect(hitPoints(9)).toBe(10);
        expect(hitPoints(11)).toBe(0);
    });
    test('a perfect round is 100 tickets and a score rounds down', () => {
        expect(ticketsForScore(1000)).toBe(100);
        expect(ticketsForScore(345)).toBe(34);
        expect(ticketsForScore(0)).toBe(0);
    });
});

describe('pickOption', () => {
    test('takes the entry offer', () => {
        const opts = ["Sure, I'll give it a go.", 'What are the rules?', 'No thanks.'];
        expect(pickOption(opts, JUDGE_PREFS)).toBe(0);
    });
    test('buys arrows when offered mid-round', () => {
        expect(pickOption(["Sure, i'll take some.", 'No thanks.'], JUDGE_PREFS)).toBe(0);
    });
    test('declines the rules reminder', () => {
        expect(pickOption(['Yes please.', "No thanks, I've got it.", 'How am I doing so far?'], JUDGE_PREFS)).toBe(1);
    });
    test('a bare "No thanks." is never the pick', () => {
        expect(pickOption(['No thanks.'], JUDGE_PREFS)).toBe(-1);
    });
    test('matching ignores case', () => {
        expect(pickOption(['SURE, I\'LL GIVE IT A GO.'], JUDGE_PREFS)).toBe(0);
    });
});

describe('bows', () => {
    test('best first, gated on the ranged level', () => {
        expect(bestBow(70, () => true)).toBe('Magic shortbow');
        expect(bestBow(45, () => true)).toBe('Yew shortbow');
        expect(bestBow(40, name => name === 'Shortbow')).toBe('Shortbow');
    });
    test('nothing available is null', () => {
        expect(bestBow(99, () => false)).toBeNull();
    });
    test('isBow matches the category by name, case-insensitive', () => {
        expect(isBow('magic shortbow')).toBe(true);
        expect(isBow('Longbow')).toBe(true);
        expect(isBow('Crossbow')).toBe(false);
        expect(isBow(null)).toBe(false);
    });
    test('every bow is at most level 50 so a guild entrant can wield the top tier soon', () => {
        expect(Math.max(...BOWS.map(b => b.level))).toBeLessThanOrEqual(50);
    });
});

describe('stand geometry', () => {
    const cheb = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    test('every target is outside the five-tile refusal and inside the ten-tile approach range', () => {
        for (const t of TARGETS) {
            const d = cheb(STAND, t);
            expect(d).toBeGreaterThanOrEqual(5);
            expect(d).toBeLessThanOrEqual(10);
        }
    });
    test('the judge stays within five tiles of the stand across his one-tile wander', () => {
        expect(cheb(STAND, JUDGE_SPAWN) + 1).toBeLessThanOrEqual(5);
    });
});
