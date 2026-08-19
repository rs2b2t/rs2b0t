import { beforeEach, describe, expect, test } from 'bun:test';

import { armourWanted, resetUnwearable } from '#/bot/api/ai/quests/defs/holygrail/armour.js';
import { GRAIL_TILE } from '#/bot/api/ai/quests/defs/holygrail/areas.js';
import { GRAIL_STAGE, decide, excaliburPlan, holygrail } from '#/bot/api/ai/quests/defs/holygrail/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    worn?: string[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: { x: number; z: number; level: number } | null;
}

function counts(names: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
}

const KIT = ['Rune chainbody', 'Rune platelegs', 'Rune full helm', 'Rune kiteshield'];

function snap(options: Options = {}): QuestSnapshot {
    const stage = options.stage ?? GRAIL_STAGE.NOT_STARTED;
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        worn: new Set((options.worn ?? []).map(n => n.toLowerCase())),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set() },
        bank: counts(options.bank ?? ['Excalibur', 'Coins', ...KIT]),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? { x: 3222, z: 3218, level: 0 } : options.tile,
        freeSlots: 20
    };
}

/** Fully armed and on the mainland: the state every mid-quest branch starts from. */
function armed(options: Options = {}): QuestSnapshot {
    return snap({ ...options, worn: [...KIT, 'Excalibur', ...(options.worn ?? [])] });
}

const custom = (step: QuestStep): string => (step.kind === 'custom' ? step.name : `${step.kind}`);

beforeEach(() => {
    resetUnwearable();
});

