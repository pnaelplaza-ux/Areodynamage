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
    if (lbl) lbl.textContent = "Drag index: –";
    if (wlbl) wlbl.textContent = "Wind: –";
    if (llbl) llbl.textContent = "Lift index: –";
    if (ylbl) ylbl.textContent = "Yaw: –";
    return;
  }

  let forceX = 0, forceY = 0;
  let areaCount = 0;
  const od = obstacleData;
  const iw = od.width;
  const ih = od.height;

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
      const nlen = Math.hypot(nx, ny) + 1e-6;
      nx /= nlen; ny /= nlen;

      const p = samplePressure(x, y);
      const fx = p * nx;
      const fy = p * ny;
      forceX += fx;
      forceY += fy;
      areaCount++;
    }
  }

  const obstacleBoundsArea = Math.max(1, obstacleBounds.w * obstacleBounds.h);
  const Vref = Math.max(1, 80);
  const dynamicPressure = 0.5 * 1.0 * Vref * Vref;
  const C_D = (forceX / (dynamicPressure * obstacleBoundsArea)) || 0;
  const C_L = ( -forceY / (dynamicPressure * obstacleBoundsArea)) || 0;

  // compute CP and Mz (yaw)
  let sumP = 0, cpX = 0, cpY = 0;
  for (let y = obstacleBounds.y; y < obstacleBounds.y + obstacleBounds.h; y++) {
    for (let x = obstacleBounds.x; x < obstacleBounds.x + obstacleBounds.w; x++) {
      const idx = (y * iw + x) * 4;
      if (od.data[idx + 3] <= 10) continue;
      const p = samplePressure(x, y);
      sumP += p;
      cpX += p * x;
      cpY += p * y;
    }
  }
  let CP = { x: 0, y: 0 };
  if (sumP !== 0) {
    CP.x = (cpX / sumP);
    CP.y = (cpY / sumP);
  } else {
    CP.x = obstacleBounds.x + obstacleBounds.w * 0.5;
    CP.y = obstacleBounds.y + obstacleBounds.h * 0.5;
  }

  const CGx = obstacleBounds.x + obstacleBounds.w * 0.5;
  let Mz = 0;
  for (let y = obstacleBounds.y; y < obstacleBounds.y + obstacleBounds.h; y++) {
    for (let x = obstacleBounds.x; x < obstacleBounds.x + obstacleBounds.w; x++) {
      const idx = (y * iw + x) * 4;
      if (od.data[idx + 3] <= 10) continue;
      const p = samplePressure(x, y);
      const ixL = Math.max(0, x - 1), ixR = Math.min(iw - 1, x + 1);
      const iyU = Math.max(0, y - 1), iyD = Math.min(ih - 1, y + 1);
      const aL = od.data[(y * iw + ixL) * 4 + 3] / 255;
      const aR = od.data[(y * iw + ixR) * 4 + 3] / 255;
      const aU = od.data[(iyU * iw + x) * 4 + 3] / 255;
      const aD = od.data[(iyD * iw + x) * 4 + 3] / 255;
      let nx = (aL - aR);
      let ny = (aU - aD);
      const nlen = Math.hypot(nx, ny) + 1e-6;
      nx /= nlen; ny /= nlen;
      const lateral = p * ny;
      const arm = x - CGx;
      Mz += lateral * arm;
    }
  }

  if (document.getElementById) {
    const lbl = document.getElementById("dragLabel");
    const wlbl = document.getElementById("windLabel");
    const llbl = document.getElementById("liftLabel");
    const ylbl = document.getElementById("yawLabel");
    if (lbl) lbl.textContent = `Drag index: ${Math.round(C_D * 100)}`;
    if (wlbl) wlbl.textContent = `Wind: ${Math.round(Vref)} px/s`;
    if (llbl) llbl.textContent = `Lift index: ${Math.round(C_L * 100)}`;
    if (ylbl) ylbl.textContent = `Yaw: ${Math.round(Mz * 0.0005)} (CP ${Math.round(CP.x - CGx)},${Math.round(CP.y - (obstacleBounds.y + obstacleBounds.h/2))})`;
  }
}