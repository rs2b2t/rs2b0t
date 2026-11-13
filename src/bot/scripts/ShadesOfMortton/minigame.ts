import Tile from '../../geometry/Tile.js';
import { Execution } from '../../api/execution/Execution.js';
import { EventSignal } from '../../api/execution/EventSignal.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Skills } from '../../api/skills/Skills.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import { ID, SHADE_TIERS, chestForKey, keyTier, spendableKeys } from './data.js';
import { CAMPS, CAMP_AREAS, CHEST_ROOMS, MorttonRoute, PYRE_TILE, inCatacombs, inventoryCounts } from './route.js';

const PYRES = [[3504, 3275, 3], [3507, 3272, 2], [3507, 3276, 0], [3508, 3275, 1]] as const;
export function pyrePillar(tile: Tile, rotation: 0 | 1 | 2 | 3): Tile {
    const [dx, dz] = [[0, 3], [3, 0], [0, -1], [-1, 0]][rotation];
    return tile.translate(dx, dz);
}

const rewardId = (id: number) => id === ID.COINS || keyTier(id) >= 0;
const locAt = (id: number, tile: Tile) => Locs.query().where(loc => loc.id === id && loc.tile().equals(tile)).nearest();

type Funeral = { tile: Tile; pillar: Tile; expires: number; remains: number; burning: boolean; lightingXp: number | null; rewardUntil: number };
type Chest = { id: number; before: number; paste: number; started: number };

export class Minigame {
    readonly stats = { kills: 0, burned: 0, chests: 0 };
    private route: MorttonRoute;
    private funeral: Funeral | null = null;
    private chest: Chest | null = null;

    constructor(private log: (message: string) => void, private upkeep: () => Promise<boolean>) {
        this.route = new MorttonRoute(log, upkeep);
    }

    private async safe(): Promise<boolean> {
        if (EventSignal.pending()) return false;
        if (await this.upkeep()) return true;
        this.log('food upkeep requested retreat');
        await this.exit();
        return false;
    }

    private async take(id: number, tile?: Tile): Promise<boolean> {
        const drop = GroundItems.query().where(item => item.id === id && (!tile || item.tile().equals(tile))).within(15).nearest();
        if (!drop) return false;
        const before = Inventory.countById(id);
        return !!(await drop.interact('Take')) && Execution.delayUntil(() => Inventory.countById(id) > before, 6000);
    }

    async hunt(tierIndex: number, limit: number): Promise<boolean> {
        const tier = SHADE_TIERS[tierIndex];
        const wanted = Math.min(20, Math.max(0, Math.floor(limit)));
        if (!tier || !wanted || !(await this.safe())) return false;
        if (tierIndex === 0) {
            if (!(await this.exit())) return false;
        } else if (!(await this.route.area(CAMP_AREAS[tierIndex]))) return false;
        const before = Inventory.countById(tier.remains);
        const reachable = (tile: Tile) => Reachability.canReach(tile, { maxSteps: 2048, adjacentOk: true });
        const candidates = () => Npcs.query().where(npc => (npc.id === tier.shadow || npc.id === tier.shade)
            && !npc.targetsAnotherPlayer() && reachable(npc.tile())).action('Attack').within(16);
        const attacker = () => candidates().where(npc => npc.targetsMe()).nearest();
        const matches = () => attacker() ?? candidates().nearest();
        if (!matches()) {
            const arrived = tierIndex === 0
                ? await Traversal.walkResilient(CAMPS[0], { radius: 4, attempts: 2, timeoutMs: 180_000, log: this.log })
                : await this.route.local(CAMPS[tierIndex], 2);
            if (!arrived) return false;
        }
        Game.setAutoRetaliate(true);
        for (let killed = 0; killed < wanted; killed++) {
            if (!(await this.safe()) || Inventory.isFull()) return false;
            if (await this.take(tier.remains)) { this.stats.kills++; continue; }
            let target = matches();
            for (let wait = 0; !target && wait < 12; wait++) {
                if (!(await this.safe())) return false;
                if (wait === 6) {
                    const arrived = tierIndex === 0
                        ? await Traversal.walkResilient(CAMPS[0], { radius: 3, attempts: 1, timeoutMs: 30000, log: this.log })
                        : await this.route.local(CAMPS[tierIndex], 2);
                    if (!arrived) break;
                }
                await Execution.delayTicks(2);
                target = matches();
            }
            if (!target) return Inventory.countById(tier.remains) > before;
            let index = target.index;
            let collected = false;
            for (let tick = 0; tick < 240; tick++) {
                if (!(await this.safe())) return false;
                if (await this.take(tier.remains)) { collected = true; break; }
                let live = Npcs.all().find(npc => npc.index === index && (npc.id === tier.shadow || npc.id === tier.shade));
                if (live && !reachable(live.tile())) {
                    live = matches() ?? undefined;
                    if (!live) return false;
                    index = live.index;
                }
                const active = attacker();
                if (live && !live.targetsMe() && active && active.index !== index) {
                    index = active.index;
                    live = active;
                }
                if (!live) {
                    for (let wait = 0; wait < 8 && !collected; wait++) {
                        if (!(await this.safe())) return false;
                        collected = await this.take(tier.remains);
                        if (!collected) await Execution.delayTicks(1);
                    }
                    break;
                }
                if (live.targetsAnotherPlayer()) return false;
                const dying = live.health === 0 && live.snap.totalHealth > 0;
                if ((!Game.inCombat() || tick % 8 === 0) && !dying && !(await live.interact('Attack'))) return false;
                await Execution.delayTicks(1);
            }
            if (!collected) return false;
            this.stats.kills++;
        }
        return Inventory.countById(tier.remains) > before;
    }

