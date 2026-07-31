# Prince Ali Rescue Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/bot/quests/defs/princeali.ts` with a stage-driven, ID-keyed quest module that completes Prince Ali Rescue end-to-end from any resume point.

**Architecture:** A `QuestModule` with `ownsInventory: true` and a `readProgress()` that parses the quest journal into one of eight server stages. `decide()` switches on the stage; stage 20 walks a fixed ordered list of "source this next" legs, so the check order *is* the route. Every item lookup goes through an object ID, because five of the objects this quest touches share a display name with something else.

**Tech Stack:** TypeScript, `bun test`, `eslint`, `tsc --noEmit`. Live verification through Playwright harnesses in `tools/` against a local Lost City server on `http://localhost:8888`.

**Spec:** `docs/superpowers/specs/2026-07-29-princeali-rebuild-design.md`

## Global Constraints

- Branch is `princeali-rebuild`. `main` is PR-only — never push to `main`.
- Comments are near-absent by house style. No rationale, history, or citations in code comments; a short `@see docs/...` line is fine. Non-obvious *why* goes in the commit message or the spec, not the source.
- **Quest state comes from the journal and from held items. Never from varps.** `prince_keystatus` is `scope=perm` with no `transmit` — the client cannot read it, and no code may pretend otherwise.
- Every item check uses the object ID. `plainwig` (2421) and `blondwig` (2419) both render `Wig`; `beer` (1917), `pot_flour` (1933), `logs` (1511) and `coins` (995) each have a colliding twin.
- `bun test`, `bun run lint` and `bun run typecheck` must all pass before every commit.
- Live harnesses run with `::speed 300` (2x ticks) against `http://localhost:8888`.
- A stage test seeds only what that stage *produces*, never the tools that stage needs. Seeding tools is what let every Watch Tower stage-10 test pass while the quest could not mine.
- The bank starts with **2,000,000 coins and nothing else**. Every other item is sourced from the world.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `src/bot/quests/defs/princeali/journal.ts` | `PRINCE_STAGE`, `parsePrinceJournal`, `readPrinceProgress` |
| Create `src/bot/quests/defs/princeali/areas.ts` | `PA_ITEM` ids, `PA_TILE`, `PA_SHOP`, the `NpcStop`s |
| Create `src/bot/quests/defs/princeali/supplies.ts` | `held`/`banked`/`owned`, `heldItem`, `scanBank`, `sourceCoins`, `buyItem`, `grabItem`, `fromBank` |
| Create `src/bot/quests/defs/princeali/disguise.ts` | wig, dye, ashes, paste, skirt legs |
| Create `src/bot/quests/defs/princeali/key.ts` | bar, water, pickaxe, clay, soft clay, print, forge-and-collect |
| Create `src/bot/quests/defs/princeali/jailbreak.ts` | beers, ropes, Joe, Keli, the door, the prince |
| Create `src/bot/quests/defs/princeali/index.ts` | `decide()`, the ordered `PREP` list, the `QuestModule` |
| Create `src/bot/quests/exec/wool.ts` | shared `shearOne` / `spinAllWool`, parameterised by pen and wheel |
| Delete `src/bot/quests/defs/princeali.ts` | superseded |
| Modify `src/bot/quests/defs/index.ts` | import from `./princeali/index.js` |
| Modify `src/bot/quests/defs/sheepshearer.ts` | call `exec/wool.ts`, keep its own tiles |
| Modify `src/bot/quests/data/quests.ts:101-113` | accurate all-`acquirable` `items` list |
| Create `tools/princeali-solo-test.ts` | stage-jump + bank-seed live harness |
| Create `tools/princeali-wheel-probe.ts` | one-shot Lumbridge spinning-wheel probe |
| Rewrite `test/quests/defs/princeali.test.ts` | table tests over every stage branch |
| Create `test/quests/defs/princeali-journal.test.ts` | journal needle tests |
| Modify `docs/QUESTS.md` | the lessons this quest adds |

---

## Task 1: Journal parsing

**Files:**
- Create: `src/bot/quests/defs/princeali/journal.ts`
- Test: `test/quests/defs/princeali-journal.test.ts`

**Interfaces:**
- Consumes: `QuestProgress` from `src/bot/quests/engine/types.ts`; `Quests` from `src/bot/api/hud/Quests.ts`.
- Produces: `PRINCE_QUEST: string`, `PRINCE_STAGE` (const object with `NOT_STARTED` 0, `STARTED` 10, `SPOKEN_OSMAN` 20, `PREP_FINISHED` 30, `GUARD_DRUNK` 40, `TIED_KELI` 50, `SAVED` 100, `COMPLETE` 110), `parsePrinceJournal(lines: readonly string[] | string): QuestProgress | undefined`, `readPrinceProgress(): Promise<QuestProgress | undefined>`.

- [ ] **Step 1: Write the failing test**

Create `test/quests/defs/princeali-journal.test.ts`. The fixture strings are the real journal
bodies from `scripts/quests/quest_prince/scripts/prince_journal.rs2`, colour tags and all.

```ts
import { describe, expect, test } from 'bun:test';

import { PRINCE_STAGE, parsePrinceJournal } from '#/bot/quests/defs/princeali/journal.js';

const INTRO =
    '@str@Prince Ali has been kidnapped but luckily the spy Leela|@str@has found he is being held near draynor village. I will|'
    + '@str@need to disguise the Prince and tie up his captor to free|@str@him from their clutches.|';
const DRUNK = '@str@I also had to prevent the Guard from seeing what I was up|@str@to, by getting him drunk.|';
const TIED = '@str@With the guard disposed of, I used my rope to tie up Lady|@str@Keli in a cupboard, so I could disguise the Prince.|';
const SAVED =
    '@str@I then used a wig, a skirt and some skin paste to make the|@str@prince look like Lady Keli so he could escape to his|'
    + '@str@freedom with Leela after unlocking his cell door.|';

const JOURNAL: Record<number, string> = {
    [PRINCE_STAGE.NOT_STARTED]:
        '@dbl@I can start this quest by speaking to @dre@Hassan@dbl@ in @dre@Al-Kharid Palace@dbl@.',
    [PRINCE_STAGE.STARTED]:
        '@str@I started this quest by speaking to Hassan in Al-Kharid|@str@Palace. He told me I should speak to Osman the spy master.|'
        + '@dbl@I should go and speak to @dre@Osman@dbl@ for details on the quest.',
    [PRINCE_STAGE.SPOKEN_OSMAN]:
        '@str@Prince Ali has been kidnapped but luckily the spy Leela|@str@has found he is being held near draynor village. I will|'
        + '@str@need to disguise the Prince and tie up his captor to free|@str@him from their clutches. To do this I should:||'
        + '@dbl@Talk to @dre@Leela@dbl@ near @dre@Draynor Village@dbl@ for advice|'
        + '@dbl@Get a duplicate of the key that is imprisoning the prince|'
        + '@dbl@Get some rope to tie up the Princes\' kidnapper|',
    [PRINCE_STAGE.PREP_FINISHED]:
        INTRO
        + '@dbl@Before I can free @dre@Prince Ali@dbl@, I need to deal with the @dre@Guard@dbl@.|'
        + '@dre@Leela@dbl@ suggested I speak with the @dre@Guard@dbl@ to try and determine any weaknesses he might have.|',
    [PRINCE_STAGE.GUARD_DRUNK]:
        INTRO + DRUNK
        + '@dbl@The last thing I need to do is deal with @dre@Lady Keli@dbl@.|@dre@Leela@dbl@ suggested I use some @dre@Rope@dbl@ to tie her up.',
    [PRINCE_STAGE.TIED_KELI]:
        INTRO + DRUNK + TIED
        + '@dbl@I can now free @dre@Prince Ali@dbl@. I\'ll need to make sure I give him his disguise when I do.',
    [PRINCE_STAGE.SAVED]:
        INTRO + DRUNK + TIED + SAVED + '@dbl@I should return to @dre@Hassan@dbl@ to claim my reward.',
    [PRINCE_STAGE.COMPLETE]:
        '@str@I started this quest by speaking to Hassan in Al-Kharid|@str@Palace. He told me I should speak to Osman the spy master.|'
        + '@str@I should go and speak to Osman for details on the quest.|'
        + INTRO + DRUNK + TIED + SAVED
        + '@str@I returned to Al-Kharid where Hassan rewarded me for|@str@my work.||@red@QUEST COMPLETE!'
};

describe('prince journal', () => {
    for (const [stage, text] of Object.entries(JOURNAL)) {
        test(`stage ${stage} reads back as itself`, () => {
            expect(parsePrinceJournal(text)?.stage).toBe(Number(stage));
        });
    }

    test('later entries keep the earlier history, so needles must be newest-first', () => {
        // Stage 50's body contains all of stage 40's. If order were wrong this returns 40.
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.TIED_KELI])?.stage).toBe(PRINCE_STAGE.TIED_KELI);
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.SAVED])?.stage).toBe(PRINCE_STAGE.SAVED);
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.COMPLETE])?.stage).toBe(PRINCE_STAGE.COMPLETE);
    });

    test('"for advice" is unique to stage 20 and does not leak into 30', () => {
        expect(JOURNAL[PRINCE_STAGE.PREP_FINISHED]).not.toContain('for advice');
    });

    test('stage 40\'s "need to do is deal with" is not stage 30\'s "need to deal with the"', () => {
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.GUARD_DRUNK])?.stage).toBe(PRINCE_STAGE.GUARD_DRUNK);
    });

    test('an array of lines parses the same as the joined string', () => {
        expect(parsePrinceJournal(['@red@QUEST', 'COMPLETE!'])?.stage).toBe(PRINCE_STAGE.COMPLETE);
    });

    test('an empty journal is undefined, not stage 0', () => {
        expect(parsePrinceJournal([])).toBeUndefined();
        expect(parsePrinceJournal('')).toBeUndefined();
    });

    test('unrecognised text is undefined', () => {
        expect(parsePrinceJournal('@str@Some other quest entirely.')).toBeUndefined();
    });

    test('flags are always empty — the stage carries everything', () => {
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.SPOKEN_OSMAN])?.flags.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/defs/princeali-journal.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/defs/princeali/journal.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/quests/defs/princeali/journal.ts`:

```ts
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Quests } from '../../../api/hud/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const PRINCE_QUEST = 'Prince Ali Rescue';

export const PRINCE_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    SPOKEN_OSMAN: 20,
    PREP_FINISHED: 30,
    GUARD_DRUNK: 40,
    TIED_KELI: 50,
    SAVED: 100,
    COMPLETE: 110
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Newest first: every entry keeps the whole earlier history.
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', PRINCE_STAGE.COMPLETE],
    ['i then used a wig, a skirt and some skin paste', PRINCE_STAGE.SAVED],
    ['i used my rope to tie up lady', PRINCE_STAGE.TIED_KELI],
    ['i also had to prevent the guard from seeing what i was up', PRINCE_STAGE.GUARD_DRUNK],
    ['i need to deal with the', PRINCE_STAGE.PREP_FINISHED],
    ['for advice', PRINCE_STAGE.SPOKEN_OSMAN],
    ['i should go and speak to', PRINCE_STAGE.STARTED],
    ['i can start this quest by speaking to', PRINCE_STAGE.NOT_STARTED]
];

export function parsePrinceJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    for (const [needle, stage] of STAGE_LINES) {
        if (text.includes(needle)) {
            return { stage, flags: new Set() };
        }
    }
    return undefined;
}

export async function readPrinceProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(PRINCE_QUEST);
    if (status === 'complete') {
        return { stage: PRINCE_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: PRINCE_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parsePrinceJournal(await Quests.journal(PRINCE_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/quests/defs/princeali-journal.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: clean. (`typecheck` covers the whole repo and the old `princeali.ts` still exists — it must still pass at this point.)

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/princeali/journal.ts test/quests/defs/princeali-journal.test.ts
git commit -m "feat(princeali): read the quest stage out of the journal

Eight stages, needles matched newest-first because every entry keeps the
whole earlier history. 'for advice' is the only phrase unique to stage 20,
and stage 40's 'need to do is deal with' must not match stage 30's
'need to deal with the'."
```

---

## Task 2: Constants and dialogue preference lists

**Files:**
- Create: `src/bot/quests/defs/princeali/areas.ts`
- Test: `test/quests/defs/princeali-areas.test.ts`

**Interfaces:**
- Consumes: `Tile` from `src/bot/api/Tile.js`, `NpcStop` from `src/bot/quests/exec/primitives.js`.
- Produces: `PrinceItem { id: number; name: string }`, `PA_ITEM`, `PA_TILE`, `PA_SHOP`, and the stops
  `HASSAN_START`, `HASSAN_REWARD`, `OSMAN_BRIEF`, `OSMAN_FORGE`, `LEELA_STOP`, `NED_WIG`, `NED_ROPE`,
  `AGGIE_PASTE`, `KELI_PRINT`, `JOE_BEER`, `BARTENDER`.

The preference lists below were each walked against the option pages in
`scripts/areas/*/scripts/*.rs2`. Two are order-critical and both are covered by tests in Step 1.

- [ ] **Step 1: Write the failing test**

