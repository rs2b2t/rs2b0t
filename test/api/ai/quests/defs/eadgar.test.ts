import { beforeEach, describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { ER_ITEM, type EadgarItem } from '#/bot/api/ai/quests/defs/eadgar/areas.js';
import { decide, eadgar } from '#/bot/api/ai/quests/defs/eadgar/index.js';
import { EADGAR_FLAG, EADGAR_STAGE } from '#/bot/api/ai/quests/defs/eadgar/journal.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';

const FALADOR: WorldTile = { x: 2946, z: 3369, level: 0 };
const ARDOUGNE: WorldTile = { x: 2616, z: 3332, level: 0 };
const CAVE: WorldTile = { x: 2890, z: 10086, level: 2 };
const STRONGHOLD: WorldTile = { x: 2844, z: 10057, level: 1 };
const WEAPON = 'Rune scimitar';

type Stack = readonly [EadgarItem, number];

interface Options {
    stage?: number;
    flags?: string[];
    journal?: QuestSnapshot['journal'];
    inv?: readonly Stack[];
    bank?: readonly Stack[];
    food?: number;
    bankFood?: number;
    worn?: readonly EadgarItem[];
    bankKnown?: boolean;
    tile?: WorldTile | null;
}

function stacks(list: readonly Stack[], food: number): { names: Map<string, number>; ids: Map<number, number> } {
    const names = new Map<string, number>();
    const ids = new Map<number, number>();
    for (const [item, qty] of list) {
        names.set(item.name.toLowerCase(), (names.get(item.name.toLowerCase()) ?? 0) + qty);
        ids.set(item.id, (ids.get(item.id) ?? 0) + qty);
    }
    if (food > 0) {
        names.set('lobster', food);
    }
    return { names, ids };
}

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? EADGAR_STAGE.STARTED;
    const pack = stacks(options.inv ?? [], options.food ?? 0);
    const vault = stacks(options.bank ?? [], options.bankFood ?? 0);
    const flags = new Set(options.flags ?? [EADGAR_FLAG.EADGAR_FREED]);
    return {
        journal: options.journal ?? (stage === EADGAR_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: pack.names,
        invIds: pack.ids,
        worn: new Set((options.worn ?? []).map(item => item.name.toLowerCase())),
        wornIds: new Set((options.worn ?? []).map(item => item.id)),
        noProgress: 0,
        bankCoins: vault.ids.get(ER_ITEM.COINS.id) ?? 0,
        stage,
        progress: { stage, flags },
        bank: vault.names,
        bankIds: vault.ids,
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? FALADOR : options.tile,
        freeSlots: 28
    };
}

/** A pack `prepare()` is finished with: boots on, coin float drawn, food aboard. */
function ready(options: Options = {}): QuestSnapshot {
    return snap({
        food: 8,
        worn: [ER_ITEM.CLIMBING_BOOTS],
        ...options,
        inv: [[ER_ITEM.COINS, 1000], ...(options.inv ?? [])]
    });
}

const customName = (step: QuestStep): string | null => (step.kind === 'custom' ? step.name : null);

// Why: the mountain-side talks are custom steps so the crossing can hold a protection prayer, and
// they keep the `talk to <npc>` label a plain `talk` step would have printed.
const talkedTo = (step: QuestStep): string | null => {
    if (step.kind === 'talk') {
        return step.stop.npc;
    }
    return step.kind === 'custom' && step.name.startsWith('talk to ') ? step.name.slice('talk to '.length) : null;
};

const realStatus = Quests.status;

beforeEach(() => {
    QuestFood.name = 'Lobster';
    QuestLoadout.current = { name: 'quest', worn: { righthand: WEAPON }, carry: [] };
    Quests.status = realStatus;
});

describe("Eadgar's Ruse module wiring", () => {
    test('is registered against the quest record and owns its own inventory', () => {
        expect(eadgar.record.id).toBe('eadgar');
        expect(eadgar.record.name).toBe("Eadgar's Ruse");
        expect(eadgar.ownsInventory).toBe(true);
        expect(eadgar.readProgress).toBeDefined();
    });

    test('keeps every quest item through a deposit', () => {
        for (const item of Object.values(ER_ITEM)) {
            expect(eadgar.tools).toContain(item.name.toLowerCase());
        }
    });
});

describe("Eadgar's Ruse decide — guards", () => {
    test('a complete journal is done', () => {
        expect(decide(snap({ journal: 'complete', stage: EADGAR_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('an unread journal waits rather than guessing a stage', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('a stage the parser could not read waits', () => {
        const base = snap();
        const step = decide({ ...base, stage: undefined, progress: undefined });
        expect(step.kind === 'wait' && step.reason).toContain('journal stage unavailable');
    });

    // Why: Troll Stronghold finishes on Godric alone, and the Cave Entrance then drops the character
    // into an empty room — so the cell is opened before any leg that needs Eadgar.
    test('an unfreed Mad Eadgar is freed before anything else', () => {
        const step = decide(ready({ stage: EADGAR_STAGE.NEEDS_PARROT, flags: [] }));
        expect(customName(step)).toBe('free Mad Eadgar from the troll prison');
    });
});

describe("Eadgar's Ruse decide — loadout", () => {
    test('reads the bank before deciding anything about supplies', () => {
        expect(decide(snap({ bankKnown: false })).kind).toBe('scanBank');
    });

    // Why: `nearest` ranks banks by straight line, and the cave sits at z ≈ 10 000 where every surface bank is six thousand tiles away — one run banked at Edgeville and walked to the Tree Gnome Stronghold through the wilderness.
    test('pins Falador West from above the stile and stays on nearest below it', () => {
        const bankOf = (tile: WorldTile): string => {
            const step = decide(snap({ bankKnown: false, tile }));
            if (step.kind !== 'scanBank') {
                return step.kind;
            }
            return step.bank ? `${step.bank.x},${step.bank.z},${step.bank.level}` : 'nearest';
        };
        expect(bankOf(CAVE)).toBe('2946,3369,0');
        expect(bankOf(STRONGHOLD)).toBe('2946,3369,0');
        expect(bankOf(ARDOUGNE)).toBe('nearest');
    });

    test('banks anything that is not part of the loadout', () => {
        const base = ready();
        base.inv.set('bones', 1);
        expect(decide(base).kind).toBe('deposit');
    });

    test('draws the coin float from the bank before walking anywhere', () => {
        const step = decide(snap({ food: 8, worn: [ER_ITEM.CLIMBING_BOOTS], bank: [[ER_ITEM.COINS, 5000]] }));
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe(ER_ITEM.COINS.name);
    });

    test('withdraws banked climbing boots rather than buying a second pair', () => {
        const step = decide(snap({
            food: 8,
            inv: [[ER_ITEM.COINS, 1000]],
            bank: [[ER_ITEM.CLIMBING_BOOTS, 1]]
        }));
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe(ER_ITEM.CLIMBING_BOOTS.name);
    });

    test('buys the boots from Tenzing when the bank has none', () => {
        const step = decide(snap({ food: 8, inv: [[ER_ITEM.COINS, 1000]] }));
        expect(customName(step)).toContain('Climbing boots from Tenzing');
    });

    test('wears the boots it is carrying', () => {
        const step = decide(snap({ food: 8, inv: [[ER_ITEM.COINS, 1000], [ER_ITEM.CLIMBING_BOOTS, 1]] }));
        expect(customName(step)).toBe(`wear ${ER_ITEM.CLIMBING_BOOTS.name}`);
    });

    // Why: past the stile a bank trip means climbing back down the secret way, so only a spent pack
    // or missing boots is worth the walk.
    test('does not walk back down the mountain for a top-up', () => {
        const step = decide(ready({ stage: EADGAR_STAGE.NEEDS_PARROT_BACK, tile: STRONGHOLD, food: 3 }));
        expect(customName(step)).toBe('fetch the parrot back from under the rack');
    });
});

describe("Eadgar's Ruse decide — the quest legs", () => {
    // Why: Sanfew's offer is gated on Troll Stronghold, and the journal reads notStarted either way,
    // so a queue that runs this quest early would otherwise walk to Taverley on every tick.
    test('stage 0 waits on Troll Stronghold, and asks Sanfew once it is complete', () => {
        Quests.status = () => 'inProgress';
        const blocked = decide(ready({ stage: EADGAR_STAGE.NOT_STARTED, journal: 'inProgress' }));
        expect(blocked.kind === 'wait' && blocked.reason).toContain('Troll Stronghold must be complete');

        Quests.status = () => 'complete';
        const step = decide(ready({ stage: EADGAR_STAGE.NOT_STARTED, journal: 'inProgress' }));
        expect(talkedTo(step)).toBe('Sanfew');
    });

    test('stage 10 walks to Eadgar and stage 15 to Burntmeat', () => {
        expect(talkedTo(decide(ready({ stage: EADGAR_STAGE.STARTED })))).toBe('Eadgar');
        expect(talkedTo(decide(ready({ stage: EADGAR_STAGE.SPOKE_EADGAR })))).toBe('Burntmeat');
        expect(talkedTo(decide(ready({ stage: EADGAR_STAGE.SPOKE_BURNTMEAT })))).toBe('Eadgar');
        expect(talkedTo(decide(ready({ stage: EADGAR_STAGE.SPOKE_BURNTMEAT_FIRST })))).toBe('Eadgar');
    });

    // Why: the axe is sold one ladder above the fruit and the vodka, and the parrot leg ends four
    // hundred tiles away in Ardougne — so the axe is bought first, on the trip that is happening anyway.
    test('stage 30 buys the axe, then the fruit, then the liquor, then catches the parrot', () => {
        const empty = decide(ready({ stage: EADGAR_STAGE.NEEDS_PARROT, tile: ARDOUGNE }));
        expect(empty.kind === 'buy' && empty.item).toBe(ER_ITEM.AXE.name);

        const kit = (...inv: readonly Stack[]): QuestStep =>
            decide(ready({ stage: EADGAR_STAGE.NEEDS_PARROT, tile: ARDOUGNE, inv: [[ER_ITEM.AXE, 1], ...inv] }));

        const noFruit = kit();
        expect(noFruit.kind === 'buy' && noFruit.item).toBe(ER_ITEM.KNIFE.name);

        const withKnife = kit([ER_ITEM.KNIFE, 1]);
        expect(withKnife.kind === 'buy' && withKnife.item).toBe(ER_ITEM.PINEAPPLE.name);

        expect(customName(kit([ER_ITEM.KNIFE, 1], [ER_ITEM.PINEAPPLE, 1]))).toBe('dice the pineapple');

        const withChunks = kit([ER_ITEM.PINEAPPLE_CHUNKS, 1]);
        expect(withChunks.kind === 'buy' && withChunks.item).toBe(ER_ITEM.VODKA.name);

        expect(customName(kit([ER_ITEM.PINEAPPLE_CHUNKS, 1], [ER_ITEM.VODKA, 1]))).toContain('catch a parrot');
        expect(talkedTo(kit([ER_ITEM.DRUNK_PARROT, 1]))).toBe('Eadgar');
    });

    // Why: the aviary refuses a second parrot while one is in the bank, so the banked one is the
    // only one this account will ever get.
    test('a banked parrot is withdrawn rather than caught again', () => {
        const step = decide(ready({
            stage: EADGAR_STAGE.NEEDS_PARROT,
            inv: [[ER_ITEM.AXE, 1]],
            bank: [[ER_ITEM.DRUNK_PARROT, 1]]
        }));
        expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(ER_ITEM.DRUNK_PARROT.id);
    });

    test('stage 50 hides the parrot, and re-asks Eadgar when it is nowhere', () => {
        const withParrot = decide(ready({ stage: EADGAR_STAGE.EXPLAINED_PLAN, inv: [[ER_ITEM.DRUNK_PARROT, 1]] }));
        expect(customName(withParrot)).toBe('hide the parrot under the prison rack');

        const lost = decide(ready({ stage: EADGAR_STAGE.EXPLAINED_PLAN }));
        expect(talkedTo(lost)).toBe('Eadgar');
    });

    test('stage 60 gathers the whole scarecrow before it walks up the mountain', () => {
        const empty = decide(ready({ stage: EADGAR_STAGE.HID_PARROT, tile: ARDOUGNE }));
        expect(empty.kind === 'buy' && empty.item).toBe(ER_ITEM.AXE.name);

        const withAxe = decide(ready({
            stage: EADGAR_STAGE.HID_PARROT,
            tile: ARDOUGNE,
            inv: [[ER_ITEM.AXE, 1]]
        }));
        expect(customName(withAxe)).toBe('chop 1 logs');

        const withLogs = decide(ready({
            stage: EADGAR_STAGE.HID_PARROT,
            tile: ARDOUGNE,
            inv: [[ER_ITEM.LOGS, 1]]
        }));
        expect(customName(withLogs)).toContain('kill chickens');

        const withChickens = decide(ready({
            stage: EADGAR_STAGE.HID_PARROT,
            tile: ARDOUGNE,
            inv: [[ER_ITEM.LOGS, 1], [ER_ITEM.RAW_CHICKEN, 5]]
        }));
        expect(withChickens.kind === 'pickLoc' && withChickens.loc).toBe('Wheat');

        const stocked = decide(ready({
            stage: EADGAR_STAGE.HID_PARROT,
            inv: [[ER_ITEM.LOGS, 1], [ER_ITEM.RAW_CHICKEN, 5], [ER_ITEM.GRAIN, 10]]
        }));
        expect(talkedTo(stocked)).toBe('Eadgar');
    });

    test('stage 60 prefers a banked sheaf over a walk to the wheat field', () => {
        const step = decide(ready({
            stage: EADGAR_STAGE.HID_PARROT,
            inv: [[ER_ITEM.LOGS, 1], [ER_ITEM.RAW_CHICKEN, 5]],
            bank: [[ER_ITEM.GRAIN, 10]]
        }));
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe(ER_ITEM.GRAIN.name);
    });

    // Why: Tegid only parts with a robe while the quest sits at stage 70, so the journal's needs
    // list is what says whether the trip is still owed.
    test('stage 70 fetches only what the journal still lists', () => {
        const robeOnly = decide(ready({
            stage: EADGAR_STAGE.NEEDS_ITEMS,
            flags: [EADGAR_FLAG.EADGAR_FREED, EADGAR_FLAG.NEED_CLOTHES]
        }));
        expect(talkedTo(robeOnly)).toBe('Tegid');

        const grainOnly = decide(ready({
            stage: EADGAR_STAGE.NEEDS_ITEMS,
            flags: [EADGAR_FLAG.EADGAR_FREED, `${EADGAR_FLAG.NEED_GRAIN}:3`],
            tile: ARDOUGNE
        }));
        expect(grainOnly.kind === 'pickLoc' && grainOnly.loc).toBe('Wheat');

        const nothingLeft = decide(ready({ stage: EADGAR_STAGE.NEEDS_ITEMS }));
        expect(talkedTo(nothingLeft)).toBe('Eadgar');
    });

    test('stage 70 withdraws a banked robe rather than asking Tegid twice', () => {
        const step = decide(ready({
            stage: EADGAR_STAGE.NEEDS_ITEMS,
            flags: [EADGAR_FLAG.EADGAR_FREED, EADGAR_FLAG.NEED_CLOTHES],
            bank: [[ER_ITEM.DIRTY_ROBE, 1]]
        }));
        expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(ER_ITEM.DIRTY_ROBE.id);
    });

    // Why: the thistle only grows on Trollheim and everything that processes it is bought at the
    // bottom, so an empty pack shops before it climbs.
    test('stage 80 buys the whole kit before it picks anything', () => {
        const fresh = decide(ready({ stage: EADGAR_STAGE.NEEDS_POTION, tile: CAVE }));
        expect(fresh.kind === 'buy' && fresh.item).toBe(ER_ITEM.TINDERBOX.name);

        const kitted = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            tile: CAVE,
            inv: [[ER_ITEM.TINDERBOX, 1], [ER_ITEM.LOGS, 1], [ER_ITEM.PESTLE, 1], [ER_ITEM.RANARR_VIAL, 1]]
        }));
        expect(customName(kitted)).toBe('pick a Troll Thistle');
    });

    test('stage 80 walks the thistle chain in order', () => {
        const picked = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            tile: CAVE,
            inv: [[ER_ITEM.THISTLE, 1], [ER_ITEM.TINDERBOX, 1], [ER_ITEM.LOGS, 1]]
        }));
        expect(customName(picked)).toBe('dry the thistle over a fire');

        const dried = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            tile: CAVE,
            inv: [[ER_ITEM.DRIED_THISTLE, 1], [ER_ITEM.PESTLE, 1]]
        }));
        expect(customName(dried)).toBe('grind the dried thistle');

        const ground = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            tile: CAVE,
            inv: [[ER_ITEM.GROUND_THISTLE, 1], [ER_ITEM.RANARR_VIAL, 1]]
        }));
        expect(customName(ground)).toBe('mix the troll truth potion');

        const brewed = decide(ready({ stage: EADGAR_STAGE.NEEDS_POTION, inv: [[ER_ITEM.TROLL_POTION, 1]] }));
        expect(talkedTo(brewed)).toBe('Eadgar');
    });

    test('stage 80 mixes the unfinished potion from a banked ranarr weed', () => {
        const needsHerb = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            inv: [[ER_ITEM.GROUND_THISTLE, 1]],
            bank: [[ER_ITEM.RANARR, 1]]
        }));
        expect(needsHerb.kind === 'withdraw' && needsHerb.items[0]?.id).toBe(ER_ITEM.RANARR.id);

        const needsVial = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            inv: [[ER_ITEM.GROUND_THISTLE, 1], [ER_ITEM.RANARR, 1]]
        }));
        expect(needsVial.kind === 'buy' && needsVial.item).toBe(ER_ITEM.VIAL_WATER.name);

        const canMix = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            inv: [[ER_ITEM.GROUND_THISTLE, 1], [ER_ITEM.RANARR, 1], [ER_ITEM.VIAL_WATER, 1]]
        }));
        expect(customName(canMix)).toBe('mix a ranarr potion (unf)');
    });

    // Why: no 2004 shop sells a ranarr weed or a ranarr potion (unf), so an empty bank is a park
    // with a reason rather than a walk that will never find one.
    test('stage 80 parks honestly when there is no ranarr weed anywhere', () => {
        const step = decide(ready({
            stage: EADGAR_STAGE.NEEDS_POTION,
            inv: [[ER_ITEM.GROUND_THISTLE, 1]]
        }));
        expect(step.kind === 'wait' && step.reason).toContain('no Ranarr weed');
    });

    test('stages 85 to 87 run the parrot back through Eadgar to Burntmeat', () => {
        expect(customName(decide(ready({ stage: EADGAR_STAGE.NEEDS_PARROT_BACK }))))
            .toBe('fetch the parrot back from under the rack');
        expect(talkedTo(decide(ready({ stage: EADGAR_STAGE.GOT_PARROT_BACK })))).toBe('Eadgar');
        expect(talkedTo(decide(ready({ stage: EADGAR_STAGE.GOT_FAKE_MAN, inv: [[ER_ITEM.FAKE_MAN, 1]] }))))
            .toBe('Burntmeat');
    });

    test('stage 90 searches the drawers, then unlocks the door with what it found', () => {
        const noKey = decide(ready({ stage: EADGAR_STAGE.GOT_BURNT_MEAT, tile: STRONGHOLD }));
        expect(customName(noKey)).toContain('kitchen drawers');

        const withKey = decide(ready({
            stage: EADGAR_STAGE.GOT_BURNT_MEAT,
            tile: STRONGHOLD,
            inv: [[ER_ITEM.STOREROOM_KEY, 1]]
        }));
        expect(customName(withKey)).toBe('unlock the troll storeroom');
    });

    test('stage 100 takes the goutweed, then carries it to Sanfew', () => {
        const empty = decide(ready({ stage: EADGAR_STAGE.UNLOCKED_STOREROOM, tile: STRONGHOLD }));
        expect(customName(empty)).toContain('goutweed');

        const carrying = decide(ready({
            stage: EADGAR_STAGE.UNLOCKED_STOREROOM,
            tile: STRONGHOLD,
            inv: [[ER_ITEM.GOUTWEED, 1]]
        }));
        expect(talkedTo(carrying)).toBe('Sanfew');
    });

    // Why: decide() is pure, so a bot killed mid-quest re-derives its leg from the same snapshot.
    test('resumes from a half-full pack without repeating a finished leg', () => {
        const midScarecrow = ready({
            stage: EADGAR_STAGE.NEEDS_ITEMS,
            flags: [EADGAR_FLAG.EADGAR_FREED, `${EADGAR_FLAG.NEED_CHICKENS}:2`],
            tile: ARDOUGNE,
            inv: [[ER_ITEM.RAW_CHICKEN, 2], [ER_ITEM.GRAIN, 10]]
        });
        expect(talkedTo(decide(midScarecrow))).toBe('Eadgar');
    });
});
