import { describe, expect, test } from 'bun:test';
import {
    BANK_OPTIONS,
    DEFAULT_BANK,
    MODE_OPTIONS,
    PACK,
    ROLE_OPTIONS,
    bankChoice,
    describeLines,
    isConfiguredAccount,
    isGiverRole,
    isReceiverRole,
    listedRows,
    nextBatchIndex,
    nextUnserved,
    normalizeAccount,
    parseAccounts,
    parseItemNames,
    parseLoadout,
    pickBankRow,
    pickBankRows,
    pickRequestTarget,
    planDeliveries,
    planWithdrawal,
    resolveRole,
    type BankRow,
    type LoadoutLine
} from '#/bot/scripts/MuleDepot/MuleDepotLogic.js';

/** One name on two rows, which is what an unnoted stack beside its noted form looks like. */
const HERBS: BankRow[] = [
    { id: 199, name: 'Guam herb', count: 40 },
    { id: 10169, name: 'Guam herb', count: 120 },
    { id: 995, name: 'Coins', count: 90_000 }
];

const BANK: BankRow[] = [
    { id: 317, name: 'Raw shark', count: 500 },
    { id: 995, name: 'Coins', count: 90_000 },
    { id: 5291, name: 'Yew logs', count: 0 },
    { id: 23469, name: 'Raw shark', count: 40 }
];

function loadout(...quantities: [string | number, number][]): LoadoutLine[] {
    return parseLoadout(quantities.map(([item, quantity]) => `${quantity} ${item}`)).lines;
}

