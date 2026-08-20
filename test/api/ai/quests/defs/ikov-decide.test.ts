import { describe, expect, test } from 'bun:test';

import { ARROWS_WANTED, IKOV_NAME, IKOV_OBJ, ROOTS_WANTED } from '#/bot/api/ai/quests/defs/ikov/areas.js';
import { decide } from '#/bot/api/ai/quests/defs/ikov/index.js';
import { IKOV_STAGE } from '#/bot/api/ai/quests/defs/ikov/journal.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const ARROWS = IKOV_NAME.ICE_ARROWS.toLowerCase();

interface Held {
    inv?: [number, number][];
    bank?: [number, number][];
    invNames?: [string, number][];
    bankNames?: [string, number][];
    worn?: string[];
    tile?: { x: number; z: number; level: number };
    bankKnown?: boolean;
    bankCoins?: number;
}

function snap(stage: number, held: Held = {}): QuestSnapshot {
    const invIds = new Map(held.inv ?? []);
    const bankIds = new Map(held.bank ?? []);
    return {
        journal: stage === IKOV_STAGE.COMPLETE ? 'complete' : stage === IKOV_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress',
        inv: new Map(held.invNames ?? []),
        invIds,
        worn: new Set(held.worn ?? []),
        wornIds: new Set<number>(),
        noProgress: 0,
        bankCoins: held.bankCoins ?? 5000,
        stage,
        bank: new Map(held.bankNames ?? []),
        bankIds,
        bankKnown: held.bankKnown ?? true,
        tile: held.tile ?? { x: 2677, z: 3406, level: 0 },
        freeSlots: 20
    };
}

/** Everything the surface legs produce, so a snapshot can start past them. */
const KIT: [number, number][] = [
    [IKOV_OBJ.LIT_CANDLE, 1],
    [IKOV_OBJ.TINDERBOX, 1],
    [IKOV_OBJ.KNIFE, 1],
    [IKOV_OBJ.YEW_SHORTBOW, 1],
    [IKOV_OBJ.PENDANT_LUCIEN, 1]
];

function label(step: QuestStep): string {
    return step.kind === 'custom' ? `custom:${step.name}` : step.kind;
}

