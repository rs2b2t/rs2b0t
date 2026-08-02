/**
 * Nav v2 — Shortest Path–style routing contract for the 2004 bot client.
 * Plan: docs/superpowers/plans/2026-08-02-nav-v2.md
 */

export * from './types.js';
export * from './edgeId.js';
export * from './requires.js';
export * from './fromV1.js';
export * from './policy.js';
export * from './teleportCatalog.js';
export * from './worldStateData.js';
export * from './hops.js';
export * from './plannedEdge.js';
export * from './specialRequires.js';
// worldStateLive imports client adapter — import from path directly when needed in browser
