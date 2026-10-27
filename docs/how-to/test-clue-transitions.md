[Manual](../README.md) › [Clues](../CLUES.md) › Test leg transitions

# Test clue leg transitions

Run `bun run build:bot`, then
`bun e2e/jivedragons-clue-transitions-live.ts`.
Use `--entrana-only` or `--map-only` to select one scenario.

Port 8890 must be free. The harness starts and stops its own local engine from
`ENGINE_DIR` or `~/code/rs2b2t-engine`. It needs the engine's existing packed
content and bot client. Every run uses fresh accounts and isolated client pages.

The server fixture replaces only the next random hard-clue selection for those
accounts with Kharazi clue 3534, then makes that the final leg. Movement,
banking, clue interactions, combat and rewards use the live engine at 600 ms
ticks. The harness asserts that the same JiveDragons instance stays running
throughout.

Both scenarios start with a full backpack and ten equipped slots. One starts
with an Entrana clue and must bank every equipped item, complete that step, restore the
outfit, fetch jungle tools and defeat the next guardian. The other starts with
an ordinary map clue and must fetch tools when the jungle clue appears later.

The harness discards one Machete withdrawal click while bank stock is present.
The Entrana case also discards one armour-equip click. Both must recover,
complete the trail alive, and retain the original outfit and 100 arrows.
The runs end at clue completion; they do not test the next dragon-farming trip.

The accounts use 75 Attack/Strength/Defence, 90 Hitpoints, 70 Prayer, 80 Magic,
60 Woodcutting and Agility, with Lost City, Watchtower and Legends completed.

## Recorded runs

On 2026-10-01, Entrana → Kharazi passed against bot commit `49acda7f` at
normal server speed. It restored all ten slots and 100 Bronze arrows before
fighting the Saradomin Wizard, recovered from both injected failures without
restarting, and completed the trail at 81 Hitpoints.
[Completion screenshot](../e2e/jivedragons-entrana-kharazi-transition-live.png).

The ordinary map → Kharazi run also passed, at 89 Hitpoints. It detected the
new leg's missing tools, banked at Varrock East, retried the discarded Machete
withdrawal and completed the guardian fight with the same outfit. Both runs
opened the reward casket and kept the same JiveDragons instance throughout.
[Completion screenshot](../e2e/jivedragons-map-kharazi-transition-live.png).