Create `test/quests/defs/princeali-areas.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { OSMAN_BRIEF, NED_ROPE, KELI_PRINT, PA_ITEM } from '#/bot/quests/defs/princeali/areas.js';
import { pickPreferred } from '#/bot/quests/exec/primitives.js';

describe('Osman briefing cannot loop', () => {
    // osman_second_thing re-offers "What is the first thing I must do?". A prefer list
    // led by that bounces between the two branches forever.
    const INSTRUCTIONS = ['What is the first thing I must do?', 'What is the second thing you need?'];
    const SECOND_THING = [
        'What is the first thing I must do?',
        'What exactly is the second thing you need?',
        'Okay, I better go find some things.'
    ];

    test('the first page moves on to a branch', () => {
        expect(pickPreferred(INSTRUCTIONS, OSMAN_BRIEF.prefer)).toBe('What is the second thing you need?');
    });

    test('the branch page takes the exit, not the way back', () => {
        expect(pickPreferred(SECOND_THING, OSMAN_BRIEF.prefer)).toBe('Okay, I better go find some things.');
    });
});

describe('Ned never spends four balls of wool on rope', () => {
    const WITH_WOOL = [
        'Okay, please sell me some rope.',
        "That's a little more than I want to pay.",
        'I have some balls of wool. Could you make me some rope?'
    ];

    test('pays 15 coins even when the wool is in the pack', () => {
        expect(pickPreferred(WITH_WOOL, NED_ROPE.prefer)).toBe('Okay, please sell me some rope.');
    });
});

describe('Lady Keli walks all five pages to the imprint', () => {
    const PAGES: string[][] = [
        ['Heard of you? You are famous in RuneScape!', 'I have heard a little, but I think Katrine is tougher.', 'I have heard rumours that you kill people.', 'No I have never really heard of you.'],
        ['I think Katrine is still tougher.', 'What is your latest plan then?', 'You must have trained a lot for this work.', 'I should not disturb someone as tough as you.'],
        ['Ah I see. You must have been very skillful.', 'Thats great, are you sure they will pay?', 'Can you be sure they will not try to get him out?', 'I should not disturb someone as tough as you.'],
        ['Could I see the key please?', 'That is a good way to keep secrets.', 'I should not disturb someone as tough as you.'],
        ['Could I touch the key for a moment?', 'I should not disturb someone as tough as you.']
    ];
    const WANT = [
        'Heard of you? You are famous in RuneScape!',
        'What is your latest plan then?',
        'Can you be sure they will not try to get him out?',
        'Could I see the key please?',
        'Could I touch the key for a moment?'
    ];

    for (let i = 0; i < PAGES.length; i++) {
        test(`page ${i + 1} picks "${WANT[i]}"`, () => {
            expect(pickPreferred(PAGES[i], KELI_PRINT.prefer)).toBe(WANT[i]);
        });
    }

    test('never takes the polite exit', () => {
        for (const page of PAGES) {
            expect(pickPreferred(page, KELI_PRINT.prefer)).not.toContain('I should not disturb');
        }
    });
});

describe('item identity', () => {
    test('the two wigs share a name and differ only by id', () => {
        expect(PA_ITEM.PLAIN_WIG.name).toBe(PA_ITEM.BLOND_WIG.name);
        expect(PA_ITEM.PLAIN_WIG.id).not.toBe(PA_ITEM.BLOND_WIG.id);
    });

    test('ids match the engine obj.pack', () => {
        expect(PA_ITEM.BLOND_WIG.id).toBe(2419);
        expect(PA_ITEM.PLAIN_WIG.id).toBe(2421);
        expect(PA_ITEM.PRINCE_KEY.id).toBe(2418);
        expect(PA_ITEM.KEY_PRINT.id).toBe(2423);
        expect(PA_ITEM.PASTE.id).toBe(2424);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/defs/princeali-areas.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/defs/princeali/areas.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/quests/defs/princeali/areas.ts`:

```ts
import Tile from '../../../api/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export interface PrinceItem {
    id: number;
    name: string;
}

// Names are the engine's. Wig, Beer, Pot of flour, Logs and Coins each collide with
// another object, so every lookup in this quest goes through the id.
export const PA_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    PRINCE_KEY: { id: 2418, name: 'Bronze key' },
    BLOND_WIG: { id: 2419, name: 'Wig' },
    PLAIN_WIG: { id: 2421, name: 'Wig' },
    KEY_PRINT: { id: 2423, name: 'Key print' },
    PASTE: { id: 2424, name: 'Paste' },
    PINK_SKIRT: { id: 1013, name: 'Pink skirt' },
    ROPE: { id: 954, name: 'Rope' },
    BEER: { id: 1917, name: 'Beer' },
    SOFT_CLAY: { id: 1761, name: 'Soft clay' },
    CLAY: { id: 434, name: 'Clay' },
    YELLOW_DYE: { id: 1765, name: 'Yellow dye' },
    ONION: { id: 1957, name: 'Onion' },
    BALL_OF_WOOL: { id: 1759, name: 'Ball of wool' },
    WOOL: { id: 1737, name: 'Wool' },
    SHEARS: { id: 1735, name: 'Shears' },
    REDBERRIES: { id: 1951, name: 'Redberries' },
    POT_OF_FLOUR: { id: 1933, name: 'Pot of flour' },
    ASHES: { id: 592, name: 'Ashes' },
    TINDERBOX: { id: 590, name: 'Tinderbox' },
    BRONZE_BAR: { id: 2349, name: 'Bronze bar' },
    JUG_OF_WATER: { id: 1937, name: 'Jug of water' },
    LOGS: { id: 1511, name: 'Logs' },
    PICKAXE: { id: 1265, name: 'Bronze pickaxe' }
} as const satisfies Record<string, PrinceItem>;

export const PA_TILE = {
    DRAYNOR_BANK: new Tile(3093, 3243, 0),
    HASSAN: new Tile(3302, 3163, 0),
    OSMAN: new Tile(3286, 3180, 0),
    LEELA: new Tile(3113, 3263, 0),
    NED: new Tile(3100, 3258, 0),
    AGGIE: new Tile(3086, 3259, 0),
    JOE: new Tile(3123, 3245, 0),
    KELI: new Tile(3128, 3244, 0),
    // North of the door, the only side oplocu accepts the key from.
    DOOR_STAND: new Tile(3123, 3244, 0),
    CELL: new Tile(3123, 3243, 0),
    PRINCE: new Tile(3123, 3242, 0),
    LOGS_SPAWN: new Tile(3089, 3265, 0),
    ONION_PATCH: new Tile(3189, 3267, 0),
    SHEEP_PEN: new Tile(3197, 3266, 0),
    // forceapproach=south, and the only open side of the Lumbridge wheel.
    SPIN_STAND: new Tile(3209, 3213, 1),
    CLAY_ROCKS: new Tile(2986, 3239, 0),
    PICKAXE_SPAWN: new Tile(2963, 3216, 0),
    BARTENDER: new Tile(3045, 3257, 0)
} as const;

export const PA_SHOP = {
    SHANTAY: { npc: 'Shantay', anchor: new Tile(3304, 3123, 0) },
    LUMBRIDGE: { npc: 'Shop keeper', anchor: new Tile(3209, 3247, 0) },
    THESSALIA: { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) },
    WYDIN: { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) }
} as const;

export const PA_LOC = {
    PRISON_DOOR: 'Prison Door',
    ONION: 'Onion',
    SPINNING_WHEEL: 'Spinning wheel'
} as const;

export const HASSAN_START: NpcStop = {
    npc: 'Hassan',
    anchor: PA_TILE.HASSAN,
    leash: 6,
    prefer: ['Can I help you? You must need some help here in the desert.']
};

export const HASSAN_REWARD: NpcStop = {
    npc: 'Hassan',
    anchor: PA_TILE.HASSAN,
    leash: 6,
    prefer: []
};

// The exit first: osman_second_thing re-offers the first branch, and taking it loops.
export const OSMAN_BRIEF: NpcStop = {
    npc: 'Osman',
    anchor: PA_TILE.OSMAN,
    leash: 6,
    prefer: ['Okay, I better go find some things.', 'What is the second thing you need?']
};

export const OSMAN_FORGE: NpcStop = {
    npc: 'Osman',
    anchor: PA_TILE.OSMAN,
    leash: 6,
    prefer: ['Thank you. I will try to find the other items.']
};

export const LEELA_STOP: NpcStop = {
    npc: 'Leela',
    anchor: PA_TILE.LEELA,
    leash: 6,
    prefer: ['I hoped to get him drunk.', 'I will go and get the rest of the escape equipment.']
};

export const NED_WIG: NpcStop = {
    npc: 'Ned',
    anchor: PA_TILE.NED,
    leash: 6,
    prefer: ['Ned, could you make other things from wool?', 'How about some sort of wig?', 'I have that now. Please, make me a wig.']
};

export const NED_ROPE: NpcStop = {
    npc: 'Ned',
    anchor: PA_TILE.NED,
    leash: 6,
    prefer: ['Yes, I would like some rope.', 'Okay, please sell me some rope.']
};

export const AGGIE_PASTE: NpcStop = {
    npc: 'Aggie',
    anchor: PA_TILE.AGGIE,
    leash: 6,
    prefer: ['Could you think of a way to make skin paste?', 'Yes please. Mix me some skin paste.']
};

export const KELI_PRINT: NpcStop = {
    npc: 'Lady Keli',
    anchor: PA_TILE.KELI,
    leash: 8,
    prefer: [
        'Heard of you? You are famous in RuneScape!',
        'What is your latest plan then?',
        'Can you be sure they will not try to get him out?',
        'Could I see the key please?',
        'Could I touch the key for a moment?'
    ]
};

export const JOE_BEER: NpcStop = {
    npc: 'Joe',
    anchor: PA_TILE.JOE,
    leash: 6,
    prefer: ['I have some beer here, fancy one?']
};

export const BARTENDER: NpcStop = {
    npc: 'Bartender',
    anchor: PA_TILE.BARTENDER,
    leash: 6,
    prefer: ['Could I buy a beer please?']
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/quests/defs/princeali-areas.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/princeali/areas.ts test/quests/defs/princeali-areas.test.ts
git commit -m "feat(princeali): ids, tiles and dialogue preferences

Two preference lists are order-critical and tested: Osman's second-thing
page re-offers the first, so the exit has to come first or the briefing
loops; and Ned offers to make rope from four balls of wool, which must
lose to the 15-coin purchase."
```

---

## Task 3: Bank-first sourcing helpers

**Files:**
- Create: `src/bot/quests/defs/princeali/supplies.ts`
- Test: `test/quests/defs/princeali-supplies.test.ts`

**Interfaces:**
- Consumes: `PA_ITEM`, `PA_TILE`, `PrinceItem` from `./areas.js`; `QuestSnapshot`, `QuestStep` from `../../engine/types.js`; `InvItem`, `Inventory` from `../../../api/hud/Inventory.js`; `Tile`.
- Produces:
  - `held(snap: QuestSnapshot, id: number): number`
  - `banked(snap: QuestSnapshot, id: number): number`
  - `owned(snap: QuestSnapshot, id: number): number`
  - `heldItem(id: number): InvItem | null`
  - `hasAnyPickaxe(snap: QuestSnapshot): boolean`
  - `scanBank(): QuestStep`
  - `withdrawFrom(items: { name: string; id: number; qty: number }[]): QuestStep`
  - `fromBank(snap: QuestSnapshot, item: PrinceItem, qty?: number): QuestStep | null`
  - `buyItem(snap, item: PrinceItem, qty: number, shop: { npc: string; anchor: Tile }, unitGp: number): QuestStep | null`
  - `grabItem(snap, item: PrinceItem, anchor: Tile): QuestStep | null`
  - `sourceCoins(snap, floor: number, top: number): QuestStep | null`
  - `PURSE_FLOOR = 150`, `PURSE_TOP = 1000`

`withdrawFrom` deliberately omits `bank`, so `openBankLeg` uses the nearest branch rather
than dragging the bot back to Draynor from wherever the route has reached.

- [ ] **Step 1: Write the failing test**

Create `test/quests/defs/princeali-supplies.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { PA_ITEM, PA_SHOP, PA_TILE } from '#/bot/quests/defs/princeali/areas.js';
import {
    PURSE_FLOOR,
    PURSE_TOP,
    banked,
    buyItem,
    fromBank,
    grabItem,
    hasAnyPickaxe,
    held,
    owned,
    scanBank,
    sourceCoins
} from '#/bot/quests/defs/princeali/supplies.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (
    invIds: [number, number][] = [],
    bankIds: [number, number][] = [],
    extra: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    ...extra
});

describe('counting', () => {
    test('held, banked and owned read the id maps', () => {
        const s = snap([[PA_ITEM.ROPE.id, 2]], [[PA_ITEM.ROPE.id, 5]]);
        expect(held(s, PA_ITEM.ROPE.id)).toBe(2);
        expect(banked(s, PA_ITEM.ROPE.id)).toBe(5);
        expect(owned(s, PA_ITEM.ROPE.id)).toBe(7);
    });

    test('a plain wig does not count as a blond one', () => {
        const s = snap([[PA_ITEM.PLAIN_WIG.id, 1]]);
        expect(held(s, PA_ITEM.BLOND_WIG.id)).toBe(0);
        expect(held(s, PA_ITEM.PLAIN_WIG.id)).toBe(1);
    });

    test('any pickaxe counts, held or worn', () => {
        expect(hasAnyPickaxe(snap())).toBe(false);
        expect(hasAnyPickaxe(snap([[1265, 1]]))).toBe(true);
        expect(hasAnyPickaxe(snap([], [], { wornIds: new Set([1271]) }))).toBe(true);
    });
});

describe('fromBank', () => {
    test('null once the pack has enough', () => {
        expect(fromBank(snap([[PA_ITEM.ROPE.id, 2]]), PA_ITEM.ROPE, 2)).toBeNull();
    });

    test('scans first when the bank has never been seen', () => {
        const s = snap([], [], { bankKnown: false });
        expect(fromBank(s, PA_ITEM.ROPE, 1)).toEqual(scanBank());
    });

    test('withdraws by id, capped at what the bank holds', () => {
        const step = fromBank(snap([], [[PA_ITEM.ROPE.id, 1]]), PA_ITEM.ROPE, 2);
        expect(step?.kind).toBe('withdraw');
        expect(step?.kind === 'withdraw' && step.items).toEqual([{ name: 'Rope', id: 954, qty: 1 }]);
    });

    test('withdraw steps use the nearest bank, not a fixed one', () => {
        const step = fromBank(snap([], [[PA_ITEM.ROPE.id, 1]]), PA_ITEM.ROPE, 1);
        expect(step?.kind === 'withdraw' && step.bank).toBeUndefined();
    });

    test('null when neither pack nor bank can supply it', () => {
        expect(fromBank(snap(), PA_ITEM.ROPE, 1)).toBeNull();
    });
});

describe('buyItem', () => {
    test('bank before shop', () => {
        const step = buyItem(snap([], [[PA_ITEM.TINDERBOX.id, 1]]), PA_ITEM.TINDERBOX, 1, PA_SHOP.LUMBRIDGE, 10);
        expect(step?.kind).toBe('withdraw');
    });

    test('shop when the bank is empty, priced for the shortfall', () => {
        const step = buyItem(snap(), PA_ITEM.BEER, 3, PA_SHOP.LUMBRIDGE, 10);
        expect(step?.kind === 'buy' && step.item).toBe('Beer');
        expect(step?.kind === 'buy' && step.qty).toBe(3);
        expect(step?.kind === 'buy' && step.estGp).toBe(30);
    });

    test('only buys the shortfall', () => {
        const step = buyItem(snap([[PA_ITEM.BEER.id, 1]]), PA_ITEM.BEER, 3, PA_SHOP.LUMBRIDGE, 10);
        expect(step?.kind === 'buy' && step.qty).toBe(2);
    });

    test('null once satisfied', () => {
        expect(buyItem(snap([[PA_ITEM.BEER.id, 3]]), PA_ITEM.BEER, 3, PA_SHOP.LUMBRIDGE, 10)).toBeNull();
    });
});

describe('grabItem', () => {
    test('bank before the ground spawn', () => {
        const step = grabItem(snap([], [[PA_ITEM.PICKAXE.id, 1]]), PA_ITEM.PICKAXE, PA_TILE.PICKAXE_SPAWN);
        expect(step?.kind).toBe('withdraw');
    });

    test('otherwise walks to the spawn and waits for a respawn', () => {
        const step = grabItem(snap(), PA_ITEM.LOGS, PA_TILE.LOGS_SPAWN);
        expect(step?.kind === 'grabGround' && step.item).toBe('Logs');
        expect(step?.kind === 'grabGround' && step.waitIfMissing).toBe(true);
    });
});

describe('sourceCoins', () => {
    test('null while the purse is above the floor', () => {
        expect(sourceCoins(snap([[PA_ITEM.COINS.id, PURSE_FLOOR]]), PURSE_FLOOR, PURSE_TOP)).toBeNull();
    });

    test('tops up to PURSE_TOP when below the floor', () => {
        const step = sourceCoins(snap([[PA_ITEM.COINS.id, 10]], [[PA_ITEM.COINS.id, 2_000_000]]), PURSE_FLOOR, PURSE_TOP);
        expect(step?.kind === 'withdraw' && step.items).toEqual([{ name: 'Coins', id: 995, qty: PURSE_TOP - 10 }]);
    });

    test('takes what the bank has when it cannot cover the top-up', () => {
        const step = sourceCoins(snap([], [[PA_ITEM.COINS.id, 40]]), PURSE_FLOOR, PURSE_TOP);
        expect(step?.kind === 'withdraw' && step.items).toEqual([{ name: 'Coins', id: 995, qty: 40 }]);
    });

    test('an empty bank and an empty purse is an honest wait, not a loop', () => {
        expect(sourceCoins(snap(), PURSE_FLOOR, PURSE_TOP)?.kind).toBe('wait');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/defs/princeali-supplies.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/defs/princeali/supplies.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/quests/defs/princeali/supplies.ts`:

