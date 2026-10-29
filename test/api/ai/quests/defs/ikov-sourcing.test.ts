import { expect, test } from 'bun:test';
import { suppliesStep } from '#/bot/api/ai/quests/defs/ikov/supplies.js';
import { IKOV_OBJ } from '#/bot/api/ai/quests/defs/ikov/areas.js';
import { ikov } from '#/bot/api/ai/quests/defs/ikov/index.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

const snapshot = (bow = false): QuestSnapshot => ({
    journal: 'inProgress', inv: new Map(), worn: new Set(), noProgress: 0, bankCoins: 5000,
    bankKnown: true,
    invIds: new Map([[IKOV_OBJ.YEW_LOGS, 1], [IKOV_OBJ.KNIFE, 1], [IKOV_OBJ.BOW_STRING, 1]]),
    bankIds: new Map(bow ? [[IKOV_OBJ.YEW_SHORTBOW, 1]] : [])
});
const wants = { candle: false, bow: true, roots: false };

test('low Fletching reports the missing level instead of retrying the bow menu', () => {
    const step = suppliesStep(snapshot(), wants, 1);
    expect(step?.kind).toBe('wait');
    expect(step?.kind === 'wait' && step.reason).toContain('Fletching 65');
});

test('a banked bow bypasses the sourcing level requirement', () => {
    expect(suppliesStep(snapshot(true), wants, 1)).toBeNull();
});

test('Fletching 65 can make the missing bow', () => {
    const step = suppliesStep(snapshot(), wants, 65);
    expect(step?.kind === 'custom' && step.name).toBe('fletch a yew shortbow');
});

test('the live quest uses the player Fletching level for bow sourcing', () => {
    const snap = snapshot();
    snap.stage = 10;
    snap.invIds = new Map([...snap.invIds!, [IKOV_OBJ.PENDANT_LUCIEN, 1]]);
    const restore = stubProps(Skills, { effective: () => 1 });
    try {
        const step = ikov.decide(snap);
        expect(step.kind === 'wait' && step.reason).toContain('Fletching 65');
    } finally {
        restore();
    }
});
