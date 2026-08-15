import { Bank } from '../../api/bank/Bank.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { openBankLeg } from '../../api/ai/quests/exec/steps.js';
import { Modals } from '../../api/ui/widgets/Modals.js';
import { CURATOR, KATRINE_HANDIN, KATRINE_JOIN, SOA_ID, SOA_TILE, TRAMP } from '../../api/ai/quests/defs/shieldofarrav/areas.js';
import { raidWeaponStore, takeBlackArmHalf } from '../../api/ai/quests/defs/shieldofarrav/blackarm.js';
import { ArravConfig } from '../../api/ai/quests/defs/shieldofarrav/config.js';
import { enterHideout, walkAndTalk } from '../../api/ai/quests/defs/shieldofarrav/hideout.js';
import { killJonny, takePhoenixHalf } from '../../api/ai/quests/defs/shieldofarrav/phoenix.js';
import { runHandoff } from '../../api/ai/quests/defs/shieldofarrav/partner.js';
import { driveChoice } from '../../api/ai/quests/exec/prompts.js';
import { supplierPhase, type SupplierPhase, type SupplierState } from './ArravSupplierLogic.js';

// Why: a supplier is not a quest. Redeeming would set %phoenixgang to complete, which seals the chest and stops the curator, so it must never reach King Roald — and a QuestModule that never turns its journal green would be re-picked by the engine forever.
// Why: the dual-gang state exists because [opnpcu,straven] is missing the %blackarmgang guard that [opnpc1,straven] and the hideout door both carry.

const STRAVEN_NPC = 644;
const BANK = SOA_TILE.RENDEZVOUS;

export const ARRAV_SUPPLIER_SETTINGS: SettingsSchema = {
    certTarget: {
        type: 'number',
        default: 10,
        min: 2,
        max: 200,
        label: 'Certificates to bank',
        help: 'stop once the bank holds this many; each pair costs one trip to each hideout'
    },
    partner: {
        type: 'string',
        default: '',
        label: 'Bootstrap key partner',
        help: 'character name of a Phoenix Gang bot that can trade over a weapon-store key; only needed once'
    }
};

