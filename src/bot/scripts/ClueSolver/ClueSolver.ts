import { foodHealAmount, shouldEatToUseFood } from '../../api/combat/food.js';
import { TaskBot } from '../../api/bot/Bot.js';
import type { Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { Sustain } from '../../api/sustain/Sustain.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Paint } from '../../paint/Paint.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import { Bank } from '../../api/bank/Bank.js';
import { depositAllExcept } from '../../api/bank/bankRules.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { SPADE_NAME, TRIO } from '../../api/ai/clues/data/toolAcquire.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { ClueExecutor } from '../../api/ai/clues/ClueExecutor.js';
import { paintClueProgress } from '../../api/ai/clues/cluePaint.js';
import { SolveClue, heldClueLikeId } from '../../api/ai/clues/SolveClue.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { scriptFood } from '../../api/loadout/loadoutPlan.js';
import { LOADOUT_SETTING } from '../../api/loadout/loadoutSetting.js';

export const SETTINGS: SettingsSchema = {
    loadout: LOADOUT_SETTING,
    foodWithdraw: { type: 'number', default: 8, min: 1, max: 27, label: 'Food to withdraw' },

    restorePrayer: { type: 'boolean', default: true, label: 'Top up prayer between trails', help: 'prays at the nearest altar after the bank stop; hard dig guardians are fought under Protect from Magic' },
    useTeleports: { type: 'boolean', default: true, label: 'Use teleports', help: 'routes long legs through spell teleports and the ring of dueling, and stocks the runes at the bank stop' }
};

export default class ClueSolver extends TaskBot {
    override loopDelay = 600;

    private status = 'waiting for a clue';
    private solved = 0;
    private solveClue: SolveClue | undefined;
    private returnToBank = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const food = scriptFood(this.settings, '');
        const foodPat = food.toLowerCase();
        this.solveClue = new SolveClue({
            log: m => this.log(m),
            setStatus: s => {
                if (s === 'clue solved') {
                    this.solved++;
                    this.returnToBank = true;
                }
                this.setStatus(s);
            },
            isFood: name => foodPat !== '' && (name ?? '').toLowerCase().includes(foodPat),
            foodName: () => food,
            foodWithdraw: () => this.settings.num('foodWithdraw', 8),
            weaponName: () => this.settings.str('weapon', ''),
            restorePrayer: () => this.settings.bool('restorePrayer', true),
            useTeleports: () => this.settings.bool('useTeleports', true)
        });

        ClueExecutor.setTeleports(this.settings.bool('useTeleports', true));

        const isFood = (name: string | null | undefined): boolean => foodPat !== '' && (name ?? '').toLowerCase().includes(foodPat);
        Sustain.set(async () => {
            if (foodPat === '') {
                return;
            }
            const held = Inventory.items().filter(i => isFood(i.name)).length;
            if (!shouldEatToUseFood({
                hp: Skills.effective('hitpoints'),
                maxHp: Skills.level('hitpoints'),
                heal: foodHealAmount(food),
                foodCount: held
            })) {
                return;
            }
            const bite = Inventory.items().find(i => isFood(i.name));
            if (!bite) {
                return;
            }
            this.log(`eating ${bite.name} (${Math.round(Skills.hpFraction() * 100)}% hp)`);
            const before = Skills.effective('hitpoints');
            await bite.interact('Eat');
            await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
        });

        const bankReturn: Task = {
            validate: () => this.returnToBank && heldClueLikeId() === null && Game.tile() !== null,
            execute: async () => {
                const here = Game.tile()!;
                const bank = nearestBank(here);
                if (!bank) {
                    this.log('[clue] no known bank on this level to return to — idling here');
                    this.returnToBank = false;
                    this.setStatus('waiting for a clue');
                    return;
                }
                if (Math.max(Math.abs(bank.tile.x - here.x), Math.abs(bank.tile.z - here.z)) > 3) {
                    this.setStatus(`returning to the ${bank.name} bank`);
                    this.log(`[clue] trail done — returning to the ${bank.name} bank (${bank.tile})`);
                    if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.log(`  ${m}`) }))) {
                        this.log('[clue] walk to the bank failed — idling here');
                        this.returnToBank = false;
                        this.setStatus('waiting for a clue');
                        return;
                    }
                }
                // Why: the casket reward has to go in, or the bot stands on the booth holding the trail's loot until the next trail's prep deposits it.
                await this.depositTrailLoot();
                this.returnToBank = false;
                this.setStatus('waiting for a clue');
            }
        };

        this.log(`ClueSolver — watching the pack for easy clue scrolls/caskets${food ? `, food '${food}'` : ', foodless'}`);
        this.add(new ContinueDialog(), this.solveClue, bankReturn);
    }

    setStatus(s: string): void {
        this.status = s;
    }

    /** Bank the casket reward, keeping only what the next trail runs on. */
    private async depositTrailLoot(): Promise<void> {
        if (!(await Bank.openNearestAccess({ name: 'Bank booth', op: 'Use-quickly' }, m => this.log(`  ${m}`)))) {
            this.log('[clue] could not open the bank to store the reward');
            return;
        }
        const keep = [
            scriptFood(this.settings, ''),
            this.settings.str('weapon', ''),
            SPADE_NAME,
            ...TRIO,
            'Coins',
            'Air rune',
            'Water rune',
            'Earth rune',
            'Fire rune',
            'Law rune'
        ].filter(n => n !== '');
        const before = Inventory.used();
        await Bank.depositAllMatching(depositAllExcept(keep), m => this.log(`  ${m}`));
        this.log(`[clue] banked the reward (${before} → ${Inventory.used()} slots used)`);
        await Bank.close();
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const held = heldClueLikeId();
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e8c35b' });
        p.title(`ClueSolver — ${held === null && !this.returnToBank ? 'waiting for a clue' : this.status}`);

        const tab = p.tabs('cs', ['Overview', 'Clue']);
        if (tab === 'Overview') {
            p.row(`Solved: ${this.solved}`, `Held clue: ${held ?? 'none'}`);
            p.text(`Status: ${this.solveClue?.clueStatus() ?? 'idle'}`);
        } else {
            paintClueProgress(p);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
