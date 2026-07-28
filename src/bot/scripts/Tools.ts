/**
 * Shared tool kit for scripts — ladders (bronze→rune) and simple tools
 * (tinderbox, hammer, knife, …). Scripts declare a ToolReq[] once; has /
 * missing / keep / restock all flow from that list so GatheringBot and
 * friends don't grow a special-case per item.
 */

/** One rung on a metal ladder (best-first, level-descending). */
export interface ToolTier {
    name: string;
    level: number;
}

/**
 * A required tool or consumable.
 * - ladder: any one tier the player can use (pickaxe, axe)
 * - exact: a named item (tinderbox, hammer, bait stack)
 */
export type ToolReq =
    | {
          kind: 'ladder';
          /** Skill whose level gates the ladder (mining / woodcutting). */
          skill: string;
          ladder: readonly ToolTier[];
          /** Human label when nothing is held ("pickaxe", "axe"). */
          label: string;
          /** Try to equip after withdraw (picks/axes). */
          equip?: boolean;
      }
    | {
          kind: 'exact';
          name: string;
          /** Minimum count required to continue. Default 1. */
          min?: number;
          /** Target count when restocking. Default = min (tools) or a stack. */
          restock?: number;
          equip?: boolean;
      };

export const PICKAXES: readonly ToolTier[] = [
    { name: 'Rune pickaxe', level: 41 },
    { name: 'Adamant pickaxe', level: 31 },
    { name: 'Mithril pickaxe', level: 21 },
    { name: 'Steel pickaxe', level: 6 },
    { name: 'Iron pickaxe', level: 1 },
    { name: 'Bronze pickaxe', level: 1 }
];

/** Classic bronze→rune woodcutting axes (same level gates as pickaxes in this era). */
export const AXES: readonly ToolTier[] = [
    { name: 'Rune axe', level: 41 },
    { name: 'Adamant axe', level: 31 },
    { name: 'Mithril axe', level: 21 },
    { name: 'Steel axe', level: 6 },
    { name: 'Iron axe', level: 1 },
    { name: 'Bronze axe', level: 1 }
];

/** Common exact tools — import these instead of stringly-typed literals. */
export const TINDERBOX = 'Tinderbox';
export const HAMMER = 'Hammer';
export const KNIFE = 'Knife';
export const CHISEL = 'Chisel';
export const NEEDLE = 'Needle';

export const pickaxeReq = (equip = true): ToolReq => ({
    kind: 'ladder',
    skill: 'mining',
    ladder: PICKAXES,
    label: 'pickaxe',
    equip
});

export const axeReq = (equip = true): ToolReq => ({
    kind: 'ladder',
    skill: 'woodcutting',
    ladder: AXES,
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

/** Best tier the player can use from those currently available. */
export function bestFromLadder(
    level: number,
    ladder: readonly ToolTier[],
    available: (name: string) => boolean
): string | null {
    for (const t of ladder) {
        if (level >= t.level && available(t.name)) {
            return t.name;
        }
    }
    return null;
}

export function bestPickaxe(miningLevel: number, available: (name: string) => boolean): string | null {
    return bestFromLadder(miningLevel, PICKAXES, available);
}

export function bestAxe(woodcuttingLevel: number, available: (name: string) => boolean): string | null {
    return bestFromLadder(woodcuttingLevel, AXES, available);
}

/** Every concrete item name a req might keep (full ladder or the exact name). */
export function toolKeepNames(reqs: readonly ToolReq[]): string[] {
    const names: string[] = [];
    for (const r of reqs) {
        if (r.kind === 'ladder') {
            for (const t of r.ladder) {
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
    /** Count held in pack (and worn, if the caller folds equipment in). */
    count: (name: string) => number
): boolean {
    if (req.kind === 'ladder') {
        return bestFromLadder(skillLevel(req.skill), req.ladder, n => count(n) > 0) !== null;
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

/** Short labels / names still missing (for status paint). */
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
        out.push(r.kind === 'ladder' ? r.label : r.name);
    }
    return out;
}

/** Human-readable gear line: held best tier, or "label (bronze→rune)" / exact name. */
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
            if (r.kind === 'ladder') {
                const held = bestFromLadder(skillLevel(r.skill), r.ladder, n => count(n) > 0);
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

/**
 * What to withdraw so the kit is satisfied.
 * Ladders pick the best banked tier the skill allows; exact tools top up to restock.
 */
export function toolRestockPlan(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): ToolRestockStep[] {
    const plan: ToolRestockStep[] = [];
    for (const r of reqs) {
        if (r.kind === 'ladder') {
            if (hasToolReq(r, skillLevel, invCount)) {
                continue;
            }
            const best = bestFromLadder(skillLevel(r.skill), r.ladder, n => bankCount(n) > 0);
            if (!best) {
                continue;
            }
            plan.push({ name: best, qty: 1, equip: r.equip === true });
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

/** Best banked ladder tool for a kit (first ladder req only — mining/wc restock). */
export function bestBankedLadderTool(
    reqs: readonly ToolReq[],
    skillLevel: (skill: string) => number,
    bankCount: (name: string) => number
): string | null {
    for (const r of reqs) {
        if (r.kind === 'ladder') {
            return bestFromLadder(skillLevel(r.skill), r.ladder, n => bankCount(n) > 0);
        }
    }
    return null;
}
