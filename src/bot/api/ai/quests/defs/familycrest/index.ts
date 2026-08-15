import { Execution } from '../../../../execution/Execution.js';
import { Reach } from '../../../../walking/Reach.js';
import { Traversal } from '../../../../walking/Traversal.js';
import { ChatDialog } from '../../../../ui/dialogue/ChatDialog.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Npcs } from '../../../../npcs/Npcs.js';
import type Tile from '../../../../../geometry/Tile.js';
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { driveChoice, settleScene } from '../../exec/prompts.js';
import type { NpcStop } from '../../exec/primitives.js';
import {
    ANTIPOISON_IDS,
    FC_ID,
    FC_ITEM,
    FC_NPC,
    FC_STAGE,
    inChronozonLair
} from './areas.js';
import { combineCrest, fightChronozon } from './chronozon.js';
import { readFamilyCrestProgress } from './journal.js';
import {
    craftPerfectJewellery,
    enterGoldMine,
    leaveGoldMine,
    mineRegion,
    minePerfectGold,
    PERFECT_ORE_NEEDED,
    smeltPerfectBars
} from './mine.js';
import {
    ANTIPOISON_GP,
    bankedAntipoison,
    bestBankPickaxe,
    BLAST_RUNES,
    CALEB_FISH,
    coinTopUp,
    deposit,
    FC_FOODS,
    foodTopUp,
    fromBank,
    hasPickaxe,
    hasWeapon,
    held,
    heldAntipoison,
    heldFood,
    heldName,
    LEG_BANK,
    MOULD_GP,
    RUBY_GP,
    RUNE_GP,
    SHOP,
    teleportKitTopUp,
    warnFamilyCrestReadiness,
    wieldWeapon,
    type FcItem
} from './supplies.js';

function custom(name: string, run: (log: (m: string) => void) => Promise<boolean>): QuestStep {
    return { kind: 'custom', name, run };
}

const DIMINTHEIS_START: NpcStop = {
    npc: 'Dimintheis',
    anchor: FC_NPC.DIMINTHEIS,
    leash: 8,
    prefer: ['Why would a nobleman live in a dump like this?', 'So where is this crest?', 'Ok, I will help you.']
};

const DIMINTHEIS_FINISH: NpcStop = {
    npc: 'Dimintheis',
    anchor: FC_NPC.DIMINTHEIS,
    leash: 8,
    prefer: []
};

const CALEB_START: NpcStop = {
    npc: 'Caleb',
    anchor: FC_NPC.CALEB,
    leash: 8,
    prefer: ['Are you Caleb Fitzharmon?', 'So can I have your bit?', 'Ok, I will get those.']
};

// Why: handing the fish over promotes to stage 3 and then offers the question that promotes to stage 4, so one conversation covers both.
const CALEB_FISH_STOP: NpcStop = {
    npc: 'Caleb',
    anchor: FC_NPC.CALEB,
    leash: 8,
    prefer: ['Uh... what happened to the rest of it?', 'Thank you very much!']
};

const GEM_TRADER: NpcStop = {
    npc: 'Gem trader',
    anchor: FC_NPC.GEM_TRADER,
    leash: 8,
    prefer: ["I'm in search of a man named Avan Fitzharmon."]
};

const BOOT: NpcStop = {
    npc: 'Boot',
    anchor: FC_NPC.BOOT,
    leash: 8,
    prefer: ["Hello. I'm in search of very high quality gold."]
};

// Why: both brothers re-issue their fragment when asked, but only while neither the pack nor the bank holds it, which is why nothing in this module ever banks one.
// Why: Avan's line calls it a "fragment" and Caleb's a "piece".
const CALEB_LOST: NpcStop = {
    npc: 'Caleb',
    anchor: FC_NPC.CALEB,
    leash: 8,
    prefer: ['I have lost the piece you gave me.']
};

const JOHNATHON: NpcStop = {
    npc: 'Johnathon',
    anchor: FC_NPC.JOHNATHON,
    leash: 8,
    prefer: []
};

