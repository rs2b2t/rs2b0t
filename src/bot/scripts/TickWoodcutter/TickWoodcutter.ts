import { actions, reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Bank } from '../../api/bank/Bank.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { KNIFE } from '../../api/acquisition/Tools.js';
import Tile from '../../geometry/Tile.js';
import { XpTracker } from '../../paint/jive.js';
import { BotHost } from '../../runtime/BotHost.js';
import { carrierName, dropExtraLogs, findCarrier, makeOneForCarrier } from './carrier.js';
import { restockKit } from './banking.js';
import { paintTickWoodcutter, type HudState } from './hud.js';
import { hasAxe, hasKnife, kitReady } from './kit.js';
import { ensureKit, type ProvisionContext } from './provision.js';
import { resolveTravel, awayFromAnchor } from './travel.js';
import { TickManipController, type TickManipHost } from './tickmanipcontroller.js';
import type { Observation, Tree } from './types.js';

/** Standalone 3-tick woodcutter. Orchestrates controller + services; owns no cycle logic. */
export default class TickWoodcutter extends LoopingBot implements TickManipHost {
    override loopDelay = 0;

    private treeName = 'Willow';
    private locationName = 'Seers Willows';
    private anchor = new Tile(2711, 3500, 0);
    private bankStand: Tile | null = null;
    private radius = 24;
    private bankMode = false;
    private toolAcquire = 'Off';
    private carrierLogName = 'Logs';
    private activeCarrier = '';
    private status = 'starting';
    private startXp = 0;
    private startedAt = Date.now();
    private logsCut = 0;
    private obs: Observation | null = null;
    private stopTick: (() => void) | null = null;
    private readonly controller = new TickManipController(this);
    private readonly xp = new XpTracker(['woodcutting'], Skills);

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.treeName = this.settings.str('treeName', 'Willow');
        this.locationName = this.settings.str('location', 'Seers Willows');
        this.bankMode = this.settings.bool('bank', false);
        this.toolAcquire = this.settings.str('toolAcquire', 'Off');
        const here = Game.tile();
        const start = here ? Tile.from(here) : new Tile(3200, 3200, 0);
        const custom = this.settings.tile('customLocation', start);
        const plan = resolveTravel(this.locationName, start, new Tile(custom.x, custom.z, custom.level));
        this.anchor = plan.anchor;
        this.bankStand = plan.bankStand;
        this.radius = this.settings.num('radius', 24);
        this.carrierLogName = carrierName(this.treeName, Skills.level('fletching'));
        const carrier = Inventory.first(this.carrierLogName) ?? findCarrier();
        this.activeCarrier = carrier?.name ?? this.carrierLogName;
        this.log(
            `kit: axe=${hasAxe()} knife=${hasKnife()} carrier=${this.activeCarrier} (preferred ${this.carrierLogName})`
        );
        this.startXp = Skills.xp('woodcutting');
        this.startedAt = Date.now();
        this.xp.begin();
        this.stopTick = BotHost.addTickListener(() => {
            const now = performance.now();
            const tick = Game.tick();
            this.obs = {
                tick,
                at: now,
                anim: reader.selfAnim() ?? -1,
                gapMs: this.obs ? now - this.obs.at : 600
            };
            this.controller.ackFromTick(this.obs);
        });
        this.log(`TickWoodcutter: ${this.treeName} @ ${this.anchor.x},${this.anchor.z} | ${this.bankMode ? 'bank' : 'drop'}`);
    }

    override onStop(): void {
        this.stopTick?.();
        this.stopTick = null;
    }

    override async loop(): Promise<number | void> {
        if (!Game.ingame() || !Game.sceneReady()) {
            return;
        }
        if (Bank.isOpen()) {
            await Bank.close();
            return;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            return;
        }
        if (ChatDialog.isOpen() || reader.modals().main !== -1) {
            // Reference waits for the interface to close; the batch's CLOSE_MODAL does it.
            return;
        }
        // The carrier is pinned for the run (reference uses one Logs); only re-choose when lost.
        if (!Inventory.first(this.activeCarrier)) {
            const fallback = findCarrier(this.carrierLogName);
            if (fallback) {
                this.activeCarrier = fallback.name ?? this.carrierLogName;
            } else {
                this.carrierLogName = carrierName(this.treeName, Skills.level('fletching'));
            }
        }
        if (!kitReady(this.activeCarrier)) {
            await ensureKit(this.provisionContext());
            return;
        }
        if (awayFromAnchor(this.anchor, this.radius)) {
            await Traversal.walkResilient(this.anchor, {
                radius: 3,
                attempts: 2,
                timeoutMs: 90_000,
                log: m => this.log(`  ${m}`)
            });
            return;
        }
        if (Inventory.isFull()) {
            if (this.bankMode && this.bankStand) {
                await this.bankHaul();
            } else {
                dropExtraLogs(5, this.activeCarrier);
            }
            return;
        }
        this.controller.tick(this.obs);
    }

    // TickManipHost -----------------------------------------------------------------

    nowMs(): number {
        return performance.now();
    }

    woodcuttingXp(): number {
        return Skills.xp('woodcutting');
    }

    findTree(current: Tree | null): Tree | null {
        const ents = Npcs.query().where(npc => npc.id >= 444 && npc.id <= 452).results();
        const trees = Locs.query()
            .name(this.treeName)
            .action('Chop down')
            .results()
            .filter(tree => this.anchor.distanceTo(tree.tile()) <= this.radius)
            .filter(tree => !ents.some(npc => {
                const t = npc.tile();
                return Math.max(Math.abs(t.x - tree.tile().x), Math.abs(t.z - tree.tile().z)) <= 1;
            }));
        if (trees.length === 0) {
            return null;
        }
        if (current) {
            const tile = current.tile();
            const live = trees.find(tree => tree.id === current.id
                && tree.tile().x === tile.x
                && tree.tile().z === tile.z);
            if (live) {
                return live as Tree;
            }
        }
        const ready = trees
            .filter(tree => this.inReach(tree as Tree))
            .sort((a, b) => a.distance() - b.distance());
        return (ready[0] ?? trees.sort((a, b) => a.distance() - b.distance())[0]) as Tree;
    }

    inReach(tree: Tree): boolean {
        const here = Game.tile();
        if (!here) {
            return false;
        }
        const tile = tree.tile();
        if (this.treeName.toLowerCase().includes('willow')) {
            const dx = Math.max(tile.x - here.x, 0, here.x - (tile.x + 1));
            const dz = Math.max(tile.z - here.z, 0, here.z - (tile.z + 1));
            return dx + dz === 1 && reader.locReachable(tile.x, tile.z, 2);
        }
        return Tile.from(here).distanceTo(tile) <= 1;
    }

    clickTree(tree: Tree): void {
        void tree.interact('Chop down');
    }

    async walkToTree(tree: Tree): Promise<unknown> {
        // Reference behavior: click the tree and let the client path to it.
        this.clickTree(tree);
        return true;
    }

    dropExtra(): void {
        dropExtraLogs(1, this.activeCarrier);
    }

    sendBatch(tree: Tree, _tick: number): boolean {
        const knife = Inventory.first(KNIFE);
        const carrier = Inventory.first(this.activeCarrier) ?? findCarrier(this.activeCarrier);
        if (!carrier) {
            return false;
        }
        this.activeCarrier = carrier.name ?? this.activeCarrier;
        if (!knife || !carrier) {
            return false;
        }
        actions.flushOut();
        const ok = actions.woodcutBatchRaw(
            { id: knife.id, slot: knife.slot, comId: knife.snap.comId },
            { id: carrier.id, slot: carrier.slot, comId: carrier.snap.comId },
            { id: tree.id, x: tree.tile().x, z: tree.tile().z, ops: tree.snap.ops },
            'Chop down',
            makeOneForCarrier(carrier.name)
        );
        if (ok) {
            this.logsCut++;
        }
        return ok;
    }

    setStatus(message: string): void {
        if (message !== this.status) {
            this.log(message);
        }
        this.status = message;
    }

    // Services ----------------------------------------------------------------------

    private provisionContext(): ProvisionContext {
        return {
            anchor: this.anchor,
            treeName: this.treeName,
            bankStand: this.bankStand,
            toolAcquire: this.toolAcquire,
            log: m => this.log(`  ${m}`),
            status: m => this.setStatus(m)
        };
    }

    private async bankHaul(): Promise<void> {
        if (!this.bankStand) {
            return;
        }
        this.setStatus('banking');
        await restockKit(this.bankStand, m => this.log(`  ${m}`));
    }

    private hudState(): HudState {
        const mins = (Date.now() - this.startedAt) / 60_000;
        const gains = this.xp.progress();
        const wood = gains.find(gain => gain.skill === 'woodcutting');
        const debug = this.controller.debug() as { batches: number; misses: number; gaps: number[] };
        return {
            status: this.status,
            treeName: this.treeName,
            locationName: this.locationName,
            bankMode: this.bankMode,
            toolAcquire: this.toolAcquire,
            mins,
            gained: wood?.gained ?? 0,
            logsCut: this.logsCut,
            batches: debug.batches,
            misses: debug.misses,
            gaps: debug.gaps,
            gains
        };
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        paintTickWoodcutter(ctx, this.hudState());
    }

    debug(): Record<string, unknown> {
        return { ...this.controller.debug(), status: this.status, bank: this.bankMode, location: this.locationName };
    }
}
