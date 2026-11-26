import { readFileSync } from 'node:fs';
import { decodeCollisionPack } from '#/bot/event/webwalk/decodeCollisionPack.js';

export function readCollisionPack(path: string): Uint8Array {
    return decodeCollisionPack(new Uint8Array(readFileSync(path)));
}
