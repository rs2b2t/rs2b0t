import { PRICE_BOOK_SETTINGS, PRICE_BOOK_SETTINGS_NS, SettingsStore } from '../../runtime/Settings.js';
import { parseBooks, serializeBooks, type PriceBook } from './priceBook.js';

const KEY = 'books';

export const PriceBooks = {
    all(): PriceBook[] {
        return parseBooks(SettingsStore.displayString(PRICE_BOOK_SETTINGS_NS, KEY, PRICE_BOOK_SETTINGS[KEY]!));
    },

    names(): string[] {
        return PriceBooks.all().map(b => b.name);
    },

    byName(name: string): PriceBook | null {
        const wanted = name.trim().toLowerCase();
        return PriceBooks.all().find(b => b.name.toLowerCase() === wanted) ?? null;
    },

    save(list: readonly PriceBook[]): void {
        SettingsStore.save(PRICE_BOOK_SETTINGS_NS, KEY, serializeBooks(list));
    }
};
