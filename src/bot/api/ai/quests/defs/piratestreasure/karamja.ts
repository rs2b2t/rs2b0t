import { Execution } from '../../../../execution/Execution.js';
import { Sustain } from '../../../../sustain/Sustain.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Locs } from '../../../../locs/Locs.js';
import { talkStrict } from '../../exec/primitives.js';
import { settleScene, useOnLoc } from '../../exec/prompts.js';
import { BANANA_TREE_IDS, LUTHAS, PT_ID, PT_LOC, PT_TILE } from './areas.js';
import { CRATE_FULL, searchBananaCrate } from './crate.js';

const KARAMJA_BOX = { minX: 2870, maxX: 2970, minZ: 3110, maxZ: 3210 };

/** True on Musa Point and the plantation, generously bounded. */
export function onKaramja(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    return Boolean(tile) && tile!.level === 0
        && tile!.x >= KARAMJA_BOX.minX && tile!.x <= KARAMJA_BOX.maxX
        && tile!.z >= KARAMJA_BOX.minZ && tile!.z <= KARAMJA_BOX.maxZ;
}

const held = (id: number): number => Inventory.countById(id);

// Why: the crate answers with both varps the client cannot read, so a resumed run learns whether the rum is already stashed instead of buying a second bottle.

/** Put the rum in the plantation crate, unless it is already in there. */
async function stashRum(log: (m: string) => void): Promise<boolean> {
    await Sustain.run();
    const state = await searchBananaCrate(log);
    if (state?.rum) {
        log('the rum is already in the crate');
        return true;
    }
    if (held(PT_ID.RUM) === 0) {
        log('no rum in the pack to stash');
        return false;
    }
    return useOnLoc(
        PT_ID.RUM,
        { name: 'Crate', near: PT_TILE.BANANA_CRATE, within: 6, id: PT_LOC.BANANA_CRATE },
        [],
        () => held(PT_ID.RUM) === 0,
        log
    );
}

/** Search trees until the pack holds `want` bananas or the grove runs dry. */
async function pickBananas(want: number, log: (m: string) => void): Promise<number> {
    if (held(PT_ID.BANANA) >= want) {
        return held(PT_ID.BANANA);
    }
    if (!(await Traversal.walkResilient(PT_TILE.BANANA_GROVE, { radius: 4, attempts: 3, timeoutMs: 180_000, log }))) {
        log('could not reach the banana grove');
        return held(PT_ID.BANANA);
    }
    for (let attempt = 0; attempt < 40 && held(PT_ID.BANANA) < want; attempt++) {
        await Sustain.run();
        await settleScene();
        const tree = Locs.query()
            .action('Search')
            .where(l => BANANA_TREE_IDS.includes(l.id))
            .within(20)
            .nearest();
        if (!tree) {
            log('no bearing Banana Tree in range of the grove anchor');
            break;
        }
        const before = held(PT_ID.BANANA);
        if (!(await tree.interact('Search'))) {
            continue;
        }
        await Execution.delayUntil(() => held(PT_ID.BANANA) > before, 4000);
    }
    log(`picked ${held(PT_ID.BANANA)} bananas`);
    return held(PT_ID.BANANA);
}

// Why: the crate's own message names the count, so the loop never keeps a tally the client could be wrong about.

/** Fill the plantation crate to ten bananas. */
async function fillCrate(log: (m: string) => void): Promise<boolean> {
    for (let pass = 0; pass < 4; pass++) {
        const state = await searchBananaCrate(log);
        if (!state) {
            return false;
        }
        if (state.bananas >= CRATE_FULL) {
            return true;
        }
        const want = CRATE_FULL - state.bananas;
        if ((await pickBananas(want, log)) === 0) {
            log('the grove gave up no bananas');
            return false;
        }
        await Sustain.run();
        if (!(await Traversal.walkResilient(PT_TILE.BANANA_CRATE, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
            return false;
        }
        await settleScene();
        for (let packed = 0; packed < want && held(PT_ID.BANANA) > 0; packed++) {
            const before = held(PT_ID.BANANA);
            if (!(await useOnLoc(
                PT_ID.BANANA,
                { name: 'Crate', near: PT_TILE.BANANA_CRATE, within: 6, id: PT_LOC.BANANA_CRATE },
                [],
                () => held(PT_ID.BANANA) < before,
                log
            ))) {
                break;
            }
        }
    }
    const done = await searchBananaCrate(log);
    return done !== null && done.bananas >= CRATE_FULL;
}

// Why: the journal reads `store-job` throughout the re-smuggle, so nothing here is separable into steps `decide()` could sequence — the leg has to run to completion on its own.
// Why: it ends on the mainland so the next decide tick is never stranded on the wrong side of the water.

/** Read the crate, stash, fill and ship it, then cross back to Port Sarim. */
export async function shipCrate(log: (m: string) => void): Promise<boolean> {
    await Sustain.run();
    let state = await searchBananaCrate(log);
    if (!state) {
        return false;
    }
    if (!state.rum) {
        if (held(PT_ID.RUM) === 0) {
            log('the crate is empty and no rum is carried — crossing back to Port Sarim');
            await Traversal.walkResilient(PT_TILE.WYDIN, { radius: 4, attempts: 3, timeoutMs: 300_000, log });
            return false;
        }
        // Why: `banana_crate.rs2` answers "Why would I want to do that?" to anyone not employed at the plantation, and Luthas clears that bit every time he ships a crate — so a second smuggle has to re-hire first, and the crate refusing the rum is the only thing that says so.
        if (!(await stashRum(log))) {
            log('the crate refused the rum — re-hiring at the plantation');
            if (!(await Traversal.walkResilient(LUTHAS.anchor, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
                return false;
            }
            if (!(await talkStrict(LUTHAS.npc, LUTHAS.prefer, log))) {
                return false;
            }
            if (!(await stashRum(log))) {
                log('the crate still refused the rum after re-hiring');
                return false;
            }
        }
        state = await searchBananaCrate(log);
        if (!state?.rum) {
            log('the rum did not land in the crate');
            return false;
        }
    }
    if (state.bananas < CRATE_FULL && !(await fillCrate(log))) {
        return false;
    }
    await Sustain.run();
    if (!(await Traversal.walkResilient(LUTHAS.anchor, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!(await talkStrict(LUTHAS.npc, LUTHAS.prefer, log))) {
        return false;
    }
    const after = await searchBananaCrate(log);
    if (!after || after.rum) {
        log('Luthas did not ship the crate');
        return false;
    }
    log('the crate has sailed — crossing back to Port Sarim');
    await Traversal.walkResilient(PT_TILE.WYDIN, { radius: 4, attempts: 3, timeoutMs: 300_000, log });
    return true;
}
