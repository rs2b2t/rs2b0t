# Prince Ali Rescue — content facts (2004scape sources)

Research agent output, 2026-07-16. Sources: `~/code/content/scripts/quests/quest_prince/`
(+ area scripts in area_alkharid/area_draynor), maps `m*.jm2`, `pack/npc.pack`.
Coordinate derivation: abs x = mx*64+lx, z = mz*64+lz. All spawns level 0.
Guides are advisory only; every fact below is source-cited.

## 1. Quest flow — varp `princequest` (quest_prince.varp:1, perm)

| Value | Constant | Advanced by |
|---|---|---|
| 0 | ^prince_not_started | — |
| 10 | ^prince_started | Hassan opt 1 (hassan.rs2:9) |
| 20 | ^prince_spoken_osman | Osman "better go" after both tasks (osman.rs2:74) |
| 30 | ^prince_prep_finished | Talk Leela holding ALL 4: princeskey+blondwig+pink_skirt+skinpaste (leela.rs2:35-37) |
| 40 | ^prince_guard_drunk | 3rd beer to Joe (joe_guard.rs2:43) |
| 50 | ^prince_tied_keli | Use rope on Keli (quest_prince.rs2:31) |
| 100 | ^prince_saved | Give prince the disguise+key (prince_ali.rs2:18) |
| 110 | ^prince_complete | Hassan reward → queue(prince_complete) (hassan.rs2:26 → quest_prince.rs2:54-55) |

Second varp `prince_keystatus` (perm): 0 → ^prince_keymade=1 (Osman took imprint+bar,
osman.rs2:92) → ^prince_keyclaimed=2 (Leela handed key, leela.rs2:15).

## 2. NPCs (map-derived spawns; op1 = Talk-to everywhere)

- **Hassan** id 923 — (3302,3163) Al Kharid palace S room (m51_49.jm2:9001).
  Start: option "Can I help you? You must need some help here in the desert." (hassan.rs2:5-6).
  At prince_saved pays out (hassan.rs2:24-26). Option 2 gives a FREE Jug of water (hassan.rs2:14-17).
- **Osman** id 924 — (3286,3180) palace NW (m51_49.jm2:8992).
  At started: "The chancellor trusts me. I have come for instructions." →
  "What is the first thing I must do?" → "What is the second thing you need?" →
  "Okay, I better go find some things." → stage 20 (osman.rs2:26-74).
  Accepts imprint+bronze bar via use-on or talk (osman.rs2:88-94,138-140).
- **Leela** id 915 — (3113,3263) Draynor NW of jail (m48_50.jm2:6689).
  Hands the copied key (leela.rs2:11-15). Sets stage 30 when all 4 held (leela.rs2:35-37).
  Stage-30 hint path: "I hoped to get him drunk." → "at least 3 beers... all at the same time" (leela.rs2:47-49).
- **Ned** id 918 — (3100,3258) Draynor (m48_50.jm2:6686).
  Wig: "Ned, could you make other things from wool?" → "How about some sort of wig?" →
  "I have that now. Please, make me a wig." (ned.rs2:48-51,104-122; consumes 3 ball_of_wool).
  Rope: "Yes, I would like some rope." → "Okay, please sell me some rope." (15 coins, ned.rs2:70-71)
  or "I have some balls of wool. Could you make me some rope?" (4 wool, ned.rs2:89-90).
- **Aggie** id 922 — (3086,3259) Draynor witch (m48_50.jm2:6681).
  Paste (quest-gated option): "Could you think of a way to make skin paste?" →
  "Yes please. Mix me some skin paste." (aggie.rs2:5,24-28,140; consumes redberries 1 +
  pot_flour 1 + ashes 1 + ONE water (bucket_water OR jug_water) — aggie.rs2:143-153. No coins.)
  Yellow dye: "Can you make dyes for me please?" → "What do you need to make yellow dye?" →
  "Okay, make me some yellow dye please." (aggie.rs2:20-22,77-90; consumes onion 2 + coins 5,
  aggie.rs2:99-101).
- **Lady Keli** id 919 — (3128,3244) jail (m48_50.jm2:6695).
  To the imprint: "Are you the famous Lady Keli?..." (any of 4 openers works) →
  "What is your latest plan then?" → "Can you be sure they will not try to get him out?" →
  "Could I see the key please?..." → (holding soft clay) "Could I touch the key for a moment?"
  → imprint taken (lady_keli.rs2:56-103: inv_del softclay 1, inv_add keyprint 1).
- **Joe the guard** id 916 — (3123,3245) jail door (m48_50.jm2:6693).
  Beers via USE beer ON Joe at stage 30: takes 1, then 2 more (needs 3 total held);
  3rd → stage 40 drunk, permanent (joe_guard.rs2:10-43,89-93).