    private async collectReward(): Promise<boolean> {
        const funeral = this.funeral;
        if (!funeral) return false;
        for (let tick = 0; tick < 25; tick++) {
            if (EventSignal.pending()) return false;
            if (ChatDialog.canContinue()) {
                if (!(await ChatDialog.continue())) return false;
                funeral.rewardUntil = Math.max(funeral.rewardUntil, Game.tick() + 52);
                await Execution.delayTicks(1);
                continue;
            }
            const reward = GroundItems.query().where(item => rewardId(item.id) && item.tile().equals(funeral.pillar)).nearest();
            if (reward && await this.take(reward.id, funeral.pillar)) {
                this.funeral = null;
                this.stats.burned++;
                return true;
            }
            if (Game.tick() >= funeral.rewardUntil) { this.funeral = null; return false; }
            await Execution.delayTicks(1);
        }
        return false;
    }

    async cremate(tierIndex: number): Promise<boolean> {
        const tier = SHADE_TIERS[tierIndex];
        if (!tier || EventSignal.pending()) return false;
        if (inCatacombs() && !(await this.exit())) return false;
        if (this.funeral?.lightingXp !== null && this.funeral?.lightingXp !== undefined
            && Skills.xp('firemaking') > this.funeral.lightingXp) this.funeral.burning = true;
        if (!this.funeral?.burning && Inventory.countById(ID.TINDERBOX) < 1) return false;
        if (!this.funeral && (Inventory.countById(ID.MAGIC_PYRE_LOGS) < 1 || Inventory.countById(tier.remains) < 1)) return false;
        if (!(await Traversal.walkResilient(PYRE_TILE, { radius: 3, attempts: 2, timeoutMs: 180_000, log: this.log }))) return false;
        if (this.funeral?.burning) return this.collectReward();
        if (this.funeral && Game.tick() >= this.funeral.expires) {
            const recovered = await this.collectReward();
            if (!recovered) this.funeral = null;
            return recovered;
        }
        if (!this.funeral) {
            const pyre = Locs.query().where(loc => loc.id === ID.PYRE_EMPTY && PYRES.some(([x, z]) => loc.tile().x === x && loc.tile().z === z)).nearest();
            const logs = Inventory.items().find(item => item.id === ID.MAGIC_PYRE_LOGS);
            if (!pyre || !logs || EventSignal.pending()) return false;
            const tile = pyre.tile();
            const angle = PYRES.find(([x, z]) => x === tile.x && z === tile.z)![2];
            const pillar = pyrePillar(tile, angle);
            const before = Inventory.countById(ID.MAGIC_PYRE_LOGS);
            if (!(await logs.useOn(pyre))) return false;
            this.funeral = { tile, pillar, expires: Game.tick() + 49, remains: tier.remains, burning: false, lightingXp: null, rewardUntil: Game.tick() + 104 };
            if (!(await Execution.delayUntil(() => Inventory.countById(ID.MAGIC_PYRE_LOGS) < before && !!locAt(ID.PYRE_LOGS, tile), 8000))) return false;
        }
        const funeral = this.funeral;
        if (EventSignal.pending()) return false;
        const logs = locAt(ID.PYRE_LOGS, funeral.tile);
        if (logs) {
            const remains = Inventory.items().find(item => item.id === funeral.remains);
            if (!remains) return false;
            const before = Inventory.countById(funeral.remains);
            if (!(await remains.useOn(logs))) return false;
            funeral.expires = Game.tick() + 49;
            if (!(await Execution.delayUntil(() => Inventory.countById(funeral.remains) < before && !!locAt(ID.PYRE_BONES, funeral.tile), 8000))) return false;
        }
        if (EventSignal.pending()) return false;
        const bones = locAt(ID.PYRE_BONES, funeral.tile);
        if (!bones) {
            if (GroundItems.query().where(item => rewardId(item.id) && item.tile().equals(funeral.pillar)).nearest()) return this.collectReward();
            return false;
        }
        const xp = Skills.xp('firemaking');
        funeral.lightingXp = xp;
        funeral.rewardUntil = Game.tick() + 55;
        if (!(await bones.interact('Light'))) { funeral.lightingXp = null; return false; }
        const lit = await Execution.delayUntil(() => Skills.xp('firemaking') > xp, 28_000);
        if (!lit) return false;
        funeral.burning = true;
        funeral.rewardUntil = Game.tick() + 52;
        return this.collectReward();
    }

