[Manual](../README.md) › [Clues](../CLUES.md) › Host yielding

# Why the solver yields

[`ClueExecutor`](../../src/bot/api/ai/clues/ClueExecutor.ts) usually runs *inside* another bot —
a fighter that solves clues it drops. It must therefore not monopolise the loop:

```ts
async solveHeldClue(log): Promise<'done' | 'abandon' | 'yield'>
```

The third outcome is the important one. Each pass checks whether the host needs
control back and returns `'yield'` rather than continuing:

```ts
if (EventSignal.pending()) {
    trace.note('yield — random event pending');
    return 'yield';
}
```

Without that, a random event fires mid-trail and the solver walks the bot away from
it, ignoring an interaction the server is waiting on. Long-running loops elsewhere
must poll `EventSignal` for the same reason.

`Sustain.run()` is called every pass, so eating and other upkeep continue during a
trail.

## Why the audit cannot catch everything

The auditor checks the baked graph, not the server, so it cannot see a barrier that is
baked open and refused in play. McGrubor's Wood audited clean for as long as its locked
gate was an edge. A clue that walks all the way to a door and never gets through is that
failure, and the fix belongs in the pack, not the solver.

## See also

- [Clue reference](../reference/clues-database.md)
- [Trace a clue failure](../how-to/trace-a-clue-failure.md)
