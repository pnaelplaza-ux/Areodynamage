/*
Tombstone wrapper: the large core implementation has been split into smaller modules for maintainability.
Removed detailed implementations: createFlowField(), setObstacleData(), resizeFlow(), buildFlowField(), sampleFlow(), computeDragIndex(), renderObstacleOverlay(), getObstacleData(), tick(), softNoise(), and related internal state — these now live in src/obstacle.js and src/aeroCore.js
*/

import * as core from "./aeroCore.js";

// Re-export core functions so existing imports remain valid.
export const createFlowField = core.createFlowField;
export const setObstacleData = core.setObstacleData;
export const buildFlowField = core.buildFlowField;
export const sampleFlow = core.sampleFlow;
export const computeDragIndex = core.computeDragIndex;
export const resizeFlow = core.resizeFlow;
export const renderObstacleOverlay = core.renderObstacleOverlay;
export const tick = core.tick;
export const getObstacleData = core.getObstacleData;

// Re-export shaping APIs from aeroCore so higher-level wrappers can expose them.
export const startShape = core.startShape;
export const appendShapePoint = core.appendShapePoint;
export const endShape = core.endShape;
export const getDynamicShapes = core.getDynamicShapes;

// Export new pressure sampling API
export const samplePressure = core.samplePressure;
