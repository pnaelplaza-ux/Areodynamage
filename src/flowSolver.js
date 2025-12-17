// Tombstone wrapper: large flow solver implementation moved to ./flowCore.js for clarity.
// removed large implementation (resizeFlow, buildFlowField, sampleFlow, tick, isSolidAt, _getPressureGrid, etc.)

import * as core from "./flowCore.js";

// Re-export core functions so existing imports remain valid.
export const GRID_SIZE = core.GRID_SIZE;
export const resizeFlow = core.resizeFlow;
export const buildFlowField = core.buildFlowField;
export const sampleFlow = core.sampleFlow;
export const tick = core.tick;
export const isSolidAt = core.isSolidAt;
export const _getPressureGrid = core._getPressureGrid;
export const getStrouhal = core.getStrouhal;

