export type NorthSample = {
    readonly at: number; readonly tick: number;
    readonly x: number; readonly z: number; readonly level: number;
    readonly fish: number; readonly used: number; readonly xp: number;
    readonly bankOpen: boolean; readonly bankFish: number;
};

import assert from 'node:assert/strict';

export function assessNorthTrip(samples: readonly NorthSample[]): 'pass' | 'pending' {
    let full = false;
    let deposited = false;
    let firstBridge = false;
    let bankBridge = false;
    let returnBridge = false;
    let previous = samples[0];
    for (const value of samples) {
        if (!previous) break;
        const caught = value.fish > previous.fish && value.xp > previous.xp;
        assert(!caught || value.z >= 2976, 'south catch invalidates north proof');
        const distance = Math.max(Math.abs(value.x - previous.x), Math.abs(value.z - previous.z));
        assert(value.level === 0 && distance <= Math.max(4, (value.tick - previous.tick) * 4), 'player jump invalidates normal walking proof');
        const bridge = value.x >= 2831 && value.x <= 2833 && value.z >= 2972 && value.z <= 2974;
        if (bridge && !full) firstBridge = true;
        if (bridge && full && !deposited) bankBridge = true;
        if (bridge && deposited) returnBridge = true;
        if (value.used === 28 && value.fish >= 25 && value.z >= 2976 && firstBridge) full = true;
        if (full && bankBridge && value.bankOpen && value.bankFish >= 25 && value.fish === 0 && value.z <= 2957) deposited = true;
        if (deposited && returnBridge && caught) return 'pass';
        previous = value;
    }
    return 'pending';
}
