# AutoFighter — anchor-based guard killer that farms and solves clues

2026-07-20. Approved in-session (brainstorm with user).

## Purpose

A standalone TaskBot that camps a chosen guard spot, kills the chosen target,
loots ONLY gem-drop-table items and clue scrolls, invokes the shared SolveClue
task the moment a clue enters the pack, banks the loot when the clue finishes,
and returns to killing. The clue farmer, distilled: RockCrab's solve-in-grind
shape without RockCrab's crab mechanics or ArdyFighter's cake-stall coupling.

## Facts the design leans on (engine-verified)

- Guards (ids 9/10 generic, 32 ardougne_guard) share one drop handler
  (`ai_queue3,_guard`): bones + a 128-slot main table (daggers, talismans,
  arrows, runes, coins <= 30) + `~trail_mediumcluedrop(128)` — the 1/128
  medium clue tertiary. **Guards never roll the gem table** — the gem loot
  list costs nothing for guards and is already correct for future targets
  that do roll `randomjewel`.
- `randomjewel` (the gem table) in this engine: uncut sapphire 32/128,
  uncut emerald 16/128, uncut ruby 8/128, uncut diamond 2/128, rune javelin
  x5, loop/tooth key halves, chaos/nature talisman, mega-rare table.
- Guard spawn clusters (from maps/*.jm2, npc ids {9,10,32}, level 0) — the
  anchor dropdown, all data-verified:

  | Spot | ~Centroid | Guards |
  |---|---|---|
  | Varrock East gate | 3273,3427 | 4 |
  | Varrock West gate | 3174,3426 | 3 |
  | Varrock Palace | 3212,3462 | 6 |
  | Varrock south entrance | 3209,3379 | 3 |
  | Ardougne market | 2660,3307 | 7 |
  | Ardougne north gate | 2636,3339 | 3 |
  | Falador east gate | 2951,3380 | 8-cluster west lobe |
  | Falador park | 2965,3390 | 8-cluster east lobe |
  | Port Sarim jail | 3006,3322 | 3 |
  | Edgeville south road | 3104,3515 | 6 (wide spread) |

  Exact anchor tiles are picked at implementation: pack-walkable within ~4
  tiles of the centroid (offline probe), leash sized to the cluster spread
  (gates ~8, park/Edgeville ~12).

## Settings

- `target`: string dropdown, options `['Guard']` (extensible — matching is by
  NPC display name, so new targets are dropdown entries + maybe new spots).
- `spot`: string dropdown of the 10 anchors above (default Varrock East gate).
- `combatStyle`: attack/strength/defence (com_mode parity with ArdyFighter).
- `food` (name, default 'Trout'), `foodWithdraw` (count, default 10),
  `eatAtHp`/`eatToHp`, `panicHp`.
- `loot`: string[] defaulting to EXACTLY gems + clues: `clue scroll, uncut
  sapphire, uncut emerald, uncut ruby, uncut diamond, loop half of a key,
  tooth half of a key, chaos talisman, nature talisman` (display names
  verified against the engine at implementation). "Nothing else" is the
  default; changes need no code.
- `solveClues`: boolean, default true.
- `bankAtLootSlots`: safety threshold (default ~12).

## Task loop (TaskBot, first-valid-wins)

1. `ContinueDialog`
2. `DeathRecovery` — anchor = selected spot, `onDeath` counts + forwards
   `solveClue.noteDeath()`.
3. `LootDrops` — ground item matching the loot list within leash+4, out of
   combat, Take. (ArdyFighter's shape.)
4. `EatFood` — below eatAt up to eatTo from carried food.
5. `PanicRetreat` — foodless below panicHp: retreat toward the bank, regen.
6. `SolveClue` (shared task) — validates on any held clue/casket; its
   bank-first already deposits loot and withdraws the full trail kit
   (spade + trio + per-clue items + 1000 coins). Host: loot-aware isFood,
   bank food name/withdraw, spade 'Spade', enabled = solveClues toggle.
7. `BankRun` — validates on `justSolved` flag (set by the SolveClue host's
   setStatus intercept when it reports 'clue solved') OR loot slots >=
   bankAtLootSlots OR carried food exhausted (disarmed once the bank proves foodless,
   re-armed when food is seen again). Nearest known bank
   (api/BankLocations), deposit everything EXCEPT food + kit
   (spade/sextant/watch/chart) + coins, top food up, walk back to the spot.
8. `Fight` — nearest NPC named `target` within leash of the anchor,
   explicit Attack, track the kill (ArdyFighter's Fight shape: re-find by
   index, eat-gate mid-fight, markCombatEnd not needed — no stall lockout).
9. `ReturnToAnchor` — start-anywhere + drift recovery via walkResilient.

Sustain armed in onStart (eat mid-walk on trails). `grindTargets()` returns
the selected target so the random-event guard never flags it hostile.
Paint: runtime, kills, clues solved + clue status, loot count, HP bar,
pause/stop buttons (fleet standard).

## Explicitly out of scope

- Multi-target simultaneous matching, safespotting, ranged/mage styles.
- Per-spot food sources (no stall coupling — bank food only).
- World-hopping / spot rotation.

## Verification

- Unit (pure): spot table shape; loot default list matches the spec set.
- Offline probe: every anchor tile pack-walkable + pathable from its
  nearest bank.
- Live smoke `tools/autofighter-test.ts`: boot at Varrock East gate, maxme,
  observe >= 1 guard kill; `::give` an easy clue -> assert SolveClue
  preempts (bank-first + trail start), then post-solve BankRun fires and
  the bot returns to the anchor and kills again. PASS = kill seen, solve
  preemption seen, post-clue bank + return seen.
