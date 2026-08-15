import { describe, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { itemIconDataUrl } from '#/bot/panel/itemIcon.js';

describe('reader.itemIconPixels', () => {
    test('returns null for an id with no sprite rather than throwing', () => {
        expect(reader.itemIconPixels(999_999)).toBeNull();
    });

    test('is callable without the client cache loaded', () => {
        expect(() => reader.itemIconPixels(1333)).not.toThrow();
    });
});

describe('itemIconDataUrl', () => {
    test('is null when there are no pixels to draw', () => {
        expect(itemIconDataUrl(999_999)).toBeNull();
    });

    test('does not throw without the client cache loaded', () => {
        expect(() => itemIconDataUrl(1333)).not.toThrow();
    });
});
