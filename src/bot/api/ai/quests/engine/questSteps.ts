import type { NpcStop } from '../exec/primitives.js';
import type { QuestSnapshot, QuestStep } from './types.js';

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

export function journalStep(journal: QuestSnapshot['journal']): QuestStep | null {
    if (journal === 'complete') return { kind: 'done' };
    if (journal === 'unknown') return waitForJournal();
    return null;
}

export function decideJournalStage(
    snap: QuestSnapshot,
    decideStage: (snap: QuestSnapshot, stage: number) => QuestStep,
    missingStage = 'quest stage not readable'
): QuestStep {
    const journal = journalStep(snap.journal);
    if (journal) return journal;

    const stage = snap.progress?.stage ?? snap.stage;
    return stage === undefined ? waitStep(missingStage) : decideStage(snap, stage);
}
