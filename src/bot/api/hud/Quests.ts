import { reader } from '../../adapter/ClientAdapter.js';

export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

const COLOUR_NOT_STARTED = 0xf80000;
const COLOUR_IN_PROGRESS = 0xf8f800;
const COLOUR_COMPLETE = 0x00f800;

export const Quests = {
    all(): { name: string; status: QuestStatus }[] {
        return reader.questStatuses().map(q => ({ name: q.name, status: toStatus(q.colour) }));
    },
    status(name: string): QuestStatus {
        const hit = reader.questStatuses().find(q => q.name.toLowerCase() === name.toLowerCase());
        return hit ? toStatus(hit.colour) : 'unknown';
    },
    points(): number {
        return reader.varp(101);
    }
};

function toStatus(colour: number): QuestStatus {
    if (colour === COLOUR_COMPLETE) return 'complete';
    if (colour === COLOUR_IN_PROGRESS) return 'inProgress';
    if (colour === COLOUR_NOT_STARTED) return 'notStarted';
    return 'unknown';
}
