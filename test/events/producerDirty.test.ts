import { describe, expect, test } from 'bun:test';
import { ServerProt } from '#/io/ServerProt.js';
import {
    anyDirty,
    applyDirty,
    dirtyFamiliesForPacket,
    emptyDirty
} from '#/bot/events/producerDirty.js';

describe('dirtyFamiliesForPacket', () => {
    test('inventory opcodes dirty only inventory', () => {
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_INV_FULL)).toEqual(['inventory']);
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_INV_PARTIAL)).toEqual(['inventory']);
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_INV_STOP_TRANSMIT)).toEqual(['inventory']);
    });

    test('stat and varp opcodes are family-scoped', () => {
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_STAT)).toEqual(['skills']);
        expect(dirtyFamiliesForPacket(ServerProt.VARP_SMALL)).toEqual(['varps']);
        expect(dirtyFamiliesForPacket(ServerProt.VARP_LARGE)).toEqual(['varps']);
        expect(dirtyFamiliesForPacket(ServerProt.VARP_SYNC)).toEqual(['varps']);
    });

    test('message opcodes dirty chat; logout resets', () => {
        expect(dirtyFamiliesForPacket(ServerProt.MESSAGE_GAME)).toEqual(['chat']);
        expect(dirtyFamiliesForPacket(ServerProt.MESSAGE_PRIVATE)).toEqual(['chat']);
        expect(dirtyFamiliesForPacket(ServerProt.LOGOUT)).toBe('reset');
    });

    test('unrelated packets do not dirty producers', () => {
        expect(dirtyFamiliesForPacket(ServerProt.PLAYER_INFO)).toBeNull();
        expect(dirtyFamiliesForPacket(ServerProt.NPC_INFO)).toBeNull();
        expect(dirtyFamiliesForPacket(ServerProt.SYNTH_SOUND)).toBeNull();
    });
});

describe('dirty flags helpers', () => {
    test('applyDirty is additive; anyDirty reflects union', () => {
        let d = emptyDirty(false);
        expect(anyDirty(d)).toBe(false);
        d = applyDirty(d, ['inventory']);
        expect(d.inventory).toBe(true);
        expect(d.varps).toBe(false);
        expect(anyDirty(d)).toBe(true);
        d = applyDirty(d, ['varps', 'skills']);
        expect(d).toEqual({ skills: true, inventory: true, varps: true, chat: false });
    });
});
