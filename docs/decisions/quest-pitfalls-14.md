[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: Tai Bwo Wannai Trio

Four brothers, one island, no bank, and a 30gp ferry between the two. Everything below
cost either a read of the content scripts or a live run.

- **A quest whose start is across a toll buys its kit first.** `decide()`
  originally answered stage 0 with "talk to Timfraku", and the navigator replied
  `unreachable without 30x Coins`, the bot stood at the Ardougne booth it had walked
  straight past. Provisioning runs before the pre-start branch, not after it, wherever
  the first NPC is behind a fare.
- **Two of this quest's six varps are on the wire.** `tbwt_main` and `tbwt_tiadeche`
  carry `transmit=yes`; `tbwt_tinsay`, `tbwt_tamayu`, `tbwt_lubufu` and `tbwt_flags`
  do not. That is the exception [the varp decision](quest-state-not-varps.md) names, so
  the module reads the first two with `reader.varp` and opens the journal only for the
  rest, and only while `tbwt_main` is in the brothers phase.
- **"Nothing of interest." is three different brothers' opening line.** The journal
  appends each brother's block under its own `Tiadeche:` / `Tinsay:` / `Tamayu:` /
  `Lubufu:` heading, so a marker is only meaningful inside its own slice of the page.
  Matching across the page reads Tinsay's intro as Tamayu's.
- **The order of the brothers is forced, and no guide states it.** Tamayu is the only
  NPC who will skin a monkey and he refuses until his own hunt is over; Tinsay writes
  Tiadeche's crafting manual only once his three deliveries are done; and Tiadeche's
  first catch is the raw Karambwan the poisoned spear is ground from. Lubufu → Tiadeche's
  catch → Tamayu → Tinsay → Tiadeche's manual is the only order that closes.
- **Melee cannot kill the monkey while the quest is live.** `opnpc2,monkey` measures
  `~player_attackrange` and dodges anything at range 1, in silence apart from a chat
  line. The kit is a bow from the start rather than a swap for one kill. Which bow is
  free: `player_ranged_check_ammo` only asks whether the quiver holds the `arrows`
  category, so every arrow fires from every bow, and the module draws the best bow the
  account's Ranged level can wield out of whatever the bank holds.
- **Tamayu's spear test is a category test, and it re-runs on every hand-over.**
  `tbwt_tamayu` clears `received_acceptable_spear`, `received_poisoned_spear` and
  `received_kp_spear` at the top of each `oc_category(last_useitem) = weapon_spear`
  branch and re-sets them from that one spear, so a strong spear followed by a poisoned
  one leaves only the second bit set. One spear has to carry both: any tier from iron up
  with the Karambwan paste on it. Bronze sets no strength bit at any dose of poison, and
  a (p) spear cannot take the paste at all, `make_tbwt_poisoned_weapon` reads a
  `tbwt_weapon_poisoned` param that only the unpoisoned tiers carry.
- **Nothing on Karamja sells a spear, and the Jogres drop one.** Their table is
  `iron_spear` at 4 in 129 (and `bronze_spear` at 30, which is no use), and their patch
  is already on this quest's route for the marinade bones. A bank with no spear in it is
  a hunt of up to forty Jogres, not a park.
- **The agility potion is four doses, not one bottle.** `~set_tbwt_tamayu_agility_count`
  adds `$doses` per hand-over and the hunt needs four, so a (2) and a (2) do what a (4)
  does. Only the fourth writes "I have increased his agility" on the journal page, so a
  part-poured Tamayu is indistinguishable from an untouched one: the pack fills to four
  doses whenever it holds none, and pours one bottle per pass until the line appears.
- **Karamja has two ranges and neither can be used.** The Brimhaven one at (2787,3191)
  is inside the Shrimp and Parrot kitchen, whose door answers "This door seems to be
  locked..." until Heroes' Quest; the one at (2814,3161) sits in a room the baked graph
  has no door into, and every path to it comes back `unreachable`. A live run burned
  four minutes wedged against the first before the second was ruled out on the
  collision pack. The cooking source is the permanent jungle fire at (2789,3048),
  eleven tiles from the village and reachable with no hops at all.
- **The only furnace on Karamja is inside Shilo Village.** Tai Bwo Wannai Trio does not
  require Shilo, so the Jogre bones are burnt with a tinderbox instead:
  `light_jogre_bones_inv` drops them at the player's tile, lights them three ticks
  later, burns for 25-50 ticks, and only then puts burnt bones back on the ground. A
  `walktrigger` clears the timer, so nothing may move until the fire catches.
- **A tile that will not take a fire says so once and then says nothing.** `area_allow_loc_add`
  refuses with a single chat line, and the bones are already on the floor by then, so the step
  reads the refusal, steps aside, and picks them back up, waiting the ninety seconds out
  instead cost a minute and a half of a live run for nothing.
- **Three of this quest's objects share a display name with two others each.**
  "Karambwan vessel" is the empty one and the baited one, "Karamjan rum" is the bottle,
  the banana-stuffed reject and the sliced-banana version, and "Karambwan paste" is the
  raw, cooked and poisonous grind. Every check is by id, and the deposit keep-list is a
  list of ids.
- **A raw Karambwan burns three times in ten, and re-fishing one is a four-minute round
  trip.** The bait comes from the Holy Lake and the only shoal the vessel may be
  lowered into is a hundred and sixty tiles away outside Brimhaven, so the step carries
  four Karambwanji and lands two Karambwan on the one visit. The cook step waits for
  the *input* to disappear rather than for the product to appear, so a burn is noticed
  at once rather than at the end of a thirty-second timeout.
- **Lubufu re-arms his brush-off on every talk inside it.** The first conversation ends
  with a ten-tick `longqueue`, and talking again inside that window replays "I said go
  away!" *and starts the queue over*. The introduction is one step that talks, waits the
  queue out, and talks again.
- **His apprenticeship is counted, and the journal cannot count it.** Stages 25 to 27
  render one identical page: three more questions, any three, and he offers on the
  third. The step asks until the vessel is in the pack rather than until a stage moves.
- **The bait count is not on the page either.** Every stage from 5 to 24 renders "I
  need to give Lubufu 20 Karambwanji", so the module cannot know how many he already
  holds. It fishes a pack-full, hands the lot over, and reads the page again, he
  counts them in himself and keeps only what he still wants, so the leftovers stay in
  the pack and go on to bait the vessel and grind into Tinsay's marinade.
- **Every one of these five NPCs wanders, and the first Talk-to after a long walk
  lands where they were.** Three separate live legs failed on `'X' never opened a
  dialogue` and passed on the retry a step later. One settle and a second attempt
  inside the step costs a tick; a failed step costs the walk again.

## See also

- [Engine behaviour](quest-pitfalls-engine.md)
- [Tooling and verification habits](quest-pitfalls-habits.md)
- [Harness recipes (Tai–Temple)](../reference/quest-harness-recipes-9.md)
