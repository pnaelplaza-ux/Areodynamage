/* 
Flow solver: grid construction, core flow build, sampling and temporal state.
Exports:
 - resizeFlow({width,height})
 - buildFlowField(params)
 - sampleFlow(x,y)
 - tick(tSeconds)
 - samplePressure is provided via diagnostics module (but solver builds pressureGrid and exposes accessor)
Tombstone: removed diagnostics/integration code and shaping code to other modules.
*/

import * as obstacle from "./obstacle.js";
import { getDynamicShapes } from "./shaping.js"; // used during sampling

const GRID_SIZE = 6;
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

  if (!flowGrid || !pressureGrid) return;

  // first pass: compute nominal velocity field
  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const cx = (gx + 0.5) * GRID_SIZE;
      const cy = (gy + 0.5) * GRID_SIZE;

      let windFactor = baseWindSpeed / 80;
      let vx = 1.2 * windFactor;
      let vy = (cy < height * 0.5 ? -0.06 : 0.06) * windFactor;
      vx += crosswindVec.x * 0.01;
      vy += crosswindVec.y * 0.01;

      let repX = 0, repY = 0, repWeight = 0;

      const influenceRadius = Math.max(10, Math.round(Math.min(width, height) * 0.06));
      const sx0 = Math.max(0, Math.floor((cx - influenceRadius)));
      const sy0 = Math.max(0, Math.floor((cy - influenceRadius)));
      const sx1 = Math.min(width - 1, Math.ceil(cx + influenceRadius));
      const sy1 = Math.min(height - 1, Math.ceil(cy + influenceRadius));
      const step = 2;

      if (od) {
        const d = od.data;
        for (let sy = sy0; sy <= sy1; sy += step) {
          for (let sx = sx0; sx <= sx1; sx += step) {
            const idx = (sy * width + sx) * 4;
            const a = d[idx + 3];
            if (a > 10) {
              const dx = cx - sx;
              const dy = cy - sy;
              const dist = Math.hypot(dx, dy) + 0.001;
              const wBase = Math.max(0, (influenceRadius - dist) / influenceRadius);
              const w = wBase * wBase * (a / 255);
              repX += (dx / dist) * w;
              repY += (dy / dist) * w;
              repWeight += w;
            }
          }
        }
      }

      if (repWeight > 0) {
        repX /= repWeight;
        repY /= repWeight;
        vx += repX * 5.2;
        vy += repY * 5.2;
      }

      if (oBounds) {
        const oCenterX = oBounds.x + oBounds.w * 0.5;
        if (cx > oCenterX) {
          const relX = (cx - oCenterX) / Math.max(1, width - oCenterX);
          const swirlStrength = Math.exp(-relX * 3) * 1.0 * vortexStrengthGlobal;
          const above = cy < oBounds.y + oBounds.h * 0.5 ? -1 : 1;
          const phase = Math.sin((cx * 0.06) + (cy * 0.03));
          vx += -above * phase * swirlStrength * 1.2;
          vy += phase * swirlStrength * 1.2;
        }
      }

      const mag = Math.hypot(vx, vy) + 0.0001;
      const speed = Math.max(12, Math.min(600, (baseWindSpeed * 0.8) + Math.min(420, mag * 160)));
      const nx = (vx / mag) * speed;
      const ny = (vy / mag) * speed;

      const idxGrid = (gy * gridCols + gx) * 2;
      flowGrid[idxGrid + 0] = nx;
      flowGrid[idxGrid + 1] = ny;
    }
  }

  // second pass: compute vorticity and inject rotational feedback
  const vorticity = new Float32Array(gridCols * gridRows);
  for (let gy = 1; gy < gridRows - 1; gy++) {
    for (let gx = 1; gx < gridCols - 1; gx++) {
      const i = (gy * gridCols + gx) * 2;
      const left = ((gy) * gridCols + (gx - 1)) * 2;
      const right = ((gy) * gridCols + (gx + 1)) * 2;
      const up = ((gy - 1) * gridCols + gx) * 2;
      const down = ((gy + 1) * gridCols + gx) * 2;
      const dvx_dy = (flowGrid[down + 0] - flowGrid[up + 0]) / (2 * GRID_SIZE);
      const dvy_dx = (flowGrid[right + 1] - flowGrid[left + 1]) / (2 * GRID_SIZE);
      const omega = dvy_dx - dvx_dy;
      vorticity[gy * gridCols + gx] = omega;
    }
  }

  for (let gy = 1; gy < gridRows - 1; gy++) {
    for (let gx = 1; gx < gridCols - 1; gx++) {
      const idxGrid = (gy * gridCols + gx) * 2;
      const vx = flowGrid[idxGrid + 0];
      const vy = flowGrid[idxGrid + 1];
      const omega = vorticity[gy * gridCols + gx] || 0;
      const rotStrength = Math.max(0, Math.min(1, Math.abs(omega) * 12)) * turbulenceGlobal * 0.5;
      const mag = Math.hypot(vx, vy) + 1e-6;
      const ux = vx / mag, uy = vy / mag;
      const px = -uy * omega * rotStrength * 0.6 * mag;
      const py = ux * omega * rotStrength * 0.6 * mag;
      flowGrid[idxGrid + 0] = vx + px;
      flowGrid[idxGrid + 1] = vy + py;
    }
  }

  // final pass: compute pressure proxy
  const Vref = Math.max(1, baseWindSpeed);
  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const idxGrid = (gy * gridCols + gx) * 2;
      const vx = flowGrid[idxGrid + 0];
      const vy = flowGrid[idxGrid + 1];
      const vmag = Math.hypot(vx, vy);
      const pIdx = Math.max(-Vref * Vref, Math.min(Vref * Vref, Vref * Vref - vmag * vmag));
      pressureGrid[gy * gridCols + gx] = pIdx;
    }
  }
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
    const boundaryFactor = 1 - (boundaryDamping * 0.85);
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
  }

  // shaping influences (via shaping module)
  const dynamicShapes = getDynamicShapes();
  if (dynamicShapes && dynamicShapes.length) {
    for (let si = dynamicShapes.length - 1; si >= 0; si--) {
      const s = dynamicShapes[si];
      const pts = s.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const segLen2 = dx * dx + dy * dy;
        if (segLen2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / segLen2));
        const px = a.x + t * dx, py = a.y + t * dy;
        const dist = Math.hypot(x - px, y - py);
        const influenceRadius = 36;
        if (dist < influenceRadius) {
          const frac = 1 - dist / influenceRadius;
          const tl = Math.hypot(dx, dy) + 1e-6;
          const tx = dx / tl, ty = dy / tl;
          const shapingStrength = 0.5;
          vx = vx * (1 - frac * shapingStrength) + tx * (Math.hypot(vx, vy) + 1e-6) * frac * shapingStrength;
          vy = vy * (1 - frac * shapingStrength) + ty * (Math.hypot(vx, vy) + 1e-6) * frac * shapingStrength;
          i = pts.length; si = -1;
        }
      }
    }
  }

  return { x: vx, y: vy };
}

// expose pressureGrid accessor for diagnostics module
export function _getPressureGrid() {
  return { pressureGrid, gridCols, gridRows, GRID_SIZE, baseWindSpeed };
}