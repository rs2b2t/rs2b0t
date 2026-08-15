import { beforeEach, describe, expect, test } from 'bun:test';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import {
    committed,
    decide,
    FOOD_TARGET,
    ITEM,
    parseTrollStrongholdJournal,
    TROLL_FLAG,
    TROLL_STAGE,
    trollZone,
    trollstronghold
} from '#/bot/api/ai/quests/defs/trollstronghold/index.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const BURTHORPE: WorldTile = { x: 2896, z: 3528, level: 0 };
const ARENA: WorldTile = { x: 2912, z: 3613, level: 0 };
const STRONGHOLD: WorldTile = { x: 2837, z: 10090, level: 2 };
const PRISON: WorldTile = { x: 2833, z: 10078, level: 0 };
const SECRET_WAY: WorldTile = { x: 2856, z: 3613, level: 0 };
const MOUNTAIN: WorldTile = { x: 2840, z: 3690, level: 0 };
const TROLL_PASS: WorldTile = { x: 2907, z: 10019, level: 0 };

const FOOD = Array(FOOD_TARGET).fill('Lobster') as string[];
const COINS = Array(500).fill('Coins') as string[];
const WEAPON = 'Rune scimitar';

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    flags?: string[];
    inv?: string[];
    worn?: string[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: WorldTile | null;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const stage = options.stage ?? TROLL_STAGE.NOT_STARTED;
    const bank = counts(options.bank ?? []);
    return {
        journal: options.journal ?? (stage === TROLL_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv: counts(options.inv ?? []),
        worn: new Set((options.worn ?? []).map(name => name.toLowerCase())),
        noProgress: 0,
        bankCoins: bank.get('coins') ?? 0,
        stage,
        progress: { stage, flags: new Set(options.flags ?? []) },
        bank,
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? BURTHORPE : options.tile,
        freeSlots: 28
    };
}

/** A pack that has already been kitted out: nothing left for prepare() to do. */
function ready(options: SnapshotOptions = {}): QuestSnapshot {
    return snap({
        journal: 'inProgress',
        inv: [...FOOD, ...COINS],
        worn: [ITEM.CLIMBING_BOOTS, WEAPON],
        ...options
    });
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

beforeEach(() => {
    QuestFood.name = 'Lobster';
    QuestLoadout.current = { name: 'quest', worn: { righthand: WEAPON }, carry: [{ item: 'Lobster', qty: 16 }] };
});

describe('Troll Stronghold journal stage parsing', () => {
    test.each([
        [
            '@dbl@I can start this quest by speaking to @dre@Denulth@dbl@ in his tent at the @dre@Imperial Guard Camp@dbl@ in @dre@Burthorpe@dbl@ after completing the @dre@Death Plateau Quest',
            0
        ],
        [
            '@dbl@I promised @dre@Denulth@dbl@ that I would rescue @dre@Godric@dbl@ from the @dre@Troll Stronghold',
            10
        ],
        [
            '@dbl@I promised @dre@Denulth@dbl@ that I would rescue @dre@Godric@dbl@ from the @dre@Troll Stronghold||@str@I got some climbing boots from Tenzing.||@dbl@I have to defeat the @dre@Troll Champion@dbl@ to get past the @dre@Arena',
            10
        ],
        [
            '@dbl@I promised Denulth||@str@I have defeated the Troll Champion.||@dbl@I have to find a way to get into the @dre@Troll Stronghold',
            20
        ],
        [
            '@str@I have defeated the Troll Champion.||@str@I have found my way into the Troll Stronghold||@str@I have the prison key.|@dbl@I have to get into the @dre@prison',
            20
        ],
        [
            '@str@I have found my way into the prison.||@dbl@I have to rescue @dre@Godric',
            30
        ],
        [
            "@str@I have found my way into the prison.||@str@I've rescued Mad Eadgar.|@dbl@I have to rescue @dre@Godric",
            30
        ],
        [
            "@str@I've rescued Godric and Mad Eadgar.|@dbl@I should return and tell @dre@Dunstan@dbl@ his son is safe.",
            40
        ],
        [
            '@str@I talked to Dunstan and he gave me the Law Talisman|@str@as a token of thanks!||@red@QUEST COMPLETE!',
            50
        ]
    ])('maps journal text to stage %i', (text, stage) => {
        expect(parseTrollStrongholdJournal(text as string)?.stage).toBe(stage);
    });

    test('reads sub-progress flags from journal lines', () => {
        const progress = parseTrollStrongholdJournal(
            '@str@I got some climbing boots from Tenzing.||@str@I have defeated the Troll Champion.||@str@I have found my way into the Troll Stronghold||@str@I have the prison key.'
        );
        expect(progress?.stage).toBe(TROLL_STAGE.DEFEATED_DAD);
        expect(progress?.flags.has(TROLL_FLAG.BOOTS)).toBe(true);
        expect(progress?.flags.has(TROLL_FLAG.ENTERED_STRONGHOLD)).toBe(true);
        expect(progress?.flags.has(TROLL_FLAG.HAS_PRISON_KEY)).toBe(true);
    });

    test('reads the freed-Eadgar flag from both the stage-30 and stage-40 wording', () => {
        const inPrison = parseTrollStrongholdJournal(
            "@str@I have found my way into the prison.||@str@I've rescued Mad Eadgar.|@dbl@I have to rescue @dre@Godric"
        );
        expect(inPrison?.flags.has(TROLL_FLAG.FREED_EADGAR)).toBe(true);
        const freed = parseTrollStrongholdJournal(
            "@str@I've rescued Godric and Mad Eadgar.|@dbl@I should return and tell @dre@Dunstan@dbl@ his son is safe."
        );
        expect(freed?.flags.has(TROLL_FLAG.FREED_EADGAR)).toBe(true);
    });

    test('does not read the Eadgar flag when only Godric was freed', () => {
        const progress = parseTrollStrongholdJournal(
            "@str@I've rescued Godric.|@dbl@I should return and tell @dre@Dunstan@dbl@ his son is safe."
        );
        expect(progress?.stage).toBe(TROLL_STAGE.FREED_GODRIC);
        expect(progress?.flags.has(TROLL_FLAG.FREED_EADGAR)).toBe(false);
    });

    test('fails closed on incomplete journal text', () => {
        expect(parseTrollStrongholdJournal(['Troll Stronghold', 'Loading…'])).toBeUndefined();
    });
});

describe('Troll Stronghold zones', () => {
    test('classifies every leg of the route', () => {
        expect(trollZone(BURTHORPE)).toBe('mainland');
        expect(trollZone(SECRET_WAY)).toBe('secretWay');
        expect(trollZone(ARENA)).toBe('arena');
        expect(trollZone(TROLL_PASS)).toBe('trollPass');
        expect(trollZone(MOUNTAIN)).toBe('mountain');
        expect(trollZone(STRONGHOLD)).toBe('stronghold');
        expect(trollZone(PRISON)).toBe('stronghold');
        expect(trollZone({ x: 3200, z: 3200, level: 0 })).toBe('mainland');
        expect(trollZone(null)).toBe('unknown');
    });

    test('only the mainland is cheap enough to bank from', () => {
        expect(committed(trollZone(BURTHORPE))).toBe(false);
        expect(committed(trollZone(null))).toBe(false);
        for (const tile of [SECRET_WAY, ARENA, TROLL_PASS, MOUNTAIN, STRONGHOLD, PRISON]) {
            expect(committed(trollZone(tile))).toBe(true);
        }
    });
});

describe('Troll Stronghold loadout', () => {
    test('reads the bank before deciding anything about supplies', () => {
        const step = decide(snap({ stage: TROLL_STAGE.STARTED, bankKnown: false }));
        expect(step.kind).toBe('scanBank');
    });

    test('banks anything that is not part of the loadout', () => {
        const step = decide(snap({ stage: TROLL_STAGE.STARTED, inv: ['Bones', ...FOOD] }));
        expect(step.kind).toBe('deposit');
    });

    test('withdraws the coin float before the boots it has to buy', () => {
        const step = decide(snap({ stage: TROLL_STAGE.STARTED, bank: COINS }));
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe(ITEM.COINS);
    });

    test('withdraws banked climbing boots rather than buying a second pair', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            bank: [ITEM.CLIMBING_BOOTS]
        }));
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe(ITEM.CLIMBING_BOOTS);
    });

    test('wears the gear it just withdrew before walking off to Tenzing', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: [WEAPON, ...COINS, ...FOOD]
        }));
        expect(customName(step)).toBe(`wear ${WEAPON}`);
    });

    test('buys boots from Tenzing when the bank has none', () => {
        const step = decide(snap({ stage: TROLL_STAGE.STARTED, inv: COINS }));
        expect(customName(step)).toContain('Tenzing');
    });

    test('waits, naming the shortfall, when it cannot pay for boots', () => {
        const step = decide(snap({ stage: TROLL_STAGE.STARTED }));
        expect(step.kind === 'wait' && step.reason).toContain('Climbing boots');
    });

    test('equips boots it is carrying', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: [ITEM.CLIMBING_BOOTS, ...COINS]
        }));
        expect(customName(step)).toBe(`wear ${ITEM.CLIMBING_BOOTS}`);
    });

    test('withdraws the loadout weapon when nothing is wielded', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS],
            bank: [WEAPON]
        }));
        expect(step.kind === 'withdraw' && step.items[0]?.name).toBe(WEAPON);
    });

    test('with no loadout it scavenges the best the bank holds', () => {
        QuestLoadout.current = null;
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS],
            bank: ['Lobster', 'Rune scimitar', 'Mithril scimitar', 'Rune chainbody']
        }));
        const names = step.kind === 'withdraw' ? step.items.map(i => i.name) : [];
        expect(names).toContain('Rune scimitar');
        expect(names).toContain('Rune chainbody');
        expect(names).not.toContain('Mithril scimitar');
    });

    test('with no loadout and an empty bank it says so instead of parking silently', () => {
        QuestLoadout.current = null;
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: [...COINS, ...FOOD],
            worn: [ITEM.CLIMBING_BOOTS],
            bank: Array(40).fill('Lobster') as string[]
        }));
        expect(step.kind === 'wait' && step.reason).toContain('no melee weapon');
    });

    test('withdraws every piece of loadout gear it is not already wearing', () => {
        QuestLoadout.current = {
            name: 'quest',
            worn: { righthand: WEAPON, torso: 'Rune chainbody' },
            carry: [{ item: 'Lobster', qty: 16 }]
        };
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS],
            bank: [WEAPON, 'Rune chainbody', ...Array(40).fill('Lobster')] as string[]
        }));
        expect(step.kind === 'withdraw' && step.items.map(i => i.name).sort())
            .toEqual(['Lobster', 'Rune chainbody', WEAPON]);
    });

    test('wears the whole kit in a single step', () => {
        QuestLoadout.current = {
            name: 'quest',
            worn: { righthand: WEAPON, torso: 'Rune chainbody', legs: 'Rune platelegs' },
            carry: []
        };
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: [...COINS, ...FOOD, WEAPON, 'Rune chainbody', 'Rune platelegs'],
            worn: [ITEM.CLIMBING_BOOTS],
            bank: []
        }));
        const name = customName(step);
        expect(name).toContain(WEAPON);
        expect(name).toContain('Rune chainbody');
        expect(name).toContain('Rune platelegs');
    });

    test('boot money rides the same bank visit as the gear', () => {
        QuestLoadout.current = { name: 'quest', worn: { righthand: WEAPON }, carry: [] };
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: [],
            worn: [],
            bank: [WEAPON, ...COINS, ...Array(40).fill('Lobster')] as string[]
        }));
        const names = step.kind === 'withdraw' ? step.items.map(i => i.name) : [];
        expect(names).toContain(ITEM.COINS);
        expect(names).toContain(WEAPON);
    });

    test('withdraws two prayer potions when the bank has them', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS, WEAPON],
            bank: [...Array(40).fill('Lobster'), ...Array(5).fill('Prayer potion(4)')] as string[]
        }));
        expect(step.kind === 'withdraw'
            && step.items.find(i => i.name === 'Prayer potion(4)')?.qty).toBe(2);
    });

    test('prefers the strongest dose the bank holds', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS, WEAPON],
            bank: [...Array(40).fill('Lobster'), 'Prayer potion(2)', 'Prayer potion(3)'] as string[]
        }));
        expect(step.kind === 'withdraw'
            && step.items.find(i => i.name?.startsWith('Prayer potion'))?.name).toBe('Prayer potion(3)');
    });

    test('tops up from a weaker dose when the strong one runs short', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS, WEAPON],
            bank: [...Array(40).fill('Lobster'), 'Prayer potion(4)', 'Prayer potion(3)'] as string[]
        }));
        const potions = step.kind === 'withdraw'
            ? step.items.filter(i => i.name.startsWith('Prayer potion'))
            : [];
        expect(potions.reduce((n, i) => n + i.qty, 0)).toBe(2);
    });

    test('carries on without potions when the bank has none', () => {
        const step = decide(ready({ stage: TROLL_STAGE.STARTED, tile: ARENA }));
        expect(customName(step)).toContain('Dad');
    });

    test('does not bank the potions it is carrying', () => {
        const step = decide(ready({
            stage: TROLL_STAGE.STARTED,
            inv: [...FOOD, ...COINS, 'Prayer potion(4)', 'Prayer potion(4)'],
            tile: ARENA
        }));
        expect(step.kind).not.toBe('deposit');
        expect(customName(step)).toContain('Dad');
    });

    test('withdraws food up to the target', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS, WEAPON],
            bank: Array(40).fill('Lobster') as string[]
        }));
        expect(step.kind === 'withdraw' && step.items[0]).toEqual({ name: 'Lobster', qty: FOOD_TARGET });
    });

    test('waits, naming the shortfall, when the bank holds no food at all', () => {
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: COINS,
            worn: [ITEM.CLIMBING_BOOTS, WEAPON]
        }));
        expect(step.kind === 'wait' && step.reason).toContain('no combat food');
    });

    test('wearing gear is a step that can give up, not a plain equip that retries forever', () => {
        // A rune platebody also wants Dragon Slayer; the server refuses, and
        // a `kind: equip` step re-derived from the same snapshot never stops.
        const step = decide(snap({
            stage: TROLL_STAGE.STARTED,
            inv: [WEAPON, ...COINS],
            worn: [ITEM.CLIMBING_BOOTS]
        }));
        expect(step.kind).toBe('custom');
        expect(customName(step)).toBe(`wear ${WEAPON}`);
    });

    test('does not walk back down the mountain for a pack that is merely low', () => {
        const step = decide(ready({
            stage: TROLL_STAGE.STARTED,
            inv: ['Lobster', 'Lobster', 'Lobster', 'Lobster'],
            tile: ARENA
        }));
        expect(customName(step)).toContain('Dad');
    });

    test('does walk back down when the pack is spent', () => {
        const step = decide(ready({
            stage: TROLL_STAGE.STARTED,
            inv: ['Lobster'],
            tile: ARENA,
            bank: Array(40).fill('Lobster') as string[]
        }));
        expect(step.kind).toBe('withdraw');
    });
});

