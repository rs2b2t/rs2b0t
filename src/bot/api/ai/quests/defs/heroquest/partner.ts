import { runHandoff as runPartnerHandoff } from '../../../../trade/PartnerHandoff.js';
import type { QuestStep } from '../../engine/types.js';
import { HERO_ID, HERO_NAMED, HERO_TILE } from './areas.js';
import { HeroConfig, type HeroGang } from './config.js';
import { returnToStreet } from './doors.js';
import { HERO_STAGE } from './journal.js';

export type HeroHandoff = 'give-key' | 'take-key' | 'give-candlestick' | 'take-candlestick';

export interface HeroHandoffInput {
    gang: HeroGang;
    stage: number;
    /** Grip's spare key in the pack. */
    hasKey: boolean;
    /** Candlesticks in the pack — the chest hands the Black Arm bot two. */
    candlesticks: number;
    partnerConfigured: boolean;
    /** False while this side still owes itself a purchase or a withdrawal before it can use the trade. */
    ready: boolean;
}

// Why: Grip re-issues the spare whenever `~obj_gettotal(misc_key)` reads zero, so the flag stops a bot
// trading keys forever and the lure counter re-opens it for a rival that died holding one.

// Why: session scope is enough — a restart fetches one more key, which is correct work.
export const HeroHandoffState = { gaveKey: false, lureFailures: 0 };

/** How many fruitless lures it takes before the Black Arm bot fetches the rival another key. */
export const LURE_RETRIES_BEFORE_REFETCH = 3;

export function resetHeroHandoffState(): void {
    HeroHandoffState.gaveKey = false;
    HeroHandoffState.lureFailures = 0;
}

/** True while the Black Arm bot should go back to Grip for a spare key rather than lure him. */
export function shouldFetchKey(state: { gaveKey: boolean; lureFailures: number } = HeroHandoffState): boolean {
    return !state.gaveKey || state.lureFailures >= LURE_RETRIES_BEFORE_REFETCH;
}

// Why: `open_and_close_door` teleports the actor and re-shuts in three ticks, so the door opens for
// nobody else — the tradeable spare key goes over and the untradeable keyring comes off the floor.

/** Who owes whom, from the snapshot alone. */
export function decideHeroHandoff(input: HeroHandoffInput): HeroHandoff | null {
    if (!input.partnerConfigured) {
        return null;
    }
    if (input.gang === 'blackarm') {
        // Why: Grip re-issues the spare whenever `~obj_gettotal` reads zero, so giving it away costs nothing.
        if (input.stage >= HERO_STAGE.BLACKARM_PAPERS_GIVEN && input.stage < HERO_STAGE.BLACKARM_ARMBAND && input.hasKey) {
            return 'give-key';
        }
        // Why: the chest hands over two, one of them the rival's payment, and the armband bounds it
        // above because `opencandlechest` refuses while one is held or banked.
        if (input.stage >= HERO_STAGE.BLACKARM_LOOTED
            && input.stage < HERO_STAGE.BLACKARM_ARMBAND
            && input.candlesticks >= 2) {
            return 'give-candlestick';
        }
        return null;
    }
    // Why: the key is only useful with a bow already worn, and the walk to fetch one afterwards starts
    // in Brimhaven — where the nearest bank is Ardougne, across a fare each way.
    if (input.stage === HERO_STAGE.PHOENIX_CHARLIE && !input.hasKey && input.ready) {
        return 'take-key';
    }
    if (input.stage === HERO_STAGE.PHOENIX_KILLED_GRIP && input.candlesticks === 0) {
        return 'take-candlestick';
    }
    return null;
}

function itemFor(handoff: HeroHandoff): { id: number; name: string; giving: boolean } {
    switch (handoff) {
        case 'give-key': return { id: HERO_ID.MISC_KEY, name: HERO_NAMED.MISC_KEY, giving: true };
        case 'take-key': return { id: HERO_ID.MISC_KEY, name: HERO_NAMED.MISC_KEY, giving: false };
        case 'give-candlestick': return { id: HERO_ID.CANDLESTICK, name: HERO_NAMED.CANDLESTICK, giving: true };
        case 'take-candlestick': return { id: HERO_ID.CANDLESTICK, name: HERO_NAMED.CANDLESTICK, giving: false };
    }
}

export async function runHeroHandoff(handoff: HeroHandoff, log: (m: string) => void): Promise<boolean> {
    // Why: every trade meets on the street, and five of the six rooms this quest works in are pockets
    // the navigator has no edge out of.
    if (!(await returnToStreet(log))) {
        return false;
    }
    const want = itemFor(handoff);
    const moved = await runPartnerHandoff({
        partner: HeroConfig.partner,
        rendezvous: HERO_TILE.RENDEZVOUS,
        id: want.id,
        name: want.name,
        giving: want.giving,
        label: handoff,
        log
    });
    if (moved && handoff === 'give-key') {
        HeroHandoffState.gaveKey = true;
        HeroHandoffState.lureFailures = 0;
    }
    return moved;
}

export function heroHandoffStep(handoff: HeroHandoff): QuestStep {
    return {
        kind: 'custom',
        name: `${handoff} with ${HeroConfig.partner}`,
        run: log => runHeroHandoff(handoff, log)
    };
}