describe('Holy Grail decide', () => {
    test('an unloaded quest list waits rather than restarting the quest', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('a green quest list is done', () => {
        expect(decide(snap({ journal: 'complete' }))).toEqual({ kind: 'done' });
    });

    test('an unread bank is scanned before the armour planner runs', () => {
        const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_CRONE, bankKnown: false }));
        expect(step.kind).toBe('scanBank');
    });

    test('inside the realm an unread bank never sends the bot back for one', () => {
        const step = decide(armed({ stage: GRAIL_STAGE.SPOKEN_CRONE, bankKnown: false, tile: GRAIL_TILE.REALM_ARRIVAL }));
        expect(step.kind).toBe('custom');
    });

    test('not started talks to King Arthur', () => {
        const step = decide(snap({ journal: 'notStarted', stage: GRAIL_STAGE.NOT_STARTED }));
        expect(step.kind === 'talk' && step.stop.npc).toBe('King Arthur');
    });

    test('started opens the workshop door for Merlin', () => {
        expect(custom(decide(snap({ stage: GRAIL_STAGE.STARTED })))).toContain('Merlin');
    });

    describe('the Entrana leg', () => {
        test('banks everything the monk would find, keeping coin and food', () => {
            const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_MERLIN, inv: ['Excalibur', 'Coins', 'Lobster'] }), 'Lobster');
            expect(step.kind).toBe('deposit');
            expect(step.kind === 'deposit' && step.exactKeep).toBe(true);
            expect(step.kind === 'deposit' && step.keep).toEqual(['Coins', 'Lobster']);
        });

        test('a pack of coin and food alone is not banked again', () => {
            const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_MERLIN, inv: ['Coins', 'Lobster'], worn: ['Rune chainbody'] }), 'Lobster');
            expect(custom(step)).toContain('Entrana');
        });

        test('a stripped pack and bare shoulders sail on and talk to the High Priest', () => {
            const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_MERLIN, inv: ['Coins'] }), 'Lobster');
            expect(step.kind === 'talk' && step.stop.npc).toBe('High Priest');
        });
    });

    describe('the crossing', () => {
        test('re-arms with Excalibur before anything else', () => {
            const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_CRONE, inv: ['Holy table napkin'] }));
            expect(step).toEqual({ kind: 'withdraw', items: [{ name: 'Excalibur', qty: 1 }] });
        });

        test('a held Excalibur is wielded, not carried', () => {
            const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_CRONE, inv: ['Holy table napkin', 'Excalibur'] }));
            expect(step).toEqual({ kind: 'equip', item: 'Excalibur' });
        });

        test('no napkin anywhere sends the bot to Galahad first', () => {
            const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_CRONE }));
            expect(step.kind === 'talk' && step.stop.npc).toBe('Galahad');
        });

        test('a banked napkin is withdrawn rather than begged for again', () => {
            const step = decide(snap({ stage: GRAIL_STAGE.SPOKEN_CRONE, bank: ['Holy table napkin', 'Excalibur'] }));
            expect(step).toEqual({ kind: 'withdraw', items: [{ name: 'Holy table napkin', qty: 1 }] });
        });

        test('armed and holding the napkin, it fetches two whistles', () => {
            const step = armedCrossing(['Holy table napkin']);
            expect(custom(step)).toContain('Draynor Manor');
        });

        test('two whistles in the pack means blow at the six heads', () => {
            const step = armedCrossing(['Holy table napkin', 'Magic whistle', 'Magic whistle']);
            expect(custom(step)).toContain('six heads');
        });

        test('stage 7 is the same errand as stage 4', () => {
            const four = armedCrossing(['Holy table napkin', 'Magic whistle', 'Magic whistle'], GRAIL_STAGE.SPOKEN_CRONE);
            const seven = armedCrossing(['Holy table napkin', 'Magic whistle', 'Magic whistle'], GRAIL_STAGE.FAILED_TITAN);
            expect(custom(seven)).toBe(custom(four));
        });

        test('in the realm it runs the one realm step', () => {
            const step = decide(armed({
                stage: GRAIL_STAGE.SPOKEN_CRONE,
                inv: ['Holy table napkin', 'Magic whistle'],
                tile: GRAIL_TILE.REALM_ARRIVAL
            }));
            expect(custom(step)).toContain('realm');
        });

        test('landing on the titan side without Excalibur wields the carried one', () => {
            const step = decide(snap({
                stage: GRAIL_STAGE.SPOKEN_CRONE,
                inv: ['Magic whistle', 'Excalibur'],
                tile: GRAIL_TILE.REALM_ARRIVAL
            }));
            expect(step).toEqual({ kind: 'equip', item: 'Excalibur' });
        });

        test('landing on the titan side with no Excalibur at all leaves to fetch it', () => {
            const step = decide(snap({
                stage: GRAIL_STAGE.SPOKEN_CRONE,
                inv: ['Magic whistle'],
                tile: GRAIL_TILE.REALM_ARRIVAL
            }));
            expect(custom(step)).toContain('fetch Excalibur');
        });
    });

    describe('finding Sir Percival', () => {
        test('the realm is left before the Goblin Village walk', () => {
            const step = decide(armed({
                stage: GRAIL_STAGE.FINDING_PERCIVAL,
                inv: ['Magic whistle'],
                tile: GRAIL_TILE.CASTLE_LANDING
            }));
            expect(custom(step)).toContain('leave the realm');
        });

        test('a whistle in hand opens the sacks', () => {
            const step = decide(armed({ stage: GRAIL_STAGE.FINDING_PERCIVAL, inv: ['Magic whistle'] }));
            expect(custom(step)).toContain('Percival');
        });

        test('no whistle means another Draynor Manor trip', () => {
            const step = decide(armed({ stage: GRAIL_STAGE.FINDING_PERCIVAL, inv: ['Holy table napkin'] }));
            expect(custom(step)).toContain('Draynor Manor');
        });

        test('a banked napkin is withdrawn before the whistle trip', () => {
            const step = decide(armed({ stage: GRAIL_STAGE.FINDING_PERCIVAL, bank: ['Holy table napkin'] }));
            expect(step).toEqual({ kind: 'withdraw', items: [{ name: 'Holy table napkin', qty: 1 }] });
        });

        test('no napkin anywhere waits and names why Galahad is no longer an option', () => {
            const step = decide(armed({ stage: GRAIL_STAGE.FINDING_PERCIVAL, bank: [] }));
            expect(step.kind === 'wait' && step.reason).toContain('Holy table napkin');
        });
    });

    describe('claiming the Grail', () => {
        test('with the whistle spent on Percival it walks back to the six heads', () => {
            const step = decide(armed({ stage: GRAIL_STAGE.GIVEN_WHISTLE, inv: ['Magic whistle'] }));
            expect(custom(step)).toContain('six heads');
        });

        test('inside the renewed realm it lifts the Grail off the table', () => {
            const step = decide(armed({
                stage: GRAIL_STAGE.GIVEN_WHISTLE,
                inv: ['Magic whistle'],
                tile: GRAIL_TILE.GRAIL_STAND
            }));
            expect(custom(step)).toContain('Holy Grail');
        });

        test('holding the Grail in the realm blows the whistle out', () => {
            const step = decide(armed({
                stage: GRAIL_STAGE.GIVEN_WHISTLE,
                inv: ['Magic whistle', 'Holy grail'],
                tile: GRAIL_TILE.GRAIL_STAND
            }));
            expect(custom(step)).toContain('out of the realm');
        });

        test('holding the Grail on the mainland hands it to King Arthur', () => {
            const step = decide(armed({ stage: GRAIL_STAGE.GIVEN_WHISTLE, inv: ['Magic whistle', 'Holy grail'] }));
            expect(step.kind === 'talk' && step.stop.npc).toBe('King Arthur');
        });
    });

    test('an unmapped stage waits with the stage in the reason', () => {
        expect(decide(snap({ stage: 5 }))).toEqual({ kind: 'wait', reason: 'unmapped Holy Grail stage 5' });
    });
});