describe('Temple of Ikov decide', () => {
    test('an unloaded journal waits rather than restarting the quest', () => {
        const s = snap(IKOV_STAGE.NOT_STARTED);
        s.journal = 'unknown';
        expect(decide(s).kind).toBe('wait');
    });

    test('a complete journal is done', () => {
        expect(decide(snap(IKOV_STAGE.COMPLETE)).kind).toBe('done');
    });

    test('not started walks to Lucien at the inn', () => {
        const step = decide(snap(IKOV_STAGE.NOT_STARTED));
        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Lucien');
    });

    test('an unread bank is scanned before anything is judged missing', () => {
        expect(decide(snap(IKOV_STAGE.STARTED, { bankKnown: false })).kind).toBe('scanBank');
    });

    test('a lost pendant sends the bot back to Lucien for another', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { bank: KIT.filter(([id]) => id !== IKOV_OBJ.PENDANT_LUCIEN) }));
        expect(step.kind).toBe('talk');
    });

    // Why: `obj_gettotal` counts the bank, so Lucien refuses to replace a pendant sitting in a booth. It has to be withdrawn instead.
    test('a banked pendant is withdrawn rather than begged for', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { bank: KIT }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items.some(i => i.id === IKOV_OBJ.PENDANT_LUCIEN)).toBe(true);
    });

    // Why: the Armoury sits on Ardougne's doorstep and the rest of the kit is a Catherby-Seers loop, so the axe is bought before the bot leaves.
    test('the axe is the first purchase', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]] }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.IRON_AXE);
    });

    test('with an axe banked the tinderbox is next', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.IRON_AXE, 1]]
        }));
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.TINDERBOX);
    });

    test('with a tinderbox banked the candle is next', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.IRON_AXE, 1], [IKOV_OBJ.TINDERBOX, 1]]
        }));
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.CANDLE);
    });

    test('the bow chain starts at the yew once the candle is covered', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.IRON_AXE, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1]]
        }));
        expect(label(step)).toBe('custom:chop a yew log');
    });

    test('with logs cut the chain moves on to the knife', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.IRON_AXE, 1], [IKOV_OBJ.YEW_LOGS, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1]]
        }));
        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe(IKOV_NAME.KNIFE);
    });

    test('with logs and a knife the flax is next', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.YEW_LOGS, 1], [IKOV_OBJ.KNIFE, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1]]
        }));
        expect(label(step)).toBe('custom:pick flax');
    });

    test('with a bow string spun the logs are fletched', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.YEW_LOGS, 1], [IKOV_OBJ.KNIFE, 1], [IKOV_OBJ.BOW_STRING, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1]]
        }));
        expect(label(step)).toBe('custom:fletch a yew shortbow');
    });

    test('a stave and a string are strung together', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.UNSTRUNG_YEW_SHORTBOW, 1], [IKOV_OBJ.BOW_STRING, 1]],
            bank: [[IKOV_OBJ.TINDERBOX, 1], [IKOV_OBJ.UNLIT_CANDLE, 1]]
        }));
        expect(label(step)).toBe('custom:string the yew shortbow');
    });

    test('the whole kit banked sends the bot down for the boots', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]], bank: KIT }));
        // Why: the pack is empty, so the candle and the knife are withdrawn before the descent.
        expect(step.kind).toBe('withdraw');
    });

    // Why: `fetchBoots` returns true for arriving in the boots room, a leg before it holds anything, so a step that
    // Why: chains straight on from it walks the gate check while standing in a pocket the ice-cavern half-plane covers.
    test('kit in the pack, boots unfound: the boots leg runs on its own', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: KIT, invNames: [['lit candle', 1], ['tinderbox', 1], ['knife', 1], ['pendant of lucien', 1]] }));
        expect(label(step)).toBe('custom:fetch the boots of lightness');
    });

    // Why: the bridge weighs the pack in grams and gives way at anything but negative, so the bow and the axe are banked before the bot goes underground.
    test('the axe and the bow are banked before the dungeon', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: KIT,
            invNames: [['lit candle', 1], ['knife', 1], ['iron axe', 1], ['yew shortbow', 1], ['lobster', 8]]
        }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toContain('lobster');
        expect(step.kind === 'deposit' && step.keep).toContain('boots of lightness');
    });

    test('a pack of nothing but the crossing kit is not trimmed', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: KIT,
            invNames: [['lit candle', 1], ['tinderbox', 1], ['knife', 1], ['pendant of lucien', 1], ['lobster', 8], ['coins', 1000]]
        }));
        expect(step.kind).not.toBe('deposit');
    });

    // Why: the south gate is untransmitted, so a session that has never stood past it plans for the lava crossing rather than for the chests.
    test('boots in hand but no arrows: the gate is unlocked before the chests', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: [...KIT, [IKOV_OBJ.BOOTS, 1]] }));
        expect(label(step)).toBe('custom:unlock the south gate');
    });

    // Why: the crossing gives way at any non-negative weight, so the leg that takes the lever carries no armour however much the bank holds.
    test('banked armour does not ride along on the crossing leg', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            bankNames: [['studded body', 1], ['studded chaps', 1]]
        }));
        expect(label(step)).toBe('custom:unlock the south gate');
    });

    // Why: a banked pair read as "done", so nothing withdrew them, the gate check descended for a
    // second pair without a candle, and failed in 2ms forever, a failing step feeds no watchdog.
    test('boots in the bank are withdrawn, not descended for a second time', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, { inv: KIT, bank: [[IKOV_OBJ.BOOTS, 1]] }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items.map(i => i.id)).toContain(IKOV_OBJ.BOOTS);
    });

    // Why: the candle cannot be bought underground, so the kit is sourced before the descent is
    // chosen, and that ordering is what keeps `fetchBoots` from being reached without one.
    test('the candle kit is bought before the descent is chosen', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: KIT.filter(([id]) => id !== IKOV_OBJ.LIT_CANDLE && id !== IKOV_OBJ.TINDERBOX)
        }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.TINDERBOX);
    });

    test('arrows in hand at stage 10: the trap lever is next', () => {
        const step = decide(snap(IKOV_STAGE.STARTED, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(label(step)).toBe('custom:disarm and pull the trap lever');
    });

    test('arrows in hand past the lever: the Fire Warrior is next', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(label(step)).toBe('custom:shoot the Fire Warrior of Lesarkus');
    });

    test('a banked bow is withdrawn before the Fire Warrior', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.BOOTS, 1]],
            bank: [[IKOV_OBJ.YEW_SHORTBOW, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(step.kind).toBe('withdraw');
    });

    // Why: the ice-chest circuit spends the engine's one-shot float, and the bot walked up to his door on an empty pack and stood there.
    test('an empty pack is refilled before the Fire Warrior', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]],
            bankNames: [[IKOV_NAME.LOBSTER.toLowerCase(), 20]]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe(IKOV_NAME.LOBSTER);
    });

    test('food in the pack goes straight to the Fire Warrior', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            invNames: [[ARROWS, ARROWS_WANTED], [IKOV_NAME.LOBSTER.toLowerCase(), 4]],
            bankNames: [[IKOV_NAME.LOBSTER.toLowerCase(), 20]]
        }));
        expect(label(step)).toBe('custom:shoot the Fire Warrior of Lesarkus');
    });

    // Why: the candle only lights the stairs to the boots, so demanding one after they are found sends the bot shopping mid-dungeon.
    test('boots in hand stop the candle being part of the kit', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.BOOTS, 1], [IKOV_OBJ.YEW_SHORTBOW, 1]],
            invNames: [[ARROWS, ARROWS_WANTED]]
        }));
        expect(label(step)).toBe('custom:shoot the Fire Warrior of Lesarkus');
    });

    test('the warrior down sends the bot to Winelda', () => {
        const step = decide(snap(IKOV_STAGE.KILLED_WARRIOR, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]] }));
        expect(label(step)).toBe('custom:ask Winelda for the ferry across the lava');
    });

    // Why: with money in the bank an axeless bot buys one first, so the farm itself is only reachable once it is both unarmed and broke.
    test('Winelda asked and no roots: the hobgoblin farm runs', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            invNames: [[IKOV_NAME.LOBSTER.toLowerCase(), 6]],
            bankCoins: 0
        }));
        expect(label(step)).toBe(`custom:farm limpwurt roots (0/${ROOTS_WANTED})`);
    });

    // Why: the crossing kit leaves the bot bare-handed, and the farm is a hundred-odd level-42 hobgoblins.
    test('a banked axe is withdrawn and wielded before the farm', () => {
        const banked = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.IRON_AXE, 1]]
        }));
        expect(banked.kind).toBe('withdraw');
        const held = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.IRON_AXE, 1]]
        }));
        expect(held.kind).toBe('equip');
        expect(held.kind === 'equip' && held.item).toBe(IKOV_NAME.IRON_AXE);
    });

    // Why: a run resumed past the sourcing leg never bought the axe it would have banked, and Aemad sells one for pocket change.
    test('a bot resumed at the ferry with no axe buys one from Aemad', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, { inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]] }));
        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe(IKOV_NAME.IRON_AXE);
        expect(step.kind === 'buy' && step.shop.npc).toBe('Aemad');
    });

    // Why: the engine's food float is provisioned once, and this grind outlasts it, the last live run starved at the camp and dropped the kit on the floor.
    test('an empty larder is restocked before the farm', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bankNames: [[IKOV_NAME.LOBSTER.toLowerCase(), 10]],
            bankCoins: 0
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe(IKOV_NAME.LOBSTER);
    });

    test('a stocked pack keeps the farm running', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            invNames: [[IKOV_NAME.LOBSTER.toLowerCase(), 6]],
            bankNames: [[IKOV_NAME.LOBSTER.toLowerCase(), 10]],
            bankCoins: 0
        }));
        expect(label(step)).toBe(`custom:farm limpwurt roots (0/${ROOTS_WANTED})`);
    });

    // Why: hobgoblins are aggressive, so a bot that stops fighting with nothing to eat dies where it stands.
    test('no food anywhere leaves the camp rather than fighting on', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bankCoins: 0
        }));
        expect(label(step)).toBe('custom:leave the hobgoblin camp');
    });

    // Why: twenty unstackable roots plus coins and food fill the pack, so the withdraw cannot land on a pack still holding the dungeon kit.
    test('the dungeon kit is banked before the roots are withdrawn', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.IRON_AXE, 1]],
            invNames: [['pendant of lucien', 1], ['knife', 1], ['lit candle', 1], ['iron axe', 1]],
            bank: [[IKOV_OBJ.LIMPWURT_ROOT, ROOTS_WANTED]]
        }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toContain('limpwurt root');
    });

    test('roots banked are withdrawn before the hand-over', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            bank: [[IKOV_OBJ.LIMPWURT_ROOT, ROOTS_WANTED]]
        }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].qty).toBe(ROOTS_WANTED);
    });

    test('roots in the pack pay Winelda', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1], [IKOV_OBJ.LIMPWURT_ROOT, ROOTS_WANTED]]
        }));
        expect(label(step)).toBe('custom:pay Winelda her twenty limpwurt roots');
    });

    // Why: the farm's own lobsters are what fill the pack, and a twenty-root withdraw into nineteen free slots retries until the watchdog gives up.
    test('the farm food is banked before the twenty roots are drawn', () => {
        const step = decide(snap(IKOV_STAGE.SPOKEN_WINELDA, {
            inv: [[IKOV_OBJ.PENDANT_LUCIEN, 1]],
            invNames: [['pendant of lucien', 1], [IKOV_NAME.LOBSTER.toLowerCase(), 15]],
            bank: [[IKOV_OBJ.LIMPWURT_ROOT, ROOTS_WANTED]],
            bankNames: [[IKOV_NAME.LOBSTER.toLowerCase(), 40]]
        }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).not.toContain(IKOV_NAME.LOBSTER.toLowerCase());
    });

    // Why: past the ferry the roots are gone, and re-reading them as missing would send the bot back to the hobgoblins forever.
    test('the spent roots never re-open the farm', () => {
        const step = decide(snap(IKOV_STAGE.PAID_WINELDA, { inv: [] }));
        expect(label(step)).toBe('custom:join the Guardians of Armadyl');
    });

    test('the guardians joined ends in Lucien', () => {
        const step = decide(snap(IKOV_STAGE.HELPING_ARMADYL, { inv: [[IKOV_OBJ.PENDANT_ARMADYL, 1]] }));
        expect(label(step)).toBe('custom:leave the temple and banish Lucien');
    });

    // Why: past the ferry there is no walking back to Lucien, so a missing pendant must not become a talk step.
    test('a missing pendant on the far side of the lava does not walk back to Lucien', () => {
        const step = decide(snap(IKOV_STAGE.PAID_WINELDA, { tile: { x: 2664, z: 9876, level: 0 } }));
        expect(label(step)).toBe('custom:join the Guardians of Armadyl');
    });

    test('worn arrows count as secured', () => {
        const step = decide(snap(IKOV_STAGE.PULLED_LEVER, {
            inv: [...KIT, [IKOV_OBJ.BOOTS, 1]],
            worn: [ARROWS]
        }));
        expect(label(step)).toBe('custom:shoot the Fire Warrior of Lesarkus');
    });
});
