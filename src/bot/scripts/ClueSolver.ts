import { TaskBot } from '../api/Bot.js';
import type { Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { nearestBank } from '../api/BankLocations.js';
import { Sustain } from '../api/Sustain.js';
import { Traversal } from '../api/Traversal.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { ClueExecutor } from '../clues/ClueExecutor.js';
import { SolveClue, heldClueLikeId } from '../clues/SolveClue.js';
import type { SettingsSchema } from '../runtime/Settings.js';

export const SETTINGS: SettingsSchema = {
    food: { type: 'string', default: '', label: 'Food item name', help: 'withdrawn during the pre-trail bank stop and kept out of the deposit; blank = run foodless (easy trails are low-risk)' },
    foodWithdraw: { type: 'number', default: 8, min: 1, max: 27, label: 'Food to withdraw' },
    eatAtHp: { type: 'number', default: 50, min: 1, max: 99, label: 'Eat below HP%', help: 'eats mid-walk too — hostiles along a trail chip HP' },
    spade: { type: 'string', default: 'Spade', label: 'Spade item (dig clues)' }
};

/**
 * Standalone easy-clue solver. Watches the pack for a clue scroll or reward
 * casket and runs the shared bank-first solve flow: dump everything except
 * the clue + food + spade at the NEAREST known bank, walk the trail, open the
 * casket. After a completed solve it walks to the nearest known bank and
 * idles there — hand it a clue (or start it holding one) and it goes.
 * Abandoned clues (missing tool, unreachable step) stay in the pack and are
 * skipped until they change.
 */
export default class ClueSolver extends TaskBot {
    override loopDelay = 600;

    private status = 'waiting for a clue';
    private solved = 0;
    private solveClue: SolveClue | undefined;
    private returnToBank = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const food = this.settings.str('food', '');
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
            spadeName: () => this.settings.str('spade', 'Spade'),
            weaponName: () => this.settings.str('weapon', '')
        });

        // eat mid-walk/mid-step: solves cross aggro zones and nothing else can
        // run while the solve holds the loop (no-op when running foodless)
        const eatAt = this.settings.num('eatAtHp', 50) / 100;
        const isFood = (name: string | null | undefined): boolean => foodPat !== '' && (name ?? '').toLowerCase().includes(foodPat);
        Sustain.set(async () => {
            if (foodPat === '' || Skills.hpFraction() >= eatAt) {
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

        // Post-solve bank return. Registered AFTER solveClue so a fresh clue
        // (dropped in mid-walk, or straight out of the casket) preempts the
        // walk; the flag survives that solve and the return fires after it.
        const bankReturn: Task = {
            validate: () => this.returnToBank && heldClueLikeId() === null && Game.tile() !== null,
            execute: async () => {
                const here = Game.tile()!;
                const bank = nearestBank(here);
                if (!bank) {
                    this.log('[clue] no known bank on this level to return to — idling here');
                } else if (Math.max(Math.abs(bank.tile.x - here.x), Math.abs(bank.tile.z - here.z)) > 3) {
                    this.setStatus(`returning to the ${bank.name} bank`);
                    this.log(`[clue] trail done — returning to the ${bank.name} bank (${bank.tile})`);
                    if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 6, timeoutMs: 300_000, log: m => this.log(`  ${m}`) }))) {
                        this.log('[clue] walk to the bank failed — idling here');
                    }
                }
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

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const cur = ClueExecutor.current;
        const held = heldClueLikeId();
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e8c35b' });
        p.title(`ClueSolver — ${held === null && !this.returnToBank ? 'waiting for a clue' : this.status}`);

        const tab = p.tabs('cs', ['Overview', 'Clue']);
        if (tab === 'Overview') {
            p.row(`Solved: ${this.solved}`, `Held clue: ${held ?? 'none'}`);
            p.text(`Status: ${this.solveClue?.clueStatus() ?? 'idle'}`);
        } else if (cur) {
            p.text(`${cur.name} — leg ${cur.leg}${cur.attempt > 1 ? ` (try ${cur.attempt})` : ''}`);
            p.text(cur.step, '#8a919a');
        } else {
            p.text('no clue in progress', '#8a919a');
        }

        p.gap();
        const clicked = p.buttons([
            { id: 'pause', label: ScriptRunner.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (ScriptRunner.state === 'paused') {
                ScriptRunner.resume();
            } else {
                ScriptRunner.pause();
            }
        } else if (clicked === 'stop') {
            ScriptRunner.stop();
        }
        p.end();
    }
}