describe('Troll Stronghold decide', () => {
    test('module record id is troll', () => {
        expect(trollstronghold.record.id).toBe('troll');
        expect(trollstronghold.ownsInventory).toBe(true);
        expect(trollstronghold.sustain?.eatBelowHp).toBe(0.6);
        // The spillover deposit banks everything not named here — coins included,
        // and without them every purchase parks on "need N gp".
        expect(trollstronghold.tools).toContain('coins');
    });

    test('starts with Denulth once the loadout is ready', () => {
        // Death Plateau's gate reads live quest state; with no client attached
        // that is notStarted, so the honest answer is a wait.
        const step = decide(ready({ stage: TROLL_STAGE.NOT_STARTED, journal: 'notStarted' }));
        expect(step.kind === 'talk' || step.kind === 'wait').toBe(true);
        if (step.kind === 'talk') {
            expect(step.stop.npc).toBe('Denulth');
        }
    });

    test('fights Dad once started and kitted out', () => {
        expect(customName(decide(ready({ stage: TROLL_STAGE.STARTED, tile: ARENA })))).toContain('Dad');
    });

    test('hunts a Troll General for the prison key after Dad', () => {
        const step = decide(ready({ stage: TROLL_STAGE.DEFEATED_DAD, tile: STRONGHOLD }));
        expect(customName(step)?.toLowerCase()).toContain('prison key');
    });

    test('goes straight to the prison once the key is in the pack', () => {
        const step = decide(ready({
            stage: TROLL_STAGE.DEFEATED_DAD,
            inv: [ITEM.PRISON_KEY, ...FOOD, ...COINS],
            tile: STRONGHOLD
        }));
        expect(customName(step)?.toLowerCase()).toContain('unlock the troll prison');
    });

    test('frees Mad Eadgar alongside Godric while it is standing there', () => {
        const step = decide(ready({ stage: TROLL_STAGE.ENTERED_PRISON, tile: PRISON }));
        expect(customName(step)).toContain('Mad Eadgar');
        expect(customName(step)).toContain('Godric');
    });

    test('skips Mad Eadgar when the journal says he is already out', () => {
        const step = decide(ready({
            stage: TROLL_STAGE.ENTERED_PRISON,
            flags: [TROLL_FLAG.FREED_EADGAR],
            tile: PRISON
        }));
        expect(customName(step)).not.toContain('Eadgar');
        expect(customName(step)).toContain('Godric');
    });

    test('reports to Dunstan after freeing Godric', () => {
        const step = decide(ready({ stage: TROLL_STAGE.FREED_GODRIC, tile: BURTHORPE }));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Dunstan');
    });

    test('done when complete', () => {
        expect(decide(snap({ stage: TROLL_STAGE.COMPLETE, journal: 'complete' })).kind).toBe('done');
    });
});
