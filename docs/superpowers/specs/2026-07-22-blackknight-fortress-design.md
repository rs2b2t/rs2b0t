# Black Knight's Fortress quest module — design

**Date:** 2026-07-22
**Status:** approved
**Prune:** delete this spec + its plan once the quest is live-verified and merged (living-docs rule).

## Goal

A new AIOQuester quest module (`defs/blackknight.ts`) that completes Black
Knight's Fortress end-to-end: start with Sir Amik, enter the fortress in the
Iron-chainbody/Bronze-med-helm disguise, listen at the grill, sabotage the
potion with a plain cabbage, and return to Sir Amik. 3 QP. Integrated into the
existing quest queue like the other 13 defs.

## Content ground truth (quest_blackknight.rs2 + sir_amik_varze.rs2)

State is the server varp `%spy` (send_quest_progress → journal). Stages:

- `%spy = 0` — not started. Sir Amik Varze (White Knights' Castle, Falador,
  `2962,3338,2`): "I seek a quest!" → (needs 12 QP) → "I laugh in the face of
  danger!" → mission accepted → `%spy = 1`.
- `%spy = 1` — enter the fortress (disguise-gated) and **Listen** at the grill
  (`witchgrill`, `3025,3508,0`, op1). Eavesdrop dialogue → `%spy = 2`.
- `%spy = 2` — **use a plain Cabbage** on the **Hole** (`blackknighthole`,
  `3031,3508, level 1`, `oplocu`). Correct cabbage → sabotage → `%spy = 3`.
  A `magic_cabbage` is REJECTED ("wrong sort of cabbage!") — no progress.
- `%spy = 3` — return to Sir Amik → complete (`%spy = 4`, 3 QP + 2500 coins).

**Disguise gate:** `bkfortressdoor1` / `fortressguard` require BOTH
`bronze_med_helm` (worn hat) and `iron_chainbody` (worn torso), or entry is
refused. So both must be WORN before entering.

**Danger:** Black Knights inside are aggressive (`black_knights_aggro` /
`aggressive_black_knight`) — the bot runs past, never fights.

**Cabbage gotcha:** the potion needs a PLAIN `Cabbage`. The Draynor MANOR
cabbage patch grows `magic_cabbage` (the wrong item). Pick from an ordinary
cabbage field (Falador south / Draynor village), never the manor patch.

## Design

Standard `QuestModule` (record + pure `decide` + gather + food + grind), one
file `src/bot/quests/defs/blackknight.ts`, registered in `defs/index.ts`.

**Stage oracle (no varp).** `%spy` is a quest varp and NEVER reaches the client
(engine adapter drops them; the snapshot has only `journal` = notStarted/
inProgress/complete, `inv`, `worn`, `noProgress`). So the def infers stage from
observables, the Priest-in-Peril / Romeo & Juliet pattern:
- `notStarted` journal → before the start talk.
- `inProgress` + disguise not fully worn → equip.
- `inProgress` + **Cabbage still held** → still infiltrating (the sabotage is
  the ONLY thing that consumes the cabbage — `inv_del` at `%spy=2`).
- `inProgress` + **Cabbage gone** → sabotaged (`%spy=3`) → return to Sir Amik.
  Safe because provisioning guarantees the cabbage is held before the fortress
  phase, so "gone" means consumed, not "never acquired".

Both the grill-**Listen** (no-op "I can't hear much" off-stage) and the
Cabbage-on-**Hole** ("why would I want to do that" off-stage) are harmless at
the wrong `%spy`, and listening must precede the sabotage — so one re-entrant
custom leg does them IN SEQUENCE without needing the exact stage.

`decide(snap)`:
1. journal `complete` → `done`.
2. journal `notStarted` → `talk` Sir Amik (start).
3. `inProgress` + Iron chainbody or Bronze med helm not in `worn` → `equip`
   them (withdrawn to the pack by provisioning, then equipped).
4. `inProgress` + Cabbage held → custom `infiltrate` (re-entrant): reach the
   grill (`3025,3508,0`) and Listen (drives the entry doors + secret-wall push
   + aggro via the fixed `Reach`, then the eavesdrop continues), then climb to
   the Hole (`3031,3508,1`) and `useOn` Cabbage → Hole. Returns false until the
   cabbage is consumed. Waterfall/Demon-Slayer custom-leg shape (no baked route
   data; aggro/doors driven live).
5. `inProgress` + Cabbage gone → `talk` Sir Amik → complete.

**Provisioning (user-confirmed):**
- Iron chainbody + Bronze med helm — mustHave, **bank-provided**: withdrawn
  from the bank and equipped; if the bank lacks either, the quest PARKS
  "missing: …" (neither is cleanly shop-buyable). Bank = **Falador West**
  (`2946,3369`, nearest the castle) per the per-quest bank field.
- Cabbage — `acquirable`, gather fn picks a plain `Cabbage` from an ordinary
  cabbage field (NEVER the Draynor Manor magic patch); re-derivable if lost.
- `food: 4` — carried for the black-knight run, eaten by the AIOQuester hook
  on low HP; never used to fight.
- `grind: ['black knight', 'aggressive black knight']` so the random-event
  guard never flags the fortress knights as a hostile event.

## Out of scope

Smithing/buying the disguise in-quest (bank-provided instead); fighting the
black knights.

## Error handling

- Missing disguise in the bank → park "missing" (retryable), not block.
- Wrong cabbage (`magic_cabbage`) → the server no-ops; the gather picks the
  plain field so this shouldn't arise, but decide() re-routes on no-progress.
- Fortress door/route stalls → the fixed `Reach` opens blocking doors on the
  server's "can't reach"; honest `unreachable` parks rather than loops.
- Death to a black knight → recoverable via the AIOQuester death latch
  (re-provision + resume).

## Testing

- Unit: `test/quests/defs/blackknight.test.ts` — pure `decide()` transitions
  off the OBSERVABLE oracle (notStarted → start talk; inProgress + disguise not
  worn → equip; inProgress + cabbage held → infiltrate; inProgress + cabbage
  gone → Sir Amik; complete → done). No client, no varp reads.
- Data: the quest-bank integrity test already pins blackknight's bank to a
  real BANK_LOCATIONS tile once the def sets it.
- Live: `aio-quest-test blackknight` (fresh account, 12 QP seeded, disguise +
  cabbage staged) — journal reaches complete, QP +3. Heavy LIVE-VERIFY on the
  fortress door/route/secret-wall tiles, the grill/hole ops, and the
  cabbage-field tile (standard for a new quest).
