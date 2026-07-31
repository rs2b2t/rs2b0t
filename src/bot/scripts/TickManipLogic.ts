/**
 * Optional tick-manipulation methods for GatheringBot (#160).
 *
 * Server ground truth (Lost City / this revision), not OSRS wiki numbers:
 * - Woodcutting default action_delay = map_clock + 3
 * - Fly fishing (freshfish) = +4
 * - Mining interval = pickaxe mining_rate (mith=4, rune=2, …)
 * - Knife + log fletch arms +2 after Make-1 confirm (never Make-X; product finish is incidental)
 * - Auto-retaliate flinch = attackrate/2 (rapid style −1)
 *
 * Client cannot read %action_delay — planners use XP / inventory / tick edges.
 *
 * Product gate: {@link TICK_MANIP_SHIPPED} is false until methods are fully ready.
 * When false, UI options are Off-only and {@link profileForSetting} always returns Off
 * so end users cannot enable WIP methods (saved settings are ignored).
 */

/**
 * Flip to true when tick-manip methods are ready for end users.
 * Keep false for leash/camp PRs and incomplete method work.
 */
export const TICK_MANIP_SHIPPED = false;

/** Inventory delay item pair (knife + one fletchable log). */
export const TICK_MANIP_KNIFE = 'Knife';

/** Logs knife can fletch on this content pack (no teak/mahogany stocks). */
export const FLETCHABLE_LOG_NAMES = [
    'Logs',
    'Oak logs',
    'Willow logs',
    'Maple logs',
    'Yew logs',
    'Magic logs'
] as const;

export type FletchableLogName = (typeof FLETCHABLE_LOG_NAMES)[number];

/**
 * Soft product hint for Make-1 when the menu offers shafts (normal Logs only).
 * Oak+ only offer bows — armKnifeDelay falls back to the first product.
 * Never use Make-X for delay arming.
 */
export const KNIFE_DELAY_MAKE_MATCH = 'shaft';

// ── Fisher ──────────────────────────────────────────────────────────────────

export const FISH_TICK_MANIP_OPTIONS = [
    'Off',
    '4t fly reclick',
    'Knife delay (+2)',
    'Tannerfishing'
] as const;

export type FishTickManipLabel = (typeof FISH_TICK_MANIP_OPTIONS)[number];
export type FishTickManip = 'off' | '4t-fly' | 'knife-delay' | 'tannerfish';

// ── Miner ───────────────────────────────────────────────────────────────────

export const MINE_TICK_MANIP_OPTIONS = ['Off', 'Iron cadence (pick-aware)'] as const;

export type MineTickManipLabel = (typeof MINE_TICK_MANIP_OPTIONS)[number];
export type MineTickManip = 'off' | 'iron-cadence';

// ── Woodcutter ──────────────────────────────────────────────────────────────

export const WC_TICK_MANIP_OPTIONS = [
    'Off',
    'Knife delay (+2)',
    '2t retaliate oaks',
    '3t farmer willows',
    '3t willows shortbow rapid'
] as const;

export type WcTickManipLabel = (typeof WC_TICK_MANIP_OPTIONS)[number];
export type WcTickManip = 'off' | 'knife-delay' | '2t-oaks' | '3t-farmer' | '3t-shortbow';

export type TickManipMethod = FishTickManip | MineTickManip | WcTickManip;

/** Combat policy derived from the active method. */
export type TickManipCombatPolicy = 'flee' | 'retaliate-may-die';

export type TickManipSkill = 'fish' | 'mine' | 'wc';

export interface TickManipProfile {
    skill: TickManipSkill;
    method: TickManipMethod;
    /** Human label from settings. */
    label: string;
    combat: TickManipCombatPolicy;
    /** Gather while Game.inCombat() (retaliate methods). */
    allowCombat: boolean;
    /** Knife + single log between rolls. */
    useKnifeDelay: boolean;
    /** Re-click resource on a fixed native cycle (fly +4, mine pick-rate). */
    timedReclick: boolean;
    /** Empty shortbow + rapid style for WC retaliate. */
    shortbowRapid: boolean;
    /**
     * Expected gather cycle length in ticks when known (server defaults).
     * null = infer only / variable (retaliate, knife compress).
     */
    nativeCycleTicks: number | null;
    /** Farmer willows 6-tick phase machine (tree / cut / drop). */
    farmerWillowCycle: boolean;
    /** Interleave cook+eat during fishing (Tannerfishing). */
    cookEatInterleave: boolean;
    /** May die — same product risk as Location Auto. */
    mayDie: boolean;
}

