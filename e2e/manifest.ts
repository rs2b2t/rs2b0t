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
        id: 'aio-skip-quest-432-live',
        harness: 'aio-skip-quest-432-live.ts',
        covers: { scripts: ['AIOQuester'] },
        status: 'unvetted'
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
        id: 'gatheringbot-cooker-pair-test',
        harness: 'gatheringbot-cooker-pair-test.ts',
        covers: { scripts: ['GatheringBot'] },
        status: 'documented',
        documentedIn: 'docs/how-to/gatheringbot-smoke.md'
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
        id: 'loadout-panel-live',
        harness: 'loadout-panel-live.ts',
        covers: { subsystems: ['panel'] },
        status: 'unvetted'
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
    }
];