    private async finishChest(): Promise<boolean> {
        if (!this.chest) return false;
        const pending = this.chest;
        for (let tick = 0; tick < 16; tick++) {
            if (EventSignal.pending()) return false;
            if (ChatDialog.canContinue()) {
                if (!(await ChatDialog.continue())) return false;
            } else if (!ChatDialog.isOpen() && Inventory.countById(pending.id) < pending.before
                && Inventory.countById(ID.SWAMP_PASTE) > pending.paste) {
                this.chest = null;
                this.stats.chests++;
                return true;
            }
            await Execution.delayTicks(1);
        }
        if (!ChatDialog.isOpen() || Game.tick() - pending.started >= 80) this.chest = null;
        return false;
    }

    async openChests(): Promise<boolean> {
        let opened = false;
        if (this.chest) {
            if (!(await this.finishChest())) return false;
            opened = true;
        }
        for (let i = 0; i < 26; i++) {
            if (!(await this.safe())) return false;
            const key = spendableKeys(inventoryCounts())[0];
            if (!key) return opened;
            if (Inventory.free() < 5) return opened;
            const matching = chestForKey(key.id);
            const room = CHEST_ROOMS.get(key.id);
            if (!matching || !room || !(await this.route.area(room.area)) || !(await this.route.local(room.tile, 1))) return false;
            const chest = locAt(matching.chestId, room.tile);
            if (!chest) return false;
            this.chest = { id: key.id, before: Inventory.countById(key.id), paste: Inventory.countById(ID.SWAMP_PASTE), started: Game.tick() };
            if (!(await chest.interact('Open'))) { this.chest = null; return false; }
            if (!(await this.finishChest())) return false;
            opened = true;
            await Execution.delayTicks(4);
        }
        return opened;
    }

    pending(): boolean { return this.funeral !== null || this.chest !== null; }

    async resume(): Promise<boolean> {
        if (EventSignal.pending()) return false;
        if (this.chest) return this.finishChest();
        if (this.funeral) return this.cremate(SHADE_TIERS.findIndex(tier => tier.remains === this.funeral?.remains));
        return true;
    }

    exit(): Promise<boolean> { return this.route.exit(); }
}
