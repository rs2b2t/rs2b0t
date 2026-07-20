# Priest in Peril — AIO quest module design

Date: 2026-07-20
Status: approved (design review with user; live end-to-end PASS is the done bar)

## Goal

Add Priest in Peril as the 13th implemented quest in the AIO questbot
(`src/bot/quests/`): 1 QP, 1406 Prayer XP, Wolfbane dagger, and post-quest
holy-barrier access to Morytania. Novice combat quest: two level-30 kills, a
key puzzle, an id-collided water chain, and a 50-essence delivery.

Done bar (user decision): implement + unit tests + static audit, then a live
AIO smoke running `quests=['priestperil']` on the user's account from
not-started to journal-complete with Wolfbane banked. Essence sourcing (user
decision): if the bank lacks 50 Rune essence, mine the shortfall in-quest via
Aubury's teleport (fresh-account self-sufficiency).

## Server ground truth (traced 2026-07-20, rs2b2t-content)

Stage varp `priestperil` (invisible to the client): 0 start → 1 talked Roald →
2 agreed to kill dog (knock dialogue) → 3 dog dead (kill hook) → 4 Roald
furious (his stage-3 dialogue sets it) → 5 Drezel story done (cell-door
Talk-through) → 6 cell unlocked (Iron key used on door, key consumed) → 7
blessed water poured on coffin → 8 told Drezel (he heads downstairs) → 10
mausoleum dialogue done → +1 per essence handed → 60 complete (completion
queue: Wolfbane + 14060/10 Prayer XP) → 61 post-quest barrier access.

Key server facts that shape the design:

- `quests/quest_priestperil/scripts/*.rs2` + `areas/area_mausoleum/scripts/*`
  + `areas/area_varrock/scripts/king_roald.rs2` hold all logic; every def
  constant must cite these `file:line`.
- Name collisions: `bucket_murkywater` (2953) and `bucket_blessedwater`
  (2954) BOTH display "Bucket of water" → water chain must read obj ids.
  Three "Monk of Zamorak" variants; only npc id 1046 (level 30) drops the
  Golden key (2944), and only while stage < 6.
- Monument puzzle: layout randomizes ONLY on first Study (op1). Never Study →
  deterministic layout, Iron key (2945) at grave_base3 (3428,9890). Using the
  Golden key on every monument in turn is seed-proof (exactly one grave swaps
  for any seed); wrong graves no-op.
- Temple guardian (dog, lvl 30, 45 HP, id 1047) is attackable ONLY at stage 2.
- Dungeon gating: temple Large door opens at stage ≥ 4, Gate 1 (3405,9895) at
  ≥ 5, Gate 2 (3431,9897) at ≥ 8, cell door (3415,3489,2) openable at ≥ 6 —
  these four openability probes are the client's stage oracles.
- Essence: Drezel takes ALL held unnoted essence in one server pass; noted is
  rejected; unstackable → 50 never fits the 28-slot pack → in-quest delivery
  trips, NOT provisioning.
- Server runs members=true (engine default); F2P may start the quest.

