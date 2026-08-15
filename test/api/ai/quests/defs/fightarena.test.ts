import { describe, expect, test } from 'bun:test';

import { KIT_KEEP, decide, fightarena } from '#/bot/api/ai/quests/defs/fightarena/index.js';
import { FA_OBJ, FA_TILE } from '#/bot/api/ai/quests/defs/fightarena/areas.js';
import { FA_STAGE } from '#/bot/api/ai/quests/defs/fightarena/journal.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface SnapOpts {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    invIds?: number[];
    worn?: string[];
    wornIds?: number[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: { x: number; z: number; level: number } | null;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

function snap(o: SnapOpts = {}): QuestSnapshot {
    const invIds = new Map<number, number>();
    for (const id of o.invIds ?? []) {
        invIds.set(id, (invIds.get(id) ?? 0) + 1);
    }
    return {
        journal: o.journal ?? 'inProgress',
        inv: counts(o.inv ?? []),
        invIds,
        worn: new Set((o.worn ?? []).map(n => n.toLowerCase())),
        wornIds: new Set(o.wornIds ?? []),
        noProgress: 0,
        bankCoins: 0,
        stage: o.stage,
        bank: counts(o.bank ?? []),
        bankKnown: o.bankKnown ?? true,
        tile: (o.tile ?? null) as QuestSnapshot['tile'],
        freeSlots: 20
    };
}

const RUNE_KIT = ['Rune scimitar', 'Rune chainbody', 'Rune platelegs', 'Rune full helm', 'Rune kiteshield'];

const name = (step: QuestStep): string => (step.kind === 'custom' ? `custom:${step.name}` : step.kind);

const RUNE_FULL_HELM = 1163;

describe('Fight Arena decide', () => {
    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unloaded journal waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unreadable stage waits', () => {
        expect(decide(snap({ stage: undefined })).kind).toBe('wait');
    });

    test('not started walks to Lady Servil', () => {
        const step = decide(snap({ journal: 'notStarted', stage: FA_STAGE.NOT_STARTED, tile: FA_TILE.YANILLE_BANK }));
        expect(step.kind).toBe('talk');
    });

    test('started searches the chest', () => {
        const step = decide(snap({ stage: FA_STAGE.STARTED, tile: FA_TILE.YANILLE_BANK }));
        expect(name(step)).toBe('custom:search the guards\' chest');
    });

    test('holding the armour but not wearing it puts it on', () => {
        const step = decide(snap({
            stage: FA_STAGE.OBTAINED_ARMOUR,
            invIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            tile: FA_TILE.CHEST_STAND
        }));
        expect(name(step)).toBe('custom:wear the Khazard disguise');
    });

    test('wearing the disguise on the mainland knocks at the guard door', () => {
        const step = decide(snap({
            stage: FA_STAGE.OBTAINED_ARMOUR,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            tile: FA_TILE.CHEST_STAND
        }));
        expect(name(step)).toBe('custom:enter the arena building');
    });

    test('inside the building at stage 2 talks to the drunk guard', () => {
        const step = decide(snap({
            stage: FA_STAGE.OBTAINED_ARMOUR,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            tile: FA_TILE.DOOR1_INSIDE
        }));
        expect(name(step)).toBe('custom:talk to the drunk guard');
    });

    test('stage 3 without the brew leaves the building to buy one', () => {
        const step = decide(snap({
            stage: FA_STAGE.SPOKEN_DRUNKGUARD,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            tile: FA_TILE.DOOR1_INSIDE
        }));
        expect(name(step)).toBe('custom:leave the arena building');
    });

    test('stage 3 on the mainland without the brew buys one from the barman', () => {
        const step = decide(snap({
            stage: FA_STAGE.SPOKEN_DRUNKGUARD,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            tile: FA_TILE.YANILLE_BANK
        }));
        expect(name(step)).toBe('custom:buy a Khali brew');
    });

    test('stage 3 holding the brew goes back to the drunk guard', () => {
        const step = decide(snap({
            stage: FA_STAGE.SPOKEN_DRUNKGUARD,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            invIds: [FA_OBJ.BREW],
            tile: FA_TILE.DOOR1_INSIDE
        }));
        expect(name(step)).toBe('custom:talk to the drunk guard');
    });

    test('stage 5 in the building swaps to combat gear before unlocking the cell', () => {
        const step = decide(snap({
            stage: FA_STAGE.GIVEN_KHALI_BREW,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            // The disguise pushed the account's own helm into the pack when it went on.
            invIds: [FA_OBJ.KEYS, RUNE_FULL_HELM],
            tile: FA_TILE.DOOR1_INSIDE
        }));
        expect(name(step)).toBe('custom:wear the combat kit');
    });

    test('stage 5 in combat gear unlocks Jeremy\'s cell', () => {
        const step = decide(snap({
            stage: FA_STAGE.GIVEN_KHALI_BREW,
            invIds: [FA_OBJ.KEYS, FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            tile: FA_TILE.DOOR1_INSIDE
        }));
        expect(name(step)).toBe('custom:unlock Jeremy\'s cell');
    });

    test('stage 5 with the keys lost reclaims them from the drunk guard', () => {
        const step = decide(snap({
            stage: FA_STAGE.GIVEN_KHALI_BREW,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            tile: FA_TILE.DOOR1_INSIDE
        }));
        expect(name(step)).toBe('custom:talk to the drunk guard');
    });

    test('stage 6 in the arena fights the ogre', () => {
        const step = decide(snap({ stage: FA_STAGE.ENTERED_OGRE_FIGHT, tile: FA_TILE.ARENA_CENTRE }));
        expect(name(step)).toBe('custom:fight Khazard Ogre');
    });

    test('stage 9 in the prison cell talks to Hengrad', () => {
        const step = decide(snap({ stage: FA_STAGE.SENT_JAIL, tile: { x: 2600, z: 3142, level: 0 } }));
        expect(name(step)).toBe('custom:talk to Hengrad');
    });

    test('stage 9 in the arena fights the scorpion', () => {
        const step = decide(snap({ stage: FA_STAGE.SENT_JAIL, tile: FA_TILE.ARENA_CENTRE }));
        expect(name(step)).toBe('custom:fight Khazard Scorpion');
    });

    test('stage 10 in the arena fights Bouncer', () => {
        const step = decide(snap({ stage: FA_STAGE.DEFEATED_SCORPION, tile: FA_TILE.ARENA_CENTRE }));
        expect(name(step)).toBe('custom:fight Bouncer');
    });

    test('stage 11 in the arena asks the Servils what Khazard wants', () => {
        const step = decide(snap({ stage: FA_STAGE.DEFEATED_BOUNCER, tile: FA_TILE.ARENA_CENTRE }));
        expect(name(step)).toBe('custom:ask the Servils about Khazard');
    });

    test('stage 12 in the arena runs for the door instead of fighting', () => {
        const step = decide(snap({ stage: FA_STAGE.FREED_SERVILS, tile: FA_TILE.ARENA_CENTRE }));
        expect(name(step)).toBe('custom:run from General Khazard');
    });

    test('stage 12 on the mainland reports back to Lady Servil', () => {
        const step = decide(snap({ stage: FA_STAGE.FREED_SERVILS, tile: FA_TILE.YANILLE_BANK }));
        expect(step.kind).toBe('talk');
    });

    test('stage 13 behaves like stage 12 — the kill path is reachable by hand', () => {
        expect(name(decide(snap({ stage: FA_STAGE.DEFEATED_KHAZARD, tile: FA_TILE.ARENA_CENTRE })))).toBe('custom:run from General Khazard');
        expect(decide(snap({ stage: FA_STAGE.DEFEATED_KHAZARD, tile: FA_TILE.YANILLE_BANK })).kind).toBe('talk');
    });

    test('after a death at stage 9 the mainland re-entry is the guard door', () => {
        const step = decide(snap({ stage: FA_STAGE.SENT_JAIL, tile: FA_TILE.YANILLE_BANK }));
        expect(name(step)).toBe('custom:knock for the arena guard');
    });

    test('after a death at stage 6 the disguise is re-fetched before the door', () => {
        const step = decide(snap({ stage: FA_STAGE.ENTERED_OGRE_FIGHT, tile: FA_TILE.YANILLE_BANK }));
        expect(name(step)).toBe('custom:search the guards\' chest');
    });

    test('inside Jeremy\'s cell nothing routes out, so it waits', () => {
        expect(decide(snap({ stage: FA_STAGE.GIVEN_KHALI_BREW, tile: { x: 2616, z: 3168, level: 0 } })).kind).toBe('wait');
    });
});

