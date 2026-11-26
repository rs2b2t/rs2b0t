import type { NpcStop } from '../exec/primitives.js';
import type { QuestStep } from './types.js';

type CustomStep = Extract<QuestStep, { kind: 'custom' }>;

export function customStep(name: string, run: CustomStep['run']): CustomStep {
    return { kind: 'custom', name, run };
}

export function talkTo(stop: NpcStop): Extract<QuestStep, { kind: 'talk' }> {
    return { kind: 'talk', stop };
}

export function waitStep(reason: string): Extract<QuestStep, { kind: 'wait' }> {
    return { kind: 'wait', reason };
}

export function waitForJournal() {
    return waitStep('quest journal not loaded');
}
