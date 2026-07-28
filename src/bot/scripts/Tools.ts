
export interface ToolTier {
    name: string;
    /** Skill level required to *use* the tool (mining / woodcutting). */
    level: number;
    /**
     * Attack level required to *wield* the tool. Classic metal tiers:
     * bronze/iron 1, steel 5, mithril 20, adamant 30, rune 40.
     * Tools may still be used from the backpack without meeting this.
     */
    attackLevel?: number;
}

/**
 * Tool requirement for gathering scripts.
 *
 * - `tiered`: best usable tool from a level-ordered list (axes, pickaxes).
 * - `exact`: a named item (tinderbox, hammer, …).
 *
 * Fishing gear is handled separately in FishingMethods (not equippable in 2004scape).
 */
export type ToolReq =
    | {
          kind: 'tiered';
          skill: string;
          tiers: readonly ToolTier[];
          label: string;
          /** When true, restock/ensure will Wield the best held tier. */
          equip?: boolean;
      }
    | {
          kind: 'exact';
          name: string;
          min?: number;
          restock?: number;
          equip?: boolean;
      };

export const PICKAXES: readonly ToolTier[] = [
    { name: 'Rune pickaxe', level: 41, attackLevel: 40 },
    { name: 'Adamant pickaxe', level: 31, attackLevel: 30 },
    { name: 'Mithril pickaxe', level: 21, attackLevel: 20 },
    { name: 'Steel pickaxe', level: 6, attackLevel: 5 },
    { name: 'Iron pickaxe', level: 1, attackLevel: 1 },
    { name: 'Bronze pickaxe', level: 1, attackLevel: 1 }
];

export const AXES: readonly ToolTier[] = [
    { name: 'Rune axe', level: 41, attackLevel: 40 },
    { name: 'Adamant axe', level: 31, attackLevel: 30 },
    { name: 'Mithril axe', level: 21, attackLevel: 20 },
    { name: 'Steel axe', level: 6, attackLevel: 5 },
    { name: 'Iron axe', level: 1, attackLevel: 1 },
    { name: 'Bronze axe', level: 1, attackLevel: 1 }
];

/** Attack required to wield a named axe/pick (1 when unknown / non-tiered). */
export function toolAttackLevel(name: string): number {
    const want = name.toLowerCase();
    for (const t of PICKAXES) {
        if (t.name.toLowerCase() === want) {
            return t.attackLevel ?? 1;
        }
    }
    for (const t of AXES) {
        if (t.name.toLowerCase() === want) {
            return t.attackLevel ?? 1;
        }
    }
    return 1;
}

/** True when Attack is high enough to wield this tool name. */
export function canWieldTool(name: string, attackLevel: number): boolean {
    return attackLevel >= toolAttackLevel(name);
}

export const TINDERBOX = 'Tinderbox';
export const HAMMER = 'Hammer';
export const KNIFE = 'Knife';
export const CHISEL = 'Chisel';
export const NEEDLE = 'Needle';

export const pickaxeReq = (equip = true): ToolReq => ({
    kind: 'tiered',
    skill: 'mining',
    tiers: PICKAXES,
    label: 'pickaxe',
    equip
});

export const axeReq = (equip = true): ToolReq => ({
    kind: 'tiered',
    skill: 'woodcutting',
    tiers: AXES,
    label: 'axe',
    equip
});

export const exactTool = (name: string, opts: { min?: number; restock?: number; equip?: boolean } = {}): ToolReq => ({
    kind: 'exact',
    name,
    min: opts.min ?? 1,
    restock: opts.restock ?? opts.min ?? 1,
    equip: opts.equip
});

export const tinderboxReq = (): ToolReq => exactTool(TINDERBOX);

/** Best tier the player can use that is also available (inv/bank/worn). Tiers are best-first. */
export function bestFromTiers(
    level: number,
    tiers: readonly ToolTier[],
    available: (name: string) => boolean
): string | null {
    for (const t of tiers) {
        if (level >= t.level && available(t.name)) {
            return t.name;
        }
    }
    return null;
}

export function bestPickaxe(miningLevel: number, available: (name: string) => boolean): string | null {
    return bestFromTiers(miningLevel, PICKAXES, available);
}

export function bestAxe(woodcuttingLevel: number, available: (name: string) => boolean): string | null {
    return bestFromTiers(woodcuttingLevel, AXES, available);
}

export function toolKeepNames(reqs: readonly ToolReq[]): string[] {
    const names: string[] = [];
    for (const r of reqs) {
        if (r.kind === 'tiered') {
            for (const t of r.tiers) {
                names.push(t.name);
            }
        } else {
            names.push(r.name);
        }
    }
    return [...new Set(names)];
}

export function hasToolReq(
    req: ToolReq,
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): boolean {
    if (req.kind === 'tiered') {
        return bestFromTiers(skillLevel(req.skill), req.tiers, n => count(n) > 0) !== null;
    }
    return count(req.name) >= (req.min ?? 1);
}

