// ... existing code ...
import * as obstacle from "./obstacle.js";

// New: delegate heavy work to smaller modules
import { computeNominalField } from "./flowGrid.js";
import { injectVorticityFeedback } from "./vorticity.js";
import { computePressureProxy } from "./pressure.js";

export const GRID_SIZE = 6;
let gridCols = 0;
let gridRows = 0;
let flowGrid = null;
let pressureGrid = null;
let width = 0;
let height = 0;

// dynamic params
let baseWindSpeed = 80;
let vortexStrengthGlobal = 0.9;
let turbulenceGlobal = 0.18;
let gustsEnabledGlobal = false;
let _time = 0;
// crosswind parameters
let crosswindMag = 0;
let crosswindAngle = 0;
let crosswindVec = { x: 0, y: 0 };

// vortex-shedding / Strouhal info (for tall/vertical obstacles)
let strouhal = 0;
export function getStrouhal() { return strouhal; }

// --- NEW: expose last computed vorticity grid for diagnostics or other modules ---
let lastVorticity = null;
export function _getVorticityGrid() {
  return { vorticity: lastVorticity, gridCols, gridRows, GRID_SIZE };
}

export function tick(tSeconds = 0) {
  _time = tSeconds;
}

export function resizeFlow({ width: w, height: h }) {
  width = w;
  height = h;
  obstacle.setSize(w, h);

  gridCols = Math.max(2, Math.ceil(width / GRID_SIZE));
  gridRows = Math.max(2, Math.ceil(height / GRID_SIZE));
  flowGrid = new Float32Array(gridCols * gridRows * 2);
  pressureGrid = new Float32Array(gridCols * gridRows); // pressure scalar per cell
}

function softNoise(x, y, z = 0) {
  return (
    Math.sin(x * 0.021 + z * 0.5) * 0.5 +
    Math.sin(y * 0.017 - z * 0.7) * 0.35 +
    Math.sin((x + y) * 0.012 + z * 0.25) * 0.15
  );
}

// Sample local obstacle surface normal (points from solid -> fluid).
// returns { nx, ny, valid, dist } where dist is approximate distance to solid (in px)
function sampleSurfaceNormal(x, y) {
  const odObj = obstacle.getObstacleData();
  if (!odObj || !odObj.obstacleData) return { nx: 0, ny: 0, valid: false, dist: Infinity };
  const od = odObj.obstacleData;
  const iw = od.width, ih = od.height;
  const ix = Math.max(1, Math.min(iw - 2, Math.round(x)));
  const iy = Math.max(1, Math.min(ih - 2, Math.round(y)));
  const idx = (iy * iw + ix) * 4;
  // If this point is inside solid, treat as invalid (we want fluid-side sampling)
  if (od.data[idx + 3] > 128) return { nx: 0, ny: 0, valid: false, dist: 0 };

  // sample alpha neighbors to compute gradient interior->exterior (we want normal pointing outwards)
  const idxL = (iy * iw + (ix - 1)) * 4;
  const idxR = (iy * iw + (ix + 1)) * 4;
  const idxU = ((iy - 1) * iw + ix) * 4;
  const idxD = ((iy + 1) * iw + ix) * 4;

  const aL = od.data[idxL + 3] / 255;
  const aR = od.data[idxR + 3] / 255;
  const aU = od.data[idxU + 3] / 255;
  const aD = od.data[idxD + 3] / 255;

  // gradient points interior->exterior; we want normal from solid->fluid so invert sign
  let gx = (aL - aR);
  let gy = (aU - aD);
  const len = Math.hypot(gx, gy);
  if (len < 1e-4) return { nx: 0, ny: 0, valid: false, dist: Infinity };
  gx /= len; gy /= len;

  // approximate distance to boundary by sampling radial alpha (simple heuristic)
  let dist = Infinity;
  // walk a few pixels along gradient to find first opaque
  for (let s = 0; s <= 6; s++) {
    const sx = Math.round(ix - gx * s);
    const sy = Math.round(iy - gy * s);
    if (sx < 0 || sy < 0 || sx >= iw || sy >= ih) break;
    const aIdx = (sy * iw + sx) * 4;
    if (od.data[aIdx + 3] > 10) { dist = s; break; }
  }

  // normal should point from solid to fluid => same direction as gradient computed above
  return { nx: gx, ny: gy, valid: true, dist };
}