const OFF_PROFILE = (skill: TickManipSkill): TickManipProfile => ({
    skill,
    method: 'off',
    label: 'Off',
    combat: 'flee',
    allowCombat: false,
    useKnifeDelay: false,
    timedReclick: false,
    shortbowRapid: false,
    nativeCycleTicks: null,
    farmerWillowCycle: false,
    cookEatInterleave: false,
    mayDie: false
});

export function parseFishTickManip(label: string): FishTickManip {
    switch (label.trim().toLowerCase()) {
        case '4t fly reclick':
        case '4t fly':
        case '4t-fly':
            return '4t-fly';
        case 'knife delay (+2)':
        case 'knife delay':
        case 'knife-delay':
        case '3t knife':
            return 'knife-delay';
        case 'tannerfishing':
        case 'tannerfish':
        case 'gnome stronghold':
            return 'tannerfish';
        default:
            return 'off';
    }
}

export function parseMineTickManip(label: string): MineTickManip {
    switch (label.trim().toLowerCase()) {
        case 'iron cadence (pick-aware)':
        case 'iron cadence':
        case '4t iron':
        case '4t-iron':
        case 'iron-cadence':
            return 'iron-cadence';
        default:
            return 'off';
    }
}

export function parseWcTickManip(label: string): WcTickManip {
    switch (label.trim().toLowerCase()) {
        case 'knife delay (+2)':
        case 'knife delay':
        case 'knife-delay':
            return 'knife-delay';
        case '2t retaliate oaks':
        case '2t oaks':
        case '2t-oaks':
            return '2t-oaks';
        case '3t farmer willows':
        case '3t farmer':
        case '3t-farmer':
            return '3t-farmer';
        case '3t willows shortbow rapid':
        case '3t shortbow':
        case '3t-shortbow':
        case 'shortbow rapid':
            return '3t-shortbow';
        default:
            return 'off';
    }
}

export function fishTickManipProfile(method: FishTickManip, label = methodLabel('fish', method)): TickManipProfile {
    switch (method) {
        case '4t-fly':
            return {
                ...OFF_PROFILE('fish'),
                method,
                label,
                timedReclick: true,
                nativeCycleTicks: 4
            };
        case 'knife-delay':
            return {
                ...OFF_PROFILE('fish'),
                method,
                label,
                useKnifeDelay: true,
                // Compress native +4 toward +2 delay arm + reclick.
                nativeCycleTicks: 4
            };
        case 'tannerfish':
            return {
                ...OFF_PROFILE('fish'),
                method,
                label,
                combat: 'retaliate-may-die',
                allowCombat: true,
                cookEatInterleave: true,
                mayDie: true,
                nativeCycleTicks: 4
            };
        default:
            return OFF_PROFILE('fish');
    }
}

export function mineTickManipProfile(method: MineTickManip, label = methodLabel('mine', method)): TickManipProfile {
    switch (method) {
        case 'iron-cadence':
            return {
                ...OFF_PROFILE('mine'),
                method,
                label,
                timedReclick: true,
                // Pick-dependent; caller supplies rate via miningRateForPickaxe.
                nativeCycleTicks: null
            };
        default:
            return OFF_PROFILE('mine');
    }
}