Coordinates (map-derived from maps/*.jm2): Roald (3222,3476,0); temple doors
(3408,3488)+(3408,3489); north trapdoor (3405,3507) ↔ crypt ladder
(3405,9907); dog (3405,9902); monuments (3416-3428, 9884-9895); mausoleum
Drezel (3440,9895); temple spiral stairs (3417,3484)/(3417,3492) → L1 ladder
(3410,3485) → L2; coffin (3413,3486,2); cell Drezel (3417,3489,2); Aubury
(3253,3402,0); Well (3423,9890) — monument-room centre, no ops (use-item
only).

Nav (verified offline via tools/nav/pip-probe.ts against the baked pack): all
legs pathable — Varrock→temple, temple L0→L2, crypt→monuments→Drezel,
bank→temple. The east-side trapdoor (3422,3485) is UNREACHABLE in the pack —
essence runs route through the crypt. Quest-gated doors/gates are
baked-walkable but live-locked → legs open leaves explicitly. The north
trapdoor re-closes 5 min after opening.

## Architecture (approach A — phase customs with world-signal probing)

Files:

- `src/bot/quests/defs/priestperil.ts` — the module (new).
- `src/bot/quests/defs/priestperil.test.ts` — pure decide() tests (new).
- `src/bot/quests/defs/index.ts` — register LAST in QUEST_DEFS.
- `src/bot/quests/data/quests.ts` — record edit: drop `Rune essence ×50
  mustHave` (impossible to provision), add `Bucket ×1 acquirable`.
- `src/bot/quests/exec/primitives.ts` + test — LadderHop gains optional
  `open?: string`: when the primary op is absent (closed trapdoor), fire the
  open op on the same loc first, then retry the primary. Generic.
- `tools/nav/pip-probe.ts` — offline route-coverage probe (already written).

decide() (pure router; stage detail lives in the legs):

    complete   → done
    unknown    → wait
    notStarted → talk ROALD (prefer ['Sure.'])
    inProgress:
      'golden key' held    → monumentLeg
      'iron key' held      → unlockLeg
      'bucket of water'    → waterLeg   (murky vs blessed by obj id inside)
      else                 → spineLeg   (stage-oracle probe ladder)

Legs (all re-entrant customs; false = re-enter; all live reads inside):

- spineLeg: position-aware probe order (underground → Gate 2 first; surface →
  temple door first).
  - Door locked (stage ≤ 3): Knock-at + drive prefers ['Roald sent me to
    check on Drezel.', 'Sure.'] (1→2, idempotent at 2/3); hop down, attack
    dog (only stage 2 fights; kill sets 3, tracked by scene-slot despawn);
    dog refuses/absent → talk Roald (3→4, harmless at 2) → re-probe.
  - Door opens, cell locked (4-5): Talk-through cell door, prefers ['Tell me
    anyway.', 'Yes.'] (4→5 story, idempotent hint at 5); then monk hunt:
    kill npc id 1046 ONLY (L0 spawns (3411,3489)/(3415,3485)), loot the
    Golden key ground drop.
  - Cell openable (≥ 6): defer to waterLeg logic / Gate-2 probe → essence.
- monumentLeg: use Golden key on each of the 7 monuments starting at
  grave_base3; success = Iron key held. NEVER issue Study.
- unlockLeg: use Iron key on cell door (→ stage 6, key consumed).
- waterLeg: blessed(2954) → use on Coffin (→7) then talk cell Drezel (→8);
  murky(2953) → use on cell Drezel (bless); plain Bucket → use on Well;
  nothing → talk cell Drezel (6: hint / 7: →8 / ≥8: harmless) then Gate-2
  probe. Lost bucket self-heals (withdraw or general-store buyOrWait).
- essenceLeg: talk mausoleum Drezel (8→10; 10+: prompts); pack essence → talk
  to hand ALL; pack empty → Varrock East withdraw min(free slots, remaining)
  (~2 trips); bank dry → mine via Aubury Teleport (Rune Mysteries-gated;
  guaranteed by run order), portal back, repeat; journal complete → one extra
  talk with Wolfbane held (→ 61, barrier access) → done. Remaining count is
  server-side only; the loop just repeats until the journal flips.

Module config: `food: 12`; `grind: ['temple guardian', 'monk of zamorak']`;
`tools: ['golden key', 'iron key', 'bucket', 'wolfbane', 'rune essence',
'coins']`; `gather: { bucket: buyOrWait(Varrock general store ~15gp) }`;
`hops`: trapdoor down (stand (3405,3506), 'Trapdoor', 'Climb-down', open
'Open', arrive (3405,9907)) + ladder up (stand (3405,9907), 'Ladder',
'Climb-up', arrive (3405,3507)).

## Failure handling

- Stage oracles make any restart/death self-locating; legs are idempotent.
- Locked-leaf walking: legs explicitly Open the temple door / Gates when
  stage-unlocked, never trusting the optimistic pack.
- Golden key despawn (~3 min floor life): loot before re-engaging; a lost key
  re-drops from monk 1046 while stage < 6.
- Lost IRON key after swap is the one non-self-healing server edge (the
  monument blocks a re-swap while `obj_gettotal(pipkey_iron) > 0` is false
  only pre-swap): mitigated by unlocking promptly after the swap, keeping
  keys in `tools`, and logging + wait-parking if the swap reports done with
  no key held (never silent-looping).
- Trapdoor re-close handled structurally by the hop `open` extension.
- Wrong-monk aggression: fought off normally; grind list keeps the
  random-event guard quiet.

## Testing & verification

1. Unit: decide() routing table (journal × inventory → step kind); hop-open
   extension test in primitives.test.ts. Existing suite stays green.
2. Static audit: every constant cited file:line against rs2b2t-content;
   pip-probe re-run for nav coverage.
3. Live (done bar): AIO smoke with quests=['priestperil'] on the user's
   account, uncheated start→finish until journal complete + Wolfbane banked.
   `::setvar priestperil N` (dev cheat) may fast-forward stages while
   debugging individual legs, but acceptance is the uncheated full run.

## Out of scope

- Morytania content beyond the stage-61 barrier talk.
- Level-aware A* heuristic / east-trapdoor reachability (nav follow-ups).
- Fresh-account combat-stat sizing (Witch's House shares this caveat; the
  live pass runs on the user's established account).
