import { describe, expect, test } from 'bun:test';

import {
    BUSY_MESSAGE,
    CHALLENGE_INTERVAL_MS,
    ChallengeCadence,
    DUEL_CHALLENGE_ANCHOR,
    DUEL_FIGHT_ARENAS,
    DUEL_LOBBY_CENTER_RADIUS,
    DUEL_NEGOTIATION_TIMEOUT_MS,
    MAX_CENTER_SEEK_ATTEMPTS,
    MAX_FIGHT_ATTEMPTS,
    beginFightSignal,
    canAttemptDuelFight,
    canSeekFightCenter,
    challengeCandidate,
    challengeResult,
    confirmedIncomingInvite,
    duelInviter,
    duelRequesterAvailable,
    duelTargetsReached,
    exactTrainingMode,
    fightArenaCenter,
    fightArenaAt,
    hasExactMeleeStyles,
    inDuelChallengeArea,
    negotiationExpired,
    observeFightSignal,
    shouldCenterDuelLobby,
    targetMeleeStyle
} from '#/bot/scripts/DuelArena/DuelArenaLogic.js';

describe('Duel Arena geography', () => {
    test('the lobby anchor is challengable and never classified as a fight pen', () => {
        expect(inDuelChallengeArea(DUEL_CHALLENGE_ANCHOR)).toBe(true);
        expect(fightArenaAt(DUEL_CHALLENGE_ANCHOR)).toBeNull();
    });

    test('all six server fight pens are classified independently', () => {
        expect(DUEL_FIGHT_ARENAS).toHaveLength(6);
        for (const arena of DUEL_FIGHT_ARENAS) {
            const tile = { x: arena.minX, z: arena.maxZ, level: 0 };
            expect(fightArenaAt(tile)).toBe(arena);
            expect(inDuelChallengeArea(tile)).toBe(false);
        }
    });

    test('each pen center sees every possible spawn within twelve tiles', () => {
        for (const arena of DUEL_FIGHT_ARENAS) {
            const center = fightArenaCenter(arena);
            expect(fightArenaAt(center)).toBe(arena);
            expect(Math.max(center.x - arena.minX, arena.maxX - center.x)).toBeLessThanOrEqual(12);
            expect(Math.max(center.z - arena.minZ, arena.maxZ - center.z)).toBeLessThanOrEqual(12);
        }
    });

    test('honours inclusive pen boundaries without claiming adjacent lobby tiles', () => {
        const arena = DUEL_FIGHT_ARENAS[0]!;
        expect(fightArenaAt({ x: arena.maxX, z: arena.maxZ, level: 0 })).toBe(arena);
        expect(fightArenaAt({ x: arena.maxX + 1, z: arena.maxZ, level: 0 })).toBeNull();
        expect(fightArenaAt({ x: arena.maxX, z: arena.maxZ + 1, level: 0 })).toBeNull();
        expect(fightArenaAt({ x: arena.minX, z: arena.minZ, level: 1 })).toBeNull();
    });

    test('rejects unrelated world tiles and upper planes', () => {
        expect(inDuelChallengeArea({ x: 3222, z: 3218, level: 0 })).toBe(false);
        expect(inDuelChallengeArea({ ...DUEL_CHALLENGE_ANCHOR, level: 1 })).toBe(false);
        expect(fightArenaAt(null)).toBeNull();
    });

    test('centers only a targetless bot outside the shared lobby scene', () => {
        const arena = DUEL_FIGHT_ARENAS[0]!;
        expect(shouldCenterDuelLobby({
            ...DUEL_CHALLENGE_ANCHOR,
            x: DUEL_CHALLENGE_ANCHOR.x + DUEL_LOBBY_CENTER_RADIUS + 1
        }, 0)).toBe(true);
        expect(shouldCenterDuelLobby(DUEL_CHALLENGE_ANCHOR, 0)).toBe(false);
        expect(shouldCenterDuelLobby({
            ...DUEL_CHALLENGE_ANCHOR,
            x: DUEL_CHALLENGE_ANCHOR.x + DUEL_LOBBY_CENTER_RADIUS + 1
        }, 1)).toBe(false);
        expect(shouldCenterDuelLobby({
            x: arena.minX,
            z: arena.minZ,
            level: 0
        }, 0)).toBe(false);
    });
});

