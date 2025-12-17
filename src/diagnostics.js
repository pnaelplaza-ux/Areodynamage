/*
Diagnostics: pressure sampling and drag/lift/yaw computations.
Depends on obstacle module and flowSolver's pressure grid accessor.
Tombstone: removed heavy flow-building logic (kept only diagnostic integrators).
*/

import * as obstacle from "./obstacle.js";
import { _getPressureGrid } from "./flowSolver.js";

export function samplePressure(x, y) {
  const pg = _getPressureGrid();
  if (!pg || !pg.pressureGrid) return 0;
  const { pressureGrid, gridCols, gridRows } = pg;
  const GRID_SIZE = pg.GRID_SIZE || 6;
  const gx = (x / GRID_SIZE) - 0.5;
  const gy = (y / GRID_SIZE) - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const x00 = clamp(x0, 0, gridCols - 1);
  const x10 = clamp(x0 + 1, 0, gridCols - 1);
  const y00 = clamp(y0, 0, gridRows - 1);
  const y01 = clamp(y0 + 1, 0, gridRows - 1);
  const v00 = pressureGrid[y00 * gridCols + x00];
  const v10 = pressureGrid[y00 * gridCols + x10];
  const v01 = pressureGrid[y01 * gridCols + x00];
  const v11 = pressureGrid[y01 * gridCols + x10];
  const v0 = v00 * (1 - fx) + v10 * fx;
  const v1 = v01 * (1 - fx) + v11 * fx;
  return v0 * (1 - fy) + v1 * fy;
}

