import { Game } from '../../../../game/Game.js';
import { shiloArea, type ShiloArea } from './areas.js';

export { driveChoice, driveUntil, heldId, locNear, promptLoc, settleScene, useOnLoc } from '../../exec/prompts.js';
export type { LocPrompt } from '../../exec/prompts.js';

export function here(): ShiloArea {
    return shiloArea(Game.tile());
}
