[Manual](../README.md) › [Scripting API](../API.md) › Items

# Inventory, equipment and bank

## Inventory & Equipment

```ts
Inventory.items(): InvItem[]
Inventory.first(name: string): InvItem | null
Inventory.contains(name: string): boolean
Inventory.count(name: string): number   // total qty across stacks/slots
Inventory.countById(id: number): number // exact object ID across stacks/slots
Inventory.used(): number                // occupied slots
Inventory.free(): number                // unoccupied slots (0 if normal pack UI is unavailable)
Inventory.isFull(): boolean

Equipment.items(): InvItem[]
Equipment.contains(name: string): boolean
Equipment.equip(name: string): Promise<boolean>    // Wield/Wear/Equip from pack
Equipment.unequip(name: string): Promise<boolean>  // Remove into pack
```

### InvItem

```ts
class InvItem {
    name; id; slot; count;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;   // held op, e.g. 'Bury', 'Eat'
    useOn(target: InvItem | Loc | Npc): boolean | Promise<boolean>;
}
```

While the bank is open, these queries read the bank's side-backpack component.
Once populated, its counts and capacity remain authoritative even though the
normal inventory tab is hidden. The side snapshot can populate one tick after
the main bank component;
`Bank.withdrawX*` waits for that handoff before recording its baseline. Side-view
`InvItem` actions are the visible `Deposit-*` component buttons, and `useOn`
returns false until the bank is closed.

`useOn` is "use X with Y" behind every processing skill — knife→logs,
raw fish→range, ess→altar. Returns false if a loc target is off-scene.

```ts
const raw = Inventory.first('Raw shrimps');
const range = Locs.query().name('Range').within(3).nearest();
if (raw && range) await raw.useOn(range);
```

## Bank

Low-level bank UI. Prefer [`Banking.open`](api-banking.md) to walk to and open a bank;
use `Bank.*` once the interface is open.

```ts
Bank.isOpen(): boolean
Bank.loaded(): boolean                    // item list populated (wait after open/deposit)
Bank.setNoteMode(on: boolean): Promise<void>
Bank.items(): BankItemSnapshot[]          // { slot, id, name, count, ops, comId }
Bank.count(name: string): number          // exact name, case-insensitive
Bank.countById(id: number): number        // when two objects share a display name
Bank.withdraw(name: string, op?: string): boolean | Promise<boolean>
Bank.withdrawById(id: number, op?: string): boolean | Promise<boolean>
Bank.withdrawX(name: string, count: number): Promise<boolean>   // Withdraw-X + dialog
Bank.withdrawXById(id: number, count: number): Promise<boolean>
Bank.deposit(name: string, op?: string): boolean | Promise<boolean>
Bank.depositInventory(): Promise<void>
Bank.depositAllMatching(match: (name, id) => boolean, log?): Promise<void>
Bank.close(timeoutMs?: number): Promise<boolean> // waits for main + side modal halves
Bank.openBooth(stand, boothName, op, log?): Promise<boolean>
Bank.openNearest(boothName, op, log?): Promise<boolean>
Bank.openNearestAccess(access, log?): Promise<boolean>

// Pick a real withdraw label from item.ops ("Withdraw-All" vs "Withdraw All")
withdrawOp(ops, amount: 'all' | '10' | '1' | 'any'): string | null
```

**Gotchas**

- `isOpen` only means the bank component exists. After open (and after every
  deposit) wait for `Bank.loaded()` before trusting `count()` / `items()` —
  until then counts read as 0.
- `withdraw`/`deposit`/`count` match names in full (case-insensitive).
  `op` is the context-menu label; use `withdrawOp(item.ops, 'all')` rather than
  hard-coding `'Withdraw-All'`.
- Prefer `countById` / `withdrawById` / `withdrawXById` when two objects share a display name.
- Do **not** hand-roll walk + booth click in new scripts — use `Banking.open`.

```ts
if (!(await Banking.open({ stand: bankTile }))) return;
await Execution.delayUntil(() => Bank.loaded(), 3000);
await Bank.depositAllMatching(depositAllExcept(['Harpoon', 'Fishing bait']));
const bait = Bank.items().find(i => i.name === 'Fishing bait');
const op = bait ? withdrawOp(bait.ops, 'all') : null;
if (op) await Bank.withdraw('Fishing bait', op);
// or exact qty:
await Bank.withdrawX('Feather', 100);
// or by id when names collide:
// await Bank.withdrawById(someId, op);
```

## See also

- [Banking helpers](api-banking.md)
- [Scripting API index](../API.md)