```ts
import type Tile from '../../../api/Tile.js';
import { Inventory, type InvItem } from '../../../api/hud/Inventory.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { PA_ITEM, type PrinceItem } from './areas.js';

export const PURSE_FLOOR = 150;
export const PURSE_TOP = 1000;

const PICKAXE_IDS = [1265, 1267, 1269, 1273, 1271, 1275] as const;

export function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function banked(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

export function owned(snap: QuestSnapshot, id: number): number {
    return held(snap, id) + banked(snap, id);
}

export function heldItem(id: number): InvItem | null {
    return Inventory.items().find(item => item.id === id) ?? null;
}

export function hasAnyPickaxe(snap: QuestSnapshot): boolean {
    return PICKAXE_IDS.some(id => held(snap, id) > 0 || (snap.wornIds?.has(id) ?? false));
}

export function scanBank(): QuestStep {
    return { kind: 'scanBank' };
}

export function withdrawFrom(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items };
}

/** Pack, then bank, then nothing — for anything the caller makes itself. */
export function fromBank(snap: QuestSnapshot, item: PrinceItem, qty = 1): QuestStep | null {
    const short = qty - held(snap, item.id);
    if (short <= 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, item.id);
    return inBank > 0 ? withdrawFrom([{ name: item.name, id: item.id, qty: Math.min(short, inBank) }]) : null;
}

export function buyItem(
    snap: QuestSnapshot,
    item: PrinceItem,
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    const short = qty - held(snap, item.id);
    if (short <= 0) {
        return null;
    }
    return fromBank(snap, item, qty) ?? { kind: 'buy', item: item.name, qty: short, shop, estGp: short * unitGp };
}

export function grabItem(snap: QuestSnapshot, item: PrinceItem, anchor: Tile): QuestStep | null {
    if (held(snap, item.id) > 0) {
        return null;
    }
    return fromBank(snap, item, 1) ?? { kind: 'grabGround', item: item.name, anchor, waitIfMissing: true };
}

export function sourceCoins(snap: QuestSnapshot, floor: number, top: number): QuestStep | null {
    const purse = held(snap, PA_ITEM.COINS.id);
    if (purse >= floor) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, PA_ITEM.COINS.id);
    if (available <= 0) {
        return { kind: 'wait', reason: 'no coins in the bank for shops, dialogue purchases and the toll gate' };
    }
    return withdrawFrom([{ name: PA_ITEM.COINS.name, id: PA_ITEM.COINS.id, qty: Math.min(top - purse, available) }]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/quests/defs/princeali-supplies.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/princeali/supplies.ts test/quests/defs/princeali-supplies.test.ts
git commit -m "feat(princeali): id-keyed, bank-first sourcing helpers

Withdraw steps omit bank so openBankLeg picks the nearest branch instead of
dragging the bot back to Draynor mid-route. A purse floor stops every
purchase from triggering a fresh bank trip."
```

---

## Task 4: Shared shear-and-spin

**Files:**
- Create: `src/bot/quests/exec/wool.ts`
- Modify: `src/bot/quests/defs/sheepshearer.ts`
- Test: `test/quests/exec/wool.test.ts`

**Interfaces:**
- Consumes: `Execution`, `ChatDialog`, `Inventory`, `Locs`, `Npcs`, `Reachability`, `Traversal`, `Tile`.
- Produces:
  - `UNSHEARED_SHEEP_ID = 43`
  - `shearOne(pen: Tile, log: (m: string) => void): Promise<boolean>`
  - `spinAllWool(wheelStand: Tile, log: (m: string) => void): Promise<boolean>`
  - `gatherWool(snap: QuestSnapshot, need: number, pen: Tile, wheelStand: Tile): QuestStep`

This is a behaviour-preserving extraction. `sheepshearer` keeps its own `SHEEP_PEN`
(3197,3266) and `WHEEL_STAND` (2982,3315) and passes them in, so nothing about that
live-verified quest changes.

- [ ] **Step 1: Write the failing test**

Create `test/quests/exec/wool.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import { UNSHEARED_SHEEP_ID, gatherWool, type WoolSites } from '#/bot/quests/exec/wool.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const SITES: WoolSites = {
    pen: new Tile(3197, 3266, 0),
    wheelStand: new Tile(3209, 3213, 1),
    shearsSpawn: new Tile(3152, 3306, 0)
};

const snap = (items: [string, number][] = []): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(items),
    invIds: new Map(),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0
});

describe('gatherWool', () => {
    test('the unsheared sheep npc id is 43', () => {
        expect(UNSHEARED_SHEEP_ID).toBe(43);
    });

    test('no shears -> grab the spawn', () => {
        const step = gatherWool(snap(), 3, SITES);
        expect(step.kind === 'grabGround' && step.item).toBe('Shears');
    });

    test('shears but not enough wool -> shear', () => {
        const step = gatherWool(snap([['shears', 1]]), 3, SITES);
        expect(step.kind === 'custom' && step.name).toContain('shear');
    });

    test('enough wool -> spin', () => {
        const step = gatherWool(snap([['shears', 1], ['wool', 3]]), 3, SITES);
        expect(step.kind === 'custom' && step.name).toContain('spin');
    });
});

describe('sheepshearer keeps its own tiles', () => {
    test('gatherBalls still returns the same step kinds', async () => {
        const { sheepshearer } = await import('#/bot/quests/defs/sheepshearer.js');
        const gather = sheepshearer.gather!['ball of wool'];
        expect(gather(snap(), 20).kind).toBe('grabGround');
        expect(gather(snap([['shears', 1]]), 20).kind).toBe('custom');
        expect(gather(snap([['shears', 1], ['wool', 20]]), 20).kind).toBe('custom');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/exec/wool.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/exec/wool.js`.

- [ ] **Step 3: Write the shared module**

Create `src/bot/quests/exec/wool.ts`:

```ts
import { Execution } from '../../api/Execution.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Reachability } from '../../api/Reachability.js';
import { Traversal } from '../../api/Traversal.js';
import type Tile from '../../api/Tile.js';
import type { QuestSnapshot, QuestStep } from '../engine/types.js';

export const UNSHEARED_SHEEP_ID = 43;

export interface WoolSites {
    pen: Tile;
    wheelStand: Tile;
    shearsSpawn: Tile;
}

export async function shearOne(pen: Tile, log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Wool');
    const sheep = Npcs.query()
        .name('Sheep')
        .within(8)
        .where(n => n.id === UNSHEARED_SHEEP_ID && Reachability.canReach(n.tile(), { adjacentOk: true }))
        .nearest();
    if (!sheep) {
        await Traversal.walkResilient(pen, { radius: 2, attempts: 2, timeoutMs: 60_000, log });
        return false;
    }
    const shears = Inventory.first('Shears');
    if (!shears || !(await shears.useOn(sheep))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count('Wool') > before, 6000);
}

export async function spinAllWool(wheelStand: Tile, log: (m: string) => void): Promise<boolean> {
    const before = Inventory.count('Ball of wool');
    if (!ChatDialog.isMakeMenu()) {
        // Every loc query is empty for about a tick after a level change, so arriving
        // and looking in the same pass reads an empty scene.
        const wheel = Locs.query().name('Spinning wheel').action('Spin').within(8).nearest();
        if (!wheel) {
            await Traversal.walkResilient(wheelStand, { radius: 2, attempts: 3, timeoutMs: 300_000, log });
            await Execution.delayTicks(2);
            return false;
        }
        if (!(await wheel.interact('Spin'))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isMakeMenu(), 8000))) {
            log('Spin menu never opened');
            return false;
        }
    }
    if (!(await ChatDialog.makeX('Wool', Inventory.count('Wool')))) {
        log(`Spin menu open but couldn't Make-X — products: [${ChatDialog.makeProducts().join(', ')}]`);
        return false;
    }
    let last = Inventory.count('Wool');
    let idle = 0;
    while (Inventory.count('Wool') > 0 && idle < 10) {
        await Execution.delayTicks(2);
        const now = Inventory.count('Wool');
        if (now < last) {
            last = now;
            idle = 0;
        } else {
            idle++;
        }
    }
    return Inventory.count('Ball of wool') > before;
}

export function gatherWool(snap: QuestSnapshot, need: number, sites: WoolSites): QuestStep {
    if ((snap.inv.get('wool') ?? 0) >= need) {
        return { kind: 'custom', name: 'spin the wool into balls', run: log => spinAllWool(sites.wheelStand, log) };
    }
    if (!snap.inv.has('shears')) {
        return { kind: 'grabGround', item: 'Shears', anchor: sites.shearsSpawn };
    }
    return { kind: 'custom', name: 'shear a sheep', run: log => shearOne(sites.pen, log) };
}
```

- [ ] **Step 4: Rewrite sheepshearer to use it**

In `src/bot/quests/defs/sheepshearer.ts`, delete `spinAllWool`, `shearOne`,
`UNSHEARED_SHEEP_ID` and the now-unused imports (`Execution`, `ChatDialog`, `Locs`, `Npcs`,
`Reachability`), keep `SHEARS_SPAWN`, `SHEEP_PEN`, `WHEEL_STAND` and `BALLS_NEEDED`, and
replace `gatherBalls` with:

```ts
import { gatherWool, type WoolSites } from '../exec/wool.js';

const SITES: WoolSites = { pen: SHEEP_PEN, wheelStand: WHEEL_STAND, shearsSpawn: SHEARS_SPAWN };

export function gatherBalls(snap: QuestSnapshot, need: number): QuestStep {
    return gatherWool(snap, need, SITES);
}
```

`Traversal` and `Tile` stay imported; `Inventory` is no longer used by this file — remove it
if lint flags it.

- [ ] **Step 5: Run the tests**

Run: `bun test test/quests/exec/wool.test.ts test/quests/defs/sheepshearer.test.ts`
Expected: PASS. If `test/quests/defs/sheepshearer.test.ts` does not exist, run
`bun test test/quests/` and confirm nothing regressed.

- [ ] **Step 6: Full suite, lint, typecheck**

Run: `bun test && bun run lint && bun run typecheck`
Expected: clean. The old `defs/princeali.ts` imports `gatherBalls` from `sheepshearer`, whose
signature is unchanged, so it still compiles.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/exec/wool.ts src/bot/quests/defs/sheepshearer.ts test/quests/exec/wool.test.ts
git commit -m "refactor(quests): share shear-and-spin between quests

Behaviour-preserving extraction: sheepshearer keeps its own pen, wheel and
shears tiles and passes them in. Prince Ali needs the same pipeline at
different sites."
```

---

## Task 5: The disguise legs

**Files:**
- Create: `src/bot/quests/defs/princeali/disguise.ts`
- Test: `test/quests/defs/princeali-disguise.test.ts`

**Interfaces:**
- Consumes: `PA_ITEM`, `PA_SHOP`, `PA_TILE`, `AGGIE_PASTE`, `NED_WIG` from `./areas.js`;
  `held`, `owned`, `fromBank`, `buyItem`, `grabItem`, `heldItem` from `./supplies.js`;
  `gatherWool`, `WoolSites` from `../../exec/wool.js`; `Reach`, `driveUntil`, `settleScene`.
- Produces (each `(snap: QuestSnapshot) => QuestStep | null`, null meaning "already satisfied"):
  `sourceTinderbox`, `sourceShears`, `sourceOnions`, `sourceWool`, `sourcePinkSkirt`,
  `sourcePasteGoods`, `makeAshes`, `makeBlondWig`, `makePaste`, and
  `disguiseComplete(snap: QuestSnapshot): boolean`.

The gating rule throughout: a leg returns `null` once its *product* is owned, so a consumed
input is never re-bought. `owned` (pack + bank) gates the product; `held` gates the withdraw.

- [ ] **Step 1: Write the failing test**