export function buildFlowField(params = {}) {
  if (params.baseWindSpeed !== undefined) baseWindSpeed = params.baseWindSpeed;
  if (params.vortexStrength !== undefined) vortexStrengthGlobal = params.vortexStrength;
  if (params.turbulence !== undefined) turbulenceGlobal = params.turbulence;
  if (params.gustsEnabled !== undefined) gustsEnabledGlobal = params.gustsEnabled;
  if (params.crosswindMag !== undefined) crosswindMag = params.crosswindMag;
  if (params.crosswindAngle !== undefined) crosswindAngle = (params.crosswindAngle * Math.PI) / 180.0;

  crosswindVec.x = crosswindMag * Math.cos(crosswindAngle);
  crosswindVec.y = crosswindMag * Math.sin(crosswindAngle);

  const od = obstacle.getObstacleData().obstacleData;
  const oBounds = obstacle.getObstacleData().obstacleBounds;

  // compute an estimated Strouhal frequency for vortex shedding:
  if (oBounds && oBounds.h > 0) {
    const D = oBounds.h;
    const U = Math.max(1, baseWindSpeed);
    const St_base = 0.18;
    const scaledSt = Math.max(0.04, Math.min(0.35, St_base * (0.5 + 0.6 * Math.min(2, vortexStrengthGlobal))));
    strouhal = scaledSt * (U / (D + 1e-6));
  } else {
    strouhal = 0;
  }

  if (!flowGrid || !pressureGrid) return;

  // --- Delegated: compute nominal velocity field. ---
  // removed large inline nominal field computation block (moved to src/flowGrid.js)
  computeNominalField({
    flowGrid, gridCols, gridRows, GRID_SIZE, width, height,
    baseWindSpeed, crosswindVec, vortexStrengthGlobal, turbulenceGlobal, obstacleData: od, obstacleBounds: oBounds
  });

  // --- Delegated: compute vorticity and inject rotational feedback. ---
  // removed large inline vorticity computation (moved to src/vorticity.js)
  const vorticity = injectVorticityFeedback({
    flowGrid, gridCols, gridRows, GRID_SIZE, turbulenceGlobal, vortexStrengthGlobal
  });

  // store for external access
  lastVorticity = vorticity;

  // --- Delegated: compute pressure proxy ---
  // removed large inline pressure computation (moved to src/pressure.js)
  computePressureProxy({
    flowGrid, pressureGrid, gridCols, gridRows, GRID_SIZE,
    baseWindSpeed, turbulenceGlobal, vortexStrengthGlobal, obstacleBounds: oBounds, vorticity
  });
}

