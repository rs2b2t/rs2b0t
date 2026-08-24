import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs, type Npc } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { combatKeepNames } from '../../api/combat/keepList.js';
import { castsAvailable } from '../../api/combat/CombatStyleLogic.js';
import { foodForms, foodCount as foodCountIn, foodHealAmount, shouldEatToUseFood } from '../../api/combat/food.js';
import { rangeLoadoutOf, rangeSupplyEmpty } from '../../api/combat/ranged.js';
import Tile from '../../geometry/Tile.js';
import { cfg, FIELD_RADIUS, HUNT_RADIUS, TARGET } from './config.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

// ── Health / food ──────────────────────────────────────────────────────────

export function hpFrac(): number {
    return Skills.hpFraction();
}

export function primaryFoodCount(): number {
    return foodCountIn(Inventory.items(), cfg.foodName);
}

export function cakeCount(): number {
    return cfg.cake ? Inventory.items().filter(i => (i.name ?? '').toLowerCase() === 'slice of cake').length : 0;
}

export function foodCount(): number {
    // Cake counts as food for "do we have anything to eat" / loot-space checks.
    return primaryFoodCount() + cakeCount();
}

export function hasFood(): boolean {
    return foodCount() > 0;
}

export function needEat(): boolean {
    if (!hasFood()) {
        return false;
    }
    const hp = Skills.effective('hitpoints');
    const maxHp = Skills.level('hitpoints');
    if (primaryFoodCount() > 0 && shouldEatToUseFood({ hp, maxHp, heal: foodHealAmount(cfg.foodName), foodCount: primaryFoodCount() })) {
        return true;
    }
    return cakeCount() > 0 && shouldEatToUseFood({ hp, maxHp, heal: foodHealAmount('slice of cake'), foodCount: cakeCount() });
}

/** Full pack, food and loot on the ground: free a slot instead of banking early. */
export function needEatForLoot(): boolean {
    return Inventory.isFull() && hasFood() && findLoot() !== null;
}

export function shouldEatNow(): boolean {
    return needEat() || needEatForLoot();
}

export async function eatOnce(bot: BrimhavenMossGiants, forLoot = false): Promise<boolean> {
    const hp = Skills.effective('hitpoints');
    const maxHp = Skills.level('hitpoints');
    const primary = Inventory.items().find(i => foodForms(cfg.foodName).includes((i.name ?? '').toLowerCase()));
    const cake = cfg.cake ? Inventory.items().find(i => (i.name ?? '').toLowerCase() === 'slice of cake') : null;
    // Prefer the selected food when a full heal fits; otherwise fall back to cake or any food (e.g. to free a slot).
    let food: ReturnType<typeof Inventory.items>[number] | null = null;
    if (primary && shouldEatToUseFood({ hp, maxHp, heal: foodHealAmount(cfg.foodName), foodCount: primaryFoodCount() })) {
        food = primary;
    } else if (cake) {
        food = cake;
    } else if (primary) {
        food = primary;
    }
    if (!food) {
        return false;
    }
    bot.setStatus(
        forLoot
            ? `eating ${food.name} for a free slot`
            : `eating ${food.name} (${Math.round(hpFrac() * 100)}% hp)`
    );
    const beforeHp = Skills.effective('hitpoints');
    const beforeUsed = Inventory.used();
    await food.interact('Eat');
    // HP may not rise when already full; a free inventory slot is the space-eat signal.
    return Execution.delayUntil(
        () => Skills.effective('hitpoints') > beforeHp || Inventory.used() < beforeUsed,
        3000
    );
}

// ── Style / supply checks ───────────────────────────────────────────────────

export function wieldedNames(): string[] {
    return Equipment.items().map(i => i.name ?? '');
}

export function castsLeft(): number {
    return castsAvailable(cfg.spell, wieldedNames(), rune => Inventory.count(rune));
}

export function rangeLoadout() {
    return rangeLoadoutOf(cfg.weapon, cfg.ammo);
}

export function rangeProjectile(): string {
    return rangeLoadout().projectile;
}

export function equippedProjectileCount(): number {
    const projectile = rangeProjectile().toLowerCase();
    return Equipment.items().find(i => (i.name ?? '').toLowerCase() === projectile)?.count ?? 0;
}

