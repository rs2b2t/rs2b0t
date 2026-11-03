import { Execution } from '../../api/execution/Execution.js';
import { Game } from '../../api/game/Game.js';
import { GroundItems } from '../../api/grounditems/GroundItems.js';
import { Inventory } from '../../api/inventory/Inventory.js';
import { Locs } from '../../api/locs/Locs.js';
import { Traversal } from '../../api/walking/Traversal.js';
import { KNIFE } from '../../api/acquisition/Tools.js';
import { Skills } from '../../api/skills/Skills.js';
import Tile from '../../geometry/Tile.js';
import { restockKit, withdrawCoins } from './banking.js';
import { carrierName, dropExtraLogs, findCarrier, logForTreeName } from './carrier.js';
import { AXE_NAMES, hasAxe, hasKnife, kitReady } from './kit.js';
import { acquireAxeAtBob } from './tools.js';

const SEERS_KNIFE_SPAWN = new Tile(2704, 3475, 0);
const AXE_SPAWN = new Tile(2678, 3731, 0);
const AXE_COINS = 200;

export interface ProvisionContext {
    anchor: Tile;
    treeName: string;
    bankStand: Tile | null;
    toolAcquire: string;
    log(message: string): void;
    status(message: string): void;
}

export async function ensureKit(ctx: ProvisionContext): Promise<boolean> {
    if (kitReady()) {
        return true;
    }
    ctx.status('provisioning axe, knife and carrier log');
    const preferred = carrierName(ctx.treeName, Skills.level('fletching'));
    if (ctx.bankStand && await restockKit(ctx.bankStand, ctx.log, preferred)) {
        if (!hasAxe() && ctx.toolAcquire === 'on') {
            await withdrawCoins(ctx.bankStand, AXE_COINS, ctx.log);
            await acquireAxeAtBob(ctx.log, ctx.status);
        }
    }
    if (!hasAxe()) {
        await takeGround(ctx, AXE_NAMES, AXE_SPAWN, 'axe');
    }
    if (!hasKnife()) {
        await takeGround(ctx, [KNIFE], SEERS_KNIFE_SPAWN, 'knife');
    }
    // Only acquire a carrier when the pack has none; a lower tier is still valid.
    if (!findCarrier()) {
        await chopCarrier(ctx, preferred);
    }
    if (!kitReady(preferred)) {
        ctx.status('kit incomplete — need axe, knife and one Logs');
        return false;
    }
    return true;
}

async function takeGround(
    ctx: ProvisionContext,
    names: readonly string[],
    spawn: Tile,
    label: string
): Promise<boolean> {
    const here = Game.tile();
    if (here && Tile.from(here).distanceTo(spawn) > 60) {
        return false;
    }
    ctx.status(`taking a ${label} from the spawn`);
    if (!(await Traversal.walkResilient(spawn, {
        radius: 2,
        attempts: 2,
        timeoutMs: 120_000,
        log: m => ctx.log(`  ${m}`)
    }))) {
        return false;
    }
    const drop = GroundItems.query().name(...names).within(8).nearest();
    if (!drop) {
        return false;
    }
    await drop.interact('Take');
    const held = () => names.some(name => Inventory.count(name) > 0);
    return Execution.delayUntilTicks(held, 6);
}

async function chopCarrier(ctx: ProvisionContext, preferred: string): Promise<boolean> {
    const selectedLog = logForTreeName(ctx.treeName);
    const treeNames = preferred === selectedLog ? [ctx.treeName] : ['Tree', 'Dead tree'];
    ctx.status(`chopping a carrier ${preferred}`);
    if (Inventory.isFull()) {
        dropExtraLogs(1, preferred);
        await Execution.delayTicks(1);
    }
    const trees = Locs.query()
        .name(...treeNames)
        .action('Chop down')
        .results()
        .filter(tree => ctx.anchor.distanceTo(tree.tile()) <= 40)
        .sort((a, b) => a.distance() - b.distance())
        .slice(0, 6);
    if (trees.length === 0) {
        ctx.log(`carrier: no ${treeNames.join(' / ')} within radius for ${preferred}`);
        return false;
    }
    for (const tree of trees) {
        const tile = tree.tile();
        if (!(await Traversal.walkTo(tile, { radius: 2, timeoutMs: 30_000 }))) {
            ctx.log(`carrier: walk failed at ${tile.x},${tile.z}`);
            continue;
        }
        await tree.interact('Chop down');
        if (await Execution.delayUntilTicks(() => Inventory.first(preferred) !== null, 20)) {
            return true;
        }
        ctx.log(`carrier: no ${preferred} after chopping ${tile.x},${tile.z}`);
    }
    return false;
}
