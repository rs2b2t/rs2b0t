import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

test.each(['', 'OtherFeature', 'OtherFeature,V8CppGCEnableLargerCage'])('desktop enables the larger Oilpan reservation before startup, preserving features: %s', existing => {
    const switches = new Map([['enable-features', existing]]);
    let startupFeatures = '';
    runInNewContext(readFileSync(new URL('../../desktop/main.cjs', import.meta.url), 'utf8'), {
        __dirname: '/desktop',
        require: (name: string) => {
            if (name === 'node:path') return { join };
            if (name === './storage-session.cjs') return { prepareStorage: () => ({}) };
            if (name !== 'electron') throw new Error(`Unexpected module: ${name}`);
            return {
                app: {
                    commandLine: {
                        getSwitchValue: (key: string) => switches.get(key) ?? '',
                        appendSwitch: (key: string, value = '') => switches.set(key, value)
                    },
                    whenReady: () => {
                        startupFeatures = switches.get('enable-features') ?? '';
                        return new Promise(() => {});
                    },
                    on: () => {}
                }
            };
        }
    });
    const features = startupFeatures.split(',');
    expect(features.filter(feature => feature === 'V8CppGCEnableLargerCage')).toHaveLength(1);
    if (existing.includes('OtherFeature')) expect(features).toContain('OtherFeature');
    expect(switches.has('disable-background-timer-throttling')).toBe(true);
    expect(switches.has('disable-renderer-backgrounding')).toBe(true);
});