export function wcTickManipProfile(method: WcTickManip, label = methodLabel('wc', method)): TickManipProfile {
    switch (method) {
        case 'knife-delay':
            return {
                ...OFF_PROFILE('wc'),
                method,
                label,
                useKnifeDelay: true,
                nativeCycleTicks: 3
            };
        case '2t-oaks':
            return {
                ...OFF_PROFILE('wc'),
                method,
                label,
                combat: 'retaliate-may-die',
                allowCombat: true,
                mayDie: true,
                nativeCycleTicks: 2
            };
        case '3t-farmer':
            return {
                ...OFF_PROFILE('wc'),
                method,
                label,
                combat: 'retaliate-may-die',
                allowCombat: true,
                farmerWillowCycle: true,
                mayDie: true,
                nativeCycleTicks: 6
            };
        case '3t-shortbow':
            return {
                ...OFF_PROFILE('wc'),
                method,
                label,
                combat: 'retaliate-may-die',
                allowCombat: true,
                shortbowRapid: true,
                mayDie: true,
                nativeCycleTicks: 3
            };
        default:
            return OFF_PROFILE('wc');
    }
}

function methodLabel(skill: TickManipSkill, method: TickManipMethod): string {
    if (method === 'off') {
        return 'Off';
    }
    if (skill === 'fish') {
        return FISH_TICK_MANIP_OPTIONS.find(o => parseFishTickManip(o) === method) ?? method;
    }
    if (skill === 'mine') {
        return MINE_TICK_MANIP_OPTIONS.find(o => parseMineTickManip(o) === method) ?? method;
    }
    return WC_TICK_MANIP_OPTIONS.find(o => parseWcTickManip(o) === method) ?? method;
}

/**
 * UI dropdown options for a skill. When {@link TICK_MANIP_SHIPPED} is false, only Off.
 */
export function tickManipUiOptions(full: readonly string[]): string[] {
    if (TICK_MANIP_SHIPPED) {
        return [...full];
    }
    return ['Off'];
}

export const TICK_MANIP_UNSHIPPED_HELP =
    'Tick methods are not shipped yet (WIP). Leave Off — AFK gather only. Non-Off values in saved settings are ignored.';

/**
 * Resolve a settings label to a runtime profile.
 * When {@link TICK_MANIP_SHIPPED} is false, always Off (ignores label).
 * Unit tests for methods should call the *Profile builders directly.
 */
export function profileForSetting(
    skill: TickManipSkill,
    label: string
): TickManipProfile {
    if (!TICK_MANIP_SHIPPED) {
        return OFF_PROFILE(skill);
    }
    if (skill === 'fish') {
        const m = parseFishTickManip(label);
        return fishTickManipProfile(m, label.trim() || 'Off');
    }
    if (skill === 'mine') {
        const m = parseMineTickManip(label);
        return mineTickManipProfile(m, label.trim() || 'Off');
    }
    const m = parseWcTickManip(label);
    return wcTickManipProfile(m, label.trim() || 'Off');
}

/** Pickaxe mining_rate param from server pickaxes.obj. */
export function miningRateForPickaxe(pickName: string | null | undefined): number {
    const n = (pickName ?? '').toLowerCase();
    if (n.includes('rune')) {
        return 2;
    }
    if (n.includes('adamant')) {
        return 3;
    }
    if (n.includes('mithril')) {
        return 4;
    }
    if (n.includes('steel')) {
        return 5;
    }
    if (n.includes('iron')) {
        return 6;
    }
    if (n.includes('bronze') || n.includes('pickaxe')) {
        return 7;
    }
    // Unknown / bare hands — treat as slow bronze-class.
    return 7;
}

/**
 * After a resource roll (XP / inventory gain) at `rollTick`, when to issue the
 * next primary gather click for a fixed native cycle.
 *
 * Server pattern: set delay = map_clock + N when expired; roll when equal.
 * Re-click on the roll tick (offset 0) or the following tick (offset 1) if the
 * client is a beat late.
 */
export function nextGatherClickTick(rollTick: number, cycleTicks: number, lateSlack = 0): number {
    const c = Math.max(1, Math.floor(cycleTicks));
    const slack = Math.max(0, Math.floor(lateSlack));
    return Math.floor(rollTick) + c + slack;
}

