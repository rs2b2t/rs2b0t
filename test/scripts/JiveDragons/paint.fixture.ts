import { reader } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';

export function installMidClue(): void {
    reader.worldTile = () => ({ x: 3200, z: 3200, level: 0 });
    ClueExecutor.current = {
        clueId: 1,
        name: 'hard clue',
        step: 'dig at the crate behind the bank',
        leg: 2,
        attempt: 2,
        startedAt: Date.now(),
        target: { x: 3180, z: 3210, level: 0 },
        startDist: 40
    };
}
