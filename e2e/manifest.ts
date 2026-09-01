import type { Case } from './manifestTypes.js';

/** Every case the e2e suite can run. The runner iterates this; nothing globs the directory. */
export const CASES: readonly Case[] = [
    {
        id: 'aio-quest-test',
        harness: 'aio-quest-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 120,
        documentedIn: 'docs/reference/quest-harness-recipes-4.md'
    },
    {
        id: 'aio-full-queue-live',
        harness: 'aio-full-queue-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'unvetted',
        manual: true,
        budgetMin: 480,
        note: 'every implemented quest on a level-70 account seeded with the mustHave items, a coin float, food and a rune kit'
    },
    {
        id: 'aio-fresh-pack-live',
        harness: 'aio-fresh-pack-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        args: ['--quest', 'doric', '--junk', '28', '--minutes', '8'],
        budgetMin: 10,
        provenAt: '0f80d90b',
        note: 'seeds 28 cow hides into the pack and proves the quest banks them before it provisions'
    },
    {
        id: 'aio-skip-quest-432-live',
        harness: 'aio-skip-quest-432-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'alcher-nearest-bank-live',
        harness: 'alcher-nearest-bank-live.ts',
        covers: { scripts: ['Alcher'] },
        status: 'vetted',
        provenAt: 'd00d66de',
        budgetMin: 12,
        note: 'noted rune chainbodies, natures and a fire staff banked at Varrock West; passes when the note stack shrinks, coins appear and magic XP moves'
    },
    {
        id: 'alcher-swarm-drain-live',
        harness: 'alcher-swarm-drain-live.ts',
        covers: { scripts: ['Alcher'] },
        status: 'unvetted',
        budgetMin: 8,
        note: 'two ticked items at Varrock West, rune chainbodies over yew longbows, with macro_swarm spawned mid-alch; passes when the event interrupts the cast loop and is evaded, then the drain retires the chainbodies and moves on to the longbows'
    },
    {
        id: 'banksorter-live',
        harness: 'banksorter-live.ts',
        covers: { scripts: ['BankSorter'] },
        status: 'vetted',
        provenAt: 'd02c664c',
        budgetMin: 8,
        note: 'seeds a scrambled bank at Varrock West, sorts it cold, then tops it up and re-sorts; passes when both orders are contiguous by category and ranked by tier inside each one, the incremental pass takes one insert batch, and varp 304 comes back to where it started'
    },
    {
        id: 'ardyfighter-restock-loop-live',
        harness: 'ardyfighter-restock-loop-live.ts',
        covers: { scripts: ['ArdyFighter'] },
        status: 'vetted',
        budgetMin: 5,
        provenAt: 'b0ae0134ec44db595faa9d58947fb30e14f6e56c'
    },
    {
        id: 'resume-loop-concurrency-live',
        harness: 'resume-loop-concurrency-live.ts',
        covers: { scripts: ['WalkToBot'], subsystems: ['infra', 'nav'] },
        status: 'unvetted',
        budgetMin: 10,
        note: 'pauses and resumes in the middle of a walk and proves one loop body comes back, not two (#580 regression)'
    },
    {
        id: 'autofighter-bank-resume-live',
        harness: 'autofighter-bank-resume-live.ts',
        covers: { scripts: ['AutoFighter'] },
        status: 'vetted',
        provenAt: 'b668c7d8',
        budgetMin: 12,
        note: 'empty pack plus banked trout forces the out-of-food trip; the run fails if the booth stays open or combat never resumes'
    },
    {
        id: 'autofighter-targets-loot-live',
        harness: 'autofighter-targets-loot-live.ts',
        covers: { scripts: ['AutoFighter'] },
        status: 'vetted',
        provenAt: '7fe84288',
        budgetMin: 14,
        note: 'spawns two Chickens and two Rats, drops guam and marrentill, then proves both names die, the avoided guam stays down, and an explicit Cake setting beats a pack of trout'
    },
    {
        id: 'bankfletcher-live',
        harness: 'bankfletcher-live.ts',
        covers: { scripts: ['BankFletcher'] },
        status: 'unvetted',
        budgetMin: 5,
        note: 'Varrock West: knife stays through a willow longbow bank trip, stringing raises strung id 847, headless attach climbs'
    },
    {
        id: 'baxtorian-rope-369-live',
        harness: 'baxtorian-rope-369-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'biohazard-234-live',
        harness: 'biohazard-234-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        budgetMin: 30,
        provenAt: '8b1c5e06',
        documentedIn: 'docs/reference/quest-harness-recipes.md',
        note: 'clean account to journal complete in 14min at --tick 100, no parks'
    },
    {
        id: 'brimhaven-agility-test',
        harness: 'brimhaven-agility-test.ts',
        covers: { scripts: ['BrimhavenAgility'] },
        status: 'unvetted'
    },
    {
        id: 'brimhaven-mossgiants-live',
        harness: 'brimhaven-mossgiants-live.ts',
        covers: { scripts: ['BrimhavenMossGiants'] },
        status: 'vetted',
        provenAt: 'd00d66de',
        budgetMin: 18,
        note: 'empty pack at the Ardougne pier bank; passes only after the bank phase, the Captain Barnaby hop and combat XP on the island. Seeds Agility 30: the field sits behind an Agility 10 ropeswing and a combat-only account reads the field as unreachable'
    },
    {
        id: 'brimhaven-swarm-597-live',
        harness: 'brimhaven-swarm-597-live.ts',
        covers: { scripts: ['BrimhavenAgility'] },
        status: 'unvetted'
    },
    {
        id: 'brimhaven-steal-restock-live',
        harness: 'brimhaven-steal-restock-live.ts',
        covers: { scripts: ['BrimhavenAgility'] },
        status: 'unvetted'
    },
    {
        id: 'chompy-bird-235-live',
        harness: 'chompy-bird-235-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        budgetMin: 90,
        provenAt: '51ea75ed',
        documentedIn: 'docs/reference/quest-harness-recipes-17.md',
        note: 'uncheated --stage 0 --until 65 finished in 13 minutes at --tick 200; members-only, so it needs the :8890 world'
    },
    {
        id: 'clue-guardian-eat-live',
        harness: 'clue-guardian-eat-live.ts',
        covers: { scripts: ['ClueSolver'] },
        status: 'unvetted'
    },
    {
        id: 'clue-shantay-pass-live',
        harness: 'clue-shantay-pass-live.ts',
        covers: { subsystems: ['clues', 'nav'] },
        status: 'unvetted'
    },
    {
        id: 'clue-trails-live',
        harness: 'clue-trails-live.ts',
        covers: { scripts: ['ClueSolver'] },
        status: 'unvetted'
    },
    {
        id: 'clock-tower-236-live',
        harness: 'clock-tower-236-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        budgetMin: 60,
        provenAt: 'ae6a6bc5',
        note: 'Clock Tower start to finish in 6 minutes at --tick 200; --stage counts placed cogs'
    },
    {
        id: 'scorpion-catcher-258-live',
        harness: 'scorpion-catcher-258-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'coaltrucks-test',
        harness: 'coaltrucks-test.ts',
        covers: { scripts: ['CoalTrucks'] },
        status: 'documented',
        documentedIn: 'package.json verify:coaltrucks'
    },
    {
        id: 'common-reward-banking-test',
        harness: 'common-reward-banking-test.ts',
        covers: { scripts: ['AutoFighter'] },
        status: 'unvetted'
    },
    {
        id: 'crandor-ship-367-live',
        harness: 'crandor-ship-367-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'dartfletcher-test',
        harness: 'dartfletcher-test.ts',
        covers: { scripts: ['DartFletcher'] },
        status: 'unvetted'
    },
    {
        id: 'deathplateau-237-live',
        harness: 'deathplateau-237-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'broken',
        note: 'exits 0 whatever happens; asserts no verdict'
    },
    {
        id: 'demon-slayer-goblins-test',
        harness: 'demon-slayer-goblins-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'desert-camp-surface-live',
        harness: 'desert-camp-surface-live.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'unvetted'
    },
    {
        id: 'digsite-251-live',
        harness: 'digsite-251-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        budgetMin: 150,
        provenAt: 'a0f40788',
        documentedIn: 'docs/reference/quest-harness-recipes-15.md',
        note: 'uncheated --stage 0 --until 9 at --tick 150'
    },
    {
        id: 'doric-level3-test',
        harness: 'doric-level3-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'dragon-slayer-379-live',
        harness: 'dragon-slayer-379-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'dragonslayer-solo-test',
        harness: 'dragonslayer-solo-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'dwarf-cannon-254-live',
        harness: 'dwarf-cannon-254-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted',
        budgetMin: 60
    },
    {
        id: 'eadgar-ruse-241-live',
        harness: 'eadgar-ruse-241-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 180,
        documentedIn: 'docs/reference/quest-harness-recipes-4.md',
        note: "Eadgar's Ruse leg by leg at --tick 200; --stage jumps %eadgar_quest, --unfreed exercises the free-Eadgar recovery"
    },
    {
        id: 'entrana-gear-368-live',
        harness: 'entrana-gear-368-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'ernest-chicken-229-live',
        harness: 'ernest-chicken-229-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 45,
        documentedIn: 'docs/reference/quest-harness-recipes-4.md'
    },
    {
        id: 'external-script-test',
        harness: 'external-script-test.ts',
        covers: { scripts: ['BoneBurier'] },
        status: 'unvetted',
        manual: true
    },
    {
        id: 'family-crest-210-live',
        harness: 'family-crest-210-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 75,
        documentedIn: 'docs/reference/quest-harness-recipes-2.md'
    },
    {
        id: 'fight-arena-233-live',
        harness: 'fight-arena-233-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        budgetMin: 20,
        provenAt: 'd708e10e',
        documentedIn: 'docs/reference/quest-harness-recipes-2.md',
        note: 'uncheated --stage 0 --until 14 finished in 7 minutes at --tick 150'
    },
    {
        id: 'fight-arena-iron-374-live',
        harness: 'fight-arena-iron-374-live.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'unvetted'
    },
    {
        id: 'firegiant-test',
        harness: 'firegiant-test.ts',
        covers: { scripts: ['FireGiant'] },
        status: 'unvetted'
    },
    {
        id: 'fishing-contest-244-live',
        harness: 'fishing-contest-244-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        budgetMin: 15,
        provenAt: '8b21aef5',
        documentedIn: 'docs/reference/quest-harness-recipes-2.md',
        note: 'uncheated --stage 0 --until 5 finished in 6 minutes at --tick 150; --stage is %fishingcompo'
    },
    {
        id: 'fremennik-trials-266-live',
        harness: 'fremennik-trials-266-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        provenAt: '7a90d351',
        budgetMin: 180,
        documentedIn: 'docs/reference/quest-harness-recipes-18.md',
        note: 'Seven trials at 70 stats and --tick 200; --stage counts whole trials won. Koschei passes on a roll that lands on the last hitpoint, so a run can spend one death and a walk back from Lumbridge'
    },
    {
        id: 'flaxaio-pick-spin-live',
        harness: 'flaxaio-pick-spin-live.ts',
        covers: { scripts: ['FlaxAIO'] },
        status: 'broken',
        budgetMin: 18,
        note: 'both toggles on from an empty pack at the Seers bank. Picking passes; the spin leg does not. Make-X is accepted 17 times at the wheel and the flax count never moves, so the run parks until the watchdog walks it home'
    },
    {
        id: 'gatheringbot-cooker-pair-test',
        harness: 'gatheringbot-cooker-pair-test.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'documented',
        documentedIn: 'docs/how-to/gatheringbot-smoke.md'
    },
    {
        id: 'marketmaker-pair-live',
        harness: 'marketmaker-pair-live.ts',
        covers: { scripts: ['MarketMaker'] },
        status: 'vetted',
        provenAt: '55e047c3',
        budgetMin: 16,
        env: { BUDGET_S: '900' },
        note: 'two accounts at Seers bank: a sale paid by coins in the window, a mixed pile bought with no chat, a live re-price mid-trade, coins ignored and named, and a cooldown after walking out'
    },
    {
        id: 'marketmaker-aliases-live',
        harness: 'marketmaker-aliases-live.ts',
        covers: { scripts: ['MarketMaker'] },
        status: 'vetted',
        provenAt: 'f4e6d57c',
        budgetMin: 14,
        env: { BUDGET_S: '900' },
        note: 'the names the content repeats: a list carrying only stock, a repeated name answered with its colours, and a colour and a key half each resolving to the one obj the customer named'
    },
    {
        id: 'marketmaker-short-float-live',
        harness: 'marketmaker-short-float-live.ts',
        covers: { scripts: ['MarketMaker'] },
        status: 'vetted',
        budgetMin: 6,
        env: { WATCH_S: '90' },
        provenAt: '974e867e',
        note: 'a bank holding less than the coin float: one trip and open for business, rather than banking and re-withdrawing the same stack every loop'
    },
    {
        id: 'marketmaker-upkeep-live',
        harness: 'marketmaker-upkeep-live.ts',
        covers: { scripts: ['MarketMaker'], subsystems: ['panel'] },
        status: 'vetted',
        budgetMin: 20,
        env: { IDLE_MIN: '12' },
        provenAt: 'f8a624c9',
        note: 'a shop left standing past the 10min wedge with no stall-guard restart, its own chat read back off its own client, and the order book filtered and edited without losing the scroll or the caret'
    },
    {
        id: 'gatheringbot-mule-pair-test',
        harness: 'gatheringbot-mule-pair-test.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'documented',
        documentedIn: 'docs/how-to/gatheringbot-smoke.md'
    },
    {
        id: 'gatheringbot-range-path-test',
        harness: 'gatheringbot-range-path-test.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'documented',
        documentedIn: 'docs/how-to/gatheringbot-smoke.md'
    },
    {
        id: 'gatheringbot-test',
        harness: 'gatheringbot-test.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'documented',
        documentedIn: 'package.json verify:gatheringbot'
    },
    {
        id: 'gertrudes-cat-245-live',
        harness: 'gertrudes-cat-245-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 60,
        documentedIn: 'docs/reference/quest-harness-recipes-11.md'
    },
    {
        id: 'greendragon-pk-flee-test',
        harness: 'greendragon-pk-flee-test.ts',
        covers: { scripts: ['GreenDragon'] },
        status: 'unvetted'
    },
    {
        id: 'grand-tree-247-live',
        harness: 'grand-tree-247-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted',
        budgetMin: 90
    },
    {
        id: 'greendragon-test',
        harness: 'greendragon-test.ts',
        covers: { scripts: ['GreenDragon'] },
        status: 'unvetted'
    },
    {
        id: 'gutanoth-ledges-364-live',
        harness: 'gutanoth-ledges-364-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'herbcleaner-empty-bank-live',
        harness: 'herbcleaner-empty-bank-live.ts',
        covers: { scripts: ['HerbCleaner'] },
        status: 'vetted',
        provenAt: '723cde25',
        budgetMin: 8,
        note: 'two herbs selected and only one banked; the run waits for the absent one to be marked and the script to stop'
    },
    {
        id: 'hazeel-cult-248-live',
        harness: 'hazeel-cult-248-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        budgetMin: 45,
        provenAt: 'a8fa0762',
        documentedIn: 'docs/reference/quest-harness-recipes-8.md',
        note: 'clean account to journal complete in 4min at --tick 200, no parks; --stage is %hazeelcultquest'
    },
    {
        id: 'herblore-secondaries-test',
        harness: 'herblore-secondaries-test.ts',
        covers: { scripts: ['HerbloreSecondaries'] },
        status: 'unvetted'
    },
    {
        id: 'heros-quest-items-249-live',
        harness: 'heros-quest-items-249-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'unvetted',
        budgetMin: 60,
        documentedIn: 'docs/reference/quest-harness-recipes-19.md',
        note: 'one account seeded at stage 13 — proves the eel chain, the feather and the hand-in'
    },
    {
        id: 'heros-quest-pair-249-live',
        harness: 'heros-quest-pair-249-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'unvetted',
        budgetMin: 90,
        manual: true,
        documentedIn: 'docs/reference/quest-harness-recipes-19.md',
        note: 'two accounts, one per gang; --stage grip proves the armband dance in 9min at --tick 300'
    },
    {
        id: 'hillgiant-bank-428-live',
        harness: 'hillgiant-bank-428-live.ts',
        covers: { scripts: ['HillGiant'] },
        status: 'unvetted'
    },
    {
        id: 'hillgiant-test',
        harness: 'hillgiant-test.ts',
        covers: { scripts: ['HillGiant'] },
        status: 'unvetted'
    },
    {
        id: 'holy-grail-246-live',
        harness: 'holy-grail-246-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        budgetMin: 90,
        provenAt: '8b21aef5',
        note: 'Holy Grail start to finish in 26 minutes at --tick 200; --stage takes the %grail values quest_grail.constant uses'
    },
    {
        id: 'horror-deep-216-live',
        harness: 'horror-deep-216-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 90,
        documentedIn: 'docs/reference/quest-harness-recipes-6.md'
    },
    {
        id: 'hosted-proof-test',
        harness: 'hosted-proof-test.ts',
        covers: { scripts: ['ChickenKiller'] },
        status: 'documented',
        manual: true,
        documentedIn: 'docs/how-to/maintainer-infra.md'
    },
    {
        id: 'hosted-wall-test',
        harness: 'hosted-wall-test.ts',
        covers: { subsystems: ['multibox'] },
        status: 'documented',
        manual: true,
        documentedIn: 'docs/how-to/maintainer-infra.md'
    },
    {
        id: 'imp-catcher-230-live',
        harness: 'imp-catcher-230-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 90,
        documentedIn: 'docs/reference/quest-harness-recipes-3.md'
    },
    {
        id: 'knights-sword-228-live',
        harness: 'knights-sword-228-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted',
        budgetMin: 60
    },
    {
        id: 'legends-quest-253-live',
        harness: 'legends-quest-253-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted',
        budgetMin: 180
    },
    {
        id: 'loadout-panel-live',
        harness: 'loadout-panel-live.ts',
        covers: { subsystems: ['panel'] },
        status: 'unvetted'
    },
    {
        id: 'loot-csv-panel-live',
        harness: 'loot-csv-panel-live.ts',
        covers: { scripts: ['AutoFighter'], subsystems: ['panel'] },
        status: 'vetted',
        provenAt: 'e3ef8111',
        budgetMin: 4,
        note: 'drives the params modal: list chips, switch to CSV, copy, paste, and back to chips with the pasted list intact'
    },
    {
        id: 'lostcity-spirit-eat-393-live',
        harness: 'lostcity-spirit-eat-393-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'lostcity-test',
        harness: 'lostcity-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'mage-bank-live',
        harness: 'mage-bank-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'map-picker-basemap-live',
        harness: 'map-picker-basemap-live.ts',
        covers: { scripts: ['WalkToBot'] },
        status: 'documented',
        documentedIn: 'package.json verify:map-picker'
    },
    {
        id: 'map-picker-showcase-live',
        harness: 'map-picker-showcase-live.ts',
        covers: { scripts: ['WalkToBot'] },
        status: 'unvetted'
    },
    {
        id: 'map-picker-walkto-e2e-live',
        harness: 'map-picker-walkto-e2e-live.ts',
        covers: { scripts: ['WalkToBot'] },
        status: 'documented',
        documentedIn: 'package.json verify:map-picker-e2e'
    },
    {
        id: 'maze-at-start-live',
        harness: 'maze-at-start-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'unvetted'
    },
    {
        id: 'maze-probe-live',
        harness: 'maze-probe-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'unvetted'
    },
    {
        id: 'merlin-mordred-353-live',
        harness: 'merlin-mordred-353-live.ts',
        covers: { subsystems: ['quests', 'world'] },
        status: 'unvetted',
        note: 'import-fences.md names it as an ABI consumer, not as run instructions'
    },
    {
        id: 'monks-friend-240-live',
        harness: 'monks-friend-240-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        budgetMin: 30,
        provenAt: '8b21aef5',
        note: "Monk's Friend start to finish in 5 minutes at --tick 200; --stage is the raw %drunkmonkquest"
    },
    {
        id: 'mortton-255-live',
        harness: 'mortton-255-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        provenAt: '929f506d',
        budgetMin: 120,
        documentedIn: 'docs/reference/quest-harness-recipes-3.md'
    },
    {
        id: 'leathercrafter-nearest-bank-live',
        harness: 'leathercrafter-nearest-bank-live.ts',
        covers: { scripts: ['LeatherCrafter'] },
        status: 'vetted',
        provenAt: '64a451e9',
        budgetMin: 8,
        note: 'starts at Varrock West with the kit banked there; coming within 20 tiles of the Al Kharid booth fails the run'
    },
    {
        id: 'miner-fight-arena-bank-live',
        harness: 'miner-fight-arena-bank-live.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'vetted',
        provenAt: '4f99b5cf',
        budgetMin: 8,
        note: 'a full ore pack at the Fight Arena Mine has to reach the Yanille booth, and the run fails if the walk drifts to East Ardougne'
    },
    {
        id: 'mossgiant-dart-test',
        harness: 'mossgiant-dart-test.ts',
        covers: { scripts: ['MossGiant'] },
        status: 'unvetted'
    },
    {
        id: 'mulecrafter-test',
        harness: 'mulecrafter-test.ts',
        covers: { scripts: ['MuleCrafter'] },
        status: 'unvetted'
    },
    {
        id: 'multibox-profile-transfer-test',
        harness: 'multibox-profile-transfer-test.ts',
        covers: { subsystems: ['multibox'] },
        status: 'unvetted'
    },
    {
        id: 'multibox-tab-renderer-test',
        harness: 'multibox-tab-renderer-test.ts',
        covers: { subsystems: ['multibox'] },
        status: 'unvetted'
    },
    {
        id: 'multibox-tabs-test',
        harness: 'multibox-tabs-test.ts',
        covers: { subsystems: ['multibox'] },
        status: 'unvetted'
    },
    {
        id: 'murder-mystery-256-live',
        harness: 'murder-mystery-256-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 90,
        documentedIn: 'docs/reference/quest-harness-recipes-6.md',
        note: 'Murder Mystery start to finish; --stage seeds the guilty sibling as well as the evidence'
    },
    {
        id: 'naturecrafter-soak-test',
        harness: 'naturecrafter-soak-test.ts',
        covers: { scripts: ['NatureCrafter'] },
        status: 'unvetted'
    },
    {
        id: 'naturespirit-239-live',
        harness: 'naturespirit-239-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 120,
        documentedIn: 'docs/reference/quest-harness-recipes-14.md'
    },
    {
        id: 'nav-path-paint-live',
        harness: 'nav-path-paint-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'documented',
        documentedIn: 'docs/how-to/compare-path-paint.md'
    },
    {
        id: 'nav-script-routes-live',
        harness: 'nav-script-routes-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'documented',
        documentedIn: 'docs/how-to/script-travel-od.md'
    },
    {
        id: 'nav-script-travel-live',
        harness: 'nav-script-travel-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'documented',
        documentedIn: 'docs/how-to/script-travel-od.md'
    },
    {
        id: 'nav-stress-live',
        harness: 'nav-stress-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'documented',
        documentedIn: 'docs/how-to/compare-path-paint.md'
    },
    {
        id: 'nav-two-route-smoke-live',
        harness: 'nav-two-route-smoke-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'unvetted'
    },
    {
        id: 'hardclue-nav-live',
        harness: 'clues/hardclue-nav-live.ts',
        covers: { subsystems: ['nav', 'clues'] },
        status: 'unvetted',
        manual: true,
        budgetMin: 240,
        args: ['--limit', '8'],
        note: 'web-walks to every hard clue destination with the transport quests complete and the gate kit carried; --limit 0 sweeps them all'
    },
    {
        id: 'tirannwn-clue-gate-live',
        harness: 'clues/tirannwn-clue-gate-live.ts',
        covers: { scripts: ['ClueSolver'], subsystems: ['clues', 'quests'] },
        status: 'unvetted',
        budgetMin: 10,
        args: ['--tick', '150'],
        note: 'runs 3560/3562/3564 through ClueSolver with Regicide unfinished then seeded complete; asserts the gate shuts and opens, and reports the Isafdar nav gap without failing on it'
    },
    {
        id: 'spirit-tree-walk-live',
        harness: 'spirit-tree-walk-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'unvetted',
        budgetMin: 15,
        note: 'every transport quest complete, then three legs the pack plans through a Spirit Tree'
    },
    {
        id: 'observatory-252-live',
        harness: 'observatory-252-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        budgetMin: 90,
        provenAt: '8b21aef5',
        note: 'Observatory Quest start to finish in 14 minutes at --tick 200, 70 stats; --stage is the raw %itgronigen'
    },
    {
        id: 'route-walk-live',
        harness: 'nav/route-walk-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'unvetted'
    },
    {
        id: 'boat-stall-probe-live',
        harness: 'nav/boat-stall-probe-live.ts',
        covers: { subsystems: ['nav'] },
        status: 'unvetted'
    },
    {
        id: 'piratestreasure-231-live',
        harness: 'piratestreasure-231-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'plague-city-243-live',
        harness: 'plague-city-243-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        budgetMin: 45,
        provenAt: '3ab5d0a4',
        documentedIn: 'docs/reference/quest-harness-recipes-5.md',
        note: 'clean account to journal complete in 23min at --tick 300, no parks'
    },
    {
        id: 'upass-265-live',
        harness: 'upass-265-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'unvetted',
        budgetMin: 110,
        documentedIn: 'docs/reference/quest-harness-recipes-16.md',
        note: 'every leg 0 to 10 proven live from its own seeded stage; end to end stalls in the second cavern'
    },
    {
        id: 'regicide-257-live',
        harness: 'regicide-257-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'unvetted',
        budgetMin: 90,
        note: 'seeds Underground Pass complete varp and bits; --stage is the %regicide_quest value, 0 to 15'
    },
    {
        id: 'plague-pipe-366-live',
        harness: 'plague-pipe-366-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'princeali-solo-test',
        harness: 'princeali-solo-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'random-events-live',
        harness: 'random-events-live.ts',
        covers: { subsystems: ['random-events'] },
        status: 'unvetted'
    },
    {
        id: 'relogin-test',
        harness: 'relogin-test.ts',
        covers: { scripts: ['AIOTeleport'] },
        status: 'unvetted'
    },
    {
        id: 'rockcrab-dart-test',
        harness: 'rockcrab-dart-test.ts',
        covers: { scripts: ['RockCrab'] },
        status: 'unvetted'
    },
    {
        id: 'roguespurse-test',
        harness: 'roguespurse-test.ts',
        covers: { scripts: ['RoguesPurse'] },
        status: 'documented',
        documentedIn: 'docs/reference/quest-harness-recipes-2.md'
    },
    {
        id: 'romeo-juliet-rewrite-test',
        harness: 'romeo-juliet-rewrite-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'runecrafter-multibox-test',
        harness: 'runecrafter-multibox-test.ts',
        covers: { scripts: ['RuneCrafter'] },
        status: 'unvetted'
    },
    {
        id: 'scene-rebuild-test',
        harness: 'scene-rebuild-test.ts',
        covers: { subsystems: ['nav'] },
        status: 'unvetted'
    },
    {
        id: 'sea-slug-259-live',
        harness: 'sea-slug-259-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        provenAt: '8b21aef5',
        budgetMin: 45,
        documentedIn: 'docs/reference/quest-harness-recipes-7.md',
        note: 'Sea Slug start to finish in 5 minutes at --tick 200; --stage writes %seaslugquest straight'
    },
    {
        id: 'shantay-pass-route-test',
        harness: 'shantay-pass-route-test.ts',
        covers: { subsystems: ['nav', 'world'] },
        status: 'unvetted'
    },
    {
        id: 'sheep-herder-260-live',
        harness: 'sheep-herder-260-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'unvetted',
        budgetMin: 90
    },
    {
        id: 'shield-of-arrav-232-live',
        harness: 'shield-of-arrav-232-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        provenAt: '0db0e3f6',
        budgetMin: 45,
        documentedIn: 'docs/reference/quest-harness-recipes-7.md',
        note: 'one gang side only — a lone account cannot redeem, so this never turns the journal green'
    },
    {
        id: 'shield-of-arrav-pair-232-live',
        harness: 'shield-of-arrav-pair-232-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        provenAt: '0db0e3f6',
        budgetMin: 90,
        manual: true,
        documentedIn: 'docs/reference/quest-harness-recipes-7.md',
        note: 'two fresh accounts, one per gang, both journals complete in 6min at --tick 300'
    },
    {
        id: 'shilo-solo-test',
        harness: 'shilo-solo-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        documentedIn: 'docs/reference/quest-harness-recipes-2.md'
    },
    {
        id: 'smelter-swarm-422-live',
        harness: 'smelter-swarm-422-live.ts',
        covers: { scripts: ['SmelterBot'] },
        status: 'unvetted'
    },
    {
        id: 'smithingbot-bank-loop-live',
        harness: 'smithingbot-bank-loop-live.ts',
        covers: { scripts: ['SmithingBot'] },
        status: 'vetted',
        provenAt: '57498434',
        budgetMin: 10,
        note: 'Varrock West bank → anvil → bank on a 54-bar Platebody load; the remainder the bot cannot smith has to send it back'
    },
    {
        id: 'superheater-smelt-live',
        harness: 'superheater-smelt-live.ts',
        covers: { scripts: ['Superheater'] },
        status: 'vetted',
        provenAt: '7fe84288',
        budgetMin: 10,
        note: 'Varrock West with iron, coal, natures and a staff of fire banked; passes on steel bars plus magic and smithing XP together'
    },
    {
        id: 'strangebox-repro-live',
        harness: 'strangebox-repro-live.ts',
        covers: { subsystems: ['random-events'] },
        status: 'unvetted'
    },
    {
        id: 'strangebox-underscript-live',
        harness: 'strangebox-underscript-live.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'unvetted'
    },
    {
        id: 'tbwt-261-live',
        harness: 'tbwt-261-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'documented',
        budgetMin: 180,
        documentedIn: 'docs/reference/quest-harness-recipes-9.md'
    },
    {
        id: 'temple-of-ikov-250-live',
        harness: 'temple-of-ikov-250-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'vetted',
        budgetMin: 90,
        provenAt: '760bae8f',
        documentedIn: 'docs/reference/quest-harness-recipes-9.md',
        note: 'members-only, :8890 — uncheated --until 100 finished in 39 minutes at --tick 200 on 20 lobsters, no parks and no deaths; the default kit is coins, food and the gear the bank already holds'
    },
    {
        id: 'thievingbot-test',
        harness: 'thievingbot-test.ts',
        covers: { scripts: ['ThievingBot'] },
        status: 'documented',
        documentedIn: 'package.json verify:thievingbot'
    },
    {
        id: 'touristtrap-cart-recovery-test',
        harness: 'touristtrap-cart-recovery-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'trapdoor-mines-live',
        harness: 'trapdoor-mines-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'treegnome-263-live',
        harness: 'treegnome-263-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted',
        budgetMin: 120
    },
    {
        id: 'tribal-totem-262-live',
        harness: 'tribal-totem-262-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'vetted',
        budgetMin: 45,
        provenAt: 'ea865e4d',
        note: 'Tribal Totem start to finish in 5 minutes at --tick 200 on 70 stats; --stage is %totemquest and --combo skips the KURT lock'
    },
    {
        id: 'trollstronghold-264-live',
        harness: 'trollstronghold-264-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted',
        budgetMin: 90
    },
    {
        id: 'vampire-slayer-live-test',
        harness: 'vampire-slayer-live-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'varrock-sewer-web-370-live',
        harness: 'varrock-sewer-web-370-live.ts',
        covers: { subsystems: ['world'] },
        status: 'unvetted'
    },
    {
        id: 'vialfiller-test',
        harness: 'vialfiller-test.ts',
        covers: { scripts: ['VialFiller'] },
        status: 'unvetted'
    },
    {
        id: 'walkmap-picker-443-live',
        harness: 'walkmap-picker-443-live.ts',
        covers: { scripts: ['WalkToBot'] },
        status: 'unvetted'
    },
    {
        id: 'watchtower-solo-test',
        harness: 'watchtower-solo-test.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
    },
    {
        id: 'waterfall-exit-test',
        harness: 'waterfall-exit-test.ts',
        covers: { subsystems: ['nav', 'quests'] },
        status: 'unvetted'
    },
    {
        id: 'witchs-house-226-live',
        harness: 'witchs-house-226-live.ts',
        covers: { scripts: ['AIOQuester'], subsystems: ['quests'] },
        status: 'unvetted',
        args: ['--stage', '5', '--until', '6', '--at', '2901,3466,0', '--stocked', '--minutes', '30'],
        budgetMin: 35,
        note: "Witch's House by stage; --stage jumps %ballquest, --stocked hands over the cheese and gloves so a staged run does not shop for them"
    },
    {
        id: 'wildyagility-food-startup-live',
        harness: 'wildyagility-food-startup-live.ts',
        covers: { scripts: ['WildyAgility'] },
        status: 'vetted',
        provenAt: '43a7a587',
        budgetMin: 6,
        note: 'cake and chocolate cake both banked; the startup trip must bring back only the one the setting names'
    }
];
