# JiveRC Cosmic crafting

Run from the checkout being tested:

```sh
bun e2e/jiverc-cosmic-live.ts --base http://localhost:8890 --minutes 8
```

Optional positional `outside` or `inside` selects one trading mode. The time limit applies to each mode after account setup. `ENGINE_DIR` selects the local engine for the isolated client deployment.

For manual validation in visible Master and Runner windows:

```sh
HEADED=1 SLOWMO=0 bun e2e/jiverc-cosmic-live.ts --base http://localhost:8890 --review inside
```

Review mode keeps the scripts running until you click **Finish test** in either window or close a test window. Pause, resume, and stop are available through the normal JiveRC controls. Use `outside` to review trades at the ruins instead. Manual review does not report an automated pass.

The harness creates fresh master and runner accounts, seeds their supplies, and starts the bundled JiveRC script. It checks Rune essence withdrawals, trades, Cosmic altar entry, 200 Runecrafting XP and 50 Cosmic runes per 25 essence at level 99, portal exits, and repeated runner bank trips. Inside mode also requires the master to bank runes and craft again afterwards. Both characters must retain their Dramen staff.

Results, failure diagnostics, and screenshots are written under `out/cos*/`. Cleanup stops the scripts, logs out the accounts, and removes the isolated deployment.

Validated against `http://localhost:8890` on 2026-09-16 with the uncommitted JiveRC build. Both modes passed two batches each, producing 200 Cosmic runes and 800 Runecrafting XP in total. Outside mode finished in 183 seconds; inside mode finished in 296 seconds, including a deposit of 50 Cosmic runes followed by another craft. Runner restocks, portal exits, and retained travel gear passed. No browser errors occurred. [Recorded results and build hashes](jiverc-cosmic.json).

The first attempt stopped with an empty fixture bank because this engine does not implement `givebank`. The final harness uses the shared bank-seeding helper, verifies the fallback `~bankitem` result, and then starts JiveRC. No crafting-script changes were needed during this validation.
