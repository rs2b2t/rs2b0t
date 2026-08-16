import { Game } from '../../api/game/Game.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Execution } from '../../api/execution/Execution.js';
import { Autocast } from '../../api/magic/Autocast.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { ASSERT_BATCH, ASSERT_RETRY_MS, cfg } from './config.js';
import { castsLeft, equipPackProjectiles, rangeLoadout, rangeProjectile, equippedProjectileCount } from './shared.js';
import type { Task } from '../../api/bot/Bot.js';
import type BrimhavenMossGiants from './BrimhavenMossGiants.js';

/** Wield the weapon / equip the ranged projectile stack when missing. */
export class GearEquip implements Task {
    private fails = 0;
    constructor(private bot: BrimhavenMossGiants) {}
    private needWeapon(): boolean {
        if (cfg.style === 'range' && rangeLoadout().thrown) {
            // darts are the projectile stack — handled by needQuiver
            return false;
        }
        return cfg.weapon !== '' && !Equipment.contains(cfg.weapon) && Inventory.first(cfg.weapon) !== null;
    }
    private needQuiver(): boolean {
        if (cfg.style !== 'range') {
            return false;
        }
        const projectile = rangeProjectile();
        return Inventory.count(projectile) > 0 && equippedProjectileCount() === 0;
    }
    validate(): boolean {
        return cfg.style !== 'melee' && this.fails < 5 && (this.needWeapon() || this.needQuiver());
    }
    async execute(): Promise<void> {
        if (this.needWeapon()) {
            this.bot.setStatus(`wielding ${cfg.weapon}`);
            if (await Equipment.equip(cfg.weapon)) {
                this.bot.log(`wielded ${cfg.weapon}`);
                this.fails = 0;
            } else {
                this.fails++;
            }
            return;
        }
        const projectile = rangeProjectile();
        this.bot.setStatus(`equipping ${projectile}`);
        if (await equipPackProjectiles()) {
            this.bot.log(`equipped ${projectile}`);
            this.fails = 0;
        } else {
            this.fails++;
        }
    }
}

/** Select the melee style or ranged combat mode each login (not persisted). */
export class SetAttackStyle implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: BrimhavenMossGiants) {}
    private selected(): boolean {
        return cfg.style === 'range' ? Game.combatMode() === cfg.rangeMode : Game.hasCombatStyle(cfg.meleeStyle);
    }
    validate(): boolean {
        return cfg.style !== 'mage' && !this.selected() && Date.now() >= this.retryAt;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('setting combat style');
        if (cfg.style === 'range') {
            Game.setCombatMode(cfg.rangeMode);
        } else {
            Game.setCombatStyle(cfg.meleeStyle);
        }
        if (await Execution.delayUntil(() => this.selected(), 3000)) {
            this.fails = 0;
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`could not set the ${cfg.style} attack style (combat tab not ready?) — retrying in ${ASSERT_RETRY_MS / 1000}s`);
        }
    }
}

/** Arm the autocast spell once a staff is equipped and casts remain. */
export class ArmAutocast implements Task {
    private fails = 0;
    private retryAt = 0;
    constructor(private bot: BrimhavenMossGiants) {}
    validate(): boolean {
        if (cfg.style !== 'mage' || Autocast.armed() || Date.now() < this.retryAt) {
            return false;
        }
        if (castsLeft() < 1) {
            return false;
        }
        return Autocast.staffTabAttached() || (cfg.weapon !== '' && Equipment.contains(cfg.weapon));
    }
    async execute(): Promise<void> {
        this.bot.setStatus(`arming autocast: ${cfg.spell}`);
        await Execution.delayTicks(3);
        if (await Autocast.arm(cfg.spell, m => this.bot.log(m))) {
            this.fails = 0;
        } else if (++this.fails >= ASSERT_BATCH) {
            this.fails = 0;
            this.retryAt = Date.now() + ASSERT_RETRY_MS;
            this.bot.log(`WARNING: could not arm autocast for '${cfg.spell}' — retrying in ${ASSERT_RETRY_MS / 1000}s (check spell/level/staff).`);
        }
    }
}
