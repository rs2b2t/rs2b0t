[Manual](../README.md) › [Clues](../CLUES.md) › Host yielding

# Why the solver yields

[`ClueExecutor`](../../src/bot/api/ai/clues/ClueExecutor.ts) usually runs *inside* another bot,
a fighter that solves clues it drops. It must therefore not monopolise the loop:

```ts
type ClueOutcome =
  | 'done'
  | 'abandon'
  | 'yield'
  | 'reward-pending'
  | 'supplies-needed'
  | 'dead'
  | 'guardian-lost';
```

Each pass checks whether the host needs control back and returns `'yield'`
rather than continuing:

```ts
if (EventSignal.pending()) {
    return 'yield';
}
```

Without that, a random event fires mid-trail and the solver walks the bot away from
it, ignoring an interaction the server is waiting on. Long-running loops elsewhere
must poll `EventSignal` for the same reason.

Yielding does not discard the trail. The next host task pass resumes the same
executor session after the event clears. A guardian yield also retains its
`GuardianEncounter`; the resumed fight revalidates the same NPC by index and id,
ownership and range instead of digging again to spawn another guardian. Failed
revalidation returns `'dead'` or `'guardian-lost'`, and an exhausted combat kit
returns `'supplies-needed'`.

`'reward-pending'` keeps casket delivery and overflow collection in the clue task.
A terminal reward failure remains blocked, with the pending rewards and completion
state retained. No automatic retry is promised; the host must explicitly clear the
block through its retry path.

`Sustain.run()` is called every pass, so eating and other upkeep continue during a
trail.

These contracts are backed by source and automated tests. Private-server runtime
acceptance is still pending, so they are not live acceptance evidence.

## Why the audit cannot catch everything

The auditor checks the baked graph, not the server, so it cannot see a barrier that is
baked open and refused in play. McGrubor's Wood audited clean for as long as its locked
gate was an edge. A clue that walks all the way to a door and never gets through is that
failure, and the fix belongs in the pack, not the solver.

## See also

- [Clue reference](../reference/clues-database.md)
- [Trace a clue failure](../how-to/trace-a-clue-failure.md)
