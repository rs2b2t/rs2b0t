import { Bank } from '../../api/bank/Bank.js';
import { TaskBot, type Task } from '../../api/bot/Bot.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Skills } from '../../api/skills/Skills.js';
import { ContinueDialog } from '../../api/tasks/ContinueDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import Tile from '../../geometry/Tile.js';
import { XpTracker, jiveFrame, paintLevels } from '../../paint/jive.js';
import { fmtDuration } from '../../paint/paintLogic.js';
import { ScriptRunner } from '../../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../../runtime/Settings.js';
import { escapeRunesFor } from '../JiveDragons/supply.js';
import { CHEST, CHEST_STAND, JUNK, KEY, KEYS_PER_TRIP, PACK, decide, junkHeld, keysToWithdraw, type PackState, type Step } from './logic.js';

/** The Falador West booths, the nearest bank to both the chest and the teleport. */
const BANK_STAND = new Tile(2946, 3369, 0);
const BOOTH = 'Bank booth';
const BOOTH_OP = 'Use-quickly';
const TELEPORT_ID = 'falador';
const CHEST_REACH = 6;
const WALK_MS = 180_000;
/** The chest's own reward runs on the tick after the use, so the pack settles inside this. */
const REWARD_MS = 4000;
const TELE_LAND_MS = 6000;
const CONTROL_ROWS = 2;
const TOP_LINES = 3;

export const SETTINGS: SettingsSchema = {
    teleportHome: {
        type: 'boolean',
        default: true,
        label: 'Teleport back to Falador',
        help: 'casts the Falador teleport when the keys are spent, and walks when the runes or the Magic level are short. The walk is the long way back through the Taverley gate'
    }
};

export default class JiveChests extends TaskBot {
    override loopDelay = 600;

    private status = 'starting';
    private startedAt = Date.now();
    private xp = new XpTracker(['crafting'], Skills);
    opened = 0;
    trips = 0;
    private dropped = 0;
    private lootByName = new Map<string, number>();

