export interface TargetLogEvent {
    t: number;
    msg: string;
}

export interface TargetChange {
    t: number;
    from: number | null;
    to: number;
    via: 'engage' | 'adoption';
    why: string;
    gapS: number | null;
    msg: string;
}

// Why: every target change is recorded, from engage lines and adoption lines alike, so no change can hide behind the event before it.
// Why: a change with a giant still held can only be the stall re-pick, which needs 4s without the held giant's health moving. Polls stamp events 2s apart, so a stamped gap under 2s cannot be a stall and stays unexplained.
// Why: adoption takes a hold only when none is held, so an adoption change stands only when no target was held yet or a recorded release below cleared the prior one. An adoption over a held target stays unexplained.
export function targetChanges(events: TargetLogEvent[]): TargetChange[] {
    const changes: TargetChange[] = [];
    let current: number | null = null;
    let pendingWhy = 'first target';
    let lastTargetT: number | null = null;
    for (const e of events) {
        const engage = /engaging fire giant (\d+)/.exec(e.msg);
        const adopt = /fire giant (\d+) is on us/.exec(e.msg);
        if (engage) {
            const idx = Number(engage[1]);
            if (idx !== current) {
                const gapS = lastTargetT === null ? null : e.t - lastTargetT;
                const why = current === null ? pendingWhy : gapS !== null && gapS >= 2 ? 'stall re-pick' : 'unexplained';
                changes.push({ t: e.t, from: current, to: idx, via: 'engage', why, gapS, msg: e.msg });
            }
            current = idx;
            lastTargetT = e.t;
        } else if (adopt) {
            const idx = Number(adopt[1]);
            if (idx !== current) {
                const why = current === null ? 'giant on us adopted' : 'unexplained';
                changes.push({ t: e.t, from: current, to: idx, via: 'adoption', why, gapS: lastTargetT === null ? null : e.t - lastTargetT, msg: e.msg });
            }
            current = idx;
            lastTargetT = e.t;
        } else if (/stalled — re-issuing/.test(e.msg)) {
            lastTargetT = e.t;
        } else if (/fire giant down/.test(e.msg)) {
            current = null;
            pendingWhy = 'previous giant down';
        } else if (/was taken by another player/.test(e.msg)) {
            current = null;
            pendingWhy = 'previous giant taken';
        } else if (/pulled us off the safespot/.test(e.msg)) {
            current = null;
            pendingWhy = 'safespot skip';
        } else if (/washed|teleported out|inside the Waterfall|banking \(food|panic at|out of supplies mid-fight/.test(e.msg)) {
            current = null;
            pendingWhy = 'new trip';
        }
    }
    return changes;
}