Create `test/quests/defs/princeali-disguise.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/quests/defs/princeali/areas.js';
import {
    disguiseComplete,
    makeAshes,
    makeBlondWig,
    makePaste,
    sourceOnions,
    sourcePasteGoods,
    sourcePinkSkirt,
    sourceShears,
    sourceTinderbox,
    sourceWool
} from '#/bot/quests/defs/princeali/disguise.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (invIds: [number, number][] = [], bankIds: [number, number][] = []): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true
});
const I = PA_ITEM;

describe('the wig chain never re-buys a consumed input', () => {
    test('nothing held -> three balls of wool', () => {
        const step = sourceWool(snap());
        expect(step).not.toBeNull();
    });

    test('a plain wig held -> no more wool', () => {
        expect(sourceWool(snap([[I.PLAIN_WIG.id, 1]]))).toBeNull();
    });

    test('a blond wig held -> no wool and no onions', () => {
        const s = snap([[I.BLOND_WIG.id, 1]]);
        expect(sourceWool(s)).toBeNull();
        expect(sourceOnions(s)).toBeNull();
        expect(makeBlondWig(s)).toBeNull();
    });

    test('onions are only wanted while the dye is missing', () => {
        expect(sourceOnions(snap())?.kind).toBe('pickLoc');
        expect(sourceOnions(snap([[I.YELLOW_DYE.id, 1]]))).toBeNull();
        expect(sourceOnions(snap([[I.ONION.id, 2]]))).toBeNull();
    });

    test('dye plus plain wig -> dye the wig', () => {
        const step = makeBlondWig(snap([[I.PLAIN_WIG.id, 1], [I.YELLOW_DYE.id, 1]]));
        expect(step?.kind === 'custom' && step.name).toContain('dye');
    });

    test('two onions and no dye -> make the dye at Aggie', () => {
        const step = makeBlondWig(snap([[I.ONION.id, 2]]));
        expect(step?.kind === 'custom' && step.name).toContain('yellow dye');
    });

    test('dye and three balls of wool but no wig -> Ned makes the wig', () => {
        const step = makeBlondWig(snap([[I.YELLOW_DYE.id, 1], [I.BALL_OF_WOOL.id, 3]]));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Ned');
    });
});

describe('paste chain', () => {
    test('paste held -> nothing wanted', () => {
        const s = snap([[I.PASTE.id, 1]]);
        expect(sourcePasteGoods(s)).toBeNull();
        expect(sourceTinderbox(s)).toBeNull();
        expect(makeAshes(s)).toBeNull();
        expect(makePaste(s)).toBeNull();
    });

    test('no redberries -> buy at Wydin', () => {
        const step = sourcePasteGoods(snap());
        expect(step?.kind === 'buy' && step.item).toBe('Redberries');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Wydin');
    });

    test('redberries but no flour -> buy the flour at Wydin', () => {
        const step = sourcePasteGoods(snap([[I.REDBERRIES.id, 1]]));
        expect(step?.kind === 'buy' && step.item).toBe('Pot of flour');
    });

    test('ashes held -> no tinderbox and no logs', () => {
        const s = snap([[I.ASHES.id, 1]]);
        expect(sourceTinderbox(s)).toBeNull();
        expect(makeAshes(s)).toBeNull();
    });

    test('tinderbox but no logs -> grab the Draynor spawn', () => {
        const step = makeAshes(snap([[I.TINDERBOX.id, 1]]));
        expect(step?.kind === 'grabGround' && step.item).toBe('Logs');
    });

    test('tinderbox and logs -> burn them', () => {
        const step = makeAshes(snap([[I.TINDERBOX.id, 1], [I.LOGS.id, 1]]));
        expect(step?.kind === 'custom' && step.name).toContain('ash');
    });

    test('all four ingredients -> Aggie mixes the paste', () => {
        const s = snap([[I.REDBERRIES.id, 1], [I.POT_OF_FLOUR.id, 1], [I.ASHES.id, 1], [I.JUG_OF_WATER.id, 1]]);
        expect(makePaste(s)?.kind === 'talk' && makePaste(s)?.kind === 'talk').toBe(true);
    });

    test('no water -> the paste leg waits rather than talking to Aggie for nothing', () => {
        const s = snap([[I.REDBERRIES.id, 1], [I.POT_OF_FLOUR.id, 1], [I.ASHES.id, 1]]);
        expect(makePaste(s)?.kind).toBe('wait');
    });
});

describe('skirt and shears', () => {
    test('no skirt -> buy at Thessalia', () => {
        const step = sourcePinkSkirt(snap());
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Thessalia');
    });

    test('shears are only wanted while wool is still needed', () => {
        expect(sourceShears(snap())?.kind).toBe('buy');
        expect(sourceShears(snap([[I.PLAIN_WIG.id, 1]]))).toBeNull();
        expect(sourceShears(snap([[I.SHEARS.id, 1]]))).toBeNull();
    });
});

describe('disguiseComplete', () => {
    test('needs the blond wig, not the plain one', () => {
        expect(disguiseComplete(snap([[I.PLAIN_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1]]))).toBe(false);
        expect(disguiseComplete(snap([[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1]]))).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/defs/princeali-disguise.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/defs/princeali/disguise.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/quests/defs/princeali/disguise.ts`:

```ts
import { Execution } from '../../../api/Execution.js';
import { Traversal } from '../../../api/Traversal.js';
import type Tile from '../../../api/Tile.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { gatherWool, type WoolSites } from '../../exec/wool.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { AGGIE_PASTE, NED_WIG, PA_ITEM, PA_SHOP, PA_TILE } from './areas.js';
import { buyItem, fromBank, grabItem, held, heldItem, owned } from './supplies.js';

const WOOL_SITES: WoolSites = {
    pen: PA_TILE.SHEEP_PEN,
    wheelStand: PA_TILE.SPIN_STAND,
    shearsSpawn: PA_TILE.SHEEP_PEN
};

const BALLS_FOR_WIG = 3;
const ONIONS_FOR_DYE = 2;

const TINDERBOX_GP = 10;
const SHEARS_GP = 10;
const SKIRT_GP = 20;
const REDBERRIES_GP = 20;
const FLOUR_GP = 30;

function haveWig(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.BLOND_WIG.id) > 0 || owned(snap, PA_ITEM.PLAIN_WIG.id) > 0;
}

function haveDye(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.BLOND_WIG.id) > 0 || owned(snap, PA_ITEM.YELLOW_DYE.id) > 0;
}

function havePaste(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.PASTE.id) > 0;
}

export function disguiseComplete(snap: QuestSnapshot): boolean {
    return held(snap, PA_ITEM.BLOND_WIG.id) > 0
        && held(snap, PA_ITEM.PINK_SKIRT.id) > 0
        && held(snap, PA_ITEM.PASTE.id) > 0;
}

export function sourceTinderbox(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap) || owned(snap, PA_ITEM.ASHES.id) > 0) {
        return null;
    }
    return buyItem(snap, PA_ITEM.TINDERBOX, 1, PA_SHOP.LUMBRIDGE, TINDERBOX_GP);
}

export function sourceShears(snap: QuestSnapshot): QuestStep | null {
    if (haveWig(snap) || owned(snap, PA_ITEM.BALL_OF_WOOL.id) >= BALLS_FOR_WIG) {
        return null;
    }
    return buyItem(snap, PA_ITEM.SHEARS, 1, PA_SHOP.LUMBRIDGE, SHEARS_GP);
}

export function sourceOnions(snap: QuestSnapshot): QuestStep | null {
    if (haveDye(snap) || held(snap, PA_ITEM.ONION.id) >= ONIONS_FOR_DYE) {
        return null;
    }
    return fromBank(snap, PA_ITEM.ONION, ONIONS_FOR_DYE)
        ?? { kind: 'pickLoc', loc: 'Onion', op: 'Pick', item: PA_ITEM.ONION.name, anchor: PA_TILE.ONION_PATCH };
}

export function sourceWool(snap: QuestSnapshot): QuestStep | null {
    if (haveWig(snap) || held(snap, PA_ITEM.BALL_OF_WOOL.id) >= BALLS_FOR_WIG) {
        return null;
    }
    const banked = fromBank(snap, PA_ITEM.BALL_OF_WOOL, BALLS_FOR_WIG);
    if (banked) {
        return banked;
    }
    const woolSnap: QuestSnapshot = {
        ...snap,
        inv: new Map([
            ['wool', held(snap, PA_ITEM.WOOL.id)],
            ...(held(snap, PA_ITEM.SHEARS.id) > 0 ? ([['shears', 1]] as [string, number][]) : [])
        ])
    };
    const stillNeeded = BALLS_FOR_WIG - held(snap, PA_ITEM.BALL_OF_WOOL.id);
    return gatherWool(woolSnap, stillNeeded, WOOL_SITES);
}

export function sourcePinkSkirt(snap: QuestSnapshot): QuestStep | null {
    return buyItem(snap, PA_ITEM.PINK_SKIRT, 1, PA_SHOP.THESSALIA, SKIRT_GP);
}

export function sourcePasteGoods(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap)) {
        return null;
    }
    return buyItem(snap, PA_ITEM.REDBERRIES, 1, PA_SHOP.WYDIN, REDBERRIES_GP)
        ?? buyItem(snap, PA_ITEM.POT_OF_FLOUR, 1, PA_SHOP.WYDIN, FLOUR_GP);
}

export function makeAshes(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap) || owned(snap, PA_ITEM.ASHES.id) > 0) {
        return null;
    }
    if (held(snap, PA_ITEM.TINDERBOX.id) === 0) {
        return null;
    }
    const logs = grabItem(snap, PA_ITEM.LOGS, PA_TILE.LOGS_SPAWN);
    return logs ?? { kind: 'custom', name: 'burn the logs for ashes', run: burnLogs };
}

export function makeBlondWig(snap: QuestSnapshot): QuestStep | null {
    if (owned(snap, PA_ITEM.BLOND_WIG.id) > 0) {
        return fromBank(snap, PA_ITEM.BLOND_WIG, 1);
    }
    if (held(snap, PA_ITEM.YELLOW_DYE.id) === 0) {
        if (held(snap, PA_ITEM.ONION.id) < ONIONS_FOR_DYE) {
            return null;
        }
        return { kind: 'custom', name: 'have Aggie make yellow dye', run: makeYellowDye };
    }
    if (held(snap, PA_ITEM.PLAIN_WIG.id) === 0) {
        if (held(snap, PA_ITEM.BALL_OF_WOOL.id) < BALLS_FOR_WIG) {
            return null;
        }
        return { kind: 'talk', stop: NED_WIG };
    }
    return { kind: 'custom', name: 'dye the wig blond', run: dyeWig };
}

export function makePaste(snap: QuestSnapshot): QuestStep | null {
    if (havePaste(snap)) {
        return fromBank(snap, PA_ITEM.PASTE, 1);
    }
    const missing = [
        held(snap, PA_ITEM.REDBERRIES.id) === 0 ? PA_ITEM.REDBERRIES.name : null,
        held(snap, PA_ITEM.POT_OF_FLOUR.id) === 0 ? PA_ITEM.POT_OF_FLOUR.name : null,
        held(snap, PA_ITEM.ASHES.id) === 0 ? PA_ITEM.ASHES.name : null,
        held(snap, PA_ITEM.JUG_OF_WATER.id) === 0 ? PA_ITEM.JUG_OF_WATER.name : null
    ].filter((n): n is string => n !== null);
    if (missing.length > 0) {
        return { kind: 'wait', reason: `paste needs ${missing.join(', ')}` };
    }
    return { kind: 'talk', stop: AGGIE_PASTE };
}

async function burnLogs(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.ASHES.id)) {
        return true;
    }
    const tinder = heldItem(PA_ITEM.TINDERBOX.id);
    const logs = heldItem(PA_ITEM.LOGS.id);
    if (!tinder || !logs) {
        log('burnLogs: no tinderbox or no logs');
        return false;
    }
    if (!(await tinder.useOn(logs))) {
        return false;
    }
    const ashesNear = (): boolean => GroundItems.query().name(PA_ITEM.ASHES.name).within(3).nearest() !== null;
    if (!(await Execution.delayUntil(ashesNear, 150_000))) {
        log('burnLogs: no ashes appeared');
        return false;
    }
    const ash = GroundItems.query().name(PA_ITEM.ASHES.name).within(3).nearest();
    if (!ash || !(await ash.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(() => heldItem(PA_ITEM.ASHES.id) !== null, 5000);
}

async function makeYellowDye(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.YELLOW_DYE.id)) {
        return true;
    }
    return useHeldOnNpc(PA_ITEM.ONION.id, 'Aggie', PA_TILE.AGGIE, () => heldItem(PA_ITEM.YELLOW_DYE.id) !== null, log);
}

async function dyeWig(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.BLOND_WIG.id)) {
        return true;
    }
    const dye = heldItem(PA_ITEM.YELLOW_DYE.id);
    const wig = heldItem(PA_ITEM.PLAIN_WIG.id);
    if (!dye || !wig) {
        log('dyeWig: no yellow dye or no plain wig');
        return false;
    }
    if (!(await dye.useOn(wig))) {
        return false;
    }
    return Execution.delayUntil(() => heldItem(PA_ITEM.BLOND_WIG.id) !== null, 8000);
}

/**
 * Item-on-NPC is an opnpcu, so this walks and then uses — it must not open a
 * conversation first, which is all `Reach.npcDialog` does.
 */
export async function useHeldOnNpc(
    itemId: number,
    npcName: string,
    near: Tile,
    expect: () => boolean,
    log: (m: string) => void
): Promise<boolean> {
    if (expect()) {
        return true;
    }
    if (!(await Traversal.walkResilient(near, { radius: 3, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    await settleScene();
    const npc = Npcs.query().name(npcName).within(10).nearest();
    const item = heldItem(itemId);
    if (!npc || !item) {
        log(`useHeldOnNpc: no '${npcName}' or no item ${itemId}`);
        return false;
    }
    if (!(await item.useOn(npc))) {
        return false;
    }
    return driveUntil(expect, [], log);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/quests/defs/princeali-disguise.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Lint, typecheck, full suite**

Run: `bun test && bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/princeali/disguise.ts test/quests/defs/princeali-disguise.test.ts
git commit -m "feat(princeali): wig, dye, ashes, paste and skirt legs

