import { expect, test } from 'bun:test';
import { threeTickFlyProfile } from '#/bot/scripts/GatheringBot/TickManipLogic.js';

test('4-tick fly profile uses the knife cycle and a 3-tick roll cadence', () => {
    const profile = threeTickFlyProfile();
    expect(profile.method).toBe('three-tick-fly');
    expect(profile.threeTickFlyCycle).toBe(true);
    expect(profile.useKnifeDelay).toBe(true);
    expect(profile.timedReclick).toBe(true);
    expect(profile.nativeCycleTicks).toBe(3);
});