/**
 * Avan's NPC is called "Man" and Al Kharid is full of them, so he is addressed
 * by id. Everything else about the stop is an ordinary walk-and-talk.
 */
async function talkToAvan(prefer: string[], log: (m: string) => void): Promise<boolean> {
    const find = () => Npcs.query().where(n => n.id === FC_NPC.AVAN_NPC_ID).nearest();
    if (!find() && !(await Traversal.walkResilient(FC_NPC.AVAN, { radius: 3, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    if (!find()) {
        log('Avan (npc 663) is not in the scene by the gold rocks');
        return false;
    }
    const status = await Reach.entityOp({
        find,
        op: 'Talk-to',
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        openWhenUnreachable: true,
        expectMs: 15_000,
        what: 'Avan',
        log
    });
    if (status !== 'done') {
        log('Avan never opened a dialogue');
        return false;
    }
    return driveChoice(prefer, log);
}

/** Any dose cures Johnathon; `opnpcu` accepts all four. */
async function cureJohnathon(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(FC_NPC.JOHNATHON, { radius: 2, attempts: 4, timeoutMs: 180_000, log }))) {
        return false;
    }
    await settleScene();
    const potion = Inventory.items().find(i => (ANTIPOISON_IDS as readonly number[]).includes(i.id));
    const npc = Npcs.query().name('Johnathon').within(8).nearest();
    if (!potion || !npc) {
        log('no antipoison in the pack, or Johnathon is not upstairs');
        return false;
    }
    if (!(await potion.useOn(npc))) {
        return false;
    }
    await Execution.delayUntil(() => ChatDialog.isOpen() || ChatDialog.canContinue(), 6000);
    // Why: curing him promotes the stage and then opens a three-way about Chronozon with no "goodbye" until a branch is taken, so the list has to walk it out rather than stop at the first menu.
    return driveChoice(['Where can I find Chronozon?', 'I will be on my way now.'], log);
}

function crestParts(snap: QuestSnapshot): number {
    return [FC_ID.CREST_FROM_CALEB, FC_ID.CREST_FROM_AVAN, FC_ID.CREST_FROM_CHRONOZON]
        .filter(id => held(snap, id) > 0).length;
}

function missingFish(snap: QuestSnapshot): FcItem[] {
    return CALEB_FISH.filter(fish => held(snap, fish.id) === 0);
}

/**
 * Bank, then a shop, then park with the exact shortfall. Returns null when the
 * need is already met.
 */
function source(
    snap: QuestSnapshot,
    item: FcItem,
    qty: number,
    bank: Tile,
    shop?: { npc: string; anchor: Tile },
    estGp?: number
): QuestStep | null {
    const short = qty - held(snap, item.id);
    if (short <= 0) {
        return null;
    }
    const fromTheBank = fromBank(snap, item, qty, bank);
    if (fromTheBank) {
        return fromTheBank;
    }
    if (shop) {
        return { kind: 'buy', item: item.name, qty: short, shop, estGp: estGp ?? 5000 };
    }
    return { kind: 'wait', reason: `need ${short}x ${item.name} — none in the bank and nothing sells it` };
}

// Why: runes are stackable, so one withdraw covers the fight.
// Why: the top-up is measured against a third of the buy quantity rather than against `BLAST_MINIMUM`, which is one cast of each.
// Why: the teleport kit carries 30 fire runes, which satisfied that minimum, so the fight went in with six Fire Blasts and spent the kill phase casting nothing.

/** Withdraw the blast runes when the pack is short, or null. */
function sourceRunes(snap: QuestSnapshot): QuestStep | null {
    for (const want of BLAST_RUNES) {
        if (held(snap, want.item.id) >= Math.ceil(want.qty / 3)) {
            continue;
        }
        const banked = fromBank(snap, want.item, want.qty, LEG_BANK.chronozon);
        if (banked) {
            return banked;
        }
        return { kind: 'buy', item: want.item.name, qty: want.qty, shop: SHOP.AUBURY, estGp: RUNE_GP };
    }
    return null;
}

/** One to cure Johnathon, one for the spiders on the gate tiles. */
const ANTIPOISON_CARRY = 2;

// Why: this covers the fight and the walk out, sized to the pack rather than to appetite.
// Why: five rune stacks, law, coins, the ring, two doses and the crest fragments leave about nineteen slots after the pre-wilderness deposit, so asking for more means a withdraw that cannot complete.
const ENDGAME_FOOD = 16;

function sourceAntipoison(snap: QuestSnapshot, want: number): QuestStep | null {
    if (heldAntipoison(snap) >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: LEG_BANK.chronozon };
    }
    const inBank = bankedAntipoison(snap);
    if (inBank) {
        const step = fromBank(snap, inBank, want, LEG_BANK.chronozon);
        if (step) {
            return step;
        }
    }
    // Jiminua is a Karamja round trip — worth it for the dose the quest cannot
    // proceed without, not for a spare.
    if (heldAntipoison(snap) === 0) {
        return { kind: 'buy', item: 'Antipoison(3)', qty: ANTIPOISON_CARRY, shop: SHOP.JIMINUA, estGp: ANTIPOISON_GP };
    }
    return null;
}

// Why: this is fetched at stage 8, before the walk to the Jolly Boar Inn, as Varrock East and Aubury both sit on that walk.
// Why: sourcing each piece where it is first needed meant three separate trips back to Varrock — one for the dose that cures him, one for the blast runes, one for the spare dose.

/** Everything the Johnathon-to-Chronozon run needs, in one visit. */
function endgameLoadout(snap: QuestSnapshot): QuestStep | null {
    const runes = sourceRunes(snap);
    if (runes) {
        // Coins only while there is still something to buy, or this and the
        // pre-wilderness deposit take turns undoing each other.
        return coinTopUp(snap, 150_000, LEG_BANK.chronozon) ?? runes;
    }
    const potions = sourceAntipoison(snap, ANTIPOISON_CARRY);
    if (potions) {
        return potions;
    }
    const food = foodTopUp(snap, ENDGAME_FOOD, LEG_BANK.chronozon);
    if (food) {
        return food;
    }
    return wieldWeapon(snap, LEG_BANK.chronozon);
}

/** Keep-lists for the deposits this quest makes; fragments are kept by id. */
const ALWAYS_KEEP = ['coins', ...FC_FOODS.map(f => f.toLowerCase())];

// Why: coins and the ring of dueling are absent on purpose, as that is what this deposit is for.
// Why: law runes are kept, since the lair sits at wilderness level 3, far under the level-20 spell cutoff, so keeping them turns the walk home into a Varrock teleport the moment the last fragment is in hand.
// Why: that walk crosses the black demons and giant skeletons on the way out, and it has killed a run.
const WILDERNESS_KEEP = [
    ...FC_FOODS.map(f => f.toLowerCase()),
    ...BLAST_RUNES.map(r => r.item.name.toLowerCase()),
    FC_ITEM.LAW_RUNE.toLowerCase(),
    'antipoison',
    'scimitar'
];

function tidyFor(snap: QuestSnapshot, need: number, keep: string[], bank: Tile): QuestStep | null {
    return (snap.freeSlots ?? 28) >= need ? null : deposit([...ALWAYS_KEEP, ...keep], bank);
}

// Why: no quest varp is read, as none of `%crestquest` is transmitted.
// Why: the flow runs Dimintheis → Caleb (five cooked fish) → an Al Kharid trader → Avan → Boot → perfect gold (lever puzzle, furnace, jewellery) → Avan → Johnathon (antipoison) → Chronozon (four blasts) → combine → Dimintheis.

/** Pure decide over journal stage plus held items. */
export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete') {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    const stage = snap.progress?.stage ?? snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Family Crest stage unavailable' };
    }
    if (stage >= FC_STAGE.COMPLETE) {
        return { kind: 'done' };
    }

    // The endgame outranks the stage: Chronozon's drop is the only evidence that
    // stage 10 finished, and the restored crest is the only evidence of the combine.
    if (held(snap, FC_ID.FAMILY_CREST) > 0) {
        return { kind: 'talk', stop: DIMINTHEIS_FINISH };
    }
    if (crestParts(snap) === 3) {
        return custom('combine the three crest parts', combineCrest);
    }

    // Why: a fragment that should be held and is not was lost to a death, or to a run that banked it before this module existed.
    // Why: both brothers hand theirs over again and the last one drops from Chronozon again, so this is a detour rather than a dead quest.
    if (stage >= FC_STAGE.CALEB_WHERE && held(snap, FC_ID.CREST_FROM_CALEB) === 0) {
        return { kind: 'talk', stop: CALEB_LOST };
    }
    // Why: at stage 8 `switch_int(%crestquest)` sends `crest_avan_piece` to `avan_where`, which is pure chat about Johnathon with no "I have lost the fragment" branch.
    // Why: that branch lives in `avan_pieces`, the `default` case, from stage 9 on, so talking to Johnathon first advances into it.
    if (stage >= FC_STAGE.SPOKEN_JOHNATHON && held(snap, FC_ID.CREST_FROM_AVAN) === 0) {
        return custom('ask Avan to replace the fragment', log =>
            talkToAvan(['I have lost the fragment you gave me.'], log));
    }

    if (stage === FC_STAGE.NOT_STARTED) {
        return { kind: 'talk', stop: DIMINTHEIS_START };
    }

    // Why: one bank trip, before the first long leg, and only when the operator has nav teleports on — A* will not plan a hop the live inventory cannot pay for, and nothing else in this quest ever carries a law rune.
    // Why: it is skipped while Chronozon is still standing, as the wilderness deposit banks the kit on purpose and re-fetching it here walked thirty law runes and a ring of dueling straight back into the fight they were banked to avoid.
    // Why: the walk home afterwards is the price, and it is one leg.
    const fightPending = stage === FC_STAGE.CURED_JOHNATHON
        && held(snap, FC_ID.CREST_FROM_CHRONOZON) === 0;
    if (!fightPending) {
        const teleKit = teleportKitTopUp(snap, LEG_BANK.start);
        if (teleKit) {
            return teleKit;
        }
    }

    // --- Caleb: the five cooked fish ---
    if (stage <= FC_STAGE.CALEB_PIECE) {
        if (stage === FC_STAGE.SPOKEN_DIMINTHEIS) {
            return { kind: 'talk', stop: CALEB_START };
        }
        if (stage === FC_STAGE.SPOKEN_CALEB) {
            const short = missingFish(snap);
            if (short.length > 0) {
                const tidy = tidyFor(snap, short.length + 2, CALEB_FISH.map(f => f.name.toLowerCase()), LEG_BANK.caleb);
                if (tidy) {
                    return tidy;
                }
                for (const fish of short) {
                    const step = fromBank(snap, fish, 1, LEG_BANK.caleb);
                    if (step) {
                        return step;
                    }
                }
                if (!snap.bankKnown) {
                    return { kind: 'scanBank', bank: LEG_BANK.caleb };
                }
                return {
                    kind: 'wait',
                    reason: `Caleb needs cooked ${short.map(f => f.name).join(', ')} — none in the bank`
                };
            }
        }
        return { kind: 'talk', stop: CALEB_FISH_STOP };
    }

    // --- The desert: an Al Kharid trader, then Avan, then Boot ---
    if (stage === FC_STAGE.CALEB_WHERE) {
        return { kind: 'talk', stop: GEM_TRADER };
    }
    if (stage === FC_STAGE.SPOKEN_GEM_TRADER) {
        return custom('ask Avan about the crest', log =>
            talkToAvan(["I'm looking for a man named Avan Fitzharmon."], log));
    }
    if (stage === FC_STAGE.SPOKEN_AVAN) {
        return { kind: 'talk', stop: BOOT };
    }

    // --- Perfect gold: mine, smelt, craft, hand over ---
    if (stage === FC_STAGE.SPOKEN_BOOT) {
        const haveRing = held(snap, FC_ID.PERFECT_RUBY_RING) > 0;
        const haveNecklace = held(snap, FC_ID.PERFECT_RUBY_NECKLACE) > 0;
        if (haveRing && haveNecklace) {
            return custom('hand Avan the perfect jewellery', log => talkToAvan([], log));
        }

        const inMine = mineRegion(snap.tile) !== 'outside';
        const made = (haveRing ? 1 : 0) + (haveNecklace ? 1 : 0);
        const outstanding = 2 - made;
        const supply = held(snap, FC_ID.PERFECT_GOLD_BAR) + held(snap, FC_ID.PERFECT_GOLD_ORE);

        if (inMine) {
            if (supply < outstanding && held(snap, FC_ID.PERFECT_GOLD_ORE) < PERFECT_ORE_NEEDED) {
                return custom('mine perfect gold', minePerfectGold);
            }
            return custom('climb out of the gold mine', leaveGoldMine);
        }

        if (supply < outstanding) {
            // Why: nothing in the mine can be fetched from inside it and the walk back out costs the lever chain, so everything is sourced before entering.
            // Why: the bank is pinned to Ardougne rather than left to "nearest" because the next stop is Witchaven — from Boot, Falador is the closer booth but the Falador-then-Witchaven walk is about 90 tiles longer.
            // Why: an unread bank is no evidence of an empty one, as deciding "buy from Nurmof" before the first scan sends the bot across the map for a pickaxe that was in the bank all along.
            if (!snap.bankKnown && (!hasPickaxe(snap) || !hasWeapon(snap) || heldFood(snap) === 0)) {
                return { kind: 'scanBank', bank: LEG_BANK.mine };
            }
            const pickaxe = hasPickaxe(snap)
                ? null
                : (bestBankPickaxe(snap)
                    ? fromBank(snap, bestBankPickaxe(snap)!, 1, LEG_BANK.mine)
                    : { kind: 'buy' as const, item: 'Steel pickaxe', qty: 1, shop: SHOP.NURMOF, estGp: 2000 });
            if (pickaxe) {
                return pickaxe;
            }
            const food = foodTopUp(snap, 10, LEG_BANK.mine);
            if (food) {
                return food;
            }
            const arm = wieldWeapon(snap, LEG_BANK.mine);
            if (arm) {
                return arm;
            }
            return custom('climb down into the perfect-gold mine', enterGoldMine);
        }

        // Why: everything left after the mine — the moulds, the rubies, the furnace and Avan himself — is in Al Kharid, so the moulds and rubies are sourced before the smelt to keep it to one trip.
        // Why: coins come first, as a `buy` step withdraws its own `estGp` threshold, so buying the ring mould leaves the pack a few coins under it and the next purchase walks back to the bank.
        // Why: one float covers the leg.
        const legCoins = coinTopUp(snap, 50_000, LEG_BANK.gold);
        if (legCoins) {
            return legCoins;
        }
        const moulds: [FcItem, number][] = [
            [{ id: FC_ID.RING_MOULD, name: FC_ITEM.RING_MOULD }, haveRing ? 0 : 1],
            [{ id: FC_ID.NECKLACE_MOULD, name: FC_ITEM.NECKLACE_MOULD }, haveNecklace ? 0 : 1]
        ];
        for (const [mould, qty] of moulds) {
            if (qty === 0) {
                continue;
            }
            const step = source(snap, mould, qty, LEG_BANK.gold, SHOP.DOMMIK, MOULD_GP);
            if (step) {
                return step;
            }
        }
        // Why: rubies are the one thing this quest cannot reliably buy — the Ardougne gem merchant restocks a single cut ruby every 60k ticks and no other shop stocks one.
        // Why: the shop is tried once and the shortfall reported plainly, rather than looping on a stall the watchdog would report as "no progress".
        const rubyShort = outstanding - held(snap, FC_ID.RUBY);
        if (rubyShort > 0) {
            const banked = fromBank(snap, { id: FC_ID.RUBY, name: FC_ITEM.RUBY }, outstanding, LEG_BANK.gold);
            if (banked) {
                return banked;
            }
            if (snap.noProgress >= 2) {
                return {
                    kind: 'wait',
                    reason: `need ${rubyShort}x Ruby — none in the bank, and the Ardougne gem merchant stocks one`
                };
            }
            return { kind: 'buy', item: FC_ITEM.RUBY, qty: rubyShort, shop: SHOP.GEM_MERCHANT, estGp: RUBY_GP };
        }
        if (held(snap, FC_ID.PERFECT_GOLD_ORE) > 0) {
            return custom('smelt the perfect gold', smeltPerfectBars);
        }
        return custom('craft the perfect gold jewellery', craftPerfectJewellery);
    }

    // --- Johnathon ---
    if (stage === FC_STAGE.AVAN_PIECE) {
        const load = endgameLoadout(snap);
        if (load) {
            return load;
        }
        return { kind: 'talk', stop: JOHNATHON };
    }
    if (stage === FC_STAGE.SPOKEN_JOHNATHON) {
        // Normally already carried from stage 8; this only fires after a death.
        if (heldAntipoison(snap) === 0) {
            const potions = sourceAntipoison(snap, ANTIPOISON_CARRY);
            if (potions) {
                return potions;
            }
        }
        return custom('cure Johnathon with antipoison', cureJohnathon);
    }

    // --- Chronozon ---
    if (stage === FC_STAGE.CURED_JOHNATHON) {
        // Why: everything below is preparation and preparation re-runs every tick, which inside the lair is a trap — eating three sharks or drinking a dose drops the pack under a threshold and the bot walks out mid-fight to top up.
        // Why: once through the gates, the fight owns what it is carrying.
        if (inChronozonLair(snap.tile)) {
            return custom('kill Chronozon with the four blasts', fightChronozon);
        }
        // Normally all fetched at stage 8; this re-runs the same list so a death
        // re-provisions rather than walking in empty.
        const load = endgameLoadout(snap);
        if (load) {
            return load;
        }
        // Everything is bought: bank the float before stepping into the
        // wilderness, where dying drops it. Nothing past this point costs coin.
        if (heldName(snap, FC_ITEM.COINS) > 0) {
            return deposit(WILDERNESS_KEEP, LEG_BANK.chronozon);
        }
        return custom('kill Chronozon with the four blasts', fightChronozon);
    }

    return { kind: 'wait', reason: `no plan for Family Crest stage ${stage}` };
}

export const familycrest: QuestModule = {
    record: QUESTS.find(r => r.id === 'crest')!,
    bank: 'nearest',
    ownsInventory: true,
    tools: ['coins', 'ruby', 'ring mould', 'necklace mould', 'antipoison'],
    readProgress: readFamilyCrestProgress,
    sustain: { foods: [...FC_FOODS], eatBelowHp: 0.55 },
    warnReadiness: warnFamilyCrestReadiness,
    exit: leaveGoldMine,
    decide
};

// Test seams.
export { parseFamilyCrestJournal, readFamilyCrestProgress, describeJournal } from './journal.js';
export { FC_STAGE, FC_ID, FC_ITEM, FC_NPC, FC_QUEST, inPerfectGoldZone } from './areas.js';
export { mineRegion } from './mine.js';
export { BLASTS, SAFESPOT } from './chronozon.js';
export { CREST_KEEP_IDS, warnFamilyCrestReadiness, FC_OFFICIAL_SKILLS, teleportKitTopUp, teleportKitPlan, TELEPORT_KIT } from './supplies.js';
