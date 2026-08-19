import { describe, expect, test } from 'bun:test';

import { FT_ID, decide, fremenniktrials, riddleAnswer } from '#/bot/api/ai/quests/defs/fremenniktrials/index.js';
import { FT_STAGE } from '#/bot/api/ai/quests/defs/fremenniktrials/journal.js';
import { resetBardLatch } from '#/bot/api/ai/quests/defs/fremenniktrials/bard.js';
import { around, middle, narrow } from '#/bot/api/ai/quests/defs/fremenniktrials/hunter.js';
import { MAZE_ROUTE } from '#/bot/api/ai/quests/defs/fremenniktrials/areas.js';
import { mazeLegAt } from '#/bot/api/ai/quests/defs/fremenniktrials/navigator.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const ALL_TRIALS = ['navigator', 'merchant', 'hunter', 'seer', 'warrior', 'reveller', 'bard'] as const;

interface Options {
    journal?: QuestSnapshot['journal'];
    votes?: number;
    flags?: string[];
    inv?: string[];
    invIds?: number[];
    worn?: string[];
    bank?: string[];
    bankIds?: number[];
    bankKnown?: boolean;
    tile?: QuestSnapshot['tile'];
    coins?: number;
    bankedCoins?: number;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

function idCounts(ids: number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of ids) {
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

function snap(options: Options = {}): QuestSnapshot {
    const flags = new Set(options.flags ?? []);
    const inv = counts(options.inv ?? []);
    const bank = counts(options.bank ?? []);
    if (options.coins !== undefined) {
        inv.set('coins', options.coins);
    }
    if (options.bankedCoins !== undefined) {
        bank.set('coins', options.bankedCoins);
    }
    return {
        journal: options.journal ?? 'inProgress',
        inv,
        invIds: idCounts(options.invIds ?? []),
        worn: new Set((options.worn ?? []).map(n => n.toLowerCase())),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: options.votes ?? 0,
        progress: { stage: options.votes ?? 0, flags },
        bank,
        bankIds: idCounts(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? null,
        freeSlots: 28
    };
}

/** Every trial won but the one named, so `decide` has to fall through to it. */
function only(trial: string, extra: string[] = []): string[] {
    return [...ALL_TRIALS.filter(t => t !== trial).map(t => `${t}-done`), ...extra];
}

const talkTo = (step: QuestStep): string | null => (step.kind === 'talk' ? step.stop.npc : null);
const customName = (step: QuestStep): string | null => (step.kind === 'custom' ? step.name : null);

describe('The Fremennik Trials decide', () => {
    test('waits while the quest list has not loaded', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done when the list is green', () => {
        expect(decide(snap({ journal: 'complete' }))).toEqual({ kind: 'done' });
    });

    test('reads the bank before deciding anything else', () => {
        expect(decide(snap({ bankKnown: false })).kind).toBe('scanBank');
    });

    test('starts by asking Brundt for a quest', () => {
        const step = decide(snap({ votes: FT_STAGE.NOT_STARTED, journal: 'notStarted' }));

        expect(talkTo(step)).toBe('Brundt the Chieftain');
    });

    test('returns to Brundt once seven votes are in', () => {
        const step = decide(snap({ votes: 7, flags: ALL_TRIALS.map(t => `${t}-done`) }));

        expect(talkTo(step)).toBe('Brundt the Chieftain');
    });

    test('opens the reveller trial before any other', () => {
        expect(talkTo(decide(snap()))).toBe('Manni the Reveller');
    });
});

describe("Manni's drinking contest", () => {
    test('buys the low alcohol keg first', () => {
        const step = decide(snap({ flags: only('reveller', ['reveller-started']), coins: 1000 }));

        expect(customName(step)).toBe('buy a low alcohol keg (250gp)');
    });

    test('withdraws coins when the pack cannot cover the keg', () => {
        const step = decide(snap({ flags: only('reveller', ['reveller-started']), bankedCoins: 5000 }));

        expect(step.kind).toBe('withdraw');
    });

    test('buys a beer for the workman once the keg is carried', () => {
        const step = decide(snap({
            flags: only('reveller', ['reveller-started']),
            inv: ['Tinderbox'],
            invIds: [FT_ID.LOW_ALCOHOL_KEG],
            coins: 1000
        }));

        expect(customName(step)).toBe("buy a beer at the Forester's Arms");
    });

    test('turns the beer into a firecracker at the bridge workman', () => {
        const step = decide(snap({
            flags: only('reveller', ['reveller-started']),
            inv: ['Tinderbox', 'Beer'],
            invIds: [FT_ID.LOW_ALCOHOL_KEG]
        }));

        expect(step).toMatchObject({ kind: 'useOn', item: 'Beer', target: 'Council workman' });
    });

    test('takes the keg off the table once the firecracker is in hand', () => {
        const step = decide(snap({
            flags: only('reveller', ['reveller-started']),
            inv: ['Tinderbox'],
            invIds: [FT_ID.LOW_ALCOHOL_KEG, FT_ID.FIRECRACKER]
        }));

        expect(step).toMatchObject({ kind: 'grabGround', item: 'Keg of beer' });
    });

    test('drinks only after the swap has spent the low alcohol keg', () => {
        const step = decide(snap({ flags: only('reveller', ['reveller-started']), invIds: [FT_ID.BEER_KEG] }));

        expect(customName(step)).toBe('drink Manni under the table');
    });
});

describe("Olaf's lyre", () => {
    const bard = (extra: string[] = []): string[] => only('bard', ['bard-started', ...extra]);

    test('picks up the Rellekka axe spawn when the bank has none', () => {
        const step = decide(snap({ flags: bard() }));

        expect(step).toMatchObject({ kind: 'grabGround', item: 'Bronze axe' });
    });

    test('cuts the musical tree once an axe is carried', () => {
        const step = decide(snap({ flags: bard(), inv: ['Bronze axe'] }));

        expect(step).toMatchObject({ kind: 'pickLoc', loc: 'Swaying tree' });
    });

    test('carves the branch with a knife', () => {
        const step = decide(snap({ flags: bard(), inv: ['Bronze axe', 'Knife'], invIds: [FT_ID.BRANCH] }));

        expect(customName(step)).toBe('carve the branch into an unstrung lyre');
    });

    test('asks Lalli before Askeladden for the pet rock', () => {
        resetBardLatch();
        const step = decide(snap({ flags: bard(), invIds: [FT_ID.UNSTRUNG_LYRE] }));

        expect(customName(step)).toBe('ask Lalli who traded him the wool');
    });

    test('picks the stew vegetables once the rock is carried', () => {
        const step = decide(snap({ flags: bard(), invIds: [FT_ID.UNSTRUNG_LYRE, FT_ID.PET_ROCK] }));

        expect(step).toMatchObject({ kind: 'pickLoc', loc: 'Cabbage' });
    });

    test('spins the fleece before stringing the lyre', () => {
        const step = decide(snap({ flags: bard(), invIds: [FT_ID.UNSTRUNG_LYRE, FT_ID.GOLDEN_FLEECE] }));

        expect(customName(step)).toBe('spin the fleece at the Seers spinning wheel');
    });

    test('strings the lyre with the spun wool', () => {
        const step = decide(snap({ flags: bard(), invIds: [FT_ID.UNSTRUNG_LYRE, FT_ID.GOLDEN_WOOL] }));

        expect(customName(step)).toBe('string the lyre with golden wool');
    });

    test('buys the shark from Rufus when neither pack nor bank has one', () => {
        const step = decide(snap({ flags: bard(), invIds: [FT_ID.LYRE] }));

        expect(step).toMatchObject({ kind: 'buy', item: 'Raw shark' });
    });

    test('withdraws a banked shark rather than walking to Canifis', () => {
        const step = decide(snap({ flags: bard(), invIds: [FT_ID.LYRE], bankIds: [FT_ID.RAW_SHARK] }));

        expect(step.kind).toBe('withdraw');
    });

    test('plays the enchanted lyre on the stage', () => {
        const step = decide(snap({ flags: bard(), invIds: [FT_ID.ENCHANTED_LYRE] }));

        expect(customName(step)).toBe('play the lyre on the longhall stage');
    });
});

describe("Sigmund's flower chain", () => {
    const merchant = (extra: string[] = []): string[] => only('merchant', ['merchant-started', ...extra]);

    test('opens the chain with the Sailor and Olaf', () => {
        expect(customName(decide(snap({ flags: merchant() })))).toBe('ask the Sailor and then Olaf about the flower');
    });

    test('walks the ask chain by the step the journal names', () => {
        const asks: Record<string, string> = {
            olaf: 'Yrsa',
            yrsa: 'Brundt the Chieftain',
            chief: 'Sigli the Huntsman',
            sigli: 'Skulgrimen',
            skul: 'Fisherman',
            fisherman: 'Swensen the Navigator',
            swensen: 'Peer the Seer',
            seer: 'Thorvald the Warrior',
            thorvald: 'Manni the Reveller',
            manni: 'Thora the Barkeep'
        };
        for (const [at, npc] of Object.entries(asks)) {
            expect(talkTo(decide(snap({ flags: merchant([`merchant-at:${at}`]) })))).toBe(npc);
        }
    });

    test('pays Askeladden his five thousand', () => {
        expect(talkTo(decide(snap({ flags: merchant(['merchant-at:thora']), coins: 5000 })))).toBe('Askeladden');
        expect(decide(snap({ flags: merchant(['merchant-at:thora']), bankedCoins: 20_000 })).kind).toBe('withdraw');
    });

    test('hands each traded good to the councillor who wants it', () => {
        const handovers: [number, string][] = [
            [FT_ID.PROMISSORY_NOTE, 'Thora the Barkeep'],
            [FT_ID.COCKTAIL, 'Manni the Reveller'],
            [FT_ID.CHAMPIONS_TOKEN, 'Thorvald the Warrior'],
            [FT_ID.WARRIORS_CONTRACT, 'Peer the Seer'],
            [FT_ID.FORECAST, 'Swensen the Navigator'],
            [FT_ID.SEA_MAP, 'Fisherman'],
            [FT_ID.UNUSUAL_FISH, 'Skulgrimen'],
            [FT_ID.BOWSTRING, 'Sigli the Huntsman'],
            [FT_ID.HUNTERS_MAP, 'Brundt the Chieftain'],
            [FT_ID.FISCAL_STATEMENT, 'Yrsa'],
            [FT_ID.STURDY_BOOTS, 'Olaf the Bard'],
            [FT_ID.BALLAD, 'Sailor'],
            [FT_ID.FLOWER, 'Sigmund The Merchant']
        ];
        for (const [id, npc] of handovers) {
            expect(talkTo(decide(snap({ flags: merchant(), invIds: [id] })))).toBe(npc);
        }
    });
});

describe("Peer's puzzle house", () => {
    const seer = (extra: string[] = []): string[] => only('seer', ['warrior-started', 'seer-started', ...extra]);

    test('has Peer bank everything before the door', () => {
        expect(talkTo(decide(snap({ flags: seer(), inv: ['Coins'] })))).toBe('Peer the Seer');
    });

    test('solves the lock once the pack is empty', () => {
        expect(customName(decide(snap({ flags: seer() })))).toBe("solve the lock on Peer's door");
    });

    test('climbs to the puzzle floor from the west room', () => {
        const step = decide(snap({ flags: seer(), tile: { x: 2631, z: 3665, level: 0 } }));

        expect(customName(step)).toBe('climb to the puzzle floor');
    });

    test('collects the unicorn disk first on the puzzle floor', () => {
        const step = decide(snap({ flags: seer(), tile: { x: 2632, z: 3662, level: 2 } }));

        expect(customName(step)).toBe('take the red disk from the unicorn head');
    });

    test('cooks the herring for its dye', () => {
        const step = decide(snap({
            flags: seer(),
            tile: { x: 2632, z: 3662, level: 2 },
            invIds: [FT_ID.RED_DISK, FT_ID.WOODEN_DISK, FT_ID.RED_HERRING]
        }));

        expect(customName(step)).toBe('cook the red herring for its dye');
    });

    test('measures four fifths with the three-jug and the five-bucket', () => {
        const floor = { x: 2632, z: 3662, level: 2 } as const;
        const two = [FT_ID.RED_DISK, FT_ID.RED_DISK];
        const at = (ids: number[]): string | null =>
            customName(decide(snap({ flags: seer(), tile: floor, invIds: [...two, ...ids] })));

        expect(at([])).toBe('open the chest and take the jug');
        expect(at([FT_ID.JUG_EMPTY])).toBe('open the cupboard and take the bucket');
        expect(at([FT_ID.JUG_EMPTY, FT_ID.BUCKET_EMPTY])).toBe('fill the jug from the tap');
        expect(at([FT_ID.JUG_3, FT_ID.BUCKET_EMPTY])).toBe('pour the jug into the bucket');
        expect(at([FT_ID.JUG_3, FT_ID.BUCKET_3])).toBe('pour the jug into the bucket');
        expect(at([FT_ID.JUG_1, FT_ID.BUCKET_5])).toBe('empty the bucket down the drain');
        expect(at([FT_ID.JUG_1, FT_ID.BUCKET_EMPTY])).toBe('pour the jug into the bucket');
        expect(at([FT_ID.JUG_EMPTY, FT_ID.BUCKET_1])).toBe('fill the jug from the tap');
        expect(at([FT_ID.JUG_3, FT_ID.BUCKET_1])).toBe('pour the jug into the bucket');
        expect(at([FT_ID.JUG_EMPTY, FT_ID.BUCKET_4])).toBe('balance the scales with a four-fifths bucket');
    });

    test('takes the vase down to the mural for its lid', () => {
        const step = decide(snap({ flags: seer(), tile: { x: 2632, z: 3662, level: 2 }, invIds: [FT_ID.VASE] }));

        expect(customName(step)).toBe('take the trapdoor down to the mural');
    });

    test('presses the disks into the mural downstairs', () => {
        const step = decide(snap({
            flags: seer(),
            tile: { x: 2636, z: 3665, level: 0 },
            invIds: [FT_ID.VASE, FT_ID.RED_DISK]
        }));

        expect(customName(step)).toBe('press a red disk into the mural');
    });

    test('freezes the sealed vase and melts the key out', () => {
        const floor = { x: 2632, z: 3662, level: 2 } as const;

        expect(customName(decide(snap({ flags: seer(), tile: floor, invIds: [FT_ID.VASE, FT_ID.VASE_LID] }))))
            .toBe('fill the vase from the tap');
        expect(customName(decide(snap({ flags: seer(), tile: floor, invIds: [FT_ID.VASE_WATER, FT_ID.VASE_LID] }))))
            .toBe('screw the lid onto the full vase');
        expect(customName(decide(snap({ flags: seer(), tile: floor, invIds: [FT_ID.SEALED_VASE_WATER] }))))
            .toBe('freeze the sealed vase until it shatters');
        expect(customName(decide(snap({ flags: seer(), tile: floor, invIds: [FT_ID.FROZEN_KEY] }))))
            .toBe('melt the ice off the key');
        expect(customName(decide(snap({ flags: seer(), tile: floor, invIds: [FT_ID.SEERS_KEY] }))))
            .toBe('take the trapdoor down to the locked door');
        expect(customName(decide(snap({ flags: seer(), tile: { x: 2636, z: 3665, level: 0 }, invIds: [FT_ID.SEERS_KEY] }))))
            .toBe('unlock the far door');
    });
});

describe("Thorvald's battleground", () => {
    const warrior = (extra: string[] = []): string[] => only('warrior', ['warrior-started', ...extra]);

    test('climbs down with an empty pack', () => {
        expect(customName(decide(snap({ flags: warrior() })))).toBe("climb down to Thorvald's battleground");
    });

    test('banks through Peer while anything is still worn', () => {
        expect(talkTo(decide(snap({ flags: warrior(), worn: ['Rune chainbody'] })))).toBe('Peer the Seer');
    });

    test('fights once it is down there', () => {
        const step = decide(snap({ flags: warrior(), tile: { x: 2671, z: 10098, level: 2 } }));

        expect(customName(step)).toBe('fight Koschei to the death');
    });

    test('climbs out of the loft the honourable death drops it in', () => {
        const step = decide(snap({ flags: warrior(), tile: { x: 2667, z: 3692, level: 1 } }));

        expect(customName(step)).toBe('climb down from the loft');
    });

    test('climbs out of the loft before walking to Brundt for the seventh vote', () => {
        const won = ALL_TRIALS.map(t => `${t}-done`);
        const step = decide(snap({ votes: 7, flags: won, tile: { x: 2667, z: 3692, level: 1 } }));

        expect(customName(step)).toBe('climb down from the loft');
    });
});

describe('the combination lock', () => {
    test('answers every riddle the door can roll', () => {
        const answers: [string, string][] = [
            ['My first is in mage, but not in wizard.', 'MIND'],
            ['My first is in tar, but not in a swamp.', 'TREE'],
            ['My first is in the well, but not at sea.', 'LIFE'],
            ['My first is in fish, but not in the sea.', 'FIRE'],
            ['My first is in water, and also in tea.', 'TIME'],
            ['My first is in wizard, but not in a mage.', 'WIND']
        ];
        for (const [plaque, word] of answers) {
            expect(riddleAnswer(plaque)).toBe(word);
        }
    });

    test('answers from the second plaque alone', () => {
        expect(riddleAnswer('My whole wears more rings the older I get.')).toBe('TREE');
        expect(riddleAnswer('My whole cannot die as long as it has food.')).toBe('FIRE');
    });

    test('does not guess at an unknown plaque', () => {
        expect(riddleAnswer('My first is in nothing at all.')).toBeNull();
    });
});

describe('the quest record', () => {
    test('names the three skill floors the trials gate on', () => {
        expect(fremenniktrials.record.requirements.skills).toEqual([
            { skill: 'woodcutting', level: 40 },
            { skill: 'crafting', level: 40 },
            { skill: 'fletching', level: 25 }
        ]);
    });

    test('owns its own inventory and banks in Seers Village', () => {
        expect(fremenniktrials.ownsInventory).toBe(true);
        expect(fremenniktrials.bank).toMatchObject({ x: 2725, z: 3491 });
    });
});

describe("the Draugen's search box", () => {
    const full = { xlo: 2600, xhi: 2760, zlo: 3540, zhi: 3720 };

    test('starts aiming at the middle of the province', () => {
        expect(middle(full)).toMatchObject({ x: 2680, z: 3630 });
    });

    test('a diagonal bearing cuts both axes to the named side', () => {
        expect(narrow(full, { x: 2680, z: 3630 }, 'north-east')).toEqual({ xlo: 2681, xhi: 2760, zlo: 3631, zhi: 3720 });
    });

    test('a straight bearing pins the axis it says nothing about', () => {
        expect(narrow(full, { x: 2680, z: 3630 }, 'west')).toEqual({ xlo: 2600, xhi: 2679, zlo: 3630, zhi: 3630 });
    });

    test('halves that cross over give the search nothing to aim at', () => {
        const pinched = { xlo: 2700, xhi: 2760, zlo: 3540, zhi: 3720 };

        expect(narrow(pinched, { x: 2690, z: 3600 }, 'west')).toBeNull();
    });

    test('reopening around the character stays inside the province', () => {
        expect(around({ x: 2604, z: 3716 })).toEqual({ xlo: 2600, xhi: 2616, zlo: 3704, zhi: 3720 });
    });

    test('an unreadable bearing leaves the box alone', () => {
        expect(narrow(full, { x: 2688, z: 3626 }, 'nowhere')).toBe(full);
    });

    test('the box closes between two readings that bracket the Draugen', () => {
        const north = narrow(full, { x: 2688, z: 3626 }, 'north')!;
        const closing = narrow(north, { x: 2688, z: 3660 }, 'south')!;

        expect(middle(closing)).toMatchObject({ x: 2688, z: 3643 });
    });
});

describe("Swensen's maze — where the route thinks we are", () => {
    const tile = (x: number, z: number) => ({ x, z, level: 0 });

    test('the ladder entry reads as the start of the route', () => {
        expect(mazeLegAt(tile(2631, 10004))).toBe(0);
    });

    test('each landing reads as the leg that portal just finished', () => {
        MAZE_ROUTE.forEach((hop, i) => {
            expect(mazeLegAt(tile(hop.land.x, hop.land.z))).toBe(i + 1);
        });
    });

    test('each stand reads as the leg whose portal is still to come', () => {
        MAZE_ROUTE.forEach((hop, i) => {
            expect(mazeLegAt(tile(hop.stand.x, hop.stand.z))).toBe(i);
        });
    });

    test('a tile in neither set is scattered', () => {
        expect(mazeLegAt(tile(2645, 10045))).toBe(-1);
    });

    test('no tile is read at all when the scene has no player', () => {
        expect(mazeLegAt(null)).toBe(-1);
    });
});
