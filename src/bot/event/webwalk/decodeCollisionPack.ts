import { gunzipSync } from 'fflate';

export function decodeCollisionPack(bytes: Uint8Array): Uint8Array {
    return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
}