export function sampleFlow(x, y) {
  if (!flowGrid) return { x: Math.max(10, baseWindSpeed) + crosswindVec.x, y: crosswindVec.y };
  const gx = (x / GRID_SIZE) - 0.5;
  const gy = (y / GRID_SIZE) - 0.5;
  const fx = gx - Math.floor(gx);
  const fy = gy - Math.floor(gy);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const x00 = clamp(Math.floor(gx), 0, gridCols - 1);
  const x10 = clamp(Math.floor(gx) + 1, 0, gridCols - 1);
  const y00 = clamp(Math.floor(gy), 0, gridRows - 1);
  const y01 = clamp(Math.floor(gy) + 1, 0, gridRows - 1);

  const idx = (yy, xx) => (yy * gridCols + xx) * 2;

  const i00 = idx(y00, x00);
  const i10 = idx(y00, x10);
  const i01 = idx(y01, x00);
  const i11 = idx(y01, x10);

  const vx00 = flowGrid[i00 + 0], vy00 = flowGrid[i00 + 1];
  const vx10 = flowGrid[i10 + 0], vy10 = flowGrid[i10 + 1];
  const vx01 = flowGrid[i01 + 0], vy01 = flowGrid[i01 + 1];
  const vx11 = flowGrid[i11 + 0], vy11 = flowGrid[i11 + 1];

  const vx0 = vx00 * (1 - fx) + vx10 * fx;
  const vy0 = vy00 * (1 - fx) + vy10 * fx;
  const vx1 = vx01 * (1 - fx) + vx11 * fx;
  const vy1 = vy01 * (1 - fx) + vy11 * fx;

  let vx = vx0 * (1 - fy) + vx1 * fy;
  let vy = vy0 * (1 - fy) + vy1 * fy;

  const od = obstacle.getObstacleData().obstacleData;
  const oBounds = obstacle.getObstacleData().obstacleBounds;

  if (od) {
    const ix = Math.round(Math.max(0, Math.min(width - 1, x)));
    const iy = Math.round(Math.max(0, Math.min(height - 1, y)));
    const aIdx = (iy * od.width + ix) * 4;
    if (od.data[aIdx + 3] > 10) {
      return { x: 0, y: 0 };
    }
  }

  const nx = softNoise(x * 0.8, y * 0.8, _time * 0.6);
  const smallShear = softNoise((x + 200) * 0.6, (y - 100) * 0.6, _time * 0.9);

  vx += crosswindVec.x * 0.18;
  vy += crosswindVec.y * 0.18;

  const gustFactor = gustsEnabledGlobal ? 1.6 : 1.0;
  let perturbStrength = (Math.max(0, turbulenceGlobal) * 0.9) * gustFactor;

  const baseMag = Math.hypot(vx, vy) + 1e-6;
  const ux = vx / baseMag;
  const uy = vy / baseMag;
  const ox = -uy;
  const oy = ux;

  const timeWave = Math.sin(_time * 0.8 + (x + y) * 0.002);
  vx += (ox * nx + ux * smallShear * 0.2) * perturbStrength * baseMag * 0.06 + ux * timeWave * perturbStrength * 12;
  vy += (oy * nx + uy * smallShear * 0.2) * perturbStrength * baseMag * 0.06 + uy * timeWave * perturbStrength * 12;

  let proximity = 0.0;
  if (oBounds) {
    const cx = oBounds.x + oBounds.w * 0.5;
    const cy = oBounds.y + oBounds.h * 0.5;
    const dx = x - cx;
    const dy = y - cy;
    const influenceRadius = Math.max(10, Math.round(Math.min(width, height) * 0.28));
    const dist = Math.hypot(dx, dy);
    proximity = Math.max(0, 1 - dist / influenceRadius);
    proximity = proximity * proximity;

    const boundaryDamping = Math.max(0, Math.min(1, proximity));
    perturbStrength *= (1 - boundaryDamping * 0.9);
    // lessen boundary damping so streamwise velocity isn't overly reduced near the surface
    const boundaryFactor = 1 - (boundaryDamping * 0.4);
    vx *= boundaryFactor;
    vy *= boundaryFactor;
  }

  if (proximity > 0) {
    const liftCoef = 0.00045 * vortexStrengthGlobal * (1 + turbulenceGlobal * 1.6);
    const liftMag = liftCoef * baseMag * baseMag * proximity;

    const dragCoef = 0.0009 * (1 + turbulenceGlobal) * (1 + vortexStrengthGlobal * 0.2);
    const dragMag = dragCoef * baseMag * proximity;

    const liftSign = Math.sign(softNoise(x * 0.3, y * 0.3, _time * 0.4));
    vx += ox * liftMag * liftSign;
    vy += oy * liftMag * liftSign;

    const reduce = Math.max(0, 1 - dragMag / (baseMag + 1e-6));
    vx *= reduce;
    vy *= reduce;

    const crossBias = crosswindMag * 0.0009 * proximity;
    vx += -oy * crossBias;
    vy += ox * crossBias;

    // --- Fin-inspired "inspiration & push" ---
    // sample local surface normal and, when close to the surface, apply a fin-like suction (along tangent)
    // and a push (normal) that depends on angle between incoming flow and the surface.
    const surf = sampleSurfaceNormal(x, y);
    if (surf.valid && surf.dist !== Infinity && surf.dist <= 6) {
      // flow unit direction
      const fmag = Math.hypot(vx, vy) + 1e-6;
      const fxu = vx / fmag, fyu = vy / fmag;
      // surface normal (points from solid->fluid)
      const nx = surf.nx, ny = surf.ny;
      // tangent vector (along surface) - rotate normal CCW
      const tx = -ny, ty = nx;
      // angle cos between flow and tangent: +1 = aligned, -1 = opposite
      const cosT = Math.max(-1, Math.min(1, fxu * tx + fyu * ty));
      // fin suction: draws flow along tangent when aligned, pushes when opposite
      const finStrengthBase = 0.14 * (1 + turbulenceGlobal * 0.6) * vortexStrengthGlobal;
      const finSuction = finStrengthBase * proximity * (1 + cosT) * (1 - surf.dist / 6);
      // apply along tangent (steer flow to follow surface)
      vx += tx * finSuction * fmag * 0.9;
      vy += ty * finSuction * fmag * 0.9;

      // normal push to mimic pressure redistribution on fin surfaces (small)
      const incidence = fxu * nx + fyu * ny; // positive = impinging
      const normalPush = 0.12 * incidence * proximity * (1 - surf.dist / 6) * baseMag * (0.6 + turbulenceGlobal * 0.6);
      vx += nx * normalPush;
      vy += ny * normalPush;
    }
  }



  // --- vortex shedding injection (Kármán-like alternating vortices) ---
  if (oBounds) {
    const oCenterX = oBounds.x + oBounds.w * 0.5;
    const oCenterY = oBounds.y + oBounds.h * 0.5;
    const relX = x - oCenterX;
    const relY = y - oCenterY;
    const wakeWidth = Math.max(24, oBounds.h * 0.9);
    const wakeExtent = Math.max(80, oBounds.w * 4.0);

    if (relX > 0 && relX < wakeExtent && Math.abs(relY) < oBounds.h * 1.6) {
      const f = Math.max(0, strouhal);
      const convectedPhase = relX * 0.08;
      const phase = Math.sin(2.0 * Math.PI * f * _time - convectedPhase);
      const sign = phase;
      const downFall = Math.exp(-relX / (oBounds.w * 1.2));
      const latFall = Math.exp(-Math.abs(relY) / (wakeWidth * 0.9));
      const baseShear = vortexStrengthGlobal * 1.05;
      const shear = baseShear * downFall * latFall;

      const mag = Math.hypot(vx, vy) + 1e-6;
      const ux = vx / mag, uy = vy / mag;
      const ox = -uy, oy = ux;

      // vorticity not directly available here; keep safe fallback
      const localOmega = 0;
      const omegaBoost = 1 + Math.min(3, Math.abs(localOmega) * 10);

      const injectScale = shear * 80 * 0.8 * omegaBoost;
      vx += ox * injectScale * sign * 0.9;
      vy += oy * injectScale * sign * 0.9;

      const wakeCore = Math.exp(-Math.pow(relY / Math.max(1, oBounds.h * 0.45), 2)) * downFall;
      const energyLoss = 1 - Math.min(0.65, 0.18 * shear * (1 + turbulenceGlobal));
      vx *= (1 - wakeCore * (1 - energyLoss));
      vy *= (1 - wakeCore * (1 - energyLoss));
    }
  }

  return { x: vx, y: vy };
}

// expose pressureGrid accessor for diagnostics module
/*
Export a helper that tells whether a world coordinate (x,y) lies inside the obstacle's solid mask.
Uses obstacle.getObstacleData() and obstacleBounds as a fast early-out, and checks alpha > 128
to avoid treating partially transparent pixels as solid.
*/
export function isSolidAt(x, y) {
  const odObj = obstacle.getObstacleData();
  if (!odObj || !odObj.obstacleData || !odObj.obstacleBounds) return false;
  const { obstacleData: od, obstacleBounds: oB, width: w, height: h } = odObj;
  // fast bounds check in obstacle pixel coords
  if (x < oB.x || y < oB.y || x >= oB.x + oB.w || y >= oB.y + oB.h) return false;
  const ix = Math.max(0, Math.min(od.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(od.height - 1, Math.round(y)));
  const idx = (iy * od.width + ix) * 4;
  const a = od.data[idx + 3];
  return a > 128;
}

export function _getPressureGrid() {
  return { pressureGrid, gridCols, gridRows, GRID_SIZE, baseWindSpeed, strouhal };
}

// ... existing code ...