function armedCrossing(inv: string[], stage: number = GRAIL_STAGE.SPOKEN_CRONE): QuestStep {
    return decide(armed({ stage, inv }));
}

describe('Excalibur sourcing', () => {
    test('the bank is used before the Lady of the Lake', () => {
        expect(excaliburPlan(snap())).toEqual({ kind: 'withdraw', items: [{ name: 'Excalibur', qty: 1 }] });
    });

    test('with 500 coins held she sells it back', () => {
        const step = excaliburPlan(snap({ bank: ['Coins'], inv: new Array(500).fill('Coins') }));
        expect(step.kind === 'talk' && step.stop.npc).toBe('The Lady of the Lake');
    });

    test('with the coins banked they are withdrawn first', () => {
        const step = excaliburPlan(snap({ bank: ['Coins'] }));
        expect(step).toEqual({ kind: 'withdraw', items: [{ name: 'Coins', qty: 500 }] });
    });

    test('with no coin anywhere it waits and says why', () => {
        const bare = { ...snap({ bank: [] }), bankCoins: 0 };
        expect(excaliburPlan(bare)).toEqual({
            kind: 'wait',
            reason: 'need 500 gp to buy Excalibur back from the Lady of the Lake'
        });
    });
});

describe('the armour planner', () => {
    test('picks the best banked piece per slot and never a weapon', () => {
        expect(armourWanted(snap())).toEqual(['Rune chainbody', 'Rune platelegs', 'Rune full helm', 'Rune kiteshield']);
    });

    test('a chainbody outranks a platebody, which rune refuses without Dragon Slayer', () => {
        expect(armourWanted(snap({ bank: ['Rune platebody', 'Rune chainbody'] }))).toEqual(['Rune chainbody']);
    });

    test('worn slots are left alone', () => {
        expect(armourWanted(snap({ worn: KIT }))).toEqual([]);
    });

    test('a lower tier is taken when the bank has nothing better', () => {
        expect(armourWanted(snap({ bank: ['Mithril platelegs'] }))).toEqual(['Mithril platelegs']);
    });
});

describe('the module record', () => {
    test('Merlin\'s Crystal is a hard prerequisite', () => {
        expect(holygrail.record.requirements.quests).toEqual(['arthur']);
    });

    test('Excalibur is the one declared item, and it is gatherable', () => {
        expect(holygrail.record.items).toEqual([{ name: 'Excalibur', qty: 1, kind: 'acquirable' }]);
        expect(holygrail.gather?.excalibur).toBeDefined();
    });

    test('every quest item and armour word is kept from the spillover deposit', () => {
        for (const name of ['excalibur', 'holy table napkin', 'magic whistle', 'grail bell', 'holy grail', 'coins', 'chainbody', 'kiteshield']) {
            expect(holygrail.tools).toContain(name);
        }
    });

    test('the titan is a declared grind target so random events do not misread the fight', () => {
        expect(holygrail.grind).toContain('Black Knight Titan');
    });
});