describe('food waits for the kit', () => {
    test('a banked kit holds the food back, so the pack has room to withdraw it', () => {
        expect(fightarena.foodReady?.(snap({ stage: FA_STAGE.STARTED, bank: RUNE_KIT }))).toBe(false);
    });

    test('a carried but unworn kit still holds it back — wearing is what frees the slots', () => {
        expect(fightarena.foodReady?.(snap({ stage: FA_STAGE.STARTED, inv: RUNE_KIT }))).toBe(false);
    });

    test('a worn kit releases the food', () => {
        expect(fightarena.foodReady?.(snap({ stage: FA_STAGE.STARTED, worn: RUNE_KIT }))).toBe(true);
    });

    test('an account owning no kit is not made to wait for one', () => {
        expect(fightarena.foodReady?.(snap({ stage: FA_STAGE.STARTED }))).toBe(true);
    });

    test('the disguise fills the kit slots, and must not hold the food back forever', () => {
        expect(fightarena.foodReady?.(snap({
            stage: FA_STAGE.STARTED,
            bank: RUNE_KIT,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR]
        }))).toBe(true);
    });
});

describe('arming from the bank', () => {
    test('an unread bank is scanned before anything is concluded about it', () => {
        const step = decide(snap({ stage: FA_STAGE.STARTED, bankKnown: false, tile: FA_TILE.YANILLE_BANK }));
        expect(step.kind).toBe('scanBank');
    });

    test('a banked melee kit is withdrawn, best tier first', () => {
        const step = decide(snap({ stage: FA_STAGE.STARTED, bank: RUNE_KIT, tile: FA_TILE.YANILLE_BANK }));
        expect(step.kind).toBe('withdraw');
        if (step.kind === 'withdraw') {
            expect(step.items.map(i => i.name)).toEqual(RUNE_KIT);
        }
    });

    test('the chainbody outranks the platebody, which wants Dragon Slayer', () => {
        const step = decide(snap({
            stage: FA_STAGE.STARTED,
            bank: ['Rune platebody', 'Rune chainbody'],
            tile: FA_TILE.YANILLE_BANK
        }));
        expect(step.kind).toBe('withdraw');
        if (step.kind === 'withdraw') {
            expect(step.items.map(i => i.name)).toEqual(['Rune chainbody']);
        }
    });

    test('a lower tier is taken when the higher one is not owned', () => {
        const step = decide(snap({ stage: FA_STAGE.STARTED, bank: ['Steel scimitar'], tile: FA_TILE.YANILLE_BANK }));
        expect(step.kind).toBe('withdraw');
        if (step.kind === 'withdraw') {
            expect(step.items.map(i => i.name)).toEqual(['Steel scimitar']);
        }
    });

    test('a carried kit is worn rather than withdrawn again', () => {
        const step = decide(snap({ stage: FA_STAGE.STARTED, inv: RUNE_KIT, bank: RUNE_KIT, tile: FA_TILE.YANILLE_BANK }));
        expect(name(step)).toBe(`custom:wear ${RUNE_KIT.join(', ')}`);
    });

    test('a dressed account goes straight to the chest', () => {
        const step = decide(snap({ stage: FA_STAGE.STARTED, worn: RUNE_KIT, bank: RUNE_KIT, tile: FA_TILE.YANILLE_BANK }));
        expect(name(step)).toBe('custom:search the guards\' chest');
    });

    test('an account that owns no melee gear is not wedged at the bank', () => {
        const step = decide(snap({ stage: FA_STAGE.STARTED, tile: FA_TILE.YANILLE_BANK }));
        expect(name(step)).toBe('custom:search the guards\' chest');
    });

    test('the disguise is not mistaken for a missing body slot', () => {
        const step = decide(snap({
            stage: FA_STAGE.OBTAINED_ARMOUR,
            wornIds: [FA_OBJ.HELMET, FA_OBJ.ARMOUR],
            worn: ['Khazard helmet', 'Khazard armour', 'Rune scimitar'],
            bank: RUNE_KIT,
            tile: FA_TILE.CHEST_STAND
        }));
        expect(name(step)).toBe('custom:enter the arena building');
    });

    test('every kit word is on the keep list, so the spillover deposit leaves it alone', () => {
        for (const word of KIT_KEEP) {
            expect(fightarena.tools).toContain(word);
        }
    });
});

describe('the Fight Arena module', () => {
    test('is registered with the engine', () => {
        expect(QUEST_DEFS.some(d => d.record.id === 'arena')).toBe(true);
    });

    test('banks at Yanille and carries food', () => {
        expect(fightarena.bank).toEqual(FA_TILE.YANILLE_BANK);
        expect(fightarena.food).toBeGreaterThan(0);
    });

    test('keeps the quest items off the spillover deposit', () => {
        expect(fightarena.tools).toContain('khazard cell keys');
        expect(fightarena.tools).toContain('coins');
    });
});