Each leg returns null once its product is owned, so a consumed input is
never re-bought. The wig gate is the blond id, never the shared 'Wig' name."
```

---

## Task 6: The key chain

**Files:**
- Create: `src/bot/quests/defs/princeali/key.ts`
- Test: `test/quests/defs/princeali-key.test.ts`

**Interfaces:**
- Consumes: `PA_ITEM`, `PA_SHOP`, `PA_TILE`, `KELI_PRINT`, `LEELA_STOP`, `OSMAN_FORGE` from `./areas.js`; `held`, `owned`, `banked`, `fromBank`, `buyItem`, `grabItem`, `hasAnyPickaxe`, `heldItem`, `withdrawFrom` from `./supplies.js`; `gotoNpc`, `talkStrict` from `../../exec/primitives.js`; `driveUntil` from `../../exec/prompts.js`.
- Produces: `sourceBronzeBar`, `sourceWater`, `sourcePickaxe`, `sourceClay`, `makeSoftClay`,
  `takeKeyPrint`, `collectKey` — all `(snap: QuestSnapshot) => QuestStep | null`; and
  `haveKey(snap: QuestSnapshot): boolean`.

Water quantity is **2**: one filled jug for the soft clay, one for the paste.

- [ ] **Step 1: Write the failing test**

Create `test/quests/defs/princeali-key.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/quests/defs/princeali/areas.js';
import {
    collectKey,
    haveKey,
    makeSoftClay,
    sourceBronzeBar,
    sourceClay,
    sourcePickaxe,
    sourceWater,
    takeKeyPrint
} from '#/bot/quests/defs/princeali/key.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (
    invIds: [number, number][] = [],
    bankIds: [number, number][] = [],
    extra: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    ...extra
});
const I = PA_ITEM;

describe('bronze bar', () => {
    test('bought at Shantay while the key is still missing', () => {
        const step = sourceBronzeBar(snap());
        expect(step?.kind === 'buy' && step.item).toBe('Bronze bar');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Shantay');
    });

    test('not wanted once the key is owned', () => {
        expect(sourceBronzeBar(snap([[I.PRINCE_KEY.id, 1]]))).toBeNull();
        expect(sourceBronzeBar(snap([], [[I.PRINCE_KEY.id, 1]]))).toBeNull();
    });
});

describe('water', () => {
    test('two jugs: one for the soft clay, one for the paste', () => {
        const step = sourceWater(snap());
        expect(step?.kind === 'buy' && step.qty).toBe(2);
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Shantay');
    });

    test('one needed once the paste is made and the clay is still raw', () => {
        const step = sourceWater(snap([[I.PASTE.id, 1]]));
        expect(step?.kind === 'buy' && step.qty).toBe(1);
    });

    test('none once the paste is made and the soft clay exists', () => {
        expect(sourceWater(snap([[I.PASTE.id, 1], [I.SOFT_CLAY.id, 1]]))).toBeNull();
    });
});

describe('pickaxe and clay', () => {
    test('no pickaxe -> the Rimmington spawn', () => {
        const step = sourcePickaxe(snap());
        expect(step?.kind === 'grabGround' && step.item).toBe('Bronze pickaxe');
    });

    test('a worn pickaxe counts', () => {
        expect(sourcePickaxe(snap([], [], { wornIds: new Set([1271]) }))).toBeNull();
    });

    test('no pickaxe wanted once the soft clay exists', () => {
        expect(sourcePickaxe(snap([[I.SOFT_CLAY.id, 1]]))).toBeNull();
    });

    test('pickaxe held -> mine clay', () => {
        const step = sourceClay(snap([[I.PICKAXE.id, 1]]));
        expect(step?.kind === 'mineRock' && step.rock).toBe('Clay');
    });

    test('clay is not mined again once a print exists', () => {
        expect(sourceClay(snap([[I.PICKAXE.id, 1], [I.KEY_PRINT.id, 1]]))).toBeNull();
    });
});

describe('soft clay', () => {
    test('clay plus water -> the item-on-item craft', () => {
        const step = makeSoftClay(snap([[I.CLAY.id, 1], [I.JUG_OF_WATER.id, 1]]));
        expect(step?.kind === 'useOn' && step.item).toBe('Jug of water');
        expect(step?.kind === 'useOn' && step.target).toBe('Clay');
        expect(step?.kind === 'useOn' && step.product).toBe('Soft clay');
    });

    test('null once the soft clay, print or key exists', () => {
        expect(makeSoftClay(snap([[I.SOFT_CLAY.id, 1]]))).toBeNull();
        expect(makeSoftClay(snap([[I.KEY_PRINT.id, 1]]))).toBeNull();
        expect(makeSoftClay(snap([[I.PRINCE_KEY.id, 1]]))).toBeNull();
    });
});

describe('key print', () => {
    test('soft clay held -> Lady Keli', () => {
        const step = takeKeyPrint(snap([[I.SOFT_CLAY.id, 1]]));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Lady Keli');
    });

    test('no soft clay -> nothing (the clay legs run first)', () => {
        expect(takeKeyPrint(snap())).toBeNull();
    });

    test('null once a print or the key exists', () => {
        expect(takeKeyPrint(snap([[I.SOFT_CLAY.id, 1], [I.KEY_PRINT.id, 1]]))).toBeNull();
        expect(takeKeyPrint(snap([[I.SOFT_CLAY.id, 1], [I.PRINCE_KEY.id, 1]]))).toBeNull();
    });
});

describe('collectKey — the wedge', () => {
    test('key in the pack -> nothing left to do', () => {
        expect(collectKey(snap([[I.PRINCE_KEY.id, 1]]))).toBeNull();
    });

    test('a banked key is withdrawn before anyone is asked for another', () => {
        // Leela reads inv_total(bank, princeskey) too, so a banked key blocks its
        // own replacement.
        const step = collectKey(snap([], [[I.PRINCE_KEY.id, 1]]));
        expect(step?.kind).toBe('withdraw');
    });

    test('print plus bar -> the self-correcting forge-and-collect', () => {
        const step = collectKey(snap([[I.KEY_PRINT.id, 1], [I.BRONZE_BAR.id, 1]]));
        expect(step?.kind === 'custom' && step.name).toContain('Osman');
    });

    test('print without a bar -> nothing here; the bar leg runs earlier', () => {
        expect(collectKey(snap([[I.KEY_PRINT.id, 1]]))).toBeNull();
    });

    test('no print and no key -> nothing; the clay legs run earlier', () => {
        expect(collectKey(snap())).toBeNull();
    });
});