describe('target-driven melee style', () => {
    test('chooses the stat with the larger remaining gap', () => {
        expect(targetMeleeStyle(20, 40, 1, 99, 99, 1)).toBe('attack');
        expect(targetMeleeStyle(40, 20, 1, 99, 99, 1)).toBe('strength');
        expect(targetMeleeStyle(60, 60, 1, 70, 99, 1)).toBe('strength');
        expect(targetMeleeStyle(60, 60, 1, 99, 70, 1)).toBe('attack');
        expect(targetMeleeStyle(60, 60, 1, 70, 70, 50)).toBe('defence');
    });

    test('defaults Defence to complete and preserves Attack, Strength, Defence tie priority', () => {
        expect(targetMeleeStyle(1, 1, 1, 99, 99, 1)).toBe('attack');
        expect(targetMeleeStyle(99, 98, 1, 99, 99, 1)).toBe('strength');
        expect(targetMeleeStyle(90, 80, 70, 99, 99, 89)).toBe('strength');
        expect(targetMeleeStyle(80, 90, 70, 99, 99, 89)).toBe('attack');
        expect(targetMeleeStyle(99, 99, 1, 99, 99, 2)).toBe('defence');
        expect(targetMeleeStyle(120, 120, 120, 99, 99, 99)).toBe('attack');
    });

    test('accepts exact Defence and rejects every wrong-stat fallback', () => {
        expect(exactTrainingMode('attack', { requested: 'attack', effective: 'attack', mode: 0 })).toBe(0);
        expect(exactTrainingMode('strength', { requested: 'strength', effective: 'strength', mode: 1 })).toBe(1);
        expect(exactTrainingMode('defence', { requested: 'defence', effective: 'defence', mode: 3 })).toBe(3);
        expect(exactTrainingMode('attack', { requested: 'attack', effective: 'defence', mode: 3 })).toBeNull();
        expect(exactTrainingMode('strength', { requested: 'strength', effective: 'controlled', mode: 2 })).toBeNull();
        expect(exactTrainingMode('defence', { requested: 'defence', effective: 'controlled', mode: 2 })).toBeNull();
        expect(exactTrainingMode('attack', null)).toBeNull();
    });

    test('requires exact Defence only while its opt-in target remains outstanding', () => {
        const attack = { requested: 'attack', effective: 'attack', mode: 0 } as const;
        const strength = { requested: 'strength', effective: 'strength', mode: 1 } as const;
        const defence = { requested: 'defence', effective: 'defence', mode: 3 } as const;
        expect(hasExactMeleeStyles(attack, strength, null, false)).toBe(true);
        expect(hasExactMeleeStyles(attack, strength, defence, true)).toBe(true);
        expect(hasExactMeleeStyles(attack, strength, null, true)).toBe(false);
        expect(hasExactMeleeStyles(attack, null, defence, false)).toBe(false);
        expect(hasExactMeleeStyles(attack, { requested: 'strength', effective: 'defence', mode: 2 }, defence, true)).toBe(false);
    });

    test('finishes only after all three configured targets are reached', () => {
        expect(duelTargetsReached(5, 5, 1, 5, 5, 1)).toBe(true);
        expect(duelTargetsReached(6, 7, 9, 5, 5, 8)).toBe(true);
        expect(duelTargetsReached(4, 99, 99, 5, 5, 5)).toBe(false);
        expect(duelTargetsReached(99, 4, 99, 5, 5, 5)).toBe(false);
        expect(duelTargetsReached(99, 99, 4, 5, 5, 5)).toBe(false);
    });
});

