import { reader } from '../../adapter/ClientAdapter.js';
import { LoopingBot } from '../../api/bot/Bot.js';
import { Game } from '../../api/game/Game.js';
import { Execution } from '../../api/execution/Execution.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Equipment } from '../../api/equipment/Equipment.js';
import { Npcs } from '../../api/npcs/Npcs.js';
import { Shop } from '../../api/shop/Shop.js';
import { Skills } from '../../api/skills/Skills.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { DirectNavigator } from '../../event/webwalk/DirectNavigator.js';
import { Reachability } from '../../event/webwalk/geometry/Reachability.js';
import Tile from '../../geometry/Tile.js';
import { ChatDialog } from '../../api/ui/dialogue/ChatDialog.js';
import { Bank } from '../../api/bank/Bank.js';
import { nearestBank } from '../../api/bank/BankLocations.js';
import { DESTINATIONS, FormationPeer, HOLD_TICKS, LABELS, MAN_TILE, PURE_WALK, SHOP_TILE, SKIRT, distance, nextStep, normalName, queueTile, same, validFloor } from './RitualLogic.js';

function visiblePink() {
    return reader
        .visiblePlayerStates()
        .filter(p => p.equipmentIds.includes(SKIRT))
        .map(p => ({ name: normalName(p.name), tile: p.networkTile }));
}

