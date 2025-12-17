/*
vorticity.js
Computes vorticity field and injects rotational feedback into flowGrid (second pass).
Returns the vorticity array for downstream pressure biasing.
*/
export function injectVorticityFeedback(opts = {}) {
  const { flowGrid, gridCols, gridRows, GRID_SIZE, turbulenceGlobal } = opts;
  const vorticity = new Float32Array(gridCols * gridRows);
  // compute vorticity (center differences)
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

  // inject rotational feedback
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

  return vorticity;
}