describe('observable fight gate', () => {
    const arena = DUEL_FIGHT_ARENAS[0]!;
    const otherArena = DUEL_FIGHT_ARENAS[1]!;
    const selfTile = { x: arena.minX, z: arena.minZ, level: 0 };
    const opponentTile = { x: arena.maxX, z: arena.maxZ, level: 0 };
    const otherArenaTile = { x: otherArena.minX, z: otherArena.minZ, level: 0 };
    const ready = {
        selfTile,
        opponentTile,
        fightStarted: true,
        inCombat: false,
        attempts: 0
    };

    test('arms only on the FIGHT signal while both remembered opponents occupy the same pen', () => {
        expect(canAttemptDuelFight(ready)).toBe(true);
        expect(canAttemptDuelFight({ ...ready, fightStarted: false })).toBe(false);
        expect(canAttemptDuelFight({ ...ready, selfTile: DUEL_CHALLENGE_ANCHOR })).toBe(false);
        expect(canAttemptDuelFight({ ...ready, opponentTile: otherArenaTile })).toBe(false);
        expect(canAttemptDuelFight({ ...ready, opponentTile: DUEL_CHALLENGE_ANCHOR })).toBe(false);
    });

    test('requires a fresh FIGHT signal after entering a pen', () => {
        let signal = beginFightSignal('FIGHT!');

        signal = observeFightSignal(signal, 'FIGHT!');
        expect(signal.phase).toBe('await-3');
        signal = observeFightSignal(signal, null);
        signal = observeFightSignal(signal, 'FIGHT!');
        expect(signal.phase).toBe('await-3');

        signal = observeFightSignal(signal, '3');
        expect(signal.phase).toBe('await-2');
        signal = observeFightSignal(signal, '2');
        signal = observeFightSignal(signal, '1');
        signal = observeFightSignal(signal, ' fight! ');
        expect(signal.phase).toBe('ready');
        expect(observeFightSignal(signal, null)).toBe(signal);
    });

    test('rejects skipped, repeated, reordered, and unrelated countdown text', () => {
        let signal = beginFightSignal(null);
        signal = observeFightSignal(signal, '2');
        signal = observeFightSignal(signal, '1');
        signal = observeFightSignal(signal, 'FIGHT!');
        expect(signal.phase).toBe('await-3');

        signal = observeFightSignal(signal, '3');
        expect(observeFightSignal(signal, '3')).toBe(signal);
        signal = observeFightSignal(signal, '1');
        signal = observeFightSignal(signal, 'FIGHT!');
        expect(signal.phase).toBe('await-3');

        signal = observeFightSignal(signal, '3');
        signal = observeFightSignal(signal, 'hello');
        signal = observeFightSignal(signal, '2');
        expect(signal.phase).toBe('await-3');
    });

    test('restarts cleanly when a new three arrives out of order', () => {
        let signal = beginFightSignal(null);
        for (const text of ['3', '2', '3', '2', '1', 'FIGHT!']) {
            signal = observeFightSignal(signal, text);
        }
        expect(signal.phase).toBe('ready');
    });

    test('never retries in combat or beyond the bounded Fight budget', () => {
        expect(canAttemptDuelFight({ ...ready, inCombat: true })).toBe(false);
        expect(canAttemptDuelFight({ ...ready, attempts: MAX_FIGHT_ATTEMPTS - 1 })).toBe(true);
        expect(canAttemptDuelFight({ ...ready, attempts: MAX_FIGHT_ATTEMPTS })).toBe(false);
    });

    test('bounds center seeks for an opponent outside the visible scene', () => {
        expect(canSeekFightCenter(0)).toBe(true);
        expect(canSeekFightCenter(MAX_CENTER_SEEK_ATTEMPTS - 1)).toBe(true);
        expect(canSeekFightCenter(MAX_CENTER_SEEK_ATTEMPTS)).toBe(false);
        expect(canSeekFightCenter(-1)).toBe(false);
    });
});

