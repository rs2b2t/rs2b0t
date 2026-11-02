[Manual](../README.md) › [Clues](../CLUES.md) › Hard trail preparation

# Hard trail preparation

Before starting a hard clue scroll, [`SolveClue.ts`](../../src/bot/api/ai/clues/SolveClue.ts) prepares at the host's initial bank when supplied, or the nearest known bank otherwise. The ready snapshot needs Attack 60, Lost City, an eligible dragon weapon (dagger ids 1231/1215 or longsword id 1305), at least one Superantipoison dose and the host's food target (15 Sharks by default, 12 for JiveDragons). It keeps an eligible equipped weapon or equips the configured eligible weapon when available, remembers the original weapon, takes the best available Superantipoison dose and stocks that many Sharks while reserving required tool and teleport slots. Puzzle clues reserve one free slot without reducing the initial food target and recover their exact banked puzzle box. A confirmed shortage stays blocked until the kit changes or the host explicitly retries.

Hosts can supply a ranged loadout instead of the default melee kit. JiveDragons does this when range is selected: preparation requires its configured bow and arrows in place of Attack 60, Lost City and a dragon weapon. It selects the wearable bow by item ID and tops up equipped arrows to the configured quantity when stock permits. Food and Superantipoison requirements stay the same. Guardian combat uses the configured ranged attack style and a reachable firing position within seven tiles with line of sight. Empty ammunition requests a bank restock.

The generic bank and Entrana rules remain in force: no reachable known bank blocks a hard trail, while an Entrana clue clears inventory space before removing and banking every equipped item. It preserves the clue and records the full outfit, including ammunition counts, for restoration. Leaving Entrana for another clue step requires a bank visit to restore that outfit before continuing. Failed withdrawals or equips keep the solver in charge until restoration succeeds. A held casket without a clue scroll bypasses combat-kit preparation, but a hard casket still follows the reward bank flow before opening.

Each new leg gets its own tool-acquisition attempts. A Kharazi leg missing its
machete, axe or required notes requests bank preparation before travel. Missing
banked tools leave the clue pending until the supplies change or the user retries.
