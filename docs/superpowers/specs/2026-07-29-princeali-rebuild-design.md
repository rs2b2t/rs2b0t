# Prince Ali Rescue — rebuild design

Issue: [#168](https://github.com/rs2b2t/rs2b0t/issues/168)

The existing `defs/princeali.ts` is discarded, not repaired. Its model of the quest
is wrong in ways that cannot be patched: it believes Osman hands over the key, it has
no notion of stages 30/40/50, and it keys every item lookup on a display name that
collides.

Everything below was read out of the engine's own content
(`LostCityRS/Content`, verified identical to the local `~/code/content` checkout for
`quest_prince` and `area_draynor`), not from a guide.

## What the current module gets wrong

| Current behaviour | Reality |
|---|---|
| Osman gives the bronze key | `osman_items` only sets `prince_keystatus = keymade`; `leela_help` runs the `inv_add(princeskey)` |
| Progress inferred from held items alone | The quest has seven distinct server stages; 30/40/50 are unrepresented |
| `snap.inv.get('wig')` | `plainwig` (2421) and `blondwig` (2419) both render `Wig`; only the blond one satisfies any check |
| Beers used on Joe one at a time in a loop | `joe_beer` consumes 1, then 2 more in a single conversation — it needs exactly 3 in the pack, once |
| Rope bought at Ardougne's adventurer shop (~2600,3294) | Ned sells rope for 15gp at 3100,3258, thirty tiles from the jail |
| Beer from the Varrock Blue Moon (3226,3399) | Port Sarim's Rusty Anchor bartender (3045,3257) is 48 tiles from Draynor |
| Tinderbox from Lumbridge but wool spun at Falador | Both the sheep and a working wheel are within sixty tiles of that same shop |
| Nothing handles Lady Keli's respawn | `respawnrate=100`, and her spawn is five tiles from the cell door |

## Stage machine

`quest_prince.constant` and `prince_journal.rs2`:

| Stage | Constant | Advanced by |
|---|---|---|
| 0 | `prince_not_started` | Hassan, 3302,3163 — "Can I help you? You must need some help here in the desert." |
| 10 | `prince_started` | Osman, 3286,3180 — ask both things, then "Okay, I better go find some things." |
| 20 | `prince_spoken_osman` | Leela, 3113,3263, **holding `princeskey` + `blondwig` + `pink_skirt` + `skinpaste`** |
| 30 | `prince_prep_finished` | Joe, 3123,3245 — "I have some beer here, fancy one?" with **3 beers** |
| 40 | `prince_guard_drunk` | `rope` on Lady Keli, 3128,3244 |
| 50 | `prince_tied_keli` | `princeskey` on the Prison Door **from the north**, then talk to Prince Ali |
| 100 | `prince_saved` | Hassan → 110 `prince_complete`, +700 coins, free toll gate |

A second varp, `prince_keystatus`, tracks the key: `0` none, `1` forged and waiting
with Leela, `2` claimed. It is `scope=perm` with no `transmit`, so **the client can
never read it.** Section "The key wedge" below is entirely about that.

### Journal parsing

Each entry retains the whole earlier history, so needles are matched newest-first, on
text normalised the way `defs/watchtower/journal.ts` normalises it (colour tags to a
space, pipes and runs of whitespace collapsed, lower-cased):

| Needle | Stage |
|---|---|
| `quest complete!` | 110 |
| `i then used a wig, a skirt and some skin paste` | 100 |
| `i used my rope to tie up lady` | 50 |
| `i also had to prevent the guard from seeing what i was up` | 40 |
| `i need to deal with the` | 30 |
| `for advice` | 20 |
| `i should go and speak to` | 10 |
| `i can start this quest by speaking to` | 0 |

Needles avoid punctuation that sits beside a colour tag: stripping `@dbl@` leaves a
space where it stood, so `Prince Ali@dbl@,` normalises to `prince ali ,`.

The stage-20 entry also renders a checklist of which disguise pieces are held, but it
reads them from `inv_total(inv, ...)` — exactly what the snapshot already knows — so
no flags are parsed. `readProgress()` returns a stage and an empty flag set.

## Item identity

Every lookup goes through the object ID. Five of the objects this quest touches share
a display name with something else:

| ID | Debug name | Renders as |
|---|---|---|
| 2418 | `princeskey` | Bronze key |
| 2419 | `blondwig` | **Wig** |
| 2421 | `plainwig` | **Wig** |
| 2423 | `keyprint` | Key print |
| 2424 | `skinpaste` | Paste |
| 1013 | `pink_skirt` | Pink skirt |
| 1917 | `beer` | **Beer** (also `viking_tankard_full`, 3803) |
| 1933 | `pot_flour` | **Pot of flour** (also `newbie_pot_flour`, 2516) |
| 1511 | `logs` | **Logs** (also `newbielogs`, 2511) |
| 995 | `coins` | **Coins** (also `fake_coins`, 617) |
| 954 | `rope` | Rope |
| 1761 | `softclay` | Soft clay |
| 434 | `clay` | Clay |
| 1765 | `yellowdye` | Yellow dye |
| 1957 | `onion` | Onion |
| 1759 | `ball_of_wool` | Ball of wool |
| 1737 | `wool` | Wool |
| 1735 | `shears` | Shears |
| 1951 | `redberries` | Redberries |
| 592 | `ashes` | Ashes |
| 590 | `tinderbox` | Tinderbox |
| 2349 | `bronze_bar` | Bronze bar |
| 1937 | `jug_water` | Jug of water |
| 1265 | `bronze_pickaxe` | Bronze pickaxe |

## Sourcing

Shops were read from the `.inv` configs and their owners from `param=owned_shop`.

| Need | Source | Approx cost |
|---|---|---|
| Bronze bar, 2× Jug of water | Shantay, 3304,3123 (`shantayshop`) | 8 / 1 each |
| Tinderbox, Shears | Shop keeper, 3209,3247, Lumbridge general | 2 each |
| 2× Onion | pick `onion`, 3188,3267 | — |
| 3× Wool | shear `sheepunsheered`, 3197,3266 | — |
| 3× Ball of wool | Spin at the wheel, stand 3209,3213,1 | — |
| Pink skirt | Thessalia, 3204,3417 (`clotheshop`) | 2 |
| Bronze pickaxe | ground spawn, 2963,3216 | — |
| Clay | mine `clayrock`, 2986,3239 | — |
| Redberries, Pot of flour | Wydin, 3014,3204 (`wydinstore`) | 3 / 10 |
| 3× Beer | Bartender, 3045,3257, one per conversation | 2 each |
| Logs | ground spawn, 3089,3265 | — |
| Ashes | tinderbox on logs, then take the ashes | — |
| Yellow dye | Onion on Aggie, 3086,3259 — 2 onions + 5gp | 5 |
| Wig | Ned, 3100,3258 — "How about some sort of wig?" + 3 balls of wool | — |
| Blond wig | Yellow dye **on** the Wig (`opheldu,plainwig`) | — |
| Paste | Aggie — redberries + pot of flour + water + ashes | — |
| 2× Rope | Ned — "Yes, I would like some rope." | 15 each |
| Soft clay | Jug of water on Clay | — |

Under 200gp against the 2m float, so coin sourcing is a single withdrawal.

Two gates worth stating: Ned only offers "could you make other things from wool?" and
Aggie only offers "Could you think of a way to make skin paste?" while
`princequest >= 20 & < 100`. Neither can be pre-fetched before Osman is spoken to.

### Water

`make_softclay` consumes the clay and the filled container and returns the empty one,
so two filled containers are needed: one for the soft clay and one for the paste.
Buying two `jug_water` from Shantay costs 2gp and rides along with the bronze bar on
a trip the quest already makes; filling empties at a sink would need a detour, since
the nearest `category=watersource` loc is nowhere near Draynor.

### The spinning wheel

The Lumbridge castle wheel at 3209,3212,1 is the one this quest uses.
`sheepshearer.ts` avoids it on the strength of commit `3a8c3a9` (2026-07-16), which
concluded it was "dead server-side" because OPLOC2 at the wheel was silently dropped.
That diagnosis predates the multi-level loc-snapshot settle fix in `e146904`
(2026-07-22) by six days, and a level-1 loc queried in the tick after a staircase
climb reads back empty — blank is not absent.

**Probe result (2026-07-29): the wheel is live.** `tools/princeali-wheel-probe.ts`
walked to 3209,3213,1, sent Spin and got `make menu open — products: [Wool, Flax]`,
then spun a ball of wool. The walk log shows the mechanism the old probe tripped over:
the route climbs the staircase at 3205,3209 into level 1 and needs a settle before the
loc query. So `3a8c3a9`'s note is wrong, and `sheepshearer` is walking 215 tiles to
Falador for no reason — recorded as a follow-up, not changed here.

Its geometry agrees with `forceapproach=south`: north is `castlewall`, east a
`castlearrowslit`, west a `chair`, and `spinningwheel_icon` sits at 3209,3213,1. The
stand tile is therefore 3209,3213,1, reached over the baked staircase edge at
3205,3209. If the live probe fails, the fallback is `sheepshearer`'s Falador
ground-level wheel at 2981,3314 with stand 2982,3315, and the design is otherwise
unchanged.

## Route

`decide()` returns one step and the engine re-derives, so the order of the checks
*is* the route. They are ordered as a tour:

1. **Al-Kharid** — Hassan starts it, Osman briefs, Shantay sells the bar and the water.
2. **Lumbridge** — general store for tinderbox and shears, onions, sheep, spinning wheel.
3. **Varrock** — Thessalia for the pink skirt.
4. **Rimmington / Port Sarim** — pickaxe spawn, clay, Wydin, three beers.
5. **Draynor** — logs to ashes, yellow dye, wig, paste, rope, soft clay.
6. **Lady Keli** — the key print.
7. **Al-Kharid** — Osman forges the key.
8. **Draynor** — one Leela conversation hands the key over *and* promotes to stage 30,
   because `leela_help` runs the handout before the promotion check and the promotion
   check then sees the key it just added.
9. **Jailbreak** — Joe, Keli, the door, the prince.
10. **Al-Kharid** — Hassan pays.

Three Al-Kharid trips is the structural minimum: the briefing, the forge, and the reward.

Anything already in the bank short-circuits its leg. `supplies.ts` batches every
still-needed banked item into a **single** `withdraw` step so a resumed run makes one
bank trip rather than one per item, and withdraw steps omit `bank` so they use the
nearest branch rather than dragging the bot back to Draynor.

## Architecture

`defs/princeali.ts` is deleted. The replacement is a directory, in the shape of
`defs/watchtower/`:

| File | Job |
|---|---|
| `defs/princeali/journal.ts` | `PRINCE_STAGE`, `readPrinceProgress()` |
| `defs/princeali/areas.ts` | `PA_ITEM` ids, tiles, `NpcStop`s, shop anchors |
| `defs/princeali/supplies.ts` | `held`/`banked`/`owned`, the batched withdraw, `source*()` bank-first-then-shop |
| `defs/princeali/disguise.ts` | wool → Ned → wig → dye, logs → ashes, Aggie's paste |
| `defs/princeali/key.ts` | clay → soft clay → Keli's print → Osman's forge → Leela's handout |
| `defs/princeali/jailbreak.ts` | Joe's three beers, rope on Keli, unlock, rescue |
| `defs/princeali/index.ts` | `decide()` switch on stage, `QuestModule` |
| `exec/wool.ts` | shared shear-and-spin, parameterised by pen and wheel |

The module is `ownsInventory: true` with a `readProgress` and no `gather` map — it owns
every loadout decision, as Watch Tower and Shilo do. `record.items` in `data/quests.ts`
stays as an all-`acquirable` list so the eligibility dashboard still describes the
quest, and never blocks it.

`exec/wool.ts` is a behaviour-preserving extraction from `sheepshearer.ts`:
`sheepshearer` keeps its own pen and wheel constants and calls the shared helper, so a
live-verified quest changes shape without changing behaviour.

No `sustain` block and no `food`. The quest has no combat: the jail guards only
retaliate through `lady_keli`'s post-tie dialogue, which this module never opens.

## The key wedge

`osman_items` forges the key only while `prince_keystatus == 0`. Afterwards Leela is
the only source, and the varp is unreadable. So a bot that crashes between the forge
and the handout re-derives "no key, no print" — indistinguishable from the start of the
chain — makes a second print, brings it to Osman, and is refused. It then holds a print
and a bar that nothing will ever consume. That is the worst available outcome: a bot
that looks busy forever.

The fix is one self-correcting step. Talk to Osman, then **read whether the print is
still held.** If it is, the key was already forged, so walk to Leela and collect it.
That is observable client-side, needs no counter and no varp, and terminates on every
path. The rare crash path wastes one clay and one bronze bar, about 70gp.

Leela's re-issue check reads `inv_total(bank, princeskey)` as well as the pack, so a
banked key blocks its own replacement. `supplies.ts` withdraws a banked key before any
step asks her for another — the same rule as Watch Tower's crystals.

## The Keli-respawn wedge

`opnpcu,lady_keli` runs `npc_del`, and `lady_keli` has `respawnrate=100`. Her spawn is
3128,3244, five tiles from the cell door, and `oplocu,alidoor` refuses while any
`lady_keli` is within ten tiles. A hundred ticks is fifty seconds at 2x, so tie → walk
→ unlock → rescue has to run as one step rather than four re-derivations.

Stage 50 is therefore re-entrant: it looks for her first and re-ties her with the spare
rope if she came back, which is why the quest carries two ropes.

## The cell door

The baked `Prison Door` edge at 3123,3243 in `nav/data/doors.json` is **left alone.**
This is the Gu'Tanoth north-west gate case, not the Draynor Manor one-way case: the
door refuses only until stage 50, after which it behaves as an ordinary door, and the
cell behind it is a dead end, so the edge creates no false connectivity for anything
else. Excluding it would break walking *out*, which needs a curated edge to replace.

The module never names a tile inside the cell. It stands at 3123,3244, uses the key,
and `open_and_close_metal_gate2(loc_1541, false, false)` teleports it onto 3123,3243,
one tile from Prince Ali at 3123,3242. Walking out afterwards uses `oploc1`, which is
free from the south side, over the baked edge.

`alidoor` renders as `Prison Door`, and so do two unrelated Ardougne locs (79 and 80),
so the loc query is radius-limited rather than name-only.

## Testing

`tools/princeali-solo-test.ts`, modelled on `tools/watchtower-solo-test.ts`:

- `--stage` and `--keystatus` set `princequest` and `prince_keystatus`, then relog —
  the quest-tab colour is pushed by `if_setcolour` and only re-derived by the login
  script's `~update_questlist`.
- `--give` seeds items through `cheatQuiet`, after the relog so nothing is lost.
- A one-shot deposit bot seeds **2m coins into the bank and nothing else.** Per the
  issue, every other item is sourced from the world; seeding a stage test with the
  tools that stage needs is what let every Watch Tower stage-10 test pass while the
  quest could not mine.
- `::speed 300` for 2x ticks.

Order of live work:

1. A bare probe that the Lumbridge wheel spins wool. Everything in the wool leg
   depends on it and the repo currently records the opposite.
2. Per-leg tests from a jumped stage: start, the Lumbridge cluster, the west cluster,
   the Draynor crafting cluster, the print, the forge-and-collect (including the
   already-forged branch, by jumping `prince_keystatus` to 1), stage 30 → 40 → 50 → 100,
   and the reward.
3. One uncheated 0 → 110 run with 2m bank coins and nothing else.

`decide()` is a pure function of the snapshot, so `test/quests/defs/princeali.test.ts`
is rewritten as a table test over every stage branch, both wedge paths, and the
ID-versus-name cases (a `plainwig` in the pack must not satisfy the blond-wig check).

## Live result

Uncheated 0 → 110, bank seeded with 2m coins and nothing else, `::speed 300`:

| | |
|---|---|
| Wall clock | **15 min 37 s** |
| Result | `status=complete princequest=110 qp=3` |
| Parks / blocks / no-progress | 0 |
| Al-Kharid trips | 3 (the structural minimum) |
| Clay mined | 1 — the forge's recovery path never fired |
| Pickaxe grabs | 1 |
| Bank trips | 2 (one scan, one withdrawal) — the purse floor held |

The route ran in the designed order first time: bank, purse, Hassan, Osman, Shantay
(bar + 2 water), Lumbridge (tinderbox + shears), onions, shear, spin at Lumbridge,
Thessalia, pickaxe, clay, Wydin, Bartender, logs, ashes, dye, Ned's wig, dye the wig,
Aggie's paste, Ned's rope, soft clay, Lady Keli, Osman's forge, Joe, the break-in,
Hassan. One Leela conversation handed the key over *and* promoted to stage 30, so no
separate handover step was ever needed.

Also verified on their own: stage 100 → 110; the already-forged wedge
(`--keystatus 1`, Osman refuses the print) → 110; Keli-respawn recovery at stage 50 → 110.

The one blemish in that run was a single `journal stage unavailable` wait after Joe's
beers — `Quests.journal` cannot open behind a lingering chat box. Fixed by closing any
main modal first and retrying three times a tick apart, and re-verified on the stage-30
leg where it occurred.

## Out of scope

- No change to `nav/data/doors.json`, `transports.json` or `specialCrossings.ts`. The
  Al-Kharid toll gate already has a `Coins`/10 crossing with the right dialogue.
- No change to `sheepshearer`'s behaviour, only to where its shear-and-spin code lives.
- `data/quests.ts` gets an accurate `record.items` list; no new requirement kinds.
