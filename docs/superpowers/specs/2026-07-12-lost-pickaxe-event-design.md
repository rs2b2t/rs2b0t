# Lost-pickaxe random event — worn-aware recovery, design

2026-07-12. Stops rune pickaxes vanishing to the "pickaxe head flies off"
random. Scope: the lost-tool event only (mining + the identical woodcutting
axe variant). The smoking-rock "Broken pickaxe" outcome is out of scope (the
hazard avoidance already exists; repair is a travel behaviour for another
day).

## The event (from `macro_event_lost_pickaxe.rs2`, engine srcDir content)

- Fires mid-mining. If the pickaxe is WIELDED it is deleted from the worn
  rhand slot and **`macro_pickaxehandle` ("Pickaxe handle") is equipped in
  its place**; an inventory pickaxe becomes a handle in the pack instead.
- The head (`macro_<tier>_pickaxehead`, display name **"Pickaxe head"** for
  every tier) is launched ≤7 tiles (line-of-walk) and dropped with
  `^lootdrop_duration = 200` ticks — a **2-minute despawn window**.
- Use head on handle (either direction) → the full pickaxe returns to the
  INVENTORY (even if it was worn). Axe variant: "Axe head"/axe handle, same
  script shape.

## Why picks are lost today (`RandomEvents.ts` gaps)

1. Detection scans `Inventory.items()` only — a wielded pick leaves the
   handle in the WORN slot, so the event is never detected (miners wield;
   this is the main loss).
2. `handleLostTool` can't fix a worn handle: `useOn` needs both pieces in
   the pack; the handle must be unequipped first.
3. Full pack (routine while mining): Take silently fails with no free slot;
   the head despawns.

## Fix (in place, worn-aware)

Detection: lost-tool fires when a handle name (`/(axe|pickaxe) handle/i`)
appears in inventory OR `Equipment.items()` (worn checked first).

`handleLostTool` order:
1. Free a slot when `Inventory.free() === 0` — drop one sacrificial item via
   pure `pickSacrificial(names)`: the most-duplicated name NOT matching the
   protected regex `/(handle|head$|axe|pick|hammer|chisel|knife|tinderbox|rod|net|harpoon)/i`
   (tools + the event pieces; ores/logs/fish/gems all qualify as droppable).
   None sacrificial → log loudly, attempt anyway (no worse than today).
2. Worn handle → `Equipment.unequip`, remember `wasWorn` (slot must be freed
   BEFORE unequip — the handle lands in the pack).
3. Take the head (existing query; names verified; ≤7-tile landing well
   inside `within(12)`).
4. Reattach via `useOn` (existing), success = pack count shrinks.
5. `wasWorn` → re-wield the restored tool: find the newly-restored
   pickaxe/axe `InvItem` and interact its own wield-style op (read from the
   item's `ops` — `/wield|wear/i`), restoring pre-event state and the slot.

Urgency: despawn is 2 min; the supervisor polls between 600 ms script loops
— correctness, not speed, is the fix.

## Pure helpers + tests (colocated bun:test)

- `pickSacrificial(names: (string | null)[]): string | null` — decision
  table incl. skipping handles/heads/tools/food, most-duplicated-wins,
  null on none.
- `handleLocation(invNames, wornNames): 'worn' | 'inventory' | null` —
  drives detection + the unequip branch.

## Live smoke `tools/lost-pickaxe-test.ts`

No random roll needed — fabricate the post-event state with existing
cheats: `::~item macro_pickaxehandle` + wield, `::~item
macro_rune_pickaxehead` + drop on the ground, step away, fill the pack with
junk (worst case), idle-script trick so the supervisor runs. Assert, in
order: handle unequipped → slot freed (one junk dropped) → head taken →
"Rune pickaxe" in pack → re-wielded. One run covers every new branch.

## Files

`src/bot/api/RandomEvents.ts` (+ helpers), colocated test file,
`tools/lost-pickaxe-test.ts`. Nothing else.
