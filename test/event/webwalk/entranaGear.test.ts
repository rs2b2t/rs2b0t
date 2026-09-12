import { expect, test } from 'bun:test';
import { namesHaveEntranaRestrictedGear } from '#/bot/event/webwalk/exec/specialCrossing.js';

test.each(['Dragonhide body', 'Dragonhide chaps', 'Dragon vambraces', 'Coif', 'Dragonfire shield', 'Legends cape', 'Leather gloves', 'Studded body', 'Wizard hat', 'Dragon dagger(p)', 'Magic shortbow', 'Maple longbow'])(
    'the monks refuse %s, every armour slot but feet and every weapon', name => {
        expect(namesHaveEntranaRestrictedGear([name])).toBe(true);
    }
);
test.each(['Amulet of glory', 'Leather boots', 'Rune arrow', 'Shark', 'Clue scroll', 'Spade', 'Sextant', 'Superantipoison(4)', 'Coins'])(
    'the monks let %s through', name => {
        expect(namesHaveEntranaRestrictedGear([name])).toBe(false);
    }
);
