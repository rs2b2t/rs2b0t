// docs/QUESTS.md
import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Shop } from '../../../../shop/Shop.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { GameMessages } from '../../../../chatbox/gameMessages.js';
import { ANTIPOISON_DOSES, ANTIPOISON_GP, ANTIPOISON_SHOP, SC_ITEM } from './areas.js';

const WALK_MS = 300_000;
const DRINK_MS = 5000;

/** `poison_player`'s own opening line, and the only reading of `%poison` there is. */
const POISONED = /you have been poisoned/i;

function heldDose(): string | undefined {
    return ANTIPOISON_DOSES.find(name => Inventory.count(name) > 0);
}

/** Chat position to measure a later poison against. */
export function poisonMark(): number {
    return GameMessages.mark();
}

// Why: this is best-effort by design — an empty shop or a short purse leaves the leg to run the corridor uncured rather than parking a quest that has always finished without one.

/** Cross to Musa Point for a dose before the dungeon. */
export async function stockAntipoison(log: (m: string) => void): Promise<void> {
    if (heldDose() !== undefined) {
        return;
    }
    const coins = Inventory.count('Coins');
    if (coins < ANTIPOISON_GP) {
        log(`scorpcatcher: ${coins} gp will not cover the ${ANTIPOISON_GP} the antipoison trip costs — running the spiders uncured`);
        return;
    }
    log('scorpcatcher: crossing to Musa Point for an antipoison');
    if (!(await Traversal.walkResilient(ANTIPOISON_SHOP.anchor, { radius: 3, attempts: 3, timeoutMs: WALK_MS, log }))) {
        log('scorpcatcher: could not reach the Karamja general store — running the spiders uncured');
        return;
    }
    if (!(await Shop.open(ANTIPOISON_SHOP.npc))) {
        log('scorpcatcher: the Karamja general store would not open — running the spiders uncured');
        return;
    }
    await Shop.buy(SC_ITEM.ANTIPOISON, 1);
    await Shop.close();
    log(heldDose() !== undefined
        ? `scorpcatcher: bought an ${SC_ITEM.ANTIPOISON}`
        : 'scorpcatcher: the Karamja general store is out of antipoison — running the spiders uncured');
}

// Why: a dose cures and then holds `%poison` negative for five poison ticks, which is 90 seconds — drunk anywhere the spiders can still reach, that window expires and they poison the run again.

/** Drink the dose once the deep dungeon gate is shut, and only if something inside poisoned us. */
export async function curePoison(mark: number, log: (m: string) => void): Promise<void> {
    if (!GameMessages.sawSince(mark, POISONED)) {
        return;
    }
    const name = heldDose();
    if (name === undefined) {
        log('scorpcatcher: poisoned in the dungeon with no antipoison to drink');
        return;
    }
    const before = Inventory.count(name);
    const dose = Inventory.items().find(item => item.name === name);
    if (!dose || !(await dose.interact('Drink'))) {
        log(`scorpcatcher: the ${name} refused the drink`);
        return;
    }
    if (await Execution.delayUntil(() => Inventory.count(name) < before, DRINK_MS)) {
        log(`scorpcatcher: drank the ${name} clear of the spiders`);
    }
}
