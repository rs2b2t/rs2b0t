[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: The Dig Site

Nineteen, and the first is the one that cost a live run.

- **A needle without a word boundary matched a different student.** The purple student
  answers with "She gave me an answer to one of the questions on the first exam"; the green
  and orange students answer with "He gave me an answer…", which is a substring of hers.
  Counting the shorter phrase made one answered errand read as two, and the bot walked past
  the panning leg into an exam it could only fail — twice, because the same read then said
  the exam was worth retaking. The leading space in front of the needle is load-bearing.
- **Display names collide four ways in one quest.** All three students render as `Student`,
  both workmen as `Digsite workman`, the empty and full panning trays as `Panning tray`,
  and the two half-made explosives as `Mixed chemicals`. Nothing in this module is matched
  by name: every npc, loc and obj is an id.
- **The letter hand-in runs the first exam inside the same conversation.**
  `itexam_examiner_deliver_stamped_letter` sets the stage and falls straight through to
  `itexam_examiner_first_exam`, so the exam is sat before a single errand has been run. A
  strict dialogue driver abandons in the middle of it and leaves the conversation open; the
  Examiner needs the guessing driver, and a failed exam costs nothing but the walk.
- **The exam only offers the right answer for the questions you revised.** Each question
  has an answered variant and an unanswered variant with a different option set, so a
  preference list holding all nine correct answers is safe: whichever is on screen is the
  one that scores.
- **`forceapproach` rotates, and the chest's rotation makes north into west.** The digsite
  chest is `forceapproach=north` at angle 3, and `rotateFlags` turns that into
  `BLOCK_WEST` cleared — the only legal stand is (3373,3378). Every other side drops the
  op silently.
- **The explosion refuses every tile but one.** `digsite_blockage_run_sequence` opens with
  `if (coord ! 0_52_153_51_34)` and answers "Eep! Eep! Unexpected player coord!", so the
  tinderbox has to be struck from (3379,9826) — `walkResilient(stand, radius 0)`, not
  "somewhere beside the bricks".
- **The two winches cross over underground.** The western winch drops you in the eastern
  shaft and vice versa, and each shaft's rope out surfaces beside the *other* winch. Which
  shaft you are standing in is a component test on the tile, not a guess from which winch
  you clicked.
- **Both shafts are needed, so both want a rope.** The chest key is only in the western
  shaft and the blocked bricks only in the eastern one; one pickpocketing session for two
  ropes beats two sessions for one each.
- **Dropping a volatile chemical hurts.** Every `opheld5` in the chain — the unidentified
  liquid, the nitroglycerin, both mixtures and the finished compound — deletes the item and
  deals up to 65 damage. The dig and panning loops fill a pack fast enough to need a
  spoil-dropper, so that dropper denies by default and keeps an explicit id list.
- **A keep-list is not a pack budget.** Two ropes cost twenty-eight pockets, and those
  pockets also hand over four pairs of gloves, six specimen brushes, two spades and two
  buckets — all of which a plain keep-list keeps. The leg finished with four free slots and
  the chemical chain needs six, so the dropper also caps how many of a kept item are worth
  carrying, and tidies once more on the way out.
- **`opheldu` is declared on one item of the pair and the client cannot tell which.**
  Ammonium nitrate declares the handler and nitroglycerin does not; charcoal declares it
  and the pestle does not. Every mix here tries both directions rather than reading the
  content.
- **A recipe that speaks before it delivers needs its dialogue driven, not waited out.**
  Two of the three mixes are pure `mes` and land in 200ms; the third speaks a player line and only adds
  the compound once that line is clicked through. A plain
  item wait timed out on both directions of a mix that had worked, and reported a failure
  the pack disproved a tick later.
- **The panning permission is a `%itexam_bits` bit, which is never transmitted — and the
  greeting that would give it away is wrapped.** `~chatnpc` splits one sentence across
  several chat components, so "I'm here to teach you how to pan for gold" matches no single
  line and the invited guide read as an uninvited one for as long as the loop ran. The
  attempt is the oracle: pan, and let the guide object if he is going to. The refusal is
  his own `p_choice2`, which takes the tea in the same conversation.
- **The success oracle and the refusal oracle fire together, so order decides.** A
  successful pan fills the tray and *then* raises an objbox; a refused one raises a
  dialogue and no tray. Testing "did something open?" before "is the tray full?" called
  every good pan a refusal — and the objbox left over from the last search made the pan
  after it look refused too. Check the tray first, and clear the box at the top of the
  loop.
- **"You dig through the earth" is the start of a dig, not the end of one.** The find lands
  six ticks later and the player is delayed until it does, so a loop that re-clicks on that
  message has its trowel dropped and then pays a full fifteen-second timeout waiting for a
  message the dropped click never produced. Thirteen digs for one lump of charcoal took six
  minutes; waiting for the "You find…" line instead is the difference between two seconds a
  dig and thirty.
- **The dig zone is checked against the soil's coordinate, not the player's.**
  `[oplocu,_digsite_soil]` runs `inzone(…, loc_coord)`, so a soil loc one tile outside the
  box is a different exam level with a different refusal. The dig loop filters candidate
  soil by the same rectangles `area_digsite.rs2` uses.
- **The panning tray spawn sits on a blocked tile.** (3369,3378) has no exits of its own;
  the Take is clicked from (3370,3378), the same shape as any ground item resting on
  furniture.
- **The specimen brush has no shop and the vial has no local one.** "We have a bit of a
  shortage of those at the moment" is literal — a workman's pocket is the only source of a
  brush. The nearest counter stocking an empty vial or a pestle and mortar is Jatix in
  Taverley, four hundred tiles from the site, which is why the module buys both on one trip.
- **The nearest workman is often behind a fence.** Each dig site is fenced, and the server
  refuses a pocket it cannot path to with a bare "I can't reach that!". Walking at the
  refused workman's own tile lets the baked graph find the gate; walking back to a fixed
  anchor retries the same wall.

## See also

- [Quest pitfalls](quest-pitfalls.md)
- [Observatory Quest](quest-pitfalls-27.md)
- [The Dig Site's harness recipe](../reference/quest-harness-recipes-15.md)
- [Add a quest](../how-to/add-a-quest.md)