describe('haveKey', () => {
    test('true only when the key is in the pack', () => {
        expect(haveKey(snap([[I.PRINCE_KEY.id, 1]]))).toBe(true);
        expect(haveKey(snap([], [[I.PRINCE_KEY.id, 1]]))).toBe(false);
        expect(haveKey(snap())).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/defs/princeali-key.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/defs/princeali/key.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/quests/defs/princeali/key.ts`:

```ts
import { Execution } from '../../../api/Execution.js';
import { gotoNpc, talkStrict } from '../../exec/primitives.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { KELI_PRINT, LEELA_STOP, OSMAN_FORGE, PA_ITEM, PA_SHOP, PA_TILE } from './areas.js';
import { banked, buyItem, fromBank, grabItem, hasAnyPickaxe, held, heldItem, owned, withdrawFrom } from './supplies.js';

const BAR_GP = 40;
const WATER_GP = 20;

export function haveKey(snap: QuestSnapshot): boolean {
    return held(snap, PA_ITEM.PRINCE_KEY.id) > 0;
}

function keyDone(snap: QuestSnapshot): boolean {
    return owned(snap, PA_ITEM.PRINCE_KEY.id) > 0;
}

function printDone(snap: QuestSnapshot): boolean {
    return keyDone(snap) || owned(snap, PA_ITEM.KEY_PRINT.id) > 0;
}

function softClayDone(snap: QuestSnapshot): boolean {
    return printDone(snap) || owned(snap, PA_ITEM.SOFT_CLAY.id) > 0;
}

export function sourceBronzeBar(snap: QuestSnapshot): QuestStep | null {
    if (keyDone(snap)) {
        return null;
    }
    return buyItem(snap, PA_ITEM.BRONZE_BAR, 1, PA_SHOP.SHANTAY, BAR_GP);
}

export function sourceWater(snap: QuestSnapshot): QuestStep | null {
    const forClay = softClayDone(snap) ? 0 : 1;
    const forPaste = owned(snap, PA_ITEM.PASTE.id) > 0 ? 0 : 1;
    const want = forClay + forPaste;
    if (want === 0) {
        return null;
    }
    return buyItem(snap, PA_ITEM.JUG_OF_WATER, want, PA_SHOP.SHANTAY, WATER_GP);
}

export function sourcePickaxe(snap: QuestSnapshot): QuestStep | null {
    if (softClayDone(snap) || owned(snap, PA_ITEM.CLAY.id) > 0 || hasAnyPickaxe(snap)) {
        return null;
    }
    return grabItem(snap, PA_ITEM.PICKAXE, PA_TILE.PICKAXE_SPAWN);
}

export function sourceClay(snap: QuestSnapshot): QuestStep | null {
    if (softClayDone(snap) || held(snap, PA_ITEM.CLAY.id) > 0) {
        return null;
    }
    return fromBank(snap, PA_ITEM.CLAY, 1)
        ?? { kind: 'mineRock', rock: 'Clay', item: PA_ITEM.CLAY.name, qty: 1, anchor: PA_TILE.CLAY_ROCKS };
}

export function makeSoftClay(snap: QuestSnapshot): QuestStep | null {
    if (softClayDone(snap)) {
        return fromBank(snap, PA_ITEM.SOFT_CLAY, 1);
    }
    if (held(snap, PA_ITEM.CLAY.id) === 0 || held(snap, PA_ITEM.JUG_OF_WATER.id) === 0) {
        return null;
    }
    return {
        kind: 'useOn',
        item: PA_ITEM.JUG_OF_WATER.name,
        targetKind: 'item',
        target: PA_ITEM.CLAY.name,
        anchor: PA_TILE.CLAY_ROCKS,
        product: PA_ITEM.SOFT_CLAY.name
    };
}

export function takeKeyPrint(snap: QuestSnapshot): QuestStep | null {
    if (printDone(snap)) {
        return fromBank(snap, PA_ITEM.KEY_PRINT, 1);
    }
    if (held(snap, PA_ITEM.SOFT_CLAY.id) === 0) {
        return null;
    }
    return { kind: 'talk', stop: KELI_PRINT };
}

export function collectKey(snap: QuestSnapshot): QuestStep | null {
    if (haveKey(snap)) {
        return null;
    }
    if (banked(snap, PA_ITEM.PRINCE_KEY.id) > 0) {
        return withdrawFrom([{ name: PA_ITEM.PRINCE_KEY.name, id: PA_ITEM.PRINCE_KEY.id, qty: 1 }]);
    }
    if (held(snap, PA_ITEM.KEY_PRINT.id) === 0 || held(snap, PA_ITEM.BRONZE_BAR.id) === 0) {
        return null;
    }
    return { kind: 'custom', name: 'have Osman forge the key, then collect it from Leela', run: forgeAndCollect };
}

/**
 * Osman forges only while prince_keystatus is 0, and that varp is not transmitted.
 * A print still in the pack after the conversation is the observable proof that the
 * key was already forged, so the step goes to Leela either way.
 */
async function forgeAndCollect(log: (m: string) => void): Promise<boolean> {
    if (heldItem(PA_ITEM.PRINCE_KEY.id)) {
        return true;
    }
    if (await gotoNpc(OSMAN_FORGE, [], log)) {
        await talkStrict(OSMAN_FORGE.npc, OSMAN_FORGE.prefer, log);
    }
    if (heldItem(PA_ITEM.KEY_PRINT.id)) {
        log('Osman would not take the print — the key is already forged; collecting from Leela');
    }
    if (!(await gotoNpc(LEELA_STOP, [], log))) {
        return false;
    }
    await talkStrict(LEELA_STOP.npc, LEELA_STOP.prefer, log);
    await Execution.delayUntil(() => heldItem(PA_ITEM.PRINCE_KEY.id) !== null, 4000);
    return heldItem(PA_ITEM.PRINCE_KEY.id) !== null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/quests/defs/princeali-key.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Lint, typecheck, full suite**

Run: `bun test && bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/princeali/key.ts test/quests/defs/princeali-key.test.ts
git commit -m "feat(princeali): the key chain, with a self-correcting forge

Osman forges only while prince_keystatus is 0, and that varp is never
transmitted to the client. A print still held after the conversation is the
observable proof the key was already forged, so the step walks to Leela
either way and the crash window cannot wedge the quest."
```

---

## Task 7: The jailbreak

**Files:**
- Create: `src/bot/quests/defs/princeali/jailbreak.ts`
- Test: `test/quests/defs/princeali-jailbreak.test.ts`

**Interfaces:**
- Consumes: `PA_ITEM`, `PA_LOC`, `PA_TILE`, `BARTENDER`, `JOE_BEER`, `NED_ROPE` from `./areas.js`; `held`, `fromBank`, `heldItem` from `./supplies.js`; `PRINCE_STAGE` from `./journal.js`; `disguiseComplete` from `./disguise.js`; `Traversal`, `Npcs`, `Locs`, `Game`, `Execution`, `driveUntil`, `settleScene`.
- Produces: `sourceBeers(snap): QuestStep | null`, `sourceRopes(snap): QuestStep | null`,
  `decideJailbreak(snap: QuestSnapshot): QuestStep`.

`BEERS_NEEDED = 3` — `joe_beer` consumes one, then two more, in a single conversation.
`ROPES_NEEDED = 2` — Lady Keli respawns 100 ticks after the tie, five tiles from the door,
and re-tying costs another rope.

- [ ] **Step 1: Write the failing test**

Create `test/quests/defs/princeali-jailbreak.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/quests/defs/princeali/areas.js';
import { PRINCE_STAGE } from '#/bot/quests/defs/princeali/journal.js';
import { decideJailbreak, sourceBeers, sourceRopes } from '#/bot/quests/defs/princeali/jailbreak.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

const snap = (stage: number, invIds: [number, number][] = [], bankIds: [number, number][] = []): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    stage,
    progress: { stage, flags: new Set() }
});
const I = PA_ITEM;
const DISGUISE: [number, number][] = [[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1], [I.PRINCE_KEY.id, 1]];

describe('supplies', () => {
    test('three beers, one per conversation at the Rusty Anchor', () => {
        const step = sourceBeers(snap(PRINCE_STAGE.SPOKEN_OSMAN));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Bartender');
    });

    test('null once three beers are held', () => {
        expect(sourceBeers(snap(PRINCE_STAGE.SPOKEN_OSMAN, [[I.BEER.id, 3]]))).toBeNull();
    });

    test('two ropes, bought from Ned by dialogue not by shop', () => {
        const step = sourceRopes(snap(PRINCE_STAGE.SPOKEN_OSMAN));
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Ned');
    });

    test('still wants a second rope with one in the pack', () => {
        expect(sourceRopes(snap(PRINCE_STAGE.SPOKEN_OSMAN, [[I.ROPE.id, 1]]))).not.toBeNull();
    });

    test('null with two ropes', () => {
        expect(sourceRopes(snap(PRINCE_STAGE.SPOKEN_OSMAN, [[I.ROPE.id, 2]]))).toBeNull();
    });
});

describe('stage 30 — the guard', () => {
    test('three beers held -> talk to Joe', () => {
        const step = decideJailbreak(snap(PRINCE_STAGE.PREP_FINISHED, [...DISGUISE, [I.BEER.id, 3]]));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Joe');
    });

    test('short of beer -> buy more first', () => {
        const step = decideJailbreak(snap(PRINCE_STAGE.PREP_FINISHED, [...DISGUISE, [I.BEER.id, 1]]));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Bartender');
    });
});

describe('stages 40 and 50 — Keli and the cell', () => {
    test('40 with rope and the disguise -> the one-shot break-in', () => {
        const step = decideJailbreak(snap(PRINCE_STAGE.GUARD_DRUNK, [...DISGUISE, [I.ROPE.id, 2]]));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });

    test('40 with no rope -> get one from Ned first', () => {
        const step = decideJailbreak(snap(PRINCE_STAGE.GUARD_DRUNK, DISGUISE));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Ned');
    });

    test('50 keeps a spare rope, because she respawns in 100 ticks', () => {
        const step = decideJailbreak(snap(PRINCE_STAGE.TIED_KELI, DISGUISE));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Ned');
    });

    test('50 with rope and the disguise -> the break-in', () => {
        const step = decideJailbreak(snap(PRINCE_STAGE.TIED_KELI, [...DISGUISE, [I.ROPE.id, 1]]));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });

    test('an incomplete disguise at 40 is recovered, not walked into the cell', () => {
        const step = decideJailbreak(snap(PRINCE_STAGE.GUARD_DRUNK, [[I.PRINCE_KEY.id, 1], [I.ROPE.id, 2]]));
        expect(step.kind).not.toBe('custom');
    });

    test('a plain wig does not pass for the disguise', () => {
        const s = snap(PRINCE_STAGE.GUARD_DRUNK, [
            [I.PLAIN_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1], [I.PRINCE_KEY.id, 1], [I.ROPE.id, 2]
        ]);
        expect(decideJailbreak(s).kind).not.toBe('custom');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/defs/princeali-jailbreak.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/defs/princeali/jailbreak.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bot/quests/defs/princeali/jailbreak.ts`:

```ts
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Traversal } from '../../../api/Traversal.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { driveUntil, settleScene } from '../../exec/prompts.js';
import { talkStrict } from '../../exec/primitives.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { BARTENDER, JOE_BEER, NED_ROPE, PA_ITEM, PA_LOC, PA_TILE } from './areas.js';
import { disguiseComplete } from './disguise.js';
import { PRINCE_STAGE } from './journal.js';
import { fromBank, held, heldItem } from './supplies.js';

const BEERS_NEEDED = 3;
const ROPES_NEEDED = 2;
/** Her spawn is five tiles from the door and oplocu refuses inside ten. */
const KELI_BLOCK_RADIUS = 12;

export function sourceBeers(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, PA_ITEM.BEER.id) >= BEERS_NEEDED) {
        return null;
    }
    return fromBank(snap, PA_ITEM.BEER, BEERS_NEEDED) ?? { kind: 'talk', stop: BARTENDER };
}

export function sourceRopes(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, PA_ITEM.ROPE.id) >= ROPES_NEEDED) {
        return null;
    }
    return fromBank(snap, PA_ITEM.ROPE, ROPES_NEEDED) ?? { kind: 'talk', stop: NED_ROPE };
}

function missingDisguise(snap: QuestSnapshot): QuestStep {
    const missing = [
        held(snap, PA_ITEM.PRINCE_KEY.id) === 0 ? PA_ITEM.PRINCE_KEY.name : null,
        held(snap, PA_ITEM.BLOND_WIG.id) === 0 ? 'blond Wig' : null,
        held(snap, PA_ITEM.PINK_SKIRT.id) === 0 ? PA_ITEM.PINK_SKIRT.name : null,
        held(snap, PA_ITEM.PASTE.id) === 0 ? PA_ITEM.PASTE.name : null
    ].filter((n): n is string => n !== null);
    return { kind: 'wait', reason: `the prince needs ${missing.join(', ')} handed over` };
}

export function decideJailbreak(snap: QuestSnapshot): QuestStep {
    const stage = snap.stage ?? PRINCE_STAGE.PREP_FINISHED;

    if (stage === PRINCE_STAGE.PREP_FINISHED) {
        const beers = sourceBeers(snap);
        return beers ?? { kind: 'talk', stop: JOE_BEER };
    }

    // A rope stays in the pack past the tie: she respawns in a hundred ticks, five
    // tiles from the door, and re-tying is the only way back through it.
    const needRope = stage === PRINCE_STAGE.GUARD_DRUNK ? ROPES_NEEDED : 1;
    if (held(snap, PA_ITEM.ROPE.id) < needRope) {
        return fromBank(snap, PA_ITEM.ROPE, needRope) ?? { kind: 'talk', stop: NED_ROPE };
    }
    if (!disguiseComplete(snap) || held(snap, PA_ITEM.PRINCE_KEY.id) === 0) {
        return missingDisguise(snap);
    }
    return { kind: 'custom', name: 'tie Lady Keli, unlock the cell and free the prince', run: breakOut };
}

async function tieKeli(log: (m: string) => void): Promise<boolean> {
    const keli = Npcs.query().name('Lady Keli').within(KELI_BLOCK_RADIUS).nearest();
    if (!keli) {
        return true;
    }
    const rope = heldItem(PA_ITEM.ROPE.id);
    if (!rope) {
        log('tieKeli: no rope in the pack');
        return false;
    }
    if (!(await Traversal.walkResilient(keli.tile(), { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const target = Npcs.query().name('Lady Keli').within(6).nearest();
    if (!target || !(await rope.useOn(target))) {
        return false;
    }
    const gone = (): boolean => Npcs.query().name('Lady Keli').within(KELI_BLOCK_RADIUS).nearest() === null;
    return driveUntil(gone, [], log, 12_000);
}

async function unlockCell(log: (m: string) => void): Promise<boolean> {
    const inCell = (): boolean => {
        const t = Game.tile();
        return t !== null && t.z <= PA_TILE.CELL.z && Math.abs(t.x - PA_TILE.CELL.x) <= 1;
    };
    if (inCell()) {
        return true;
    }
    if (!(await Traversal.walkResilient(PA_TILE.DOOR_STAND, { radius: 0, attempts: 4, timeoutMs: 90_000, log }))) {
        return false;
    }
    await settleScene();
    const key = heldItem(PA_ITEM.PRINCE_KEY.id);
    const door = Locs.query().name(PA_LOC.PRISON_DOOR).within(4).nearest();
    if (!key || !door) {
        log('unlockCell: no key or no Prison Door within four tiles of the north stand');
        return false;
    }
    if (!(await key.useOn(door))) {
        return false;
    }
    return Execution.delayUntil(inCell, 6000);
}

async function breakOut(log: (m: string) => void): Promise<boolean> {
    if (!(await tieKeli(log))) {
        return false;
    }
    if (!(await unlockCell(log))) {
        return false;
    }
    await settleScene();
    const handedOver = (): boolean => heldItem(PA_ITEM.BLOND_WIG.id) === null;
    if (!(await talkStrict('Prince Ali', [], log))) {
        log('breakOut: could not open a dialogue with Prince Ali');
    }
    return driveUntil(handedOver, [], log, 20_000);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test test/quests/defs/princeali-jailbreak.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Lint, typecheck, full suite**

Run: `bun test && bun run lint && bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/princeali/jailbreak.ts test/quests/defs/princeali-jailbreak.test.ts
git commit -m "feat(princeali): three beers, the tie, the cell and the prince

Joe takes all three beers in one conversation, so the pack needs exactly
three at once. Lady Keli respawns 100 ticks after npc_del five tiles from
the door, and oplocu refuses inside ten of her, so the tie, the walk, the
unlock and the rescue run as one step and stage 50 keeps a spare rope."
```

---

## Task 8: `decide()` and registration

**Files:**
- Create: `src/bot/quests/defs/princeali/index.ts`
- Delete: `src/bot/quests/defs/princeali.ts`
- Modify: `src/bot/quests/defs/index.ts`
- Modify: `src/bot/quests/data/quests.ts:101-113`
- Rewrite: `test/quests/defs/princeali.test.ts`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 2, 3, 5, 6, 7.
- Produces: `decide(snap: QuestSnapshot): QuestStep`, `princeali: QuestModule`.

The `PREP` array is the route. Read top to bottom and it is the tour: Al-Kharid, Lumbridge,
Varrock, Rimmington/Port Sarim, Draynor, Keli, Osman.

- [ ] **Step 1: Write the failing test**

Replace `test/quests/defs/princeali.test.ts` entirely:

```ts
import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/quests/defs/princeali/areas.js';
import { PRINCE_STAGE } from '#/bot/quests/defs/princeali/journal.js';
import { decide, princeali } from '#/bot/quests/defs/princeali/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

const snap = (
    stage: number | undefined,
    invIds: [number, number][] = [],
    bankIds: [number, number][] = [[PA_ITEM.COINS.id, 2_000_000]],
    extra: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
    journal: stage === PRINCE_STAGE.COMPLETE ? 'complete' : 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    stage,
    progress: stage === undefined ? undefined : { stage, flags: new Set() },
    ...extra
});
const I = PA_ITEM;
const PURSE: [number, number][] = [[I.COINS.id, 1000]];
const DISGUISE: [number, number][] = [[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1]];

describe('module shape', () => {
    test('declares the Draynor bank at level 0', () => {
        expect(princeali.bank?.x).toBe(3093);
        expect(princeali.bank?.z).toBe(3243);
        expect(princeali.bank?.level).toBe(0);
    });

    test('owns its own inventory and reads progress, with no gather map', () => {
        expect(princeali.ownsInventory).toBe(true);
        expect(princeali.readProgress).toBeDefined();
        expect(princeali.gather).toBeUndefined();
    });

    test('every record item is acquirable, so eligibility never blocks the quest', () => {
        expect(princeali.record.items.length).toBeGreaterThan(0);
        for (const item of princeali.record.items) {
            expect(item.kind).toBe('acquirable');
        }
    });

    test('the record keeps coins, or every dialogue purchase parks', () => {
        expect(princeali.record.items.map(i => i.name.toLowerCase())).toContain('coins');
    });
});

describe('lifecycle', () => {
    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snap(undefined, [], [], { journal: 'unknown' })).kind).toBe('wait');
    });

    test('a loaded journal with no readable stage waits', () => {
        expect(decide(snap(undefined)).kind).toBe('wait');
    });

    test('stage 0 -> Hassan', () => {
        const step = decide(snap(PRINCE_STAGE.NOT_STARTED));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Hassan');
    });

    test('stage 10 -> Osman', () => {
        const step = decide(snap(PRINCE_STAGE.STARTED));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Osman');
    });

    test('stage 100 -> Hassan for the reward', () => {
        const step = decide(snap(PRINCE_STAGE.SAVED));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Hassan');
    });

    test('stage 110 and a complete journal are both done', () => {
        expect(decide(snap(PRINCE_STAGE.COMPLETE)).kind).toBe('done');
        expect(decide(snap(PRINCE_STAGE.SAVED, [], [], { journal: 'complete' })).kind).toBe('done');
    });
});

describe('stage 20 route order', () => {
    test('an unseen bank is scanned before anything is sourced', () => {
        const s = snap(PRINCE_STAGE.SPOKEN_OSMAN, [], [], { bankKnown: false });
        expect(decide(s).kind).toBe('scanBank');
    });

    test('an empty purse is refilled first', () => {
        const step = decide(snap(PRINCE_STAGE.SPOKEN_OSMAN));
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Coins');
    });

    test('with coins, the first leg is the Al-Kharid bar', () => {
        const step = decide(snap(PRINCE_STAGE.SPOKEN_OSMAN, PURSE));
        expect(step.kind === 'buy' && step.item).toBe('Bronze bar');
    });

    test('then the water, on the same Shantay trip', () => {
        const step = decide(snap(PRINCE_STAGE.SPOKEN_OSMAN, [...PURSE, [I.BRONZE_BAR.id, 1]]));
        expect(step.kind === 'buy' && step.item).toBe('Jug of water');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Shantay');
    });

    test('everything held -> Leela hands the key over and promotes the stage', () => {
        const s = snap(PRINCE_STAGE.SPOKEN_OSMAN, [...PURSE, ...DISGUISE, [I.PRINCE_KEY.id, 1], [I.ROPE.id, 2], [I.BEER.id, 3]]);
        const step = decide(s);
        expect(step.kind === 'custom' && step.name).toContain('Leela');
    });

    test('no coins anywhere is an honest wait, never a loop', () => {
        const s = snap(PRINCE_STAGE.SPOKEN_OSMAN, [], []);
        expect(decide(s).kind).toBe('wait');
    });
});

describe('stage 20 resumability', () => {
    test('a soft clay in the pack routes to Lady Keli, not back to the mine', () => {
        const s = snap(PRINCE_STAGE.SPOKEN_OSMAN, [...PURSE, ...DISGUISE, [I.SOFT_CLAY.id, 1], [I.BRONZE_BAR.id, 1], [I.ROPE.id, 2], [I.BEER.id, 3], [I.JUG_OF_WATER.id, 1]]);
        const step = decide(s);
        expect(step.kind === 'talk' && step.stop.npc).toBe('Lady Keli');
    });

    test('a print plus a bar routes to the forge-and-collect', () => {
        const s = snap(PRINCE_STAGE.SPOKEN_OSMAN, [...PURSE, ...DISGUISE, [I.KEY_PRINT.id, 1], [I.BRONZE_BAR.id, 1], [I.ROPE.id, 2], [I.BEER.id, 3], [I.JUG_OF_WATER.id, 1]]);
        const step = decide(s);
        expect(step.kind === 'custom' && step.name).toContain('Osman');
    });

    test('a banked key is withdrawn rather than re-forged', () => {
        const s = snap(
            PRINCE_STAGE.SPOKEN_OSMAN,
            [...PURSE, ...DISGUISE, [I.ROPE.id, 2], [I.BEER.id, 3], [I.JUG_OF_WATER.id, 1]],
            [[I.COINS.id, 2_000_000], [I.PRINCE_KEY.id, 1]]
        );
        const step = decide(s);
        expect(step.kind === 'withdraw' && step.items.some(i => i.id === I.PRINCE_KEY.id)).toBe(true);
    });
});

