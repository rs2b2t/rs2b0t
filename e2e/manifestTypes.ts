// Why: a runtime array makes the union checkable against the registry; a bare type union cannot be.
export const SCRIPT_NAMES = [
    'AgilityBot', 'AIOQuester', 'AIOTeleport', 'ArdyCakes', 'ArdyFighter',
    'ArdyThiever', 'ArravSupplier', 'AutoFighter', 'BankFletcher', 'Barcrawl', 'BoneBurier',
    'BrimhavenAgility', 'ChaosDruidKiller', 'ChickenKiller', 'ClueSolver',
    'CoalTrucks', 'CookBot', 'DartFletcher', 'DuelArena', 'EdgevilleMonkeyBars',
    'EssMiner', 'FireGiant', 'Firemaker', 'FlaxPicker', 'FlaxRunner',
    'FlaxSpinner', 'GatheringBot', 'GemCutter', 'GreenDragon', 'HerbCleaner',
    'HerbloreSecondaries', 'HillGiant', 'LeatherCrafter', 'MossGiant',
    'MuleCrafter', 'NatureCrafter', 'PotionMaker', 'RockCrab', 'RoguesPurse',
    'RuneCrafter', 'ShopBuyout', 'ShopRunner', 'SmelterBot', 'SmithingBot',
    'TannerBot', 'ThievingBot', 'VialFiller', 'WalkToBot', 'WildyAgility'
] as const;

export type ScriptName = typeof SCRIPT_NAMES[number];

export type Subsystem =
    | 'nav' | 'multibox' | 'clues' | 'panel' | 'quests' | 'random-events' | 'world' | 'infra';

/** vetted: someone ran it green and recorded the commit. documented: a doc or npm script tells you
 *  how to run it, with no green run on record. unvetted: neither. broken: known to fail or assert nothing. */
export type CaseStatus = 'vetted' | 'documented' | 'unvetted' | 'broken';

export type Level = 'quick' | 'smart' | 'full';

export interface Case {
    /** Unique across the manifest; names the scenario, not the harness. */
    id: string;
    /** Path under e2e/, including any subdirectory. */
    harness: string;
    covers: { scripts?: readonly ScriptName[]; subsystems?: readonly Subsystem[] };
    status: CaseStatus;
    /** Never selected by a level; reachable only through --only. */
    manual?: true;
    env?: Readonly<Record<string, string>>;
    args?: readonly string[];
    budgetMin?: number;
    /** Commit where this case last ran green. Required when status is 'vetted'. */
    provenAt?: string;
    /** Doc path or npm script naming how to run this. Required when status is 'documented'. */
    documentedIn?: string;
    note?: string;
}
