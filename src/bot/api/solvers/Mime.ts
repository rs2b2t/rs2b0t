import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../Execution.js';

export const MIME_IF = {
    root: 6543,
    buttons: [6546, 6547, 6548, 6549, 6550, 6551, 6552, 6553] as const
};

export const MIME_EMOTE_BY_SEQ: Record<number, number> = {
    860: 0, // emote_cry
    857: 1, // emote_think
    861: 2, // emote_laugh
    866: 3, // emote_dance
    1130: 4, // emote_climbing_rope
    1129: 5, // emote_mime_lean
    1128: 6, // emote_glass_wall
    1131: 7 // emote_glass_box
};

export function mimeAnswer(lastSeenSeq: number | null): number | null {
    if (lastSeenSeq === null) {
        return null;
    }
    return MIME_EMOTE_BY_SEQ[lastSeenSeq] ?? null;
}

export const MIME_SQUARE = { mx: 31, mz: 74 };

export async function performMimeStage(log: (msg: string) => void): Promise<boolean> {
    log('random event: mime stage — copying the performance');
    const onStage = (): boolean => {
        const me = reader.worldTile();
        return me !== null && me.level === 0 && me.x >> 6 === MIME_SQUARE.mx && me.z >> 6 === MIME_SQUARE.mz;
    };

    let lastSeen: number | null = null;
    const deadline = performance.now() + 180_000; // ~9 full cycles

    while (onStage() && performance.now() < deadline) {
        const mime = reader.npcs().find(n => (n.name ?? '').toLowerCase() === 'mime');
        if (mime && MIME_EMOTE_BY_SEQ[mime.anim] !== undefined) {
            lastSeen = mime.anim;
        }

        if (reader.modals().chat === MIME_IF.root) {
            const answer = mimeAnswer(lastSeen);
            if (answer !== null) {
                actions.ifButton(MIME_IF.buttons[answer]);
                log(`mime: performed emote ${answer}`);
                lastSeen = null;
                await Execution.delayUntil(() => reader.modals().chat !== MIME_IF.root || !onStage(), 10_000);
                continue;
            }
        }
        await Execution.delayTicks(1);
    }

    log(onStage() ? 'mime: still on stage after 3min — will retry' : 'random event: mime solved — returned');
    return true;
}