describe('stages 30 through 50 delegate to the jailbreak', () => {
    const kit: [number, number][] = [...PURSE, ...DISGUISE, [I.PRINCE_KEY.id, 1], [I.ROPE.id, 2], [I.BEER.id, 3]];

    test('30 -> Joe', () => {
        const step = decide(snap(PRINCE_STAGE.PREP_FINISHED, kit));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Joe');
    });

    test('40 -> the break-in', () => {
        const step = decide(snap(PRINCE_STAGE.GUARD_DRUNK, kit));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });

    test('50 -> the break-in', () => {
        const step = decide(snap(PRINCE_STAGE.TIED_KELI, kit));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });
});

describe('every stage produces a step', () => {
    const stages = Object.values(PRINCE_STAGE);
    for (const stage of stages) {
        test(`stage ${stage} never returns undefined`, () => {
            const step: QuestStep = decide(snap(stage, PURSE));
            expect(step.kind).toBeDefined();
        });
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test test/quests/defs/princeali.test.ts`
Expected: FAIL — cannot resolve `#/bot/quests/defs/princeali/index.js`.

- [ ] **Step 3: Write `index.ts`**

Create `src/bot/quests/defs/princeali/index.ts`:

```ts
import { gotoNpc, talkStrict } from '../../exec/primitives.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { HASSAN_REWARD, HASSAN_START, LEELA_STOP, OSMAN_BRIEF, PA_ITEM, PA_TILE } from './areas.js';
import {
    disguiseComplete,
    makeAshes,
    makeBlondWig,
    makePaste,
    sourceOnions,
    sourcePasteGoods,
    sourcePinkSkirt,
    sourceShears,
    sourceTinderbox,
    sourceWool
} from './disguise.js';
import { decideJailbreak, sourceBeers, sourceRopes } from './jailbreak.js';
import { PRINCE_STAGE, readPrinceProgress } from './journal.js';
import {
    collectKey,
    haveKey,
    makeSoftClay,
    sourceBronzeBar,
    sourceClay,
    sourcePickaxe,
    sourceWater,
    takeKeyPrint
} from './key.js';
import { PURSE_FLOOR, PURSE_TOP, heldItem, scanBank, sourceCoins } from './supplies.js';

type Leg = (snap: QuestSnapshot) => QuestStep | null;

/** Read top to bottom, this is the route. */
const PREP: readonly Leg[] = [
    snap => sourceCoins(snap, PURSE_FLOOR, PURSE_TOP),
    sourceBronzeBar,
    sourceWater,
    sourceTinderbox,
    sourceShears,
    sourceOnions,
    sourceWool,
    sourcePinkSkirt,
    sourcePickaxe,
    sourceClay,
    sourcePasteGoods,
    sourceBeers,
    makeAshes,
    makeBlondWig,
    makePaste,
    sourceRopes,
    makeSoftClay,
    takeKeyPrint,
    collectKey
];

function decidePrep(snap: QuestSnapshot): QuestStep {
    if (!snap.bankKnown) {
        return scanBank();
    }
    for (const leg of PREP) {
        const step = leg(snap);
        if (step) {
            return step;
        }
    }
    if (!haveKey(snap) || !disguiseComplete(snap)) {
        return { kind: 'wait', reason: 'every prep leg is satisfied but the disguise or key is not in the pack' };
    }
    return { kind: 'custom', name: 'show Leela the disguise and collect the key', run: leelaHandover };
}

async function leelaHandover(log: (m: string) => void): Promise<boolean> {
    if (!(await gotoNpc(LEELA_STOP, [], log))) {
        return false;
    }
    return talkStrict(LEELA_STOP.npc, LEELA_STOP.prefer, log);
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= PRINCE_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Prince Ali Rescue journal stage unavailable' };
    }

    switch (snap.stage) {
        case PRINCE_STAGE.NOT_STARTED:
            return { kind: 'talk', stop: HASSAN_START };
        case PRINCE_STAGE.STARTED:
            return { kind: 'talk', stop: OSMAN_BRIEF };
        case PRINCE_STAGE.SPOKEN_OSMAN:
            return decidePrep(snap);
        case PRINCE_STAGE.PREP_FINISHED:
        case PRINCE_STAGE.GUARD_DRUNK:
        case PRINCE_STAGE.TIED_KELI:
            return decideJailbreak(snap);
        case PRINCE_STAGE.SAVED:
            return { kind: 'talk', stop: HASSAN_REWARD };
        default:
            return { kind: 'wait', reason: `Prince Ali Rescue stage ${snap.stage} is not implemented` };
    }
}

export const princeali: QuestModule = {
    record: QUESTS.find(record => record.id === 'prince')!,
    bank: PA_TILE.DRAYNOR_BANK,
    ownsInventory: true,
    readProgress: readPrinceProgress,
    decide
};
```

Remove the unused `PA_ITEM` and `heldItem` imports if lint flags them.

- [ ] **Step 4: Delete the old module and repoint the registry**

```bash
git rm src/bot/quests/defs/princeali.ts
```

In `src/bot/quests/defs/index.ts`, change:

```ts
import { princeali } from './princeali.js';
```

to:

```ts
import { princeali } from './princeali/index.js';
```

- [ ] **Step 5: Update the quest record**

In `src/bot/quests/data/quests.ts`, replace the `items` array of the `prince` record
(lines 105-112) with:

```ts
        items: [
            { name: 'Coins', qty: 400, kind: 'acquirable' },
            { name: 'Bronze bar', qty: 1, kind: 'acquirable' },
            { name: 'Pink skirt', qty: 1, kind: 'acquirable' },
            { name: 'Redberries', qty: 1, kind: 'acquirable' },
            { name: 'Pot of flour', qty: 1, kind: 'acquirable' },
            { name: 'Tinderbox', qty: 1, kind: 'acquirable' },
            { name: 'Shears', qty: 1, kind: 'acquirable' },
            { name: 'Rope', qty: 2, kind: 'acquirable' },
            { name: 'Beer', qty: 3, kind: 'acquirable' }
        ]
```

- [ ] **Step 6: Run the tests**

Run: `bun test test/quests/defs/princeali.test.ts`
Expected: PASS, 27 tests.

- [ ] **Step 7: Full suite, lint, typecheck**

Run: `bun test && bun run lint && bun run typecheck`
Expected: clean. `test/quests/quest-banks.test.ts` must still pass — it asserts every
`QUEST_DEFS` entry declares a real level-0 bank.

- [ ] **Step 8: Commit**

```bash
git add -A src/bot/quests/defs src/bot/quests/data/quests.ts test/quests/defs/princeali.test.ts
git commit -m "feat(princeali): stage-driven decide(), old module deleted

decide() switches on the journal stage. Stage 20 walks an ordered PREP list
whose order IS the route: Al-Kharid, Lumbridge, Varrock, Rimmington and
Port Sarim, Draynor, Keli, Osman. Three Al-Kharid trips is the structural
minimum for this quest."
```

---

## Task 9: Live harness

**Files:**
- Create: `tools/princeali-solo-test.ts`
- Create: `tools/princeali-wheel-probe.ts`

**Interfaces:**
- Consumes: `fail`, `launchBrowser` from `tools/lib/harness.js`; `cheat`, `cheatQuiet`,
  `mainlandAccount`, `relog`, `startScript`, `getServerVarQuiet` from `tools/tutorial/harness.js`.
- Produces: two runnable harnesses. No importable exports.

- [ ] **Step 1: Write the wheel probe**

The repo currently records the Lumbridge wheel as dead. Everything in the wool leg depends
on it, so it is probed on its own before any of it is trusted.

Create `tools/princeali-wheel-probe.ts`:

```ts
// docs/TESTING.md#live-harnesses
import { fail, launchBrowser } from './lib/harness.js';
import { cheat, cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `pw${Date.now().toString(36).slice(-7)}`;
const minutes = Number(opt('--minutes') ?? 8);

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, base, user);
    await cheat(page, 'speed 300');
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }
    // Wool only: the probe is about the wheel, not about shearing.
    if (!(await cheatQuiet(page, 'give wool 5'))) {
        fail('could not give wool');
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'prince'));
    await startScript(page, 'AIOQuester');

    const spun = await page
        .waitForFunction(
            () => {
                const g = globalThis as never as { __rs2b0t: { Inventory: { count(n: string): number } } };
                return g.__rs2b0t.Inventory.count('Ball of wool') > 0;
            },
            undefined,
            { timeout: minutes * 60_000 }
        )
        .then(() => true)
        .catch(() => false);

    const where = await page.evaluate(() => {
        const g = globalThis as never as { __rs2b0t: { reader: { worldTile(): unknown } } };
        return g.__rs2b0t.reader.worldTile();
    });
    console.log(`END spun=${spun} pos=${JSON.stringify(where)}`);
    if (!spun) {
        console.log('The Lumbridge wheel did not produce a ball of wool. Fall back to Falador:');
        console.log('  PA_TILE.SPIN_STAND = new Tile(2982, 3315, 0)');
        fail('Lumbridge spinning wheel probe failed');
    }
} finally {
    await browser.close();
}
```

- [ ] **Step 2: Run the wheel probe**

Run: `bun tools/princeali-wheel-probe.ts 2>&1 | tee /tmp/pa-wheel.log`
Expected: `END spun=true`. The bot should climb to level 1 of Lumbridge castle, stand at
3209,3213,1 and Spin.

**If it fails:** change `PA_TILE.SPIN_STAND` in `areas.ts` to `new Tile(2982, 3315, 0)`,
note it in the spec's "The spinning wheel" section, re-run, and continue. Do not proceed
with a red probe.

- [ ] **Step 3: Commit the probe and whatever it decided**

```bash
git add tools/princeali-wheel-probe.ts src/bot/quests/defs/princeali/areas.ts docs/superpowers/specs/2026-07-29-princeali-rebuild-design.md
git commit -m "test(princeali): probe the Lumbridge spinning wheel

sheepshearer avoids it on the strength of a 2026-07-16 probe that predates
the multi-level loc-snapshot settle fix by six days. Settle the question
before the wool leg depends on it."
```

- [ ] **Step 4: Write the solo harness**

Create `tools/princeali-solo-test.ts`:

```ts
// docs/TESTING.md#live-harnesses
import { fail, launchBrowser } from './lib/harness.js';
import { cheat, cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `pa${Date.now().toString(36).slice(-7)}`;
const stage = opt('--stage');
const keystatus = opt('--keystatus');
const give = opt('--give') ?? '';
const bankCoins = Number(opt('--bank-coins') ?? 2_000_000);
const minutes = Number(opt('--minutes') ?? 75);

const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };

interface SoloSnapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    await cheat(page, 'speed 300');
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }

    if (stage !== undefined && !(await cheatQuiet(page, `setvar princequest ${stage}`))) {
        fail('could not set princequest');
    }
    if (keystatus !== undefined && !(await cheatQuiet(page, `setvar prince_keystatus ${keystatus}`))) {
        fail('could not set prince_keystatus');
    }
    if (stage !== undefined || keystatus !== undefined) {
        // The quest-tab colour is pushed by if_setcolour; only the login script's
        // ~update_questlist re-derives it after a setvar.
        await relog(page, user);
        const got = await getServerVarQuiet(page, 'princequest');
        console.log(`jumped to princequest=${got} keystatus=${keystatus ?? '(unset)'} and relogged`);
    }

    // Bank seeding: 2m coins and nothing else. Seeding a stage's tools is what lets a
    // stage test pass while the quest cannot actually source them.
    await seedBank(page, bankCoins);

    // After the relog and the bank trip, so nothing is lost.
    for (const pair of give.split(',').map(s => s.trim()).filter(Boolean)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `give ${obj} ${Number(n) || 1}`))) {
            fail(`could not give ${pair}`);
        }
        console.log(`gave ${pair}`);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'prince'));
    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching');

    const deadline = Date.now() + minutes * 60_000;
    let lastLogTime = 0;
    let last: SoloSnapshot | null = null;
    while (Date.now() < deadline) {
        last = await page.evaluate((): SoloSnapshot => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
            };
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                status: g.__rs2b0t.Quests.status('Prince Ali Rescue'),
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
            };
        });
        const t = Math.round((Date.now() - t0) / 1000);
        const pos = last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?';
        console.log(`  t=${t}s pos=${pos} status=${last.status} qp=${last.qp} runner=${last.runner}`);
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        if (last.status === 'complete' || last.runner !== 'running') {
            break;
        }
        await page.waitForTimeout(10_000);
    }

    if (!last) {
        fail('no snapshot');
    }
    console.log(`END status=${last.status} qp=${last.qp} runner=${last.runner}`);
} finally {
    await browser.close();
}

async function seedBank(page: import('playwright-core').Page, coins: number): Promise<void> {
    if (coins <= 0) {
        return;
    }
    if (!(await cheatQuiet(page, `tele 0,${DRAYNOR_BANK.x >> 6},${DRAYNOR_BANK.z >> 6},${DRAYNOR_BANK.x & 63},${DRAYNOR_BANK.z & 63}`))) {
        fail('seedBank: tele to the Draynor bank failed');
    }
    await page.waitForTimeout(2000);
    if (!(await cheatQuiet(page, `give coins ${coins}`))) {
        fail('seedBank: give coins failed');
    }
    const banked = await page.evaluate(async (stand): Promise<string> => {
        const g = globalThis as never as {
            __rs2b0t: {
                Bank: {
                    isOpen(): boolean;
                    loaded(): boolean;
                    openBooth(t: unknown, name: string, op: string, log?: (m: string) => void): Promise<boolean>;
                    openNearest(name: string, op: string, log?: (m: string) => void): Promise<boolean>;
                    depositAllMatching(m: (name: string, id: number) => boolean): Promise<void>;
                    close(): Promise<boolean>;
                    countById(id: number): number;
                };
                Execution: { delayUntil(c: () => boolean, ms: number): Promise<boolean>; delayTicks(n: number): Promise<void> };
            };
        };
        const { Bank, Execution } = g.__rs2b0t;
        const opened = (await Bank.openBooth(stand, 'Bank booth', 'Use-quickly')) || (await Bank.openNearest('Bank booth', 'Use-quickly'));
        if (!opened) {
            return 'could not open the bank';
        }
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 5000);
        await Execution.delayTicks(1);
        await Bank.depositAllMatching((_name, id) => id === 995);
        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 4000);
        await Execution.delayTicks(1);
        const total = Bank.countById(995);
        await Bank.close();
        return total > 0 ? `ok:${total}` : 'coins never landed in the bank';
    }, DRAYNOR_BANK);
    if (!banked.startsWith('ok:')) {
        fail(`seedBank: ${banked}`);
    }
    console.log(`seedBank: ${banked.slice(3)} coins in the bank, nothing else`);
}
```

Note the harness needs the bot API exposed as `__rs2b0t.Bank` / `__rs2b0t.Execution`. Confirm
those are on the debug surface with `grep -n "Bank\|Execution" src/bot/runtime/*.ts` and, if
they are absent, add them the same way `tools/gatheringbot-test.ts` reaches `abi.Bank`.

- [ ] **Step 5: Smoke the harness at stage 100**

The shortest end of the quest, so a broken harness surfaces in two minutes rather than forty.

Run: `bun tools/princeali-solo-test.ts --stage 100 --minutes 10 2>&1 | tee /tmp/pa-100.log`
Expected: `END status=complete qp=3`. Confirm the log shows the bank seed line and a walk to
Hassan.

- [ ] **Step 6: Commit**

```bash
git add tools/princeali-solo-test.ts
git commit -m "test(princeali): stage-jump harness that seeds coins only

Bank gets 2m coins and nothing else, so every other item has to be sourced
from the world. Stage and keystatus jumps relog, because the quest-tab
colour is only re-derived by the login script."
```

---

## Task 10: Live per-leg verification

**Files:** none created. This task changes `src/bot/quests/defs/princeali/*` only where a run
proves something wrong.

**Interfaces:** none. The deliverable is a set of green harness runs and the fixes they force.

Each run below is a separate step. For each: run it, read the log, and if it fails, fix the
module and re-run **that** step before moving on. Commit after each fix with a message that
names what the live run taught.

- [ ] **Step 1: Stage 0 → 20, the start**

Run: `bun tools/princeali-solo-test.ts --stage 0 --minutes 20 2>&1 | tee /tmp/pa-start.log`
Expected: the log shows Hassan, then Osman, then `princequest` reaching 20 and the bot heading
for Shantay. Watch specifically for the Osman option loop — if the log shows
"What is the first thing I must do?" twice, the preference order in `OSMAN_BRIEF` is wrong.

- [ ] **Step 2: The Al-Kharid purchases**

Run: `bun tools/princeali-solo-test.ts --stage 20 --minutes 20 2>&1 | tee /tmp/pa-shantay.log`
Expected: one bank trip for coins, then Shantay sells a Bronze bar and two Jugs of water.
Then the bot leaves for Lumbridge. Kill it once the skirt leg starts.

- [ ] **Step 3: The Lumbridge cluster**

Run: `bun tools/princeali-solo-test.ts --stage 20 --give bronze_bar:1,jug_water:2 --minutes 30 2>&1 | tee /tmp/pa-lumbridge.log`
Expected: tinderbox and shears from the Shop keeper, two onions picked at 3189,3267, three
sheep sheared at 3197,3266, and three Balls of wool spun. Then Varrock for the skirt.

- [ ] **Step 4: The western cluster**

Run: `bun tools/princeali-solo-test.ts --stage 20 --give bronze_bar:1,jug_water:2,tinderbox:1,ball_of_wool:3,yellowdye:1,pink_skirt:1 --minutes 30 2>&1 | tee /tmp/pa-west.log`
Expected: the Bronze pickaxe taken from 2963,3216, Clay mined at 2986,3239, Redberries and a
Pot of flour from Wydin, and three separate Bartender conversations each yielding one Beer.

- [ ] **Step 5: The Draynor crafting cluster**

Run: `bun tools/princeali-solo-test.ts --stage 20 --give bronze_bar:1,jug_water:2,tinderbox:1,ball_of_wool:3,onion:2,pink_skirt:1,clay:1,redberries:1,pot_flour:1,beer:3 --minutes 30 2>&1 | tee /tmp/pa-draynor.log`
Expected: logs taken at 3089,3265 and burnt to Ashes; an Onion used on Aggie for Yellow dye;
Ned making the Wig; the dye used on the Wig to make id 2419; Aggie mixing the Paste; two rope
purchases from Ned; and the Jug of water used on the Clay for Soft clay.

- [ ] **Step 6: The print and the forge**

Run: `bun tools/princeali-solo-test.ts --stage 20 --give softclay:1,bronze_bar:1,blondwig:1,pink_skirt:1,skinpaste:1,rope:2,beer:3 --minutes 25 2>&1 | tee /tmp/pa-print.log`
Expected: the five-page Lady Keli conversation yielding a Key print, then Osman taking the
print and the bar, then Leela handing over the Bronze key **and** `princequest` moving to 30
in the same conversation.

- [ ] **Step 7: The already-forged branch — the wedge**

This is the crash path the design exists to survive. `--keystatus 1` means Osman has already
forged and Leela is holding the key.

Run: `bun tools/princeali-solo-test.ts --stage 20 --keystatus 1 --give keyprint:1,bronze_bar:1,blondwig:1,pink_skirt:1,skinpaste:1,rope:2,beer:3 --minutes 20 2>&1 | tee /tmp/pa-forged.log`
Expected: the log line `Osman would not take the print — the key is already forged; collecting
from Leela`, then the key in the pack and `princequest` at 30. It must **not** loop, and it
must not park.

- [ ] **Step 8: Stage 30 → 100, the jailbreak**

Run: `bun tools/princeali-solo-test.ts --stage 30 --give princeskey:1,blondwig:1,pink_skirt:1,skinpaste:1,rope:2,beer:3 --minutes 20 2>&1 | tee /tmp/pa-break.log`
Expected: Joe drinks all three beers in one conversation and `princequest` hits 40; the rope
ties Keli to 50; the key unlocks the door from 3123,3244 and the bot lands on 3123,3243; the
prince takes the disguise and `princequest` hits 100.

- [ ] **Step 9: The Keli respawn recovery**

Seed stage 50 *without* having tied her, so she is standing at her spawn inside the ten-tile
block. This is exactly the state a slow stage-40 run lands in.

Run: `bun tools/princeali-solo-test.ts --stage 50 --give princeskey:1,blondwig:1,pink_skirt:1,skinpaste:1,rope:1 --minutes 20 2>&1 | tee /tmp/pa-respawn.log`
Expected: the bot re-ties her with the spare rope and completes the break-in. If it instead
loops on "You'd better get rid of Lady Keli", the `KELI_BLOCK_RADIUS` check in `tieKeli` is
not finding her.

- [ ] **Step 10: Commit the fixes**

```bash
git add -A src/bot/quests/defs/princeali
git commit -m "fix(princeali): live per-leg corrections

<one line per thing a live run actually taught — delete this task's commit
if every leg passed first time>"
```

---

## Task 11: Uncheated end-to-end

**Files:** none created. Fixes go to `src/bot/quests/defs/princeali/*`.

**Interfaces:** none. The deliverable is one green 0 → 110 run.

- [ ] **Step 1: Run it**

No `--stage`, no `--give`. The bank holds 2m coins and nothing else.

Run: `bun tools/princeali-solo-test.ts --minutes 90 2>&1 | tee /tmp/pa-e2e.log`
Expected: `END status=complete qp=3`.

- [ ] **Step 2: Read the log for silent waste**

Even on a pass, check for:
- more than three Al-Kharid trips (the route order has drifted)
- a second Clay mined (the forge-and-collect fell into its recovery path)
- any `wait` reason repeating more than twice in a row (a leg that cannot make progress)
- any `parking` line at all

Fix anything found and re-run from Step 1.

- [ ] **Step 3: Record the evidence**

Append the run's headline numbers to the spec — wall-clock, quest points, and the number of
Al-Kharid trips — under a new `## Live result` heading.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-princeali-rebuild-design.md src/bot/quests/defs/princeali
git commit -m "test(princeali): uncheated 0 -> 110 run passes

<wall-clock, qp, anything the run forced>"
```

---

## Task 12: Documentation and PR

**Files:**
- Modify: `docs/QUESTS.md`
- Create: the pull request

- [ ] **Step 1: Add the lessons**

In `docs/QUESTS.md`, after the Shilo Village lessons block, add:

```markdown
Prince Ali Rescue added three more, and each of them is a class of bug rather than a
one-off:

- **A quest-internal varp the client cannot read is not state you may branch on.**
  `prince_keystatus` decides whether Osman will forge the key or refuse, and it is
  `scope=perm` with no `transmit`. The only durable answer is a step that *acts and then
  reads the result*: talk to Osman, and treat a print still in the pack as proof the key
  was already forged. Counters and `noProgress` tie-breaks are not a substitute.
- **Display names collide, and the collisions are exactly the quest items.** `plainwig`
  and `blondwig` both render `Wig`, and only the blond one satisfies any check in the
  quest. Wherever two objects share a name, `snap.invIds` is the only correct lookup —
  `snap.inv` silently accepts the wrong one.
- **An NPC you delete can come back inside the window you needed.** Lady Keli respawns
  100 ticks after `npc_del`, five tiles from the cell door, and the door refuses the key
  while she is within ten. Anything with a respawn timer shorter than the work it unblocks
  has to run as one step, and its stage has to be re-entrant with the consumable to redo it.

One habit falls out of the first point: **before believing a "this is broken server-side"
note, check its date against the nav fixes.** `sheepshearer` avoided the Lumbridge spinning
wheel for a fortnight on the strength of a probe taken six days before the multi-level
loc-snapshot settle landed. A level-1 loc queried in the tick after a climb reads back empty,
and blank is not absent.
```

- [ ] **Step 2: Verify the docs links**

Run: `bun run lint && bun test`
Expected: clean. If the repo has a docs link-checker (`grep -n "docs" package.json`), run it.

- [ ] **Step 3: Commit**

```bash
git add docs/QUESTS.md
git commit -m "docs(quests): the three lessons Prince Ali Rescue added"
```

- [ ] **Step 4: Open the PR**

```bash
git push -u origin princeali-rebuild
gh pr create --base main --title "Rebuild Prince Ali Rescue (#168)" --body "$(cat <<'EOF'
Closes #168.

The old module is deleted rather than repaired. It believed Osman hands over the
bronze key, had no notion of stages 30/40/50, and keyed every item lookup on a
display name that collides — `plainwig` and `blondwig` both render `Wig`.

## What is here

- `defs/princeali/` in the Watch Tower shape: `journal`, `areas`, `supplies`,
  `disguise`, `key`, `jailbreak`, `index`. `ownsInventory: true`, `readProgress`,
  no `gather` map.
- Stage read from the journal, newest needle first. Every item read by object id.
- `decide()`'s stage-20 `PREP` list is literally the route: Al-Kharid, Lumbridge,
  Varrock, Rimmington and Port Sarim, Draynor, Keli, Osman.
- `exec/wool.ts`, a behaviour-preserving shear-and-spin extraction from
  `sheepshearer`, which keeps its own tiles.
- `tools/princeali-solo-test.ts` (stage jump, 2m bank coins and nothing else) and
  `tools/princeali-wheel-probe.ts`.

## The two wedges

`prince_keystatus` is never transmitted, so a crash between Osman's forge and
Leela's handover is indistinguishable from the start of the key chain. The forge
step reads whether the print survived the conversation and goes to Leela either
way. Lady Keli respawns 100 ticks after the tie, five tiles from a door that
refuses the key within ten of her, so tie/walk/unlock/rescue is one step and
stage 50 keeps a spare rope.

## Verification

<paste the uncheated 0 -> 110 result: wall-clock, qp, Al-Kharid trips>

`bun test`, `bun run lint`, `bun run typecheck` all clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| What the current module gets wrong | 8 (deletion), 12 (docs) |
| Stage machine + journal parsing | 1 |
| Item identity (ids) | 2, 3 |
| Sourcing table | 3, 5, 6, 7 |
| Water quantity of two | 6 |
| The spinning wheel | 4, 9 |
| Route | 8 |
| Architecture / file table | 1–8 |
| The key wedge | 6, 10 Step 7 |
| The Keli-respawn wedge | 7, 10 Step 9 |
| The cell door | 7 (no nav-data change, as specified) |
| Testing | 9, 10, 11 |
| Out of scope | honoured: no nav-data edits, sheepshearer behaviour unchanged |

**Placeholder scan:** the only intentionally-open text is the commit body of Task 10 Step 10
and the PR's verification block, both of which are placeholders for *results that do not
exist yet* and are marked as such. No "TBD", no "add error handling", no "similar to Task N".

**Type consistency:** `gatherWool(snap, need, sites: WoolSites)` is used with the same
signature in Task 4's test, `sheepshearer` and `disguise.ts`. `held`/`banked`/`owned`/
`fromBank`/`buyItem`/`grabItem`/`sourceCoins`/`withdrawFrom`/`heldItem`/`hasAnyPickaxe`/
`scanBank` are declared in Task 3 and consumed with those exact names in Tasks 5, 6, 7 and 8.
`disguiseComplete` is defined in Task 5 and consumed in Task 7 and Task 8. `PRINCE_STAGE` and
`readPrinceProgress` are defined in Task 1 and consumed in Tasks 7 and 8. `PA_ITEM` /
`PA_TILE` / `PA_SHOP` / `PA_LOC` and the eleven `NpcStop`s are defined in Task 2 and consumed
throughout. `decideJailbreak` / `sourceBeers` / `sourceRopes` are defined in Task 7 and
consumed in Task 8.

**Fixed during review:** two steps originally showed a first draft and then corrected it in
the same step (`gatherWool`'s signature, and `makeYellowDye` calling `Reach.npcDialog` before
an `opnpcu`). Both now show only the final form, because a plan that ships code it knows is
wrong is a plan that gets the wrong code written.
