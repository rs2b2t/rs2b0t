import { Navigator } from '../../event/webwalk/Navigator.js';
import { Bank } from '../bank/Bank.js';
import { openBankAccess } from '../bank/Banking.js';
import { nearestBankReachable, type BankLocation } from '../bank/BankLocations.js';
import { TaskBot, type Task } from '../bot/Bot.js';
import { Equipment } from '../equipment/Equipment.js';
import { Execution } from '../execution/Execution.js';
import { Game } from '../game/Game.js';
import { Inventory } from '../inventory/Inventory.js';
import { Traversal } from '../walking/Traversal.js';
import { FIRE_STAVES, NATURE_RUNE, pickFireStaff } from './fireStaves.js';

const BOOTH = { name: 'Bank booth', op: 'Use-quickly' };

export abstract class BankMagicBot extends TaskBot {
    protected bank: BankLocation | null = null;
    protected readonly warningColor?: string;

    abstract openBank(): Promise<boolean>;
    abstract setStatus(status: string, color?: string): void;

    protected get bankAccess() {
        return this.bank?.npcAccess ?? this.bank?.access ?? BOOTH;
    }

    async resolveBank(): Promise<boolean> {
        const here = Game.tile();
        if (!here) return false;
        const bank = await nearestBankReachable(here, Navigator);
        if (!bank) {
            this.log('no reachable bank — stopping');
            this.requestFinish('no reachable bank');
            return false;
        }
        this.bank = bank;
        this.log(`banking at ${bank.name} (${this.bankAccess.name} / ${this.bankAccess.op})`);
        if (bank.tile.level === here.level && bank.tile.distanceTo(here) <= 4) return true;
        this.setStatus(`walking to ${bank.name}`, this.warningColor);
        if (await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: m => this.log(`  ${m}`) })) return true;
        this.log('walk to the bank failed — stopping');
        this.requestFinish('walk to the bank failed');
        return false;
    }

    protected openResolvedBank(): boolean | Promise<boolean> {
        return openBankAccess(this.bank, BOOTH, m => this.log(`  ${m}`));
    }

    async bankTrulyOutOf(...names: string[]): Promise<boolean> {
        return await Bank.waitReady(3500) && names.every(name => Bank.count(name) === 0);
    }

    async closeBankToEquip(item: string): Promise<boolean> {
        if (!(await Bank.close())) {
            this.log('bank would not close — retrying');
            return false;
        }
        await Execution.delayUntil(
            () => !Bank.isOpen() && (Inventory.first(item)?.actions().some(op => /wield|wear|equip/i.test(op)) ?? false),
            3000
        );
        return true;
    }

    protected fireStaffTask(useFireRunes: () => boolean, mustYield = () => false): Task {
        return {
            validate: () => !mustYield() && !useFireRunes() && pickFireStaff(name => Equipment.contains(name)) === undefined,
            execute: () => this.equipFireStaff(mustYield)
        };
    }

    private async equipFireStaff(mustYield: () => boolean): Promise<void> {
        if (!(await this.openBank()) || mustYield()) return;
        if (Inventory.used() > 0) await Bank.depositAllMatching(() => true);

        let staff = pickFireStaff(name => Inventory.count(name) > 0);
        if (!staff) {
            staff = pickFireStaff(name => Bank.count(name) > 0);
            if (staff) this.log(`withdrawing ${staff}`);
            if (!staff || !(await Bank.withdrawX(staff, 1))) {
                if (!(await this.bankTrulyOutOf(...FIRE_STAVES))) {
                    this.log(`withdraw of ${staff ?? 'a fire staff'} stalled but the bank list is still settling — retrying`);
                    return;
                }
                this.log('no fire staff in the bank — stopping');
                this.requestFinish('no fire staff in the bank');
                return;
            }
        }
        if (!(await this.closeBankToEquip(staff)) || mustYield()) return;
        this.setStatus(`wielding ${staff}`, this.warningColor);
        if (!(await Equipment.equip(staff))) {
            this.log(`could not wield ${staff} — stopping`);
            this.requestFinish(`could not wield ${staff}`);
            return;
        }
        this.log(`wore ${staff} — casts need only ${NATURE_RUNE}s now`);
        await this.openBank();
    }
}