export function hasAllTools(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): boolean {
    return reqs.every(r => hasToolReq(r, skillLevel, count));
}

export function missingToolLabels(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): string[] {
    const out: string[] = [];
    for (const r of reqs) {
        if (hasToolReq(r, skillLevel, count)) {
            continue;
        }
        out.push(r.kind === 'tiered' ? r.label : r.name);
    }
    return out;
}

export function toolKitLabel(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): string {
    if (reqs.length === 0) {
        return 'gear';
    }
    return reqs
        .map(r => {
            if (r.kind === 'tiered') {
                const held = bestFromTiers(skillLevel(r.skill), r.tiers, n => count(n) > 0);
                return held ?? `${r.label} (bronze→rune)`;
            }
            return r.name;
        })
        .join(' + ');
}

export interface ToolRestockStep {
    name: string;
    qty: number;
    equip: boolean;
}

export function toolRestockPlan(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): ToolRestockStep[] {
    const plan: ToolRestockStep[] = [];
    for (const r of reqs) {
        if (r.kind === 'tiered') {
            const level = skillLevel(r.skill);
            // Prefer the best usable tier across pack + bank (bronze held + steel banked → withdraw steel).
            const bestOwned = bestFromTiers(
                level,
                r.tiers,
                n => invCount(n) > 0 || bankCount(n) > 0
            );
            if (!bestOwned) {
                continue;
            }
            if (invCount(bestOwned) > 0) {
                // Already holding the best we own — nothing to withdraw.
                continue;
            }
            if (bankCount(bestOwned) <= 0) {
                continue;
            }
            plan.push({ name: bestOwned, qty: 1, equip: r.equip === true });
            continue;
        }
        const min = r.min ?? 1;
        const target = r.restock ?? min;
        const have = invCount(r.name);
        const need = target - have;
        if (need <= 0) {
            continue;
        }
        const available = bankCount(r.name);
        if (available <= 0) {
            continue;
        }
        plan.push({ name: r.name, qty: Math.min(need, available), equip: r.equip === true });
    }
    return plan;
}

/**
 * True when the bank holds a strictly better usable tiered tool than the pack/worn set.
 * Requires bank counts (open/loaded bank). Used to decide a one-shot startup bank trip.
 */
export function bankHasBetterGatherTool(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): boolean {
    return toolRestockPlan(reqs, skillLevel, invCount, bankCount).some(step => {
        const req = reqs.find(
            r =>
                r.kind === 'tiered' &&
                r.tiers.some(t => t.name.toLowerCase() === step.name.toLowerCase())
        );
        return req != null && req.kind === 'tiered';
    });
}

/**
 * Names of tools that should be worn right now (held in inv/equip, equip flag set, not yet worn).
 * Empty when nothing needs wielding.
 *
 * Skips tiers the player cannot wield yet (Attack too low). Classic RS still lets you
 * mine/chop with the tool in the backpack, so we must not thrash Wield forever.
 */
export function toolsNeedingEquip(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number,
    worn: (name: string) => boolean
): string[] {
    const attack = skillLevel('attack');
    const out: string[] = [];
    for (const r of reqs) {
        if (r.equip !== true) {
            continue;
        }
        if (r.kind === 'tiered') {
            const best = bestFromTiers(skillLevel(r.skill), r.tiers, n => count(n) > 0);
            if (best && !worn(best) && canWieldTool(best, attack)) {
                out.push(best);
            }
            continue;
        }
        if (count(r.name) > 0 && !worn(r.name) && canWieldTool(r.name, attack)) {
            out.push(r.name);
        }
    }
    return out;
}

/**
 * Best usable tier currently held for each tiered req (plus exact tool names when held).
 * Used as the deposit keep-set so worse axes/picks get banked.
 */
export function bestHeldToolNames(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): string[] {
    const out: string[] = [];
    for (const r of reqs) {
        if (r.kind === 'tiered') {
            const best = bestFromTiers(skillLevel(r.skill), r.tiers, n => count(n) > 0);
            if (best) {
                out.push(best);
            }
            continue;
        }
        if (count(r.name) > 0) {
            out.push(r.name);
        }
    }
    return out;
}

/**
 * Tiered tools held on the player that are worse than the best usable tier we already have.
 * e.g. bronze axe while holding/wearing steel → bronze is surplus.
 */
export function surplusHeldToolNames(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    count: (name: string) => number
): string[] {
    const surplus: string[] = [];
    for (const r of reqs) {
        if (r.kind !== 'tiered') {
            continue;
        }
        const best = bestFromTiers(skillLevel(r.skill), r.tiers, n => count(n) > 0);
        if (!best) {
            continue;
        }
        const bestKey = best.toLowerCase();
        for (const t of r.tiers) {
            if (t.name.toLowerCase() === bestKey) {
                continue;
            }
            if (count(t.name) > 0) {
                surplus.push(t.name);
            }
        }
    }
    return [...new Set(surplus)];
}
