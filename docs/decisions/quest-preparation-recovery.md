# Quest preparation and recovery

AIOQuester owns the quest objective. AccountLeveler's training and supply methods
satisfy missing requirements, then control returns to the quest engine.

The engine checks required skills, survival supplies and missing start items before
running a quest. Preparation checks the bank before gathering, expands production
dependencies, and rechecks actual levels and stock after each activity. A requested
food remains the requested food: a Shark requirement includes Fishing and Cooking
training when necessary. Unsupported production remains an actionable blocker.
Partner quests discover compatible active bots on the same world. Preparation never recursively starts AIOQuester.

Recovery has a finite escalation: close stale interfaces and refresh module state,
then retreat and bank inventory and equipment before rebuilding the pack. A final
failure blocks that quest for the session. Deaths consume a finite retry budget.
Restart and Skip interrupt child activities as well as quest steps.

A bank reset retains an exact-ID snapshot until restoration succeeds. Resumed quest
items cannot be discarded or assumed reacquirable. One-way areas require an explicit
exit, and travel-sensitive items prevent a generic bank reset. If restoration or
escape fails, stop with the reason instead of launching another quest from an unsafe
state. Quest journals and visible inventory remain the source of progress.

Implementation and verification:

- Audit every registered quest's decision, provisioning, recovery and skill gates.
- Add tested preparation planning and runtime around existing AccountLeveler methods.
- Add a tested bank reset with partial-failure restoration and travel guards.
- Integrate preparation, restart, bounded recovery and death handling in the engine.
- Exercise planner, lifecycle, queue and recovery regressions; run typecheck, lint,
  quest and AccountLeveler suites, then build the bot before opening the PR.

The per-quest coverage and remaining manual requirements live in
[the preparation audit](../reference/quest-preparation-audit.md).

## Runtime behavior

AIOQuester expands selected quests with prerequisite quests and enough lower-gate
quests to earn missing quest points. Explicitly skipped quests stay excluded.
Missing skills and ordinary supplies become preparation activities using
AccountLeveler's methods. The Current tab shows the activity and its dependencies.
Food production includes Fishing and Cooking training, with exact Lobster and Shark
policies for Underground Pass and Regicide. Unsupported sources and insufficient
shopping money remain visible blockers.

For AIOQuester, a stalled quest first refreshes its module state and journal. Another
stall banks inventory and equipment, then restores the quest pack by exact item ID.
Five minutes without journal, inventory, equipment or combat progress also triggers
recovery, even if movement keeps repeating. After those two attempts, the engine
retreats and aborts that quest for the session. Three deaths also abort the quest.
Restart quest requests the bank reset directly; Skip cancels preparation and restores
the pack before moving on. An unsafe retreat or incomplete restoration stops the run.
Coins stay banked and are redrawn through the quest's normal coin allowance.


## Partner quests

Blank Arrav and Heroes partner settings enable automatic matching between active
AIOQuester clients sharing the same browser origin. A BroadcastChannel exchanges
character, world, gang, quest stage, key possession and reciprocal claims. Explicit names override
matching. Paused, dead, disconnected and unrelated-quest clients cannot take a new
pair; heartbeats expire after fifteen seconds. This does not discover bots in a
separate browser profile or on another machine.

Quest journal stages take precedence over the configured gang. Partners keep their
pair through a trade. Stage and key announcements prevent obsolete key handoffs.
A Phoenix bot retrieves or replaces its missing key before asking for a shield half. A
cooperative step with a live active counterpart gets ten minutes without either
local quest/inventory progress or a partner stage change before normal recovery.
Heartbeats alone do not renew that timeout.

The preparation suppliers also support whole Cakes from the Ardougne stall,
Seaweed from its coastal spawn, and Bat bones from Giant bats without burial.
Tourist Trap prepares eight rations and does not require, buy, or restock waterskins.
Overfilled food loadouts return safely to the bank and restock eight rations.
Resumed Tourist Trap runs use local supply recovery instead of generic preparation
banking, preserving the mine exit route and Ana rescue checkpoints. Nature Spirit
replaces a lost empty Druid pouch from its grotto spawn after checking the bank.

Tai Bwo Wannai Trio preparation counts all Agility potion doses before brewing.
Missing doses require Herblore 34, Toadflax from Brimhaven tickets (three per herb),
swamp toad legs and water vials. The ticket activity exits the arena before handing
control back; failures retry the arena exit before banking. Banked Toadflax unfinished
potions are identified by ID 3002 and used before new herbs. PotionMaker caps each
batch to the requested output shortfall. Starting empty requires six tickets and
two three-dose bottles. Resumed quests also prepare potions until Tamayu's journal
confirms delivery; the journal does not expose partially delivered doses.

Trio uses a phase-specific inventory plan for tools, food capacity and bank recovery.
Lubufu accepts partial catches before any supply detour. Preparation withdraws only
current-phase tools and reserves space for the next collection or recipe; recovery
banks retired tools and caps duplicate supplies. Food is capped at six occupied
slots across whole and partially eaten portions, with less restored when the next
action needs more room. Withdrawal, combat food checks and eating share the same
fallback foods. Slot-neutral rum preparation and completed handovers precede cleanup.
Replacement Karambwan use banked fish or poison before fishing; fishing requires
level 65 and a free inventory slot, otherwise the quest reports the unmet requirement.

Watch Tower provisions only its current phase and batches banked supplies on the
mainland. Consumed rope and potion ingredients do not trigger a return from sealed
quest areas. Cleanup and bank recovery share the phase loadout, cap whole and
partial food at eight slots, and reserve two slots for quest items. Banked potion
intermediates and berries are reused before collecting replacements.

Crystal recovery supplies the rope, map and light needed for its destination.
Paid gold gates are reopened without another bar; observed gate payment is scoped
to the character. Recovery leaves both cave six and its east-gate enclosure before
banking. Death runes come from Betty without the Magic Guild's level requirement.
The enclave disables auto retaliation, confirms each shaman dissolution from a
fresh server message, finishes its dialogue, and returns after one kill. Shaman,
mining and robe actions retreat when food, health or inventory reserves run low.
