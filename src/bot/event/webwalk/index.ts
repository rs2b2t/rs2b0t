/**
 * World-walker library surface — teleports, travel catalog, requires, bank plan.
 * Product docs: docs/NAV.md
 */

export * from './types.js';
export * from './edgeId.js';
export * from './requires.js';
export * from './fromV1.js';
export * from './policy.js';
export * from './teleportCatalog.js';
export * from './wilderness.js';
export * from './geometry/lcCoord.js';
export * from './essenceExit.js';
export * from './essenceSession.js';
export * from './locRef.js';
export * from './travelCatalog.js';
export * from './transportQuestReqs.js';
export * from './worldStateData.js';
export * from './hops.js';
export * from './plannedEdge.js';
export * from './specialRequires.js';
export * from './stateAwareRequires.js';
export * from './activateStateAware.js';
export * from './virtualState.js';
export * from './bankPlan.js';
export * from './routeRecovery.js';
export * from './routeState.js';
// worldStateLive / teleportExecute import client adapter — use direct paths when needed
