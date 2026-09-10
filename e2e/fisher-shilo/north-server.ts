import assert from 'node:assert/strict';

function point(value: unknown) {
    assert(typeof value === 'object' && value !== null && 'x' in value && 'z' in value && 'level' in value);
    assert(typeof value.x === 'number' && typeof value.z === 'number' && typeof value.level === 'number');
    return { x: value.x, z: value.z, level: value.level };
}

export function parseNorthServer(text: string, username: string) {
    return text.trim().split('\n').map(line => {
        const value: unknown = JSON.parse(line);
        assert(typeof value === 'object' && value !== null && 'at' in value && 'tick' in value && 'spots' in value);
        assert(typeof value.at === 'number' && typeof value.tick === 'number' && Array.isArray(value.spots));
        const spots: readonly unknown[] = value.spots;
        const players: readonly unknown[] = 'players' in value && Array.isArray(value.players) ? value.players : [];
        const player = players.find(p => typeof p === 'object' && p !== null && 'username' in p && p.username === username);
        return { at: value.at, tick: value.tick, spots: spots.map(point), player: player ? point(player) : null };
    });
}

export function verifyNorthServer(rows: ReturnType<typeof parseNorthServer>): void {
    assert(rows.length >= 20, 'authoritative server fixture observations missing');
    let previous = rows[0];
    for (const row of rows) {
        assert.deepEqual(row.spots, [
            { x: 2850, z: 2976, level: 0 }, { x: 2855, z: 2977, level: 0 }, { x: 2860, z: 2976, level: 0 }
        ], 'all live NPC317 spots must stay north and stationary');
        assert(row.player, 'test player missing from authoritative trace');
        if (previous?.player) {
            const distance = Math.max(Math.abs(row.player.x - previous.player.x), Math.abs(row.player.z - previous.player.z));
            assert(row.player.level === 0 && distance <= 2 * (row.tick - previous.tick), 'authoritative player teleport/jump');
        }
        previous = row;
    }
}