/**
 * Knife-delay phase relative to delay-arm tick `armTick` (Make-1 confirm):
 * - t1 armTick: knife+log + Make-1 → %action_delay = map_clock+2
 * - t2 armTick+1: re-click gather (delay still live)
 * - t3 armTick+2: delay expires → gather roll window
 *
 * Callers often stamp armTick ≈ last gather roll when the bot reacts same-tick.
 */
export type KnifeDelayPhase = 'delay-action' | 'reclick' | 'wait';

export function knifeDelayPhase(nowTick: number, armTick: number): KnifeDelayPhase {
    const now = Math.floor(nowTick);
    const arm = Math.floor(armTick);
    if (now <= arm) {
        return 'delay-action';
    }
    if (now === arm + 1) {
        return 'reclick';
    }
    // Missed the reclick window — re-arm rather than idle.
    if (now > arm + 1) {
        return 'delay-action';
    }
    return 'wait';
}

/**
 * Farmer willows 6-tick cycle (issue): t1 click tree, t5 cut/process log, t6 drop/ground.
 * Phase index is (nowTick - cycleStart) mod 6, where 0 = tick 1 of the cycle.
 */
export type FarmerWillowPhase = 'click-tree' | 'wait' | 'cut-log' | 'drop-log';

export function farmerWillowPhase(nowTick: number, cycleStartTick: number): FarmerWillowPhase {
    const phase = ((Math.floor(nowTick) - Math.floor(cycleStartTick)) % 6 + 6) % 6;
    // t1 → index 0, t5 → index 4, t6 → index 5
    if (phase === 0) {
        return 'click-tree';
    }
    if (phase === 4) {
        return 'cut-log';
    }
    if (phase === 5) {
        return 'drop-log';
    }
    return 'wait';
}

/**
 * Whether combat should break a gather wait/session.
 * When allowCombat is true (retaliate methods), inCombat alone does not yield.
 */
export function combatBreaksGather(inCombat: boolean, allowCombat: boolean): boolean {
    return inCombat && !allowCombat;
}

/** True when name is a fletchable log on this content pack. */
export function isFletchableLogName(name: string | null | undefined): boolean {
    const n = (name ?? '').trim().toLowerCase();
    return FLETCHABLE_LOG_NAMES.some(l => l.toLowerCase() === n);
}

/**
 * Prefer keeping exactly one delay log in the pack.
 * Returns how many logs of `logName` to drop (extras beyond 1).
 */
export function extraDelayLogsToDrop(logCount: number, keep = 1): number {
    const k = Math.max(0, Math.floor(keep));
    const c = Math.max(0, Math.floor(logCount));
    return Math.max(0, c - k);
}

/** Shortbow names suitable for empty-bow rapid retaliate WC. */
export const SHORTBOW_NAMES = [
    'Shortbow',
    'Oak shortbow',
    'Willow shortbow',
    'Maple shortbow',
    'Yew shortbow',
    'Magic shortbow'
] as const;

export function isShortbowName(name: string | null | undefined): boolean {
    const n = (name ?? '').toLowerCase();
    return n.includes('shortbow');
}

/** Eat cooked catch during Tannerfishing when HP fraction is below this. */
export const TANNERFISH_EAT_HP = 0.55;

/** True when Tannerfishing should spend a beat eating cooked fish. */
export function shouldEatForTannerfish(hpFraction: number, hasCooked: boolean): boolean {
    return hasCooked && hpFraction < TANNERFISH_EAT_HP;
}

/**
 * Prefer cooking a raw catch when the pack is getting full or we need food soon.
 * Pure heuristic — caller still needs a Fire/Range in scene.
 */
export function shouldCookForTannerfish(opts: {
    rawCount: number;
    cookedCount: number;
    freeSlots: number;
    hpFraction: number;
}): boolean {
    if (opts.rawCount <= 0) {
        return false;
    }
    // Always cook at least one when we have raw and room is tight.
    if (opts.freeSlots <= 2) {
        return true;
    }
    // Build a small cooked buffer when HP is not full.
    if (opts.cookedCount < 2 && opts.hpFraction < 0.9) {
        return true;
    }
    // Otherwise cook opportunistically when we have several raw.
    return opts.rawCount >= 3 && opts.cookedCount < 4;
}
