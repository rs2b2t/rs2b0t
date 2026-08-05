import { describe, expect, test } from 'bun:test';
import { BUILD_INFO, formatBuildInfo } from '#/config/buildInfo.js';

describe('BUILD_INFO', () => {
    test('has the shape harnesses and the UI expect', () => {
        expect(typeof BUILD_INFO.commit).toBe('string');
        expect(typeof BUILD_INFO.short).toBe('string');
        expect(typeof BUILD_INFO.dirty).toBe('boolean');
        expect(typeof BUILD_INFO.builtAt).toBe('string');
        expect(typeof BUILD_INFO.label).toBe('string');
        expect(BUILD_INFO.short.length).toBeGreaterThan(0);
        expect(BUILD_INFO.label.startsWith(BUILD_INFO.short) || BUILD_INFO.label === 'unknown').toBe(true);
    });

    test('formatBuildInfo includes the label', () => {
        const line = formatBuildInfo();
        expect(line.includes(BUILD_INFO.label)).toBe(true);
    });
});
