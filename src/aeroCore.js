/*
Aerodynamics core (tombstone wrapper): the large implementation has been split into focused modules:
 - src/flowSolver.js  (flow grid, sampling, resize, tick, softNoise)
 - src/diagnostics.js (computeDragIndex, samplePressure)
 - src/shaping.js     (dynamic shaping APIs)
This file now re-exports the functions so higher-level imports remain valid.
Removed large implementation details to improve maintainability.
*/

import * as solver from "./flowSolver.js";
import * as diag from "./diagnostics.js";
import * as shaping from "./shaping.js";
import * as obstacle from "./obstacle.js";

// Re-export obstacle passthroughs
export const createFlowField = obstacle.createFlowField;
export const setObstacleData = obstacle.setObstacleData;
export const renderObstacleOverlay = obstacle.renderObstacleOverlay;
export const getObstacleData = obstacle.getObstacleData;

// Flow solver API
export const resizeFlow = solver.resizeFlow;
export const buildFlowField = solver.buildFlowField;
export const sampleFlow = solver.sampleFlow;
export const tick = solver.tick;

// Pressure / diagnostics
export const samplePressure = diag.samplePressure;
export const computeDragIndex = diag.computeDragIndex;

// Shaping APIs
export const startShape = shaping.startShape;
export const appendShapePoint = shaping.appendShapePoint;
export const endShape = shaping.endShape;
export const getDynamicShapes = shaping.getDynamicShapes;



