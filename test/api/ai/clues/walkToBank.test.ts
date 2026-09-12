import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { walkToBank } from '#/bot/api/ai/clues/SolveClue.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

const FALADOR = { x: 2946, z: 3369, level: 0 };

afterEach(() => { mock.restore(); ClueExecutor.setTeleports(true); });

test('a bank walk routes through the teleport catalog like a trail leg', async () => {
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    expect(await walkToBank(FALADOR, () => {})).toBe(true);
    const opts = walk.mock.calls[0]?.[1];
    expect(opts?.useTeleportCatalog).toBe(true);
    expect(opts?.policy?.useTeleports).toBe(true);
    expect(opts?.radius).toBe(3);
});
test('a bank walk stays on foot once the host turns teleports off', async () => {
    ClueExecutor.setTeleports(false);
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    await walkToBank(FALADOR, () => {});
    expect(walk.mock.calls[0]?.[1]?.policy?.useTeleports).toBe(false);
});