describe('MuleDepotLogic', () => {
    describe('resolveRole', () => {
        test('accepts all four valid pairs', () => {
            expect(resolveRole('Dump', 'Mule')).toBe('Mule');
            expect(resolveRole('Dump', 'Supermule')).toBe('Supermule');
            expect(resolveRole('Supply', 'Supplier')).toBe('Supplier');
            expect(resolveRole('Supply', 'Client')).toBe('Client');
        });

        test('is case and whitespace insensitive', () => {
            expect(resolveRole(' dump ', ' SUPERMULE ')).toBe('Supermule');
        });

        test('rejects a designation from the other mode', () => {
            // A Supermule in Supply mode has no list to hand out, and a Client in Dump mode has
            // nothing to receive, so guessing here would produce a bot that does nothing.
            expect(resolveRole('Dump', 'Supplier')).toBeNull();
            expect(resolveRole('Dump', 'Client')).toBeNull();
            expect(resolveRole('Supply', 'Mule')).toBeNull();
            expect(resolveRole('Supply', 'Supermule')).toBeNull();
        });

        test('rejects an unknown mode or designation', () => {
            expect(resolveRole('Haul', 'Mule')).toBeNull();
            expect(resolveRole('Dump', 'Chef')).toBeNull();
            expect(resolveRole('', '')).toBeNull();
        });
    });

    describe('role sides', () => {
        test('mule and supplier give, supermule and client take', () => {
            for (const role of ROLE_OPTIONS) {
                expect(isGiverRole(role)).toBe(role === 'Mule' || role === 'Supplier');
                expect(isReceiverRole(role)).toBe(!isGiverRole(role));
            }
        });
    });

    describe('option lists', () => {
        test('the default bank is offered', () => {
            expect(MODE_OPTIONS).toEqual(['Dump', 'Supply']);
            expect(ROLE_OPTIONS).toEqual(['Mule', 'Supermule', 'Supplier', 'Client']);
            expect(BANK_OPTIONS).toContain(DEFAULT_BANK);
        });

        test('every offered bank resolves to a location', () => {
            for (const name of BANK_OPTIONS) {
                expect(bankChoice(name).name).toBe(name);
            }
        });

        test('an unknown bank falls back to the default rather than throwing', () => {
            expect(bankChoice('Atlantis').name).toBe(DEFAULT_BANK);
            expect(bankChoice('').name).toBe(DEFAULT_BANK);
        });
    });

    describe('parseAccounts', () => {
        test('splits on commas and normalizes', () => {
            expect(parseAccounts(' Player_One , stranger ')).toEqual(['player one', 'stranger']);
        });

        test('drops blanks and dedupes', () => {
            expect(parseAccounts('A,,B, a ,')).toEqual(['a', 'b']);
        });

        test('non-breaking space normalizes like a plain space', () => {
            expect(normalizeAccount('Player\u00A0One')).toBe('player one');
        });
    });

    describe('isConfiguredAccount', () => {
        test('matches case insensitively', () => {
            expect(isConfiguredAccount('Player1', ['player1'])).toBe(true);
        });

        test('rejects a stranger and an empty list', () => {
            expect(isConfiguredAccount('Stranger', ['player1'])).toBe(false);
            expect(isConfiguredAccount('Player1', [])).toBe(false);
            expect(isConfiguredAccount(null, ['player1'])).toBe(false);
        });
    });

    describe('parseItemNames', () => {
        test('trims, drops blanks, and dedupes case insensitively', () => {
            expect(parseItemNames([' Raw shark ', '', 'Coins', 'raw SHARK', '   '])).toEqual(['Raw shark', 'Coins']);
        });

        test('keeps first-seen casing for the log', () => {
            expect(parseItemNames(['raw shark'])).toEqual(['raw shark']);
        });

        test('an empty list yields nothing', () => {
            expect(parseItemNames([])).toEqual([]);
        });
    });

    describe('parseLoadout', () => {
        test('reads a quantity-prefixed name', () => {
            const { lines, problems } = parseLoadout(['10000 Cooked meat']);
            expect(problems).toEqual([]);
            expect(lines).toEqual([{ id: -1, name: 'Cooked meat', quantity: 10_000, raw: '10000 Cooked meat' }]);
        });

        test('a bare name defaults to one', () => {
            expect(parseLoadout(['Cooked meat']).lines).toEqual([
                { id: -1, name: 'Cooked meat', quantity: 1, raw: 'Cooked meat' }
            ]);
        });

        test('an all-digit item is an id and keeps no name', () => {
            expect(parseLoadout(['500 995']).lines).toEqual([{ id: 995, name: '', quantity: 500, raw: '500 995' }]);
        });

        test('a name containing digits is still a name', () => {
            expect(parseLoadout(['10 Coins (995)']).lines[0]).toMatchObject({ id: -1, name: 'Coins (995)' });
        });

        test('skips blanks and comments', () => {
            const { lines, problems } = parseLoadout(['', '   ', '# cooking loadout', '5 Cooked meat']);
            expect(lines).toHaveLength(1);
            expect(problems).toEqual([]);
        });

        test('merges duplicate entries so a repeated item costs one slot', () => {
            expect(parseLoadout(['100 Cooked meat', '50 cooked MEAT']).lines).toEqual([
                { id: -1, name: 'Cooked meat', quantity: 150, raw: '100 Cooked meat' }
            ]);
        });

        test('reports a zero quantity as a problem rather than a line', () => {
            const { lines, problems } = parseLoadout(['0 Cooked meat', '5 Cooked meat']);
            expect(lines).toHaveLength(1);
            expect(problems).toEqual([{ line: 1, raw: '0 Cooked meat', reason: 'quantity must be 1 or more' }]);
        });

        test('a bare number is an id with quantity one', () => {
            expect(parseLoadout(['995']).lines).toEqual([{ id: 995, name: '', quantity: 1, raw: '995' }]);
        });

        test('an empty list yields no lines and no problems', () => {
            expect(parseLoadout([])).toEqual({ lines: [], problems: [] });
        });
    });

    describe('planDeliveries', () => {
        const stackable: (line: LoadoutLine) => number = () => 1;
        const perUnit: (line: LoadoutLine) => number = line => line.quantity;

        test('a loadout that fits is one batch', () => {
            expect(planDeliveries(loadout(['Cooked meat', 10], ['Rune essence', 500]), stackable))
                .toHaveLength(1);
        });

        test('splits at the slot width and keeps order', () => {
            const lines = Array.from({ length: PACK * 2 + 3 }, (_, i) => `Item ${i}`);
            const batches = planDeliveries(parseLoadout(lines).lines, stackable);
            expect(batches).toHaveLength(3);
            expect(batches[0]!.lines).toHaveLength(PACK);
            expect(batches[2]!.lines).toHaveLength(3);
            expect(batches[2]!.lines[0]!.name).toBe(`Item ${PACK * 2}`);
        });

        test('carries one oversized line across batches instead of truncating it', () => {
            const batches = planDeliveries(parseLoadout(['1000 Cooked meat']).lines, stackable);
            expect(batches).toHaveLength(1);
            expect(batches[0]!.lines[0]!.quantity).toBe(1000);
        });

        test('a non-stackable line is cut by slot count and resumed in the next batch', () => {
            const batches = planDeliveries(loadout(['Bronze sword', PACK + 5]), perUnit);
            expect(batches).toHaveLength(2);
            expect(batches[0]!.lines[0]!.quantity).toBe(PACK);
            expect(batches[1]!.lines[0]!.quantity).toBe(5);
        });

        test('a partly used batch is topped up by the next line', () => {
            // Only the sword costs a slot per unit. The meat stacks, so it costs one slot for all
            // ten and rides in the single slot the sword left behind.
            const mixed: (line: LoadoutLine) => number = line => (line.name === 'Bronze sword' ? line.quantity : 1);
            const batches = planDeliveries(loadout(['Bronze sword', PACK - 1], ['Cooked meat', 10]), mixed);
            expect(batches).toHaveLength(1);
            expect(batches[0]!.lines.map(line => line.quantity)).toEqual([PACK - 1, 10]);
        });

        test('delivers the whole quantity across every batch', () => {
            const lines = loadout(['Cooked meat', 10_000], ['Bronze sword', PACK + 5]);
            const total = planDeliveries(lines, line => (line.name === 'Cooked meat' ? 1 : line.quantity))
                .flatMap(batch => batch.lines)
                .reduce((sum, line) => sum + line.quantity, 0);
            expect(total).toBe(10_000 + PACK + 5);
        });

        test('an empty loadout plans no batches', () => {
            expect(planDeliveries([], stackable)).toEqual([]);
        });

        test('a zero slot width still delivers everything', () => {
            const batches = planDeliveries(loadout(['Cooked meat', 3]), stackable, 0);
            expect(batches.flatMap(batch => batch.lines).reduce((sum, line) => sum + line.quantity, 0)).toBe(3);
        });
    });

    describe('pickBankRow', () => {
        test('matches case insensitively', () => {
            expect(pickBankRow('raw shark', BANK)?.id).toBe(317);
        });

        test('prefers the unnoted row when the noted ids are known', () => {
            expect(pickBankRow('Raw shark', BANK, new Set([23469]))?.id).toBe(317);
        });

        test('falls back to the first row when every candidate is noted', () => {
            expect(pickBankRow('Raw shark', BANK, new Set([317, 23469]))?.id).toBe(317);
        });

        test('skips an empty row and an absent name', () => {
            expect(pickBankRow('Yew logs', BANK)).toBeNull();
            expect(pickBankRow('Adamantite bar', BANK)).toBeNull();
        });
    });

    describe('planWithdrawal', () => {
        test('takes each listed item whole, in CSV order', () => {
            // Room decides how many distinct items come along; it does not cap a line, or the
            // first entry would take the whole pack and starve the rest.
            const plan = planWithdrawal(['Raw shark', 'Coins'], BANK, 2);
            expect(plan).toEqual([
                { id: 317, name: 'Raw shark', quantity: 500 },
                { id: 23469, name: 'Raw shark', quantity: 40 }
            ]);
        });

        test('takes both stacks of one name in a single pass', () => {
            expect(planWithdrawal(['Guam herb'], HERBS, 4)).toEqual([
                { id: 199, name: 'Guam herb', quantity: 40 },
                { id: 10169, name: 'Guam herb', quantity: 120 }
            ]);
        });

        test('takes only what the free room admits when one name has two stacks', () => {
            expect(planWithdrawal(['Guam herb'], HERBS, 1)).toEqual([
                { id: 199, name: 'Guam herb', quantity: 40 }
            ]);
        });

        test('skips a name the bank does not hold', () => {
            const plan = planWithdrawal(['Adamantite bar', 'Coins'], BANK, 4);
            expect(plan).toEqual([{ id: 995, name: 'Coins', quantity: 90_000 }]);
        });

        test('skips a row the bank holds none of', () => {
            expect(planWithdrawal(['Yew logs', 'Coins'], BANK, 4).map(line => line.id)).toEqual([995]);
        });

        test('prefers the unnoted row', () => {
            expect(planWithdrawal(['Raw shark'], BANK, 1, new Set([23469]))[0]!.id).toBe(317);
        });

        test('stops when the pack is full', () => {
            expect(planWithdrawal(['Raw shark', 'Coins'], BANK, 1)).toHaveLength(1);
            expect(planWithdrawal(['Raw shark', 'Coins'], BANK, 0)).toEqual([]);
        });

        test('an empty CSV plans nothing', () => {
            expect(planWithdrawal([], BANK, 28)).toEqual([]);
        });
    });

    describe('pickBankRows', () => {
        test('returns every row a name sits on', () => {
            // Why: taking only the first row leaves the rest for a later trip, so a name held on
            // two rows needs two passes and the mule looks stalled between them.
            expect(pickBankRows('Guam herb', HERBS).map(r => r.id)).toEqual([199, 10169]);
        });

        test('puts the unnoted row first when the noted ids are known', () => {
            expect(pickBankRows('Guam herb', HERBS, new Set([10169])).map(r => r.id)).toEqual([199, 10169]);
        });

        test('keeps the noted row when it is all the bank holds', () => {
            expect(pickBankRows('Guam herb', HERBS, new Set([199])).map(r => r.id)).toEqual([10169, 199]);
        });

        test('an absent or empty name yields nothing', () => {
            expect(pickBankRows('Snapdragon', HERBS)).toEqual([]);
            expect(pickBankRows('  ', HERBS)).toEqual([]);
        });

        test('a single row is returned as itself', () => {
            expect(pickBankRows('Coins', HERBS).map(r => r.id)).toEqual([995]);
        });
    });

    describe('listedRows', () => {
        test('is the list in order, whatever the free room', () => {
            // Why: the dumper's keep set comes from here, and a full pack makes the withdrawal plan
            // empty, so using the plan would bank the haul it is carrying.
            expect(listedRows(['Coins', 'Guam herb'], HERBS).map(line => line.id)).toEqual([995, 199, 10169]);
        });

        test('skips a name the bank does not hold or holds none of', () => {
            expect(listedRows(['Adamantite bar', 'Yew logs', 'Coins'], BANK).map(line => line.id)).toEqual([995]);
        });

        test('ignores free slots entirely', () => {
            expect(listedRows(['Guam herb', 'Coins'], HERBS)).toHaveLength(3);
        });

        test('prefers the unnoted row', () => {
            expect(listedRows(['Raw shark'], BANK, new Set([23469]))[0]!.id).toBe(317);
        });

        test('an empty list yields nothing', () => {
            expect(listedRows([], BANK)).toEqual([]);
        });
    });

    describe('nextBatchIndex', () => {
        test('stays on the client until its last batch lands', () => {
            // Why: advancing the client per batch would serve everyone a partial loadout.
            expect(nextBatchIndex(0, 3)).toEqual({ index: 1, clientDone: false });
            expect(nextBatchIndex(1, 3)).toEqual({ index: 2, clientDone: false });
        });

        test('wraps and finishes the client on the last batch', () => {
            expect(nextBatchIndex(2, 3)).toEqual({ index: 0, clientDone: true });
        });

        test('a single-batch loadout finishes on the first transfer', () => {
            expect(nextBatchIndex(0, 1)).toEqual({ index: 0, clientDone: true });
        });
    });

    describe('pickRequestTarget', () => {
        const all = { acceptable: () => true, visible: () => true };

        test('walks the list from the cursor', () => {
            expect(pickRequestTarget({ ...all, asker: null, accounts: ['a', 'b', 'c'], cursor: 0 })).toBe('a');
            expect(pickRequestTarget({ ...all, asker: null, accounts: ['a', 'b', 'c'], cursor: 1 })).toBe('b');
            expect(pickRequestTarget({ ...all, asker: null, accounts: ['a', 'b', 'c'], cursor: 2 })).toBe('c');
            expect(pickRequestTarget({ ...all, asker: null, accounts: ['a', 'b', 'c'], cursor: 3 })).toBe('a');
        });

        test('reaches every account, so a stopped one cannot hold the rotation', () => {
            // Why: a stopped mule keeps standing on the bank tile and stays visible, so a cursor
            // that only moves after a transfer would ask that one mule for ever.
            const seen = new Set<string>();
            for (let cursor = 0; cursor < 3; cursor++) {
                seen.add(pickRequestTarget({ ...all, asker: null, accounts: ['dead', 'live1', 'live2'], cursor })!);
            }
            expect([...seen].sort()).toEqual(['dead', 'live1', 'live2']);
        });

        test('an account that asked goes first whatever the cursor says', () => {
            expect(pickRequestTarget({ ...all, asker: 'b', accounts: ['a', 'b'], cursor: 0 })).toBe('b');
        });

        test('an ask from someone unacceptable is ignored', () => {
            const chosen = pickRequestTarget({
                asker: 'stranger',
                accounts: ['a', 'b'],
                cursor: 1,
                acceptable: () => true,
                visible: () => true
            });
            expect(chosen).toBe('b');
        });

        test('skips an asker that is not in sight', () => {
            const chosen = pickRequestTarget({
                asker: 'b',
                accounts: ['a', 'b'],
                cursor: 0,
                acceptable: () => true,
                visible: name => name === 'a'
            });
            expect(chosen).toBe('a');
        });

        test('skips an acceptable account that is out of sight', () => {
            const chosen = pickRequestTarget({
                asker: null,
                accounts: ['a', 'b', 'c'],
                cursor: 0,
                acceptable: () => true,
                visible: name => name !== 'a'
            });
            expect(chosen).toBe('b');
        });

        test('a supplier only ever asks the account it owes', () => {
            const accounts = ['a', 'b'];
            const owed = 'b';
            for (const cursor of [0, 1, 2]) {
                expect(pickRequestTarget({
                    asker: null,
                    accounts,
                    cursor,
                    acceptable: name => name === owed,
                    visible: () => true
                })).toBe('b');
            }
        });

        test('nothing eligible yields null', () => {
            expect(pickRequestTarget({ ...all, asker: null, accounts: [], cursor: 0 })).toBeNull();
            expect(pickRequestTarget({ asker: null, accounts: ['a'], cursor: 0, acceptable: () => false, visible: () => true })).toBeNull();
            expect(pickRequestTarget({ asker: null, accounts: ['a'], cursor: 0, acceptable: () => true, visible: () => false })).toBeNull();
        });
    });

    describe('nextUnserved', () => {
        test('walks the configured order', () => {
            expect(nextUnserved(['a', 'b', 'c'], new Set(['a']))).toBe('b');
            expect(nextUnserved(['a', 'b', 'c'], new Set(['a', 'b']))).toBe('c');
        });

        test('returns null once everyone is served', () => {
            expect(nextUnserved(['a', 'b'], new Set(['a', 'b']))).toBeNull();
            expect(nextUnserved([], new Set())).toBeNull();
        });

        test('matches served names regardless of case', () => {
            expect(nextUnserved(['Player One'], new Set(['player one']))).toBeNull();
        });
    });

    describe('describeLines', () => {
        test('names an item and falls back to its id', () => {
            expect(describeLines([{ id: -1, name: 'Cooked meat', quantity: 500 }])).toBe('500 Cooked meat');
            expect(describeLines([{ id: 995, name: '', quantity: 500 }])).toBe('500 #995');
        });

        test('says so when there is nothing', () => {
            expect(describeLines([])).toBe('nothing');
        });
    });
});
