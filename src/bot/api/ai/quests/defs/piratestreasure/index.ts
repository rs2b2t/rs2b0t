import { customStep, decideJournalStage, talkTo as talk } from '../../engine/questSteps.js';
import { questRecord } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { FRANK, LUTHAS, PT_ID, PT_NAME, PT_STAGE, WYDIN, ZAMBO_SHOP } from './areas.js';
import { onKaramja, shipCrate } from './karamja.js';
import { readPiratesTreasureProgress } from './journal.js';
import { heldId, kit, wornId } from './supplies.js';
import { collectRum, digTreasure, openChest, readMessage } from './treasure.js';

const RUM_GP = 100;

function buyRum(): QuestStep {
    return { kind: 'buy', item: PT_NAME.RUM, qty: 1, shop: ZAMBO_SHOP, estGp: RUM_GP };
}

function ship(): QuestStep {
    return customStep('ship the crate from the plantation', shipCrate);
}

// Why: the apron is bought before the crossing so its Varrock trip rides the Varrock-Draynor-Port Sarim line and isn't a round trip after the rum ships.
const APRON_STAGES = new Set(['need-rum', 'rum-lost', 'rum-shipped', 'store-job']);

function smuggle(snap: QuestSnapshot, flag: string | undefined): QuestStep {
    switch (flag) {
        case 'rum-held-unemployed':
        case 'employed-need-rum':
            return heldId(snap, PT_ID.RUM) > 0 ? talk(LUTHAS) : buyRum();
        case 'rum-held-employed':
        case 'rum-in-crate':
        case 'crate-full':
            return ship();
        case 'rum-shipped':
            return talk(WYDIN);
        // Why: this page renders both for "the rum is waiting in Wydin's back room" and "the rum is still in the plantation crate", and only where you stand tells them apart.
        case 'store-job':
            if (onKaramja(snap.tile)) {
                return ship();
            }
            return wornId(snap, PT_ID.WHITE_APRON)
                ? customStep('search the back room for the rum', collectRum)
                : { kind: 'equip', item: PT_NAME.WHITE_APRON };
        // Why: `%hunt_store_employed = 2` renders this page for a rum bought minutes earlier on Karamja too, and carrying that onto the boat gets it confiscated.
        case 'rum-in-hand':
            return onKaramja(snap.tile) ? ship() : talk(FRANK);
        default:
            return heldId(snap, PT_ID.RUM) > 0 ? talk(LUTHAS) : buyRum();
    }
}

function treasure(snap: QuestSnapshot): QuestStep {
    if (heldId(snap, PT_ID.PIRATE_MESSAGE) > 0) {
        return customStep('read the pirate message', readMessage);
    }
    if (heldId(snap, PT_ID.CHEST_KEY) > 0) {
        return customStep('open the Blue Moon chest', openChest);
    }
    // Frank re-issues the key to anyone who turns up without one.
    return talk(FRANK);
}

export function decide(snap: QuestSnapshot): QuestStep {
    return decideJournalStage(snap, decideStage);
}

function decideStage(snap: QuestSnapshot, stage: number): QuestStep {
    const flag = [...(snap.progress?.flags ?? [])][0];
    const supplies = kit(
        snap,
        stage === PT_STAGE.FETCH_RUM && APRON_STAGES.has(flag ?? 'need-rum'),
        stage === PT_STAGE.READ_NOTE
    );
    if (supplies) {
        return supplies;
    }
    switch (stage) {
        case PT_STAGE.NOT_STARTED:
            return talk(FRANK);
        case PT_STAGE.FETCH_RUM:
            return smuggle(snap, flag);
        case PT_STAGE.RECEIVED_KEY:
            return treasure(snap);
        case PT_STAGE.READ_NOTE:
            return customStep('dig up the treasure', digTreasure);
        default:
            return { kind: 'done' };
    }
}

export const piratestreasure: QuestModule = {
    record: questRecord('hunt'),
    // Why: 4 kingdoms and a bankless island, so no booth is worth pinning.
    bank: 'nearest',
    // Why: the smuggle has to acquire at the stage that needs it, or the engine's provisioning block buys rum before Frank has asked for any.
    ownsInventory: true,
    tools: [
        'karamjan rum', 'chest key', 'pirate message', 'white apron', 'spade',
        'banana', 'coins'
    ],
    // Literals; this object is built at import, when QuestFood.name still holds its default. The host merges the configured food in.
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.5 },
    readProgress: readPiratesTreasureProgress,
    decide
};
