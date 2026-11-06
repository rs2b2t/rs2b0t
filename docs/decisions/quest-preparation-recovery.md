# Quest preparation and recovery

AIOQuester owns the quest objective. AccountLeveler's training and supply methods
satisfy missing requirements, then control returns to the quest engine.

The engine checks required skills, survival supplies and missing start items before
running a quest. Preparation checks the bank before gathering, expands production
dependencies, and rechecks actual levels and stock after each activity. A requested
food remains the requested food: a Shark requirement includes Fishing and Cooking
training when necessary. Unsupported production and partner requirements remain
actionable blockers. Preparation never recursively starts AIOQuester.

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