/** Mints Shield of Arrav certificates forever from one dual-gang account. */
export default class ArravSupplier extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private phase: SupplierPhase = 'await-key';
    private banked = 0;
    private minted = 0;
    private failures = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        ArravConfig.partner = this.settings.str('partner', '').trim();
        this.log(`ArravSupplier — banking ${this.certTarget()} certificates, never redeeming`);
    }

    private certTarget(): number {
        return Math.max(2, Math.floor(this.settings.num('certTarget', 10)));
    }

    /** The journal is blank for a dual-gang character, so every field is an item or a door's own refusal. */
    private async readState(): Promise<SupplierState> {
        return {
            inBlackArm: await this.canOpenBlackArmDoor(),
            inPhoenix: await this.canOpenPhoenixDoor(),
            hasKey: Inventory.countById(SOA_ID.STORE_KEY) > 0,
            hasReport: Inventory.countById(SOA_ID.REPORT) > 0,
            crossbows: Inventory.countById(SOA_ID.CROSSBOW),
            phoenixHalf: Inventory.countById(SOA_ID.SHIELD_PHOENIX),
            blackarmHalf: Inventory.countById(SOA_ID.SHIELD_BLACKARM),
            certsBanked: this.banked,
            certTarget: this.certTarget()
        };
    }

    // Why: membership is a server varp the client cannot read, so the proof is having been through the door.
    private blackArmProven = false;
    private phoenixProven = false;

    private async canOpenBlackArmDoor(): Promise<boolean> {
        return this.blackArmProven;
    }

    private async canOpenPhoenixDoor(): Promise<boolean> {
        return this.phoenixProven;
    }

    override async loop(): Promise<number | void> {
        if (!Game.ingame()) {
            return 1200;
        }
        await this.refreshBanked();

        const state = await this.readState();
        this.phase = supplierPhase(state);
        this.status = this.phase;

        if (this.phase === 'done') {
            ScriptRunner.stop(`banked ${this.banked} certificates — stock is ready for other bots`);
            return;
        }

        const ok = await this.runPhase(this.phase);
        this.failures = ok ? 0 : this.failures + 1;
        if (this.failures >= 8) {
            ScriptRunner.stop(`'${this.phase}' failed 8 times in a row — stopping rather than looping`);
            return;
        }
        return ok ? 600 : 2400;
    }

    private async runPhase(phase: SupplierPhase): Promise<boolean> {
        const log = (m: string): void => this.log(`  ${m}`);
        switch (phase) {
            case 'await-key':
                if (ArravConfig.partner.length === 0) {
                    this.log('no bootstrap partner set — a weapon-store key can only come from a Phoenix Gang member');
                    return false;
                }
                return runHandoff('take-key', 'blackarm', log);

            case 'raid-store':
                if (!(await this.ensureKatrineTask(log))) {
                    return false;
                }
                return raidWeaponStore(log);

            case 'join-blackarm':
                if (!(await walkAndTalk(KATRINE_HANDIN, [], log))) {
                    return false;
                }
                this.blackArmProven = Inventory.countById(SOA_ID.CROSSBOW) === 0;
                return this.blackArmProven;

            case 'kill-jonny':
                return killJonny(log);

            case 'join-phoenix':
                return this.joinPhoenixWithReport(log);

            case 'take-phoenix-half':
                return takePhoenixHalf(log);

            case 'take-blackarm-half':
                return takeBlackArmHalf(log);

            case 'mint':
                return this.mint(log);

            default:
                return false;
        }
    }

    /** Tramp then Katrine, so the crossbow task is set before the store is raided. */
    private async ensureKatrineTask(log: (m: string) => void): Promise<boolean> {
        if (this.blackArmProven) {
            return true;
        }
        await walkAndTalk(TRAMP, TRAMP.prefer, log);
        await walkAndTalk(KATRINE_JOIN, KATRINE_JOIN.prefer, log);
        return true;
    }

    // Why: [opnpc1,straven] sends a Black Arm member to the brush-off branch; only [opnpcu,straven] reaches the join.

    /** Use the intelligence report on Straven rather than talking to him. */
    private async joinPhoenixWithReport(log: (m: string) => void): Promise<boolean> {
        if (!(await enterHideout(log))) {
            return false;
        }
        if (!(await Traversal.walkResilient(SOA_TILE.PHOENIX_DOOR, { radius: 3, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const straven = Npcs.query().where(n => n.id === STRAVEN_NPC).nearest();
        const report = Inventory.items().find(i => i.id === SOA_ID.REPORT);
        if (!straven || !report) {
            log('no Straven in the scene, or no report in the pack');
            return false;
        }
        if (!(await report.useOn(straven))) {
            return false;
        }
        await driveChoice([], log);
        this.phoenixProven = Inventory.countById(SOA_ID.REPORT) === 0
            && Inventory.countById(SOA_ID.STORE_KEY) > 0;
        if (!this.phoenixProven) {
            log('Straven did not take the report — the dual-gang join did not land');
        }
        return this.phoenixProven;
    }

    private async mint(log: (m: string) => void): Promise<boolean> {
        const before = Inventory.countById(SOA_ID.CERTIFICATE);
        if (!(await walkAndTalk(CURATOR, [], log))) {
            return false;
        }
        await Modals.close();
        const gained = Inventory.countById(SOA_ID.CERTIFICATE) - before;
        if (gained <= 0) {
            log('the curator minted nothing — check that neither gang varp has gone complete');
            return false;
        }
        this.minted += gained;
        return this.bankCertificates(log);
    }

    private async bankCertificates(log: (m: string) => void): Promise<boolean> {
        if (!(await openBankLeg('supplier: no known bank', BANK, log))) {
            return false;
        }
        await Bank.depositAllMatching((_name, id) => id === SOA_ID.CERTIFICATE);
        await this.refreshBanked(true);
        await Modals.close();
        this.log(`banked certificates: ${this.banked}/${this.certTarget()}`);
        return true;
    }

    private async refreshBanked(force = false): Promise<void> {
        if (!Bank.isOpen()) {
            return;
        }
        if (force) {
            await Execution.delayUntil(() => Bank.loaded(), 3000);
        }
        if (Bank.loaded()) {
            this.banked = Bank.countById(SOA_ID.CERTIFICATE);
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.phase === 'done' ? '#9be05b' : '#6cb6ff' });
        p.title(`ArravSupplier — ${this.status}`);
        p.bar('Certificates banked', this.banked / this.certTarget(), '#6cb6ff');
        p.row(`Banked: ${this.banked}/${this.certTarget()}`, `Minted: ${this.minted}`);
        p.row(`Black Arm: ${this.blackArmProven ? 'yes' : 'no'}`, `Phoenix: ${this.phoenixProven ? 'yes' : 'no'}`);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
