import { reader } from '../../adapter/ClientAdapter.js';

export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

// Colour constants CONFIRMED live by tools/quests-tab-test.ts (Task 2) --
// see docs/quest-campaign-map.md, "Quest-tab colour constants (Task 2)".
// These are NOT the classic client palette (general/configs/colour.constant:
// red_rgb=0xFF0000, yellow_rgb=0xFFFF00, green_rgb=0x00FF00): the server
// pipes if_setcolour through a 15-bit (5/5/5) wire format
// (ColorConversion.rgb24to15 engine-side), and the client reconstructs an
// 8-bit value with the low 3 bits of each channel always zero (Client.ts
// IF_SETCOLOUR handler), so every channel is truncated down to a multiple of
// 8 (0xFF -> 0xF8). Verified: every untouched quest line reads
// COLOUR_NOT_STARTED before any varp is changed; setting a quest's progress
// varp complete/mid-complete and relogging flips it to COLOUR_COMPLETE /
// COLOUR_IN_PROGRESS respectively.
const COLOUR_NOT_STARTED = 0xf80000;
const COLOUR_IN_PROGRESS = 0xf8f800;
const COLOUR_COMPLETE = 0x00f800;

export const Quests = {
    all(): { name: string; status: QuestStatus }[] {
        return reader.questStatuses().map(q => ({ name: q.name, status: toStatus(q.colour) }));
    },
    /** Case-insensitive exact-name lookup, 'unknown' if the tab isn't loaded. */
    status(name: string): QuestStatus {
        const hit = reader.questStatuses().find(q => q.name.toLowerCase() === name.toLowerCase());
        return hit ? toStatus(hit.colour) : 'unknown';
    },
    /** Total quest points (varp 101, kept current by the engine's count_questpoints). */
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