export function needStyleSupplies(): boolean {
    if (cfg.style === 'mage') {
        return castsLeft() < 1;
    }
    if (cfg.style === 'range') {
        const projectile = rangeProjectile();
        return rangeSupplyEmpty(equippedProjectileCount(), Inventory.count(projectile), 0);
    }
    return false;
}

export async function equipPackProjectiles(): Promise<boolean> {
    const projectile = rangeProjectile();
    const item = Inventory.first(projectile);
    if (!item) {
        return true;
    }
    const op = item.actions().find(o => /wield|wear|equip/i.test(o));
    if (!op) {
        return false;
    }
    const before = Inventory.count(projectile);
    await item.interact(op);
    return Execution.delayUntil(() => Inventory.count(projectile) < before, 3000);
}

// ── Field / target queries ──────────────────────────────────────────────────

/** Brimhaven is multicombat with the safespot disabled, so never stand on a tile. */
export function usesSafespot(): boolean {
    return false;
}

export function inField(tile: Tile): boolean {
    return cfg.fieldTile.distanceTo(tile) <= FIELD_RADIUS;
}

/** Within the larger roaming/hunt area (used so the bot will walk to distant giants). */
export function inHunt(tile: Tile): boolean {
    return cfg.fieldTile.distanceTo(tile) <= HUNT_RADIUS;
}

export function atField(): boolean {
    const here = Game.tile();
    return here !== null && cfg.fieldTile.distanceTo(new Tile(here.x, here.z, here.level)) <= FIELD_RADIUS;
}

/** Giants at the field (for "are we fighting at the spot" checks). */
export function fieldGiants(): Npc[] {
    return Npcs.query()
        .name(TARGET)
        .where(n => inField(n.tile()) && !n.targetsAnotherPlayer())
        .results();
}

/** All moss giants within the hunt radius, the ones the bot walks to and engages. */
export function huntGiants(): Npc[] {
    return Npcs.query()
        .name(TARGET)
        .where(n => inHunt(n.tile()) && !n.targetsAnotherPlayer())
        .results();
}

// ── Loot queries ────────────────────────────────────────────────────────────

export function findLoot() {
    return GroundItems.query()
        .where(g => {
            const name = (g.name ?? '').toLowerCase();
            // Arrows and bolts dropped by the target, only when the loot-ammo option is on.
            const lootAmmo = cfg.lootAmmo && cfg.style === 'range' && name === rangeProjectile().toLowerCase();
            // Cake is only ever grabbed while looting (its own phase), so no extra gate is needed here.
            // Why: common bank junk such as beer, kebab and gems is a banking concern rather than a loot one.
            return (
                cfg.lootSet.has(name) ||
                (cfg.cake && name === 'slice of cake' && cakeCount() < 2) ||
                lootAmmo
            );
        })
        .within(HUNT_RADIUS)
        .nearest();
}

export function keepNames(): string[] {
    const projectile = cfg.style === 'range' ? rangeProjectile() : cfg.ammo;
    const weapon = cfg.style === 'range' && rangeLoadout().thrown ? projectile : cfg.weapon;
    const extra = cfg.cake ? ['Coins', 'slice of cake'] : ['Coins'];
    return combatKeepNames({ food: cfg.foodName, style: cfg.style, spell: cfg.spell, ammo: cfg.lootAmmo ? projectile : '', weapon, extra });
}

// ── Travel ────────────────────────────────────────────────────────────────

/** Walk to the Brimhaven field (crosses the Ardougne↔Brimhaven boat as needed). */
export async function walkToField(bot: BrimhavenMossGiants): Promise<boolean> {
    bot.setStatus('walking to the Brimhaven moss giants');
    bot.log(`not at the field (${Game.tile()?.x ?? '?'},${Game.tile()?.z ?? '?'}) — walking to ${cfg.fieldTile}`);
    return Traversal.walkResilient(cfg.fieldTile, { radius: usesSafespot() ? 0 : 3, attempts: 6, timeoutMs: 300_000, log: m => bot.log(`  ${m}`) });
}
