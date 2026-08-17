import { TaskBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import Tile from '../../geometry/Tile.js';
import { DeathRecovery } from '../../api/tasks/DeathRecovery.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Skills } from '../../api/skills/Skills.js';
import { parseCombatStyle, parseRangeStyle } from '../../api/combat/CombatStyle.js';
import { rangeLoadoutOf } from '../../api/combat/ranged.js';
import { cfg, FIELD_TILE, BANK_TILE, TARGET, type CombatStyle } from './config.js';
import { DEFAULT_LOOT } from './settings.js';
import { Fight } from './attack.js';
import { Eat, LootCorpse, BuryBones } from './loot.js';
import { GearEquip, SetAttackStyle, ArmAutocast } from './combat.js';
import { Banking } from './bank.js';
import { TravelToField } from './travel.js';
import { PhaseDirector } from './phase.js';
import { paintBrimhaven } from './paint.js';
export { SETTINGS } from './settings.js';

const XP_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer'];

export default class BrimhavenMossGiants extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private killsTotal = 0;
    private looted = 0;
    private buriedTotal = 0;
    private bankTripsCount = 0;
    private startedAt = Date.now();
    private xpAtStartVal = 0;
    private lootCountsMap = new Map<string, number>();
    private supplyEmpty = false;
    private bankEmpty = false;

    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        Game.setAutoRetaliate(true); // Why: this script drives the fight, so ensure auto-retaliate is on at start

        cfg.style = (this.settings.str('combatStyle', 'melee') as CombatStyle);
        cfg.meleeStyle = parseCombatStyle(this.settings.str('meleeStyle', 'strength'));
        cfg.rangeMode = parseRangeStyle(this.settings.str('rangeStyle', 'rapid'));
        cfg.spell = this.settings.str('spell', 'Wind Strike');
        cfg.ammo = this.settings.str('ammo', 'Iron arrow');
        cfg.weapon = cfg.style === 'mage' ? this.settings.str('staff', 'Staff of air')
            : cfg.style === 'range' ? this.settings.str('bow', 'Maple shortbow') : '';
        cfg.foodName = this.settings.str('food', 'Lobster');

        cfg.panicHp = this.settings.num('panicHp', 25) / 100;
        cfg.runesWithdraw = this.settings.num('runesWithdraw', 150);
        cfg.ammoWithdraw = this.settings.num('ammoWithdraw', 500);
        cfg.foodWithdraw = this.settings.num('foodWithdraw', 20);
        cfg.lootSet = new Set(this.settings.list('loot', DEFAULT_LOOT).map(s => s.toLowerCase()));
        cfg.bankCommon = this.settings.bool('bankCommonJunk', true);
        cfg.buryBones = this.settings.bool('buryBones', false);
        if (cfg.buryBones) {
            cfg.lootSet.add('big bones');
        }
        cfg.cake = this.settings.bool('lootCake', false);
        cfg.lootAmmo = this.settings.bool('lootAmmo', true);
        cfg.fieldTile = this.settings.tile('fieldTile', FIELD_TILE);
        cfg.bankTile = this.settings.tile('bankTile', BANK_TILE);

        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.startedAt = Date.now();
        this.xpAtStartVal = XP_SKILLS.reduce((n, sk) => n + Skills.xp(sk), 0);

        const loadout = rangeLoadoutOf(cfg.weapon, cfg.ammo);
        const rangeNote =
            cfg.style === 'range'
                ? loadout.thrown
                    ? ` darts '${loadout.projectile}'`
                    : ` bow '${loadout.weapon}' + '${loadout.projectile}'`
                : '';
        this.log(
            `BrimhavenMossGiants — style ${cfg.style}${cfg.style === 'mage' ? ` w/ ${cfg.weapon} (${cfg.spell})` : rangeNote}${cfg.style === 'melee' ? ` (${cfg.meleeStyle})` : ''}, food '${cfg.foodName}' (smart-eat, panic<${Math.round(cfg.panicHp * 100)}%), field ${cfg.fieldTile}, bank ${cfg.bankTile} (Ardougne↔Brimhaven boat)${cfg.buryBones ? ', burying big bones' : ''}`
        );

        this.add(
            new PhaseDirector(this),
            new ContinueDialog(),
            new DeathRecovery(this, {
                anchor: cfg.fieldTile,
                radius: 6,
                onDeath: () => { this.setStatus('died — recovering'); this.log('died! recovering'); },
                onRecovered: () => { this.died = false; }
            }),
            new Eat(this),
            new GearEquip(this),
            new SetAttackStyle(this),
            new ArmAutocast(this),
            new BuryBones(this),
            new Banking(this),
            new LootCorpse(this),
            new TravelToField(this),
            new Fight(this)
        );
    }

    override recoveryAnchor(): Tile | null {
        return cfg.fieldTile;
    }
    override grindTargets(): string[] {
        return [TARGET.toLowerCase()];
    }

    // ── Status / counters (consumed by tasks + paint) ───────────────────────

    setStatus(s: string): void {
        this.status = s;
    }
    statusText(): string {
        return this.status;
    }
    countKill(): void {
        this.killsTotal++;
    }
    kills(): number {
        return this.killsTotal;
    }
    countLoot(name?: string | null): void {
        this.looted++;
        if (name) {
            this.lootCountsMap.set(name, (this.lootCountsMap.get(name) ?? 0) + 1);
        }
    }
    lootedCount(): number {
        return this.looted;
    }
    countBurial(): void {
        this.buriedTotal++;
    }
    buriedCount(): number {
        return this.buriedTotal;
    }
    countBankTrip(): void {
        this.bankTripsCount++;
    }
    bankTrips(): number {
        return this.bankTripsCount;
    }
    lootCounts(): Map<string, number> {
        return this.lootCountsMap;
    }
    noteSupplyEmpty(v: boolean): void {
        this.supplyEmpty = v;
    }
    supplyKnownEmpty(): boolean {
        return this.supplyEmpty;
    }
    noteBankEmpty(v: boolean): void {
        this.bankEmpty = v;
    }
    bankKnownEmpty(): boolean {
        return this.bankEmpty;
    }
    startedAtMs(): number {
        return this.startedAt;
    }
    xpAtStart(): number {
        return this.xpAtStartVal;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        paintBrimhaven(ctx, this);
    }
}