describe('duel request parsing', () => {
    test('accepts the server duel-request chat type and display name', () => {
        expect(duelInviter({ type: 8, username: 'Fresh Bot 7', text: 'wishes to duel with you.' })).toBe('Fresh Bot 7');
    });

    test('does not turn public spoofed text or nameless requests into player ops', () => {
        expect(duelInviter({ type: 2, username: 'Spoofer', text: 'wishes to duel with you.' })).toBeNull();
        expect(duelInviter({ type: 8, username: null, text: 'wishes to duel with you.' })).toBeNull();
        expect(duelInviter({ type: 8, username: 'Bot', text: 'wishes to trade with you.' })).toBeNull();
    });

    test('consumes an incoming request only after dispatch and interface confirmation', () => {
        expect(confirmedIncomingInvite(true, true)).toBe(true);
        expect(confirmedIncomingInvite(false, true)).toBe(false);
        expect(confirmedIncomingInvite(true, false)).toBe(false);
        expect(confirmedIncomingInvite(false, false)).toBe(false);
    });

    test('classifies every terminal reciprocal Challenge outcome', () => {
        expect(challengeResult(false, false, false)).toBe('failed');
        expect(challengeResult(true, true, false)).toBe('interface');
        expect(challengeResult(true, false, true)).toBe('busy');
        expect(challengeResult(true, false, false)).toBe('sent');
    });

    test('expires a half-open negotiation at its bounded deadline', () => {
        expect(negotiationExpired(0, DUEL_NEGOTIATION_TIMEOUT_MS * 2)).toBe(false);
        expect(negotiationExpired(1000, 1000 + DUEL_NEGOTIATION_TIMEOUT_MS - 1)).toBe(false);
        expect(negotiationExpired(1000, 1000 + DUEL_NEGOTIATION_TIMEOUT_MS)).toBe(true);
    });

    test('drops requests after the sender enters a fight pen or combat', () => {
        expect(duelRequesterAvailable(DUEL_CHALLENGE_ANCHOR, false)).toBe(true);
        expect(duelRequesterAvailable(DUEL_CHALLENGE_ANCHOR, true)).toBe(false);
        expect(duelRequesterAvailable({ x: DUEL_FIGHT_ARENAS[0]!.minX, z: DUEL_FIGHT_ARENAS[0]!.minZ, level: 0 }, false)).toBe(false);
        expect(duelRequesterAvailable(null, false)).toBe(false);
    });
});

describe('challenge cadence and rotation', () => {
    test('waits exactly five wall-clock seconds after a sent invite', () => {
        const cadence = new ChallengeCadence();
        cadence.record('sent', 1000);
        expect(cadence.ready(1000 + CHALLENGE_INTERVAL_MS - 1)).toBe(false);
        expect(cadence.remaining(1000)).toBe(CHALLENGE_INTERVAL_MS);
        expect(cadence.ready(1000 + CHALLENGE_INTERVAL_MS)).toBe(true);
    });

    test('an opened interface preserves cadence across its transient modal gap', () => {
        const cadence = new ChallengeCadence();
        cadence.record('interface', 1200);
        expect(cadence.ready(1200 + CHALLENGE_INTERVAL_MS - 1)).toBe(false);
        expect(cadence.ready(1200 + CHALLENGE_INTERVAL_MS)).toBe(true);
    });

    test('busy and failed outcomes remain immediately retryable', () => {
        for (const result of ['busy', 'failed'] as const) {
            const cadence = new ChallengeCadence();
            cadence.record('sent', 1000);
            cadence.record(result, 1200);
            expect(cadence.ready(1200)).toBe(true);
            expect(cadence.remaining(1200)).toBe(0);
        }
    });

    test('the exact server busy message is recognized', () => {
        expect(BUSY_MESSAGE.test('Other player is busy at the moment.')).toBe(true);
        expect(BUSY_MESSAGE.test('Other player is not busy at the moment.')).toBe(false);
    });

    test('round-robins candidates and handles empty/negative cursors', () => {
        const bots = ['a', 'b', 'c'];
        expect(challengeCandidate(bots, 0)).toEqual({ candidate: 'a', nextCursor: 1 });
        expect(challengeCandidate(bots, 1)).toEqual({ candidate: 'b', nextCursor: 2 });
        expect(challengeCandidate(bots, 3)).toEqual({ candidate: 'a', nextCursor: 1 });
        expect(challengeCandidate(bots, -1)).toEqual({ candidate: 'c', nextCursor: 3 });
        expect(challengeCandidate([], 0)).toBeNull();
    });
});