- **Prince Ali** id 920 — (3123,3242) cell (m48_50.jm2:6692). At stage 50 talk/use item →
  handover consumes princeskey+blondwig+pink_skirt+skinpaste → stage 100 (prince_ali.rs2:11-24).
  FAILS SILENTLY (intro dialogue only) if any of the 4 is missing.
- **jailguards** id 917 "Guard" ×4: (3109,3237),(3120,3238),(3121,3249),(3127,3248).

## 3. Recipe summary (this server — differs from classic!)

- **Wig must be dyed YELLOW**: Ned (3 wool) → `plainwig` "Wig"; use `yellowdye` on it →
  `blondwig` "Wig" (quest_prince.rs2:1-12). Yellow dye: Aggie, 2 onions + 5 coins.
  BOTH wigs display as "Wig" — distinguish by obj id live, or by pipeline order.
- **Paste**: redberries + pot_flour + ashes + (bucket_water|jug_water) at Aggie. Free.
- **Key**: soft clay → Keli imprint → give keyprint+bronze_bar to Osman (both consumed) →
  collect `princeskey` "Bronze key" FROM LEELA (multi-trip; osman.rs2:94, leela.rs2:11-15).
  Lost key later: Osman OR Leela remake for 15gp (osman.rs2:77-87, leela.rs2:17-28).
- **Skirt**: pink_skirt bought (Thessalia, Varrock).
- **Beers ×3** carried at once.
- **Rope**: Ned — 15 coins or 4 wool.

## 4. Display names (.obj verbatim)

Key print / Wig (both plain+blond!) / Paste / Bronze key (quest_prince.obj);
Rope, Ball of wool, Soft clay, Yellow dye, Pink skirt (cost=2), Beer, Bronze bar,
Redberries, Pot of flour, Ashes, Onion, Jug of water, Bucket of water.

## 5. Jailbreak (exact order; geometry: Joe z3245 > Keli z3244 > Prison Door z3243 > Prince z3242)

Cell door: loc `alidoor` id 2881 "Prison Door" op1=Open, shape 0 (NOT diagonal/sealed),
at (3123,3243) (m48_50.jm2:5871).

1. Stage 30 with all 4 items (Leela gate).
2. Use 3 beers on Joe → stage 40. Only works at stage 30.
3. Use rope on Keli → rope consumed, npc_del, stage 50 (quest_prince.rs2:23-32).
   Earlier: "You cannot tie Keli up until you have all equipment and disabled the guard!".
4. Use Bronze key on Prison Door STANDING NORTH (z≥3244; quest_prince.rs2:34-44).
   Blocked if Keli respawned within 10 tiles ("You'd better get rid of Lady Keli...").
5. Talk/use item on Prince with all 4 held → handover, stage 100. Prince walks off.
6. Return to Hassan (3302,3163) → stage 110, 3 QP + 700 coins + free Al Kharid gate.

## 6. Buy list

| Item | Shop | NPC + coords | Price |
|---|---|---|---|
| Pink skirt ×1 | Varrock clothes | Thessalia (3204,3417) | ~2gp |
| Beer ×3 | Varrock Blue Moon bartender ~(3225,3399) — DIALOGUE buy: "I'll have a beer please." | 2gp each |
| Bronze bar ×1 | Shantay Pass Shop | Shantay (3304,3123) | stock 10 |
| Redberries ×1 | Port Sarim general | — | 1gp |
| Pot of flour ×1 | Port Sarim general | — | 3gp |
| Onion ×2 | NOT SOLD — Fred's onion patch loc 3366 'Onion' op2=Pick at (3188,3266-3268) | free |
| Soft clay | mine clay + use water on it | — | free |
| Ashes | burn logs: tinderbox (Lumbridge general, stock5) + logs; fire burns 100-200 ticks then
  obj_addall ashes (firemaking.rs2:125-132). Only ONE world ashes spawn (2596,3400) — off-route. | free |
| Jug of water | FREE from Hassan option 2 | free |

Coins if buying the buyables: ~30-35gp minimum (dye 5 + rope 15 + beers 6 + skirt 2 + bar + slack).

## 7. Gotchas

- Keli RESPAWNS; door unlock re-blocked if she's within 10 tiles; re-tie consumes another
  rope — carry a spare rope or unlock fast (Leela: "she won't stay tied up long").
- Guard-drunk is a permanent varp; never repeats.
- NOTHING is worn by the player; all disguise items are handed over.
- All 4 disguise items must be in inv simultaneously at Leela, and at the prince.
- Unlock the door BEFORE handing over (handover deletes the key).
- Door side: stand north (z≥3244) to unlock.
- Guide's "close the door to trap guards" step DOES NOT EXIST on this server.