export function computeDragIndex() {
  const odObj = obstacle.getObstacleData();
  const obstacleData = odObj.obstacleData;
  const obstacleBounds = odObj.obstacleBounds;

  const lbl = document.getElementById("dragLabel");
  const wlbl = document.getElementById("windLabel");
  const llbl = document.getElementById("liftLabel");
  const ylbl = document.getElementById("yawLabel");

  if (!obstacleData || !obstacleBounds) {
    if (lbl) lbl.textContent = "Drag (C_D): –";
    if (wlbl) wlbl.textContent = "Wind (V_ref): –";
    if (llbl) llbl.textContent = "Lift (C_L): –";
    if (ylbl) ylbl.textContent = "Yaw / Moment: –";
    return;
  }

  // get solver-derived reference (dynamic) velocity scale
  const pg = _getPressureGrid();
  const baseV = (pg && pg.baseWindSpeed) ? Math.max(1, pg.baseWindSpeed) : 80;

  let forceX = 0, forceY = 0;
  let areaCount = 0;
  const od = obstacleData;
  const iw = od.width;
  const ih = od.height;

  // accumulate pressure * normal * dS and compute CP moments
  let sumP = 0, cpX = 0, cpY = 0;

  // pixel area in physical units (using GRID cell as reference area per sample)
  // dS: we consider each sampled pixel as an area of 1 (consistent across shapes) and normalize later
  for (let y = obstacleBounds.y; y < obstacleBounds.y + obstacleBounds.h; y++) {
    for (let x = obstacleBounds.x; x < obstacleBounds.x + obstacleBounds.w; x++) {
      const idx = (y * iw + x) * 4;
      if (od.data[idx + 3] <= 10) continue;

      // estimate normal from alpha neighbours (pointing outward from solid)
      const ixL = Math.max(0, x - 1), ixR = Math.min(iw - 1, x + 1);
      const iyU = Math.max(0, y - 1), iyD = Math.min(ih - 1, y + 1);
      const aL = od.data[(y * iw + ixL) * 4 + 3] / 255;
      const aR = od.data[(y * iw + ixR) * 4 + 3] / 255;
      const aU = od.data[(iyU * iw + x) * 4 + 3] / 255;
      const aD = od.data[(iyD * iw + x) * 4 + 3] / 255;

      // gradient of alpha points from interior->exterior; normal should point from solid to fluid
      let nx = (aL - aR);
      let ny = (aU - aD);
      const nlen = Math.hypot(nx, ny) + 1e-8;
      nx /= nlen; ny /= nlen;

      // sample pressure at this surface location (solver pressure proxy)
      const p = samplePressure(x, y);

      // accumulate force = p * n * dS  (dS = 1 pixel)
      const fx = p * nx;
      const fy = p * ny;
      forceX += fx;
      forceY += fy;

      // CP accumulation
      sumP += p;
      cpX += p * x;
      cpY += p * y;

      areaCount++;
    }
  }

  // fallback CP and sums if no pressure points found
  let CP = { x: 0, y: 0 };
  if (sumP !== 0) {
    CP.x = (cpX / sumP);
    CP.y = (cpY / sumP);
  } else {
    CP.x = obstacleBounds.x + obstacleBounds.w * 0.5;
    CP.y = obstacleBounds.y + obstacleBounds.h * 0.5;
  }

  // Reference area: use obstacle projected area (number of opaque pixels)
  const obstacleArea = Math.max(1, areaCount);

  // dynamic pressure q = 0.5 * rho * V^2 ; use rho = 1 for normalized coefficients
  const q = 0.5 * 1.0 * baseV * baseV;

  // Project total force onto streamwise (x) and vertical (y) axes to get drag and lift.
  // Note: the solver's pressureGrid was constructed as Vref^2 - |V|^2, so positive p -> stagnation/high pressure
  const F_D = forceX; // positive force in +x from pressure onto normals
  const F_L = -forceY; // invert sign so positive lift is upward

  // Non-dimensional coefficients
  const C_D = F_D / (q * obstacleArea);
  const C_L = F_L / (q * obstacleArea);

  // Yaw moment Mz about CG (using x-distance from CG)
  const CGx = obstacleBounds.x + obstacleBounds.w * 0.5;
  const CGy = obstacleBounds.y + obstacleBounds.h * 0.5;
  // recompute moment by summing p * (n_y) * lever arm in x
  let Mz = 0;
  for (let y = obstacleBounds.y; y < obstacleBounds.y + obstacleBounds.h; y++) {
    for (let x = obstacleBounds.x; x < obstacleBounds.x + obstacleBounds.w; x++) {
      const idx = (y * iw + x) * 4;
      if (od.data[idx + 3] <= 10) continue;
      const ixL = Math.max(0, x - 1), ixR = Math.min(iw - 1, x + 1);
      const iyU = Math.max(0, y - 1), iyD = Math.min(ih - 1, y + 1);
      const aL = od.data[(y * iw + ixL) * 4 + 3] / 255;
      const aR = od.data[(y * iw + ixR) * 4 + 3] / 255;
      const aU = od.data[(iyU * iw + x) * 4 + 3] / 255;
      const aD = od.data[(iyD * iw + x) * 4 + 3] / 255;
      let nx = (aL - aR);
      let ny = (aU - aD);
      const nlen = Math.hypot(nx, ny) + 1e-8;
      nx /= nlen; ny /= nlen;
      const p = samplePressure(x, y);
      const lateral = p * ny; // lateral force contribution in y direction
      const arm = x - CGx;
      Mz += lateral * arm;
    }
  }

  // Update UI elements with clearer normalized metrics
  if (document.getElementById) {
    const lbl = document.getElementById("dragLabel");
    const wlbl = document.getElementById("windLabel");
    const llbl = document.getElementById("liftLabel");
    const ylbl = document.getElementById("yawLabel");
    if (lbl) lbl.textContent = `Drag (C_D): ${C_D.toFixed(3)}`;
    if (wlbl) wlbl.textContent = `Wind V_ref: ${Math.round(baseV)} px/s`;
    if (llbl) llbl.textContent = `Lift (C_L): ${C_L.toFixed(3)}`;
    const cpRelX = Math.round(CP.x - CGx);
    const cpRelY = Math.round(CP.y - CGy);
    // show yaw/moment and Strouhal (shedding frequency) when available
    const pg = _getPressureGrid();
    const st = pg && pg.strouhal ? pg.strouhal : 0;
    if (ylbl) ylbl.textContent = `Yaw moment M_z: ${Math.round(Mz)} · CP offset: (${cpRelX}, ${cpRelY}) · Shed freq: ${st ? st.toFixed(3) + "Hz" : "–"}`;
  }
}