# Concurrent Electron instances

Run `bun e2e/desktop-instances-test.ts` from the repository root with desktop dependencies installed.
The harness uses temporary fixture accounts and makes no game login.

The recorded run used commit `1fb37543609b7a1ab82f62b725c2f92a75d828f9` on ports 8082 and 8083.
Each launcher built into its own directory. Both Electron windows read and wrote one saved-data store.

The checks cover existing account/settings migration, simultaneous account additions, shared settings
inside bot frames, persistence after restart, unchanged shared build output, and independent shutdown.
Both screenshots show the migrated account and accounts added concurrently by the two windows.
The browser caches and private builds were removed at shutdown.

[Proof](proof.json) · [First launcher](launcher-1.log) · [Second launcher](launcher-2.log)

![First instance](first.png)

![Second instance](second.png)

Validation: 10,435 unit tests passed, one existing skip, zero failures. The five focused launcher/storage/proxy
tests passed after the final changes. Typecheck, ESLint, prose, API contract and e2e boundary checks passed.
`bun run package` from `desktop/` succeeded; the packaged app includes the storage/preload modules and lock dependency.

Older Electron windows must restart once with the updated launcher to use shared saved data.
