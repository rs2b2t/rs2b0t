# Prince Ali Rescue + Waterfall Quest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new AIOQuester defs — Prince Ali Rescue (f2p, 3 QP) and Waterfall Quest (members) — on top of two new engine capabilities: a shop `buy` step and quest-agnostic death recovery.

**Architecture:** Capabilities-first. Wave 1 extends the proven quest engine (`quests/engine/`, `quests/exec/steps.ts`) with a self-contained buy executor (coins from the bank; broke = a `wait` that the wait-park liveness machinery surfaces) and a death handler (chat-event detection → clear the running quest's provisioning flags → the ordinary decide loop re-gears and resumes). Waves 2–3 are pure `decide()` defs in `quests/defs/` exactly like the shipped six.

**Tech Stack:** TypeScript bot client, bun:test for pure logic, Playwright smokes via `tools/aio-quest-test.ts`, content research from `~/code/content` (.rs2 + .jm2), pack probes via scratch PathFinder scripts WITH edge packs loaded.

**Spec:** `docs/superpowers/specs/2026-07-16-prince-ali-waterfall-design.md`

## Global Constraints

- Quest facts from `~/code/content` `.rs2`/`.jm2` ONLY (guides are cross-checks; classic-RS memory is a trap — cadava/Urhney lessons). Cite `file:line` in code comments.
- NPC/loc anchors are MAP-DERIVED (npc.pack id → `grep " <id>$"` in maps; abs = mx*64+lx, mz*64+lz), never guide-derived.
- Pure `decide()`/gather fns: no live imports at runtime; live APIs only inside custom-step thunks.
- Journal + inventory are the only progress signals (ADR-0007); stage-invisible spans use the `snap.noProgress` probe rotation.
- Wait steps are the visible-failure channel: a gather that cannot proceed returns `{kind:'wait', reason}` and the WAIT_PARK machinery parks with that reason.
- Every def declares `tools` (deposit keep-list): gather tools + quest-internal carryables.
- Commit per task; add files explicitly by path (the user commits concurrently — NEVER `git add -A`; `src/client/GameShell.ts` is their WIP).
- Gates per task: `bunx tsc --noEmit` clean, `bun test src/bot/quests` green (or `src/bot` where api files change).
- Live smokes: engine on :8890, `tools/deploy-local.sh` first, main checkout only. Smoke account prep uses give/stats/gold cheats — the bot itself stays cheat-free.
- Pack probes MUST load the edge packs (doors/transports/stairEdges) — the raw grid lies (sheep-pen lesson).

---

## File structure

```
src/bot/quests/
  engine/
    types.ts          # + bankCoins on QuestSnapshot; + 'buy' QuestStep kind
    provisioning.ts   # + gpShort() pure helper (broke detection for gather fns)
    QuestEngine.ts    # + death flag consumption (clear provisioned/deposited, resume)
  exec/steps.ts       # + buy executor (self-provisions coins via the bank leg)
  defs/
    princeali.ts      # wave 2 (+ defs/index.ts append, run order after romeojuliet)
    waterfall.ts      # wave 3 (+ append last)
src/bot/scripts/AIOQuester.ts   # + chat.message death subscription -> consumeDeath()
src/bot/nav/data/*.json         # wave-3 curated edges IF the offline audit finds seals
```

---

### Task 1: bankCoins snapshot field + gpShort (pure)

**Files:**
- Modify: `src/bot/quests/engine/types.ts` (QuestSnapshot)
- Modify: `src/bot/quests/engine/provisioning.ts` (+ gpShort)
- Modify: `src/bot/quests/engine/QuestEngine.ts` (buildSnapshot populates bankCoins)
- Modify: every existing `src/bot/quests/defs/*.test.ts` + `src/bot/quests/engine/watchdog.test.ts` snap() helpers (mechanical: add `bankCoins: 0`)
- Test: `src/bot/quests/engine/provisioning.test.ts`

**Interfaces:**
- Produces: `QuestSnapshot.bankCoins: number` (REQUIRED — last-seen bank coins, LOWERCASED-counts convention; 0 until a bank has been opened this run) and:

```ts
/** How many MORE gp a purchase needs beyond pack + last-seen bank coins.
 *  0 = affordable. Pure: gather fns call this to decide buy vs broke-wait. */
export function gpShort(snap: { inv: Map<string, number>; bankCoins: number }, estGp: number): number;
```

- [ ] **Step 1: Write the failing test** (append to provisioning.test.ts)

```ts
describe('gpShort', () => {
    const snapWith = (packCoins: number, bankCoins: number) => ({
        inv: new Map(packCoins > 0 ? [['coins', packCoins]] : []),
        bankCoins
    });
    test('pack + bank covers -> 0', () => {
        expect(gpShort(snapWith(100, 0), 100)).toBe(0);
        expect(gpShort(snapWith(40, 60), 100)).toBe(0);
    });
    test('short -> the exact shortfall', () => {
        expect(gpShort(snapWith(0, 0), 150)).toBe(150);
        expect(gpShort(snapWith(30, 20), 150)).toBe(100);
    });
});
```

- [ ] **Step 2: Run — FAIL** (`bun test src/bot/quests/engine/provisioning.test.ts`, unresolved import)

- [ ] **Step 3: Implement**

provisioning.ts:

```ts
/** How many MORE gp a purchase needs beyond pack + last-seen bank coins.
 *  0 = affordable. bankCoins is last-SEEN (0 before any bank visit this run),
 *  so a broke verdict can be stale-pessimistic on a fresh login; the buy
 *  executor's own bank trip refreshes it and the next loop re-decides. Pure. */
export function gpShort(snap: { inv: Map<string, number>; bankCoins: number }, estGp: number): number {
    const have = (snap.inv.get('coins') ?? 0) + snap.bankCoins;
    return Math.max(0, estGp - have);
}
```

types.ts QuestSnapshot gains (after `noProgress`):

```ts
    /** Last-SEEN bank coin count (0 until a bank has been opened this run) —
     *  lets pure gather fns decide buy vs 'need ~N gp' wait. Same staleness
     *  contract as provisioning's bank counts. */
    bankCoins: number;
```

QuestEngine.buildSnapshot adds `bankCoins: this.lastBankCounts.get('coins') ?? 0`. Update ALL existing snap() test helpers with `bankCoins: 0` (watchdog.test.ts, runemysteries/doric/sheepshearer/restlessghost/cooksassistant/romeojuliet .test.ts).

- [ ] **Step 4: Run — PASS** (`bun test src/bot/quests` all green) + `bunx tsc --noEmit`
- [ ] **Step 5: Commit** (`feat(quests): bankCoins snapshot + gpShort for buy affordability`)

---

### Task 2: buy step + executor

**Files:**
- Modify: `src/bot/quests/engine/types.ts` (QuestStep union)
- Modify: `src/bot/quests/exec/steps.ts` (executor)
- Modify: `src/bot/quests/engine/QuestEngine.ts` (describeStep case)
- Test: typecheck + wave-2 live smoke (I/O executor; plan-mandated no unit test, same as the other executors)

**Interfaces:**
- Produces QuestStep kind:

```ts
    /** Buy `qty` of `item` from the shop run by `shop.npc` (Trade op). The
     *  executor self-provisions coins: pack < estGp -> bank-leg withdraw of
     *  estGp first. Gather fns pair this with gpShort(): affordable -> buy,
     *  broke -> {kind:'wait', reason:`need ~N gp for <item>`} (wait-park
     *  surfaces it). estGp is a deliberate overestimate (shop prices climb as
     *  stock drops — ShopRunner's est×1.25 lesson). */
    | { kind: 'buy'; item: string; qty: number; shop: { npc: string; anchor: Tile }; estGp: number }
```

- [ ] **Step 1: Implement the executor** (steps.ts, after the deposit case; read `src/bot/api/hud/Shop.ts` + how `ShopBuyout.ts` opens a shop first and copy that open idiom exactly)

```ts
        case 'buy': {
            const before = Inventory.count(step.item);
            // coins first: withdraw the estimate at the nearest bank when the
            // pack can't cover it (the withdraw-leg idiom; estGp deliberately
            // overshoots so price climb mid-purchase doesn't strand us)
            if (Inventory.count('Coins') < step.estGp) {
                const here = Game.tile();
                const bankLoc = here ? nearestBank(here) : null;
                if (!bankLoc) {
                    log('buy: no known bank for coins');
                    return false;
                }
                if (!(await Traversal.walkResilient(bankLoc.tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log }))) {
                    return false;
                }
                if (!(await Bank.openNearest(BANK_NAME, BANK_OP, log))) {
                    return false;
                }
                await Bank.withdrawX('Coins', step.estGp);
                actions.closeModal();
                if (Inventory.count('Coins') < step.estGp) {
                    log(`buy: bank could not cover ${step.estGp} gp for ${step.item}`);
                    return false; // gather fn's gpShort turns this into a parked wait next loop
                }
            }
            if (!(await ensureAt(step.shop.anchor, 3, log))) {
                return false;
            }
            const keeper = Npcs.query().name(step.shop.npc).action('Trade').nearest();
            if (!keeper) {
                log(`buy: no '${step.shop.npc}' to trade near the anchor`);
                return false;
            }
            if (!(await keeper.interact('Trade'))) {
                return false;
            }
            if (!(await Execution.delayUntil(() => Shop.isOpen(), 8000))) {
                log('buy: shop never opened');
                return false;
            }
            await Shop.buy(step.item, step.qty);
            actions.closeModal();
            return Inventory.count(step.item) > before;
        }
```

NOTE for the implementer: verify `Shop.isOpen()` and the exact `Shop.buy(name, n)` signature against `src/bot/api/hud/Shop.ts` (buy returns the bought count with a stop-on-no-progress contract) and copy ShopBuyout's open/close idiom where it differs. Import `Shop` into steps.ts.

- [ ] **Step 2: describeStep case** (QuestEngine.ts): `case 'buy': return `buy ${step.qty}× ${step.item}`;`
- [ ] **Step 3: Gates** — `bunx tsc --noEmit`; `bun test src/bot/quests`
- [ ] **Step 4: Commit** (`feat(quests): buy step — bank-coin self-provisioning + Shop API leg`)

---

### Task 3: death recovery

**Files:**
- Modify: `src/bot/scripts/AIOQuester.ts` (chat.message subscription + consumeDeath + paint death count)
- Modify: `src/bot/quests/engine/QuestEngine.ts` (consume + recover)
- Test: typecheck + the wave-3 deliberate-death live run (detection regex is already live-proven by WildyAgility)

**Interfaces:**
- AIOQuester: subscribe in onStart via the existing `this.on('chat.message', ...)` bus helper with the SAME loose regex DeathRecovery uses (`/oh dear.*you are dead/i` — cite `src/bot/api/tasks/DeathRecovery.ts:8`); latch a `died` flag; expose `consumeDeath(): boolean` (read-and-clear, the consumeSkip idiom) and count deaths for the Current tab.
- QuestEngine.execute, right after the skip consumption: 

```ts
        // Death recovery (spec: death = involuntary deposit-everything + a
        // teleport). Everything re-derives from journal + inventory, so the
        // whole recovery is: forget this quest's provisioning state so
        // bank-first re-gears it (spares come back out of the bank), reset the
        // watchdog, and let the ordinary decide loop walk back via its own
        // next step. No park: the quest keeps running.
        if (this.host.consumeDeath() && this.runningId !== null) {
            const dead = this.nameOf(this.runningId, elig);
            this.host.log(`died during ${dead} — re-provisioning and resuming`);
            this.provisioned.delete(this.runningId);
            this.deposited.delete(this.runningId);
            this.resetWatchdog();
            this.waitKey = '';
            this.waitCount = 0;
            return;
        }
```

(Death with no running quest: consumeDeath still clears the latch — same unconditional-consume lesson as Skip.)

- [ ] **Step 1: Implement both sides** (per the interfaces above; keep QuestEngine free of paint, AIOQuester free of orchestration)
- [ ] **Step 2: Gates** — `bunx tsc --noEmit`; `bun test src/bot/quests`
- [ ] **Step 3: Commit** (`feat(quests): quest-agnostic death recovery — re-provision and resume`)

---

### Task 4: Prince Ali Rescue def

**Read first:** `docs/superpowers/research/2026-07-16-prince-ali-content-facts.md` — every
coordinate, dialogue string, and recipe below is sourced there; treat it as part of this brief.

**Files:**
- Create: `src/bot/quests/defs/princeali.ts`
- Modify: `src/bot/quests/defs/index.ts` (append after `romeojuliet`)
- Modify: `src/bot/quests/data/f2p.ts` (prince record: `items: []` — Wig/Paste/Bronze key are
  quest-internal (stage-gated crafting) and Rope/Pink skirt are self-managed by the def's
  acquisition phases; keep a comment citing the research doc. Provisioning must NOT try to
  pre-gather stage-gated intermediates.)
- Test: `src/bot/quests/defs/princeali.test.ts`

**Interfaces:**
- Consumes: `gpShort` (Task 1), buy step (Task 2), everything from the shipped engine.
- Produces: `export const princeali: QuestModule` (+ `export function decide` for tests).

**Module data (from the research doc — copy exactly):**

```ts
const HASSAN: NpcStop = { npc: 'Hassan', anchor: new Tile(3302, 3163, 0), leash: 6, prefer: ['Can I help you? You must need some help here in the desert.'] };
const OSMAN: NpcStop = { npc: 'Osman', anchor: new Tile(3286, 3180, 0), leash: 6, prefer: ['The chancellor trusts me. I have come for instructions.', 'What is the first thing I must do?', 'What is the second thing you need?', 'Okay, I better go find some things.'] };
const LEELA: NpcStop = { npc: 'Leela', anchor: new Tile(3113, 3263, 0), leash: 6, prefer: [] };
const NED_WIG: NpcStop = { npc: 'Ned', anchor: new Tile(3100, 3258, 0), leash: 6, prefer: ['Ned, could you make other things from wool?', 'How about some sort of wig?', 'I have that now. Please, make me a wig.'] };
const NED_ROPE: NpcStop = { npc: 'Ned', anchor: new Tile(3100, 3258, 0), leash: 6, prefer: ['Yes, I would like some rope.', 'Okay, please sell me some rope.'] };
const AGGIE_PASTE: NpcStop = { npc: 'Aggie', anchor: new Tile(3086, 3259, 0), leash: 6, prefer: ['Could you think of a way to make skin paste?', 'Yes please. Mix me some skin paste.'] };
const AGGIE_DYE: NpcStop = { npc: 'Aggie', anchor: new Tile(3086, 3259, 0), leash: 6, prefer: ['Can you make dyes for me please?', 'What do you need to make yellow dye?', 'Okay, make me some yellow dye please.'] };
const KELI: NpcStop = { npc: 'Lady Keli', anchor: new Tile(3128, 3244, 0), leash: 6, prefer: ['Are you the famous Lady Keli?', 'What is your latest plan then?', 'Can you be sure they will not try to get him out?', 'Could I see the key please?', 'Could I touch the key for a moment?'] };
const THESSALIA_SHOP = { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) };
const SHANTAY_SHOP = { npc: 'Shantay', anchor: new Tile(3304, 3123, 0) };
const BARTENDER: NpcStop = { npc: 'Bartender', anchor: new Tile(3226, 3399, 0), leash: 8, prefer: ["I'll have a beer please."] }; // Varrock Blue Moon; LIVE-VERIFY exact display name + anchor
const ONION_PATCH = new Tile(3188, 3267, 0);      // loc 3366 'Onion' op2=Pick, beside Fred's farm
const CLAY_ROCKS = /* reuse doric's Rimmington clay anchor */ new Tile(2986, 3240, 0);
const BUCKET_SPAWN = new Tile(3225, 3294, 0);     // proven farmhouse tile (cook def)
const WELL = new Tile(3208, 3221, 0);             // Lumbridge courtyard well — LIVE-VERIFY
const JAIL_DOOR_NORTH = new Tile(3123, 3244, 0);  // MUST unlock from z>=3244
const PRINCE_TILE = new Tile(3123, 3242, 0);
const JOE_TILE = new Tile(3123, 3245, 0);
```

**decide() priority table** (inProgress; first match wins; every branch is stage-safe
because talks at wrong stages are harmless status lines and the probe rotation +
watchdog cover invisible gaps):

| # | Condition (snap.inv, lowercased) | Step |
|---|---|---|
| 1 | has all 4: 'bronze key','wig','pink skirt','paste' AND beer≥3 AND rope≥2 | custom `jailbreak` |
| 2 | has all 4, missing beers/ropes | beers<3 → coins≥10 in pack ? talk BARTENDER : withdraw/wait via gpShort; rope<2 → coins≥15 ? talk NED_ROPE : gpShort wait |
| 3 | has 'key print' | talk OSMAN (hands imprint+bar; NEEDS 'bronze bar' held — if missing, buy SHANTAY first: `{kind:'buy', item:'Bronze bar', qty:1, shop:SHANTAY_SHOP, estGp:60}`) |
| 4 | no 'bronze key' && no 'key print' && has 'soft clay' | custom `imprintAtKeli` (talkThrough KELI with the prefer chain; success = 'Key print' appears) |
| 5 | no 'bronze key' && no 'key print' && no 'soft clay' | soft-clay chain, in order: no 'clay' → mineRock Clay ×1 @ CLAY_ROCKS; no 'bucket of water' → (no 'bucket' → grabGround Bucket @ BUCKET_SPAWN; else useOn Bucket → loc 'Well' @ WELL, product 'Bucket of water'); else make soft clay: `{kind:'useOn', item:'Bucket of water', targetKind:'item', target:'Clay', product:'Soft clay'}`. **This task adds the `targetKind:'item'` useOn variant** — extend the union member in types.ts and add an executor branch resolving the target via `Inventory.first(step.target)` and dispatching `held.useOn(targetItem)` (InvItem-on-InvItem is already supported by the driver, ~10 lines mirroring the npc/loc cases) |
| 6 | probe: key made but not collected (no visible signal) | talk LEELA (harmless at every stage; collects key at keymade, sets stage 30 when all 4 held) |
| 7 | no 'wig' (blond OR plain — same display name) | custom `wigPipeline`: live id check via Inventory.first('Wig'); no wig at all → need 3 'ball of wool' (reuse: shear/spin — import { gatherBalls } from './sheepshearer.js' and call it with need 3) then talk NED_WIG; plain wig held + 'yellow dye' → useOn dye→wig (item-on-item); plain wig + no dye → dye chain: onion<2 → pickLoc 'Onion' 'Pick' @ ONION_PATCH; coins<5 → gpShort wait/withdraw; else talk AGGIE_DYE |
| 8 | no 'paste' | paste chain: no 'redberries' → buy Port Sarim general (`estGp:20`; NPC + anchor from port_sarim.inv — implementer derives the shopkeeper spawn the standard way); no 'pot of flour' → buy same shop; no 'ashes' → custom `burnForAshes` (needs 'tinderbox' → buy Lumbridge general estGp 5; 'logs' → grabGround from a Draynor/Lumbridge house spawn (derive; several exist) or chop; light: useOn Tinderbox→Logs, wait for fire burnout ≤200 ticks, grab 'Ashes'); no water (bucket_water or jug) → water chain as row 5; else talk AGGIE_PASTE |
| 9 | no 'pink skirt' | buy: `{kind:'buy', item:'Pink skirt', qty:1, shop:THESSALIA_SHOP, estGp:10}` |
| 10 | fallback (all parts flowing, stage invisible) | probe rotation [LEELA, OSMAN, HASSAN] via noProgress |

`notStarted` → talk HASSAN. `complete` → done.

**jailbreak custom** (the one big bespoke mechanic; every leg re-checks live state):
1. walk JOE_TILE area; if Joe present and beers held: useOn Beer→'Joe' up to 3× (research: 1 then 2; each is opnpcu) — stop early if beers hit 0.
2. useOn Rope→'Lady Keli' (only works once guard drunk; failure = keep rope, retry next pass).
3. If Keli gone (npc_del'd): walk JAIL_DOOR_NORTH (stand z≥3244), useOn 'Bronze key'→'Prison Door' (loc name exact), expect "You unlock the door" (no item change — bounded delay then proceed).
4. Open 'Prison Door' (op1) if needed, walk PRINCE_TILE, talkThrough 'Prince Ali' [] (handover consumes the 4 when held) — success = 'Bronze key' left the pack.
5. Return false on any missing precondition; the decide table re-routes.

**tools (deposit keep-list):** `['bronze key','key print','wig','paste','pink skirt','rope','beer','soft clay','clay','yellow dye','onion','ball of wool','shears','redberries','pot of flour','ashes','bucket','jug','tinderbox','logs','bronze bar','coins']` — everything the pipelines touch; coins kept so mid-quest shopping doesn't re-trip the bank. (Broad on purpose; deposit only matters for spillover from OTHER quests.)

- [ ] **Step 1: failing tests** — decide-table unit tests (one per row: craft snapshots hitting each condition, assert the step kind/target; include the all-4+supplies → jailbreak custom row and the notStarted → Hassan row). Follow the sheepshearer.test.ts shape; ~10 cases.
- [ ] **Step 2: verify FAIL**, implement def (+ the `targetKind:'item'` useOn variant in types.ts + steps.ts), append to QUEST_DEFS, **Step 3: PASS** + `bunx tsc --noEmit`.
- [ ] **Step 4: Commit** (`feat(quests): Prince Ali Rescue def — disguise pipelines + jailbreak`)
- [ ] **Step 5 (controller): live smoke** — `bun tools/aio-quest-test.ts http://localhost:8890 '' prince 90 bronze_pickaxe:1 mining:15` + gold prep (add a gold amount to the give CSV as `coins:100`); fix LIVE-VERIFY anchors it exposes.

---

### Task 5: Waterfall offline nav audit + data

**Read first:** `docs/superpowers/research/2026-07-16-waterfall-content-facts.md`.

**Files:**
- Modify: `src/bot/nav/data/transports.json` (TGV dungeon pair; any curated fixes the audit demands)
- Create: `docs/superpowers/research/2026-07-16-waterfall-nav-audit.md` (findings)

**Steps:**
- [ ] **Step 1:** add the TGV dungeon telejump pair (Edgeville-dungeon encoding):
  `(2533,3155,0)<->(2533,9555,0)`, locName from loc 1754/1757 configs ('Ladder'), actions Climb-down/up, kind 'dungeon'.
- [ ] **Step 2:** offline pack-connectivity probes (scratch PathFinder WITH edge packs — the established walkcheck pattern):
  - region 149: (2533,9555) → crate (2548,9565) → gate-south side (2515,9574); note the gate itself is def-driven (key door), so check connectivity ONLY up to each side of it, and (2515,9576) → Golrie (2515,9581).
  - region 153 (tomb): landing (2554,9844) → coffin (2542,9811) → chest (2530,9844).
  - region 154 (dungeon): entry (2575,9861) → crate (2589,9888) → each baxtorian_door_2 side → pillars (2562-2569, 9910-9914) → statue (2565,9916)-adjacent → post-tele room (2603,9914) → chalice (2603,9910).
  - surface: Ardougne-area approach → Almera (2522,3498); tombstone hill (2558,3444); rope-rock zone (2510-2514, 3476-3481); Hadley's upstairs bookcase (2520,3426,1) — stairs edge present?
- [ ] **Step 3:** curate any missing edges the probes expose (door pairs / stair entries — the Juliet-mansion idiom), each with a WHY comment; re-probe until every leg above resolves.
- [ ] **Step 4:** write the audit doc (what resolved out-of-the-box, what needed curation, unresolved risks for the def task), commit data + doc (`feat(nav): waterfall-route edges — TGV dungeon pair + audit`).

---

### Task 6: Waterfall Quest def

**Read first:** `docs/superpowers/research/2026-07-16-waterfall-content-facts.md` + the Task 5 audit doc.

**Files:**
- Create: `src/bot/quests/defs/waterfall.ts`
- Modify: `src/bot/quests/defs/index.ts` (append LAST)
- Modify: `src/bot/quests/data/members-c.ts` (waterfall record: confirm `items: []` or set to
  `[{name:'Rope',qty:1,kind:'acquirable'}]` + comment; runes/food are def-managed mid-quest
  because runes cannot pass the tomb gate)
- Test: `src/bot/quests/defs/waterfall.test.ts`

**Phase model** (decide dispatches on held items; stages 0-3 are talk/read; 4+ is item-driven):

| # | Condition | Step |
|---|---|---|
| 1 | notStarted | talk ALMERA (prefer ['How can I help?']) |
| 2 | no 'book on baxtorian' read yet AND no 'glarial's pebble' AND no pebble-consumed signals | custom `bookLeg`: raft hop (Board lograft @ (2509,3493) → arrive (2512,3481); fires Hudon), then Hadley's office upstairs bookcase (2520,3426,1) Search → grab book → interact 'Read' (iop). Idempotent; success = book read once (track: book in pack = read it then keep; re-read harmless) |
| 3 | no 'glarial's pebble' && no 'glarial's amulet' && no 'glarial's urn' | custom `pebbleLeg`: walkWithHops-style to TGV via the Task-5 dungeon pair; 'a key' not held → Search golrie_crate (2548,9565); open golrie_gate (2515,9575) with the key (useOn); talk Golrie (prefer ['Do you mind if I have a look?', 'No, of course not.', 'Could I take this old pebble?']) |
| 4 | has pebble, missing amulet or urn | custom `tombLeg`: FIRST a def-issued `{kind:'deposit', keep:['glarial','rope','food-names...','coins']}` (the tomb gate forbids weapons/armour/runes/logs/etc — research §tomb-gate; the narrow keep guarantees entry), then unequip everything worn (Equipment loop), tombstone hop (useOn pebble→tombstone @ (2558,3444) → arrive (2554,9844)), Search coffin (2542,9811) → urn, Open+Search chest (2530,9844) → amulet, exit via the landing ladder (pin live), RUN PAST the moss giants (no combat) |
| 5 | has amulet+urn, runes not stocked (air/earth/water <6 each) | withdraw `{kind:'withdraw', items:[{name:'Air rune',qty:6},{name:'Earth rune',qty:6},{name:'Water rune',qty:6},{name:<food>,qty:10}]}` — bank-first; missing runes in bank → gpShort-style wait 'need 6+6+6 elemental runes banked' (runes ARE buyable but shop routing is out of scope v1 — park visibly) |
| 6 | has amulet+urn+runes | custom `fallsLeg`: rope-rock crossing (stand in zone (2510-2514,3476-3481) north of rock, useOn Rope→crossing_rock — forcemove; rope kept), useOn Rope→overhanging tree → ledge (2511,3463); AVOID the barrel; Open ledge door with amulet held → dungeon (2575,9861) |
| 7 | in dungeon (underground z 9860-9920, held amulet+urn) | custom `dungeonLeg`: Search baxtorian_crate (2589,9888) → 'a key'; open door leaves toward the puzzle room (useOn key); blind-place ALL 18 runes (each pillar × air/earth/water — repeats are FREE no-ops, research §pillars); useOn amulet→'Statue of Glarial' (2565,9916) — a 20-hp bounce means bits incomplete → re-place; after the tele (2603,9914): useOn 'Glarial's urn'→chalice (2603,9910); NEVER op1 the chalice |
| 8 | complete | done |

(The custom-per-leg shape mirrors Restless Ghost's sanctioned two-custom deviation — here it is
five legs; each is one scripted-ride cluster and each returns false to re-enter. Document the
deviation in the def header. Hazards: dungeonLeg fights nothing; food eaten via the sustain hook;
death recovery (Task 3) is the net — the def's `tools` keep-list must cover every quest item:
`['glarial','a key','rope','book on baxtorian','trout','air rune','earth rune','water rune','coins']`
(FOOD constant = 'Trout' throughout the def — cheap, bankable, and the smoke preps it).)

- [ ] **Step 1: failing tests** — decide-table cases per row (~8), sheepshearer.test.ts shape.
- [ ] **Step 2:** implement (verify each hop triple against the research doc; keep customs
  re-entrant), **Step 3: PASS** + tsc.
- [ ] **Step 4: Commit** (`feat(quests): Waterfall Quest def — five-leg custom pipeline`)
- [ ] **Step 5 (controller): live smoke** — prepped account:
  `bun tools/aio-quest-test.ts http://localhost:8890 '' waterfall 120 rope:1 attack:60,strength:60,defence:60,hitpoints:60` + banked runes/food prep (extend prep or pre-bank via cheat+deposit; simplest: give runes+food in the CSV — provisioning deposits spillover then the def withdraws as needed... verify flow live). Fix LIVE-VERIFY items (tomb exit ladder, bartender name, etc.).

---

### Task 7: deliberate-death live verification (controller-run)

- [ ] Run Waterfall on a WEAK account (`attack:40,strength:40` only, minimal food) and let the
  dungeon giants kill it at least once. Verify from the diag log ring: death detected
  (`died during Waterfall Quest — re-provisioning and resuming`), re-provision withdraws spare
  food/runes, the def resumes the correct leg from journal+inventory, and the run either
  completes or parks honestly. Record what happens to untradeable quest items on death
  (kept vs dropped) in the research doc — it decides whether defs need re-loot logic.
- [ ] If untradeables DROP on death: add re-obtain handling per the research doc's re-give
  table (each source re-checks inv and re-gives) — the pipelines already re-run, so verify
  rather than build.

---

### Task 8: acceptance + wrap

- [ ] `bun tools/aio-quest-test.ts http://localhost:8890 '' prince,waterfall 240 <prep>` —
  both journals complete, clean stop, on ONE account (gold + stats + rope prep).
- [ ] Ledger + memory updates (new capabilities, new gotchas), final whole-branch review
  dispatch over the project range, doc breadcrumbs for any smoke-prep gates discovered.
