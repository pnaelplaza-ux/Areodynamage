/*
  Refactored flowField wrapper.
  Tombstone: large implementation moved to ./flowFieldCore.js
  // removed large implementation of flow field functions (createFlowField, setObstacleData, buildFlowField, sampleFlow, computeDragIndex, resizeFlow, renderObstacleOverlay, getObstacleData, softNoise, tick, etc.)
*/

import * as core from "./flowFieldCore.js";

// Re-export core functions to preserve original module API
export const createFlowField = core.createFlowField;
export const setObstacleData = core.setObstacleData;
export const buildFlowField = core.buildFlowField;
export const sampleFlow = core.sampleFlow;
export const computeDragIndex = core.computeDragIndex;
export const resizeFlow = core.resizeFlow;
export const renderObstacleOverlay = core.renderObstacleOverlay;
export const tick = core.tick;
export const getObstacleData = core.getObstacleData;
export const samplePressure = core.samplePressure;

// expose new shaping APIs
export const startShape = core.startShape;
export const appendShapePoint = core.appendShapePoint;
export const endShape = core.endShape;
export const getDynamicShapes = core.getDynamicShapes;
