import { describe, expect, test } from 'bun:test';
import { ServerProt } from '#/io/ServerProt.js';
import {
    anyDirty,
    applyDirty,
    dirtyFamiliesForPacket,
    emptyDirty
} from '#/bot/events/producerDirty.js';

const SP = ServerProt as unknown as Record<string, number>;

describe('dirtyFamiliesForPacket', () => {
    test('inventory opcodes dirty only inventory', () => {
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_INV_FULL, SP)).toEqual(['inventory']);
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_INV_PARTIAL, SP)).toEqual(['inventory']);
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_INV_STOP_TRANSMIT, SP)).toEqual(['inventory']);
    });

    test('stat and varp opcodes are family-scoped', () => {
        expect(dirtyFamiliesForPacket(ServerProt.UPDATE_STAT, SP)).toEqual(['skills']);
        expect(dirtyFamiliesForPacket(ServerProt.VARP_SMALL, SP)).toEqual(['varps']);
        expect(dirtyFamiliesForPacket(ServerProt.VARP_LARGE, SP)).toEqual(['varps']);
        expect(dirtyFamiliesForPacket(ServerProt.VARP_SYNC, SP)).toEqual(['varps']);
    });

    test('message opcodes dirty chat; logout resets', () => {
        expect(dirtyFamiliesForPacket(ServerProt.MESSAGE_GAME, SP)).toEqual(['chat']);
        expect(dirtyFamiliesForPacket(ServerProt.MESSAGE_PRIVATE, SP)).toEqual(['chat']);
        expect(dirtyFamiliesForPacket(ServerProt.LOGOUT, SP)).toBe('reset');
    });

    test('unrelated packets do not dirty producers', () => {
        expect(dirtyFamiliesForPacket(ServerProt.PLAYER_INFO, SP)).toBeNull();
        expect(dirtyFamiliesForPacket(ServerProt.NPC_INFO, SP)).toBeNull();
        expect(dirtyFamiliesForPacket(ServerProt.SYNTH_SOUND, SP)).toBeNull();
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