    teleportHome = true;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.teleportHome = this.settings.bool('teleportHome', true);
        this.startedAt = Date.now();
        this.xp.begin();
        const esc = escapeRunesFor(TELEPORT_ID);
        this.log(`[chests] ${KEYS_PER_TRIP} ${KEY}s a trip from Falador West, opening the chest at ${CHEST_STAND.x},${CHEST_STAND.z}, dropping ${JUNK.join(', ')}, home by ${this.teleportHome ? esc.label : 'the walk back'}`);
        this.add(new ContinueDialog(), new DropJunk(this), new OpenChest(this), new Travel(this), new BankTrip(this));
    }

    override recoveryAnchor(): Tile | null {
        return BANK_STAND;
    }

    setStatus(s: string): void {
        this.status = s;
    }

    keysHeld(): number {
        return Inventory.count(KEY);
    }

    junkInPack(): number {
        return junkHeld(n => Inventory.count(n));
    }

    /** Everything but the keys and the junk, which is what a trip is carrying home. */
    lootInPack(): number {
        return Inventory.items().filter(i => {
            const name = i.name ?? '';
            return name !== KEY && !JUNK.some(j => j.toLowerCase() === name.toLowerCase());
        }).length;
    }

    atChest(): boolean {
        const here = Game.tile();
        return here !== null && here.level === CHEST_STAND.level && CHEST_STAND.distanceTo(here) === 0;
    }

    pack(): PackState {
        return { keys: this.keysHeld(), junk: this.junkInPack(), loot: this.lootInPack(), free: Inventory.free(), atChest: this.atChest() };
    }

    step(): Step {
        return decide(this.pack());
    }

    noteOpen(gained: Map<string, number>): void {
        this.opened++;
        for (const [name, n] of gained) {
            this.lootByName.set(name, (this.lootByName.get(name) ?? 0) + n);
        }
    }

    noteDrop(n: number): void {
        this.dropped += n;
    }

    noteTrip(): void {
        this.trips++;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const { frame: p, page, section } = jiveFrame(ctx, {
            script: 'JiveChests',
            status: this.status,
            pages: ['Statistics', 'Options'],
            sections: ['Overview', 'Haul']
        });
        const mins = (Date.now() - this.startedAt) / 60_000;

        if (page === 'Options') {
            p.statGrid([
                [{ text: `Keys a trip: ${KEYS_PER_TRIP}` }, { text: `Home: ${this.teleportHome ? 'teleport' : 'walk'}` }],
                [{ text: `Chest: ${CHEST_STAND.x},${CHEST_STAND.z}` }, { text: `Bank: ${BANK_STAND.x},${BANK_STAND.z}` }]
            ]);
        } else if (section === 'Overview') {
            p.statGrid([
                [{ text: `Runtime: ${fmtDuration(mins)}` }, { text: `Opened: ${this.opened}` }],
                [{ text: `Trips: ${this.trips}` }, { text: `Chests/hr: ${mins > 0.5 ? Math.round((this.opened / mins) * 60) : 'n/a'}` }],
                [{ text: `Keys: ${this.keysHeld()}` }, { text: `Dropped: ${this.dropped}` }]
            ]);
            p.bar('Pack', Inventory.used() / PACK);
            paintLevels(p, this.xp.progress(), mins, CONTROL_ROWS);
        } else {
            const rows = [...this.lootByName.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, TOP_LINES)
                .map(([name, n]) => [{ text: `${n}x ${name}` }]);
            p.statGrid([...rows, [{ text: `Kinds: ${this.lootByName.size}` }, { text: `Dropped: ${this.dropped}` }]]);
        }

        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

// Why: the junk goes before anything else, so a roll of five swordfish never costs the slots the next roll needs.
class DropJunk implements Task {
    constructor(private bot: JiveChests) {}

    validate(): boolean {
        return this.bot.step().kind === 'drop';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        for (const name of JUNK) {
            const item = Inventory.first(name);
            if (!item) {
                continue;
            }
            const before = Inventory.count(name);
            bot.setStatus(`dropping ${name}`);
            if (!(await item.interact('Drop'))) {
                bot.log(`[chests] could not drop ${name}`);
                return;
            }
            if (await Execution.delayUntil(() => Inventory.count(name) < before, 3000)) {
                bot.noteDrop(before - Inventory.count(name));
            }
            return;
        }
    }
}

// Why: the chest answers oploc1 with "securely locked shut" and only opens on oplocu, so the key is used on it rather than the loc being clicked.
class OpenChest implements Task {
    constructor(private bot: JiveChests) {}

    validate(): boolean {
        return this.bot.step().kind === 'open';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const chest = Locs.query().name(CHEST).withinOf(CHEST_STAND, CHEST_REACH).nearest();
        const key = Inventory.first(KEY);
        if (!chest || !key) {
            await Execution.delayTicks(2);
            return;
        }
        const before = census();
        const keys = bot.keysHeld();
        bot.setStatus('opening the chest');
        if (!(await key.useOn(chest))) {
            bot.log('[chests] the key would not go on the chest, retrying');
            await Execution.delayTicks(2);
            return;
        }
        if (!(await Execution.delayUntil(() => bot.keysHeld() < keys, REWARD_MS))) {
            bot.log('[chests] the chest took no key, retrying');
            return;
        }
        // Why: the reward lands in the same script as the unlock, a tick after the key goes, so the pack is read once it has settled rather than on the tick of the click.
        await Execution.delayTicks(2);
        const gained = gainedSince(before);
        bot.noteOpen(gained);
        bot.log(`[chests] opened the chest: ${[...gained].map(([n, c]) => `${c} ${n}`).join(', ') || 'nothing new'}`);
    }
}

function census(): Map<string, number> {
    const out = new Map<string, number>();
    for (const item of Inventory.items()) {
        const name = item.name ?? '';
        out.set(name, (out.get(name) ?? 0) + Math.max(1, item.count));
    }
    return out;
}

function gainedSince(before: Map<string, number>): Map<string, number> {
    const now = census();
    const out = new Map<string, number>();
    for (const [name, count] of now) {
        const delta = count - (before.get(name) ?? 0);
        if (delta > 0 && name !== '') {
            out.set(name, delta);
        }
    }
    return out;
}

class Travel implements Task {
    constructor(private bot: JiveChests) {}

    validate(): boolean {
        return this.bot.step().kind === 'travel';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        bot.setStatus('walking to the chest');
        if (!(await Traversal.walkResilient(CHEST_STAND, { radius: 0, attempts: 4, timeoutMs: WALK_MS, log: m => bot.log(`  ${m}`) }))) {
            bot.log('[chests] the walk to the chest failed, will retry');
        }
    }
}

// Why: the teleport lands twenty tiles from the booths and the walk back is the long way through the Taverley gate, so a short rune stack costs a walk rather than the trip.
class BankTrip implements Task {
    constructor(private bot: JiveChests) {}

    validate(): boolean {
        return this.bot.step().kind === 'bank';
    }

    async execute(): Promise<void> {
        const bot = this.bot;
        const here = Game.tile();
        const far = here === null || BANK_STAND.distanceTo(here) > 20;
        if (far && bot.teleportHome && (await this.castHome())) {
            return;
        }
        bot.setStatus('walking to the bank');
        if (!(await Traversal.walkResilient(BANK_STAND, { radius: 3, attempts: 4, timeoutMs: WALK_MS, log: m => bot.log(`  ${m}`) }))) {
            bot.log('[chests] the walk to the bank failed, will retry');
            return;
        }
        if (!(await Bank.openBooth(BANK_STAND, BOOTH, BOOTH_OP, m => bot.log(`  ${m}`)))) {
            bot.log('[chests] could not open the bank, will retry');
            return;
        }
        bot.setStatus('banking the haul');
        await Bank.depositAllMatching(name => name.toLowerCase() !== KEY.toLowerCase());
        if (!(await Execution.delayUntil(() => Bank.isOpen() && Bank.loaded(), 5000))) {
            bot.log(Bank.isOpen() ? '[chests] the bank list has not filled in, retrying' : '[chests] the bank window closed, retrying');
            return;
        }
        const want = keysToWithdraw(bot.keysHeld(), Bank.count(KEY));
        if (want < 1 && bot.keysHeld() < 1) {
            await Bank.close();
            bot.setStatus('stopped');
            ScriptRunner.stop(`[chests] no ${KEY}s left in the bank; ${bot.opened} chest(s) opened over ${bot.trips} trip(s)`);
            return;
        }
        if (want > 0) {
            bot.setStatus(`withdrawing ${want} ${KEY}s`);
            if (!(await Bank.withdrawX(KEY, want))) {
                bot.log(`[chests] could not withdraw ${want} ${KEY}s, retrying`);
                return;
            }
        }
        if (!(await Bank.close())) {
            bot.log('[chests] the bank would not close, retrying');
            return;
        }
        bot.noteTrip();
        bot.log(`[chests] banked the haul and took ${bot.keysHeld()} ${KEY}s`);
    }

    /** Cast the way home, false when the runes or the level are short and the walk has to do it. */
    private async castHome(): Promise<boolean> {
        const bot = this.bot;
        const esc = escapeRunesFor(TELEPORT_ID);
        const short = esc.runes.find(r => Inventory.count(r.rune) < r.count);
        if (Skills.level('magic') < esc.level || short) {
            bot.log(`[chests] ${esc.label} is short ${short ? short.rune : `Magic ${esc.level}`}, walking back instead`);
            return false;
        }
        const before = Game.tile();
        bot.setStatus(`casting ${esc.label}`);
        if (!(await Game.teleport(TELEPORT_ID))) {
            return false;
        }
        return Execution.delayUntil(() => {
            const now = Game.tile();
            return now !== null && before !== null && BANK_STAND.distanceTo(now) < BANK_STAND.distanceTo(before);
        }, TELE_LAND_MS);
    }
}