export default class PinkSkirtSummoningRitual extends LoopingBot {
    loopDelay = 0;
    /** @type {import('../../api/bot/Bot.js').LoopCadence} */
    loopCadence = { kind: 'frame' };
    status = 'Starting';
    destination = 0;
    anchor = null;
    peer = null;
    lastTick = -1;
    dead = false;
    recovering = false;
    admitted = false;
    lastHere = null;
    previouslyWoreSkirt = false;
    travelStalls = 0;
    lastTripKey = '';
    purchaseAfter = 0;
    openedThessalia = false;
    fullCycles = 0;
    deaths = 0;
    lastCompletedAt = 0;
    lastPhase = -1;
    startupBanked = false;
    startupFunded = false;
    startupBank = null;
    startedAt = 0;
    citiesVisited = new Set();
    patternsFormed = 0;
    peerCompleted = 0;
    async onStart() {
        this.startedAt = Date.now();
        await Execution.delayUntil(() => Game.ingame() && Game.sceneReady(), 0);
        if (!reader.serverTile()) throw new Error('Server position unavailable.');
        this.on('chat.message', e => {
            if (e.type === 0 && /oh dear.*you are dead/i.test(e.text)) this.noteDeath();
        });
        Game.setAutoRetaliate(false);
        this.log('Leaderless formations: verified movement, cycle-boundary admission, alphabetic slots, 9-tick holds.');
    }
    noteDeath() {
        if (!this.dead) this.deaths++;
        this.dead = true;
        this.openedThessalia = false;
        this.recovering = true;
        this.destination = 0;
        this.clearDance();
    }
    clearDance() {
        this.anchor = null;
        this.peer = null;
        this.admitted = false;
        this.lastCompletedAt = 0;
        this.lastPhase = -1;
        this.peerCompleted = 0;
    }
    nextDestination(reason) {
        this.log(`${DESTINATIONS[this.destination].name}: ${reason}; checking next destination.`);
        this.destination = (this.destination + 1) % DESTINATIONS.length;
        this.clearDance();
        this.travelStalls = 0;
        if (this.destination === 0) this.fullCycles++;
    }
    async travel(target, radius, label) {
        this.status = label;
        const key = `${target.x},${target.z},${radius}`;
        if (key !== this.lastTripKey) {
            this.travelStalls = 0;
            this.lastTripKey = key;
        }
        const before = distance(reader.serverTile(), target);
        await Traversal.walkTo(new Tile(target.x, target.z, target.level), { radius, timeoutMs: 6000, ...PURE_WALK });
        const after = distance(reader.serverTile(), target);
        this.travelStalls = after < before || after <= radius ? 0 : this.travelStalls + 1;
        return after <= radius;
    }
    async fund() {
        if (distance(Game.tile(), MAN_TILE) > 18) {
            await this.travel(MAN_TILE, 5, 'Returning to Lumbridge to earn 5 gp');
            return;
        }
        this.status = `Pickpocketing a Man: ${Inventory.count('Coins')}/5 gp`;
        if (Inventory.free() === 0 && Inventory.count('Coins') === 0) {
            this.status = 'Inventory full: free one slot for coins';
            return;
        }
        if (Skills.effective('hitpoints') < 3) {
            this.status = 'Waiting for health before pickpocketing';
            return;
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            return;
        }
        const man = Npcs.query()
            .name('Man')
            .action('Pickpocket')
            .where(n => distance(n.tile(), MAN_TILE) <= 20)
            .nearest();
        if (!man) {
            await this.travel(MAN_TILE, 2, 'Looking for a Lumbridge Man');
            return;
        }
        const gp = Inventory.count('Coins'),
            hp = Skills.effective('hitpoints');
        await man.interact('Pickpocket');
        await Execution.delayUntil(() => this.dead || Inventory.count('Coins') > gp || Skills.effective('hitpoints') < hp || ChatDialog.canContinue(), 6000);
        if (!this.dead && Skills.effective('hitpoints') < hp) await Execution.delayTicks(8);
    }
    async bankStartup() {
        if (!this.startupBank) this.startupBank = nearestBank(Game.tile());
        if (!this.startupBank) {
            this.status = 'No usable nearby bank; waiting';
            return;
        }
        const bank = this.startupBank;
        if (!Bank.isOpen()) {
            if (distance(Game.tile(), bank.tile) > 3) {
                await this.travel(bank.tile, 3, `Startup: walking to ${bank.name} bank`);
                return;
            }
            this.status = `Startup: opening ${bank.name} bank`;
            if (bank.npcAccess) {
                await Bank.openNpcAccess(bank.npcAccess);
            } else await Bank.openNearestAccess(bank.access ?? { name: 'Bank booth', op: 'Use-quickly' });
            return;
        }
        if (!Bank.loaded()) {
            this.status = 'Startup: waiting for bank';
            return;
        }
        this.status = 'Startup: banking all inventory items';
        if (Inventory.free() !== 28) {
            await Bank.depositInventory();
            await Execution.delayUntil(() => Inventory.free() === 28 || !Bank.isOpen(), 4000);
            if (!Bank.isOpen() || Inventory.free() !== 28) return;
        }
        if (await Bank.close()) this.startupBanked = true;
    }
    async wardrobe() {
        if (Equipment.contains('Pink skirt')) return true;
        if (Inventory.contains('Pink skirt')) {
            if (Shop.isOpen()) await Shop.close();
            this.status = 'Equipping Pink skirt';
            await Equipment.equip('Pink skirt');
            return false;
        }
        if (Inventory.count('Coins') < 5) {
            await this.fund();
            return false;
        }
        if (distance(Game.tile(), SHOP_TILE) > 5) {
            await this.travel(SHOP_TILE, 3, 'Walking to Thessalia in Varrock');
            return false;
        }
        if (Inventory.free() === 0) {
            this.status = 'Inventory full: free one slot for a skirt';
            return false;
        }
        this.status = 'Buying a Pink skirt from Thessalia';
        if (Game.tick() < this.purchaseAfter) {
            this.status = 'Waiting for Thessalia to restock';
            return false;
        }
        if (Shop.isOpen() && !this.openedThessalia) {
            await Shop.close();
            return false;
        }
        if (!Shop.isOpen()) {
            this.openedThessalia = await Shop.open('Thessalia');
            return false;
        }
        const stock = Shop.stock().find(i => i.name.toLowerCase() === 'pink skirt');
        if (!stock || stock.count === 0) {
            this.purchaseAfter = Game.tick() + 10;
            return false;
        }
        await Shop.buy('Pink skirt', 1);
        if (Inventory.contains('Pink skirt')) await Shop.close();
        else this.purchaseAfter = Game.tick() + 5;
        return false;
    }
    async loop() {
        if (!Game.ingame() || !Game.sceneReady()) return;
        const tick = Game.tick();
        if (tick === this.lastTick) return;
        this.lastTick = tick;
        if (Skills.effective('hitpoints') <= 0) {
            this.noteDeath();
            return;
        }
        const here = reader.serverTile();
        if (!here) return;
        // Catch respawns even when the death message was missed during loading.
        const wearing = Equipment.contains('Pink skirt');
        if (distance(here, MAN_TILE) <= 15 && ((this.previouslyWoreSkirt && !wearing) || (this.admitted && this.lastHere && distance(this.lastHere, here) > 25))) this.noteDeath();
        this.previouslyWoreSkirt = wearing;
        this.lastHere = here;
        if (this.dead) {
            if (distance(here, MAN_TILE) > 18) {
                this.status = 'Waiting for Lumbridge respawn';
                return;
            }
            this.dead = false;
            this.purchaseAfter = 0;
        }
        if (!this.startupBanked) {
            await this.bankStartup();
            return;
        }
        if (!this.startupFunded) {
            if (Inventory.count('Coins') < 5) {
                await this.fund();
                return;
            }
            this.startupFunded = true;
        }
        if (this.recovering) {
            if (Inventory.count('Coins') < 5) {
                await this.fund();
                return;
            }
            // This funding stage completes once, before spending on the skirt.
            this.recovering = false;
        }
        if (!(await this.wardrobe())) {
            if (this.peer) this.clearDance();
            return;
        }
        this.recovering = false;
        if (Shop.isOpen()) {
            await Shop.close();
            return;
        }
        if (Game.autoRetaliateOn()) Game.setAutoRetaliate(false);
        const destination = DESTINATIONS[this.destination];
        if (!this.anchor) {
            if (distance(here, destination.tile) > 5) {
                await this.travel(destination.tile, 4, `Walking to ${destination.name}`);
                if (this.travelStalls >= 8) this.nextDestination('route made no progress');
                return;
            }
            this.anchor = { ...destination.anchor };
            if (
                !validFloor(
                    this.anchor,
                    t => Reachability.walkable(t),
                    (a, b) => Reachability.canStep(a, b)
                )
            ) {
                this.nextDestination('the shared formation floor is obstructed');
                return;
            }
            this.peer = new FormationPeer(Game.myName(), this.anchor);
            this.lastCompletedAt = tick;
            this.log(`${destination.name}: formation centre ${this.anchor.x},${this.anchor.z}.`);
        }
        const rows = visiblePink();
        const myName = normalName(Game.myName());
        if (!rows.some(p => p.name === myName)) {
            this.status = 'Waiting for equipped appearance update';
            return;
        }
        if (!this.admitted && this.peer.created === null && !same(here, queueTile(this.anchor))) {
            await this.travel(queueTile(this.anchor), 0, `Joining ${destination.name}`);
            if (this.travelStalls >= 8) this.nextDestination('entry lane unreachable');
            return;
        }
        const plan = this.peer.step(tick, rows);
        if (plan.overflow) {
            this.nextDestination('simultaneous arrivals filled this group');
            return;
        }
        if (!plan.fresh) return;
        this.admitted = this.peer.joined;
        this.patternsFormed += (plan.completed ?? this.peerCompleted) - this.peerCompleted;
        this.peerCompleted = plan.completed ?? this.peerCompleted;
        if (plan.holding) this.citiesVisited.add(destination.name);
        if (plan.holding) this.lastCompletedAt = tick;
        if (tick - this.lastCompletedAt > 150) {
            this.nextDestination('group cannot assemble; retrying elsewhere');
            return;
        }
        this.status = `${destination.name}: ${plan.waiting ? 'Waiting to join next cycle' : plan.phase < 0 ? 'Assembling' : LABELS[plan.phase]} | ${plan.rank + 1}/${plan.members.length}`;
        if (plan.holding) this.status += ` | hold ${plan.heldTicks}/${HOLD_TICKS}`;
        if (plan.phase !== this.lastPhase) {
            this.lastPhase = plan.phase;
            this.log(this.status);
        }
        const step = nextStep(here, plan.target, this.anchor);
        if (!same(here, step)) {
            if (Reachability.canStep(here, step)) await DirectNavigator.walk(step);
            else {
                this.status = 'Formation path changed; rechecking destination';
                this.clearDance();
            }
        }
    }
    onPause() {
        if (this.peer) this.peer.reset(Game.tick());
    }
    onResume() {
        if (this.peer) this.peer.reset(Game.tick());
    }
    recoveryAnchor() {
        const t = this.anchor ?? DESTINATIONS[this.destination].tile;
        return new Tile(t.x, t.z, t.level);
    }
    onPaint(ctx) {
        const seconds = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
        const runtime = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
        ctx.save();
        ctx.fillStyle = 'rgba(35,12,31,.88)';
        ctx.fillRect(8, 8, 540, 76);
        ctx.fillStyle = '#ffadd8';
        ctx.font = '12px monospace';
        ctx.fillText('Pink Skirt Summoning Ritual | leaderless | 1.1.0', 16, 25);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(this.status.slice(0, 70), 16, 42);
        ctx.fillText(`Running ${runtime} | cities visited ${this.citiesVisited.size} | patterns formed ${this.patternsFormed}`, 16, 58);
        ctx.fillText(`9-tick holds | deaths ${this.deaths} | groups of 1–16`, 16, 75);
        ctx.restore();
    }
}
