/*
pressure.js
Computes a Bernoulli-like pressure proxy and applies wake/vorticity biasing (third pass).
*/
export function computePressureProxy(opts = {}) {
  const {
    flowGrid, pressureGrid, gridCols, gridRows, GRID_SIZE,
    baseWindSpeed, turbulenceGlobal, vortexStrengthGlobal, obstacleBounds, vorticity
  } = opts;

  const Vref = Math.max(1, baseWindSpeed);
  // compute vorticity magnitude map
  const vortMag = new Float32Array(gridCols * gridRows);
  for (let gy = 1; gy < gridRows - 1; gy++) {
    for (let gx = 1; gx < gridCols - 1; gx++) {
      vortMag[gy * gridCols + gx] = Math.abs(vorticity[gy * gridCols + gx] || 0);
    }
  }

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const idxGrid = (gy * gridCols + gx) * 2;
      const vx = flowGrid[idxGrid + 0];
      const vy = flowGrid[idxGrid + 1];
      const vmag = Math.hypot(vx, vy);

      let pIdx = Vref * Vref - vmag * vmag;

      if (obstacleBounds) {
        const cx = (gx + 0.5) * GRID_SIZE;
        const cy = (gy + 0.5) * GRID_SIZE;
        const oCenterX = obstacleBounds.x + obstacleBounds.w * 0.5;
        const oCenterY = obstacleBounds.y + obstacleBounds.h * 0.5;
        const relX = cx - oCenterX;
        const relY = cy - oCenterY;

        if (relX > 0 && relX < Math.max(1, obstacleBounds.w * 4.0) && Math.abs(relY) < obstacleBounds.h * 1.6) {
          const downFall = Math.exp(-relX / (obstacleBounds.w * 1.4));
          const latFall = Math.exp(-Math.pow(relY / (obstacleBounds.h * 0.55), 2));
          const wakeDepth = 0.6 * vortexStrengthGlobal * (1 + turbulenceGlobal * 0.9);
          const localVort = vortMag[gy * gridCols + gx] || 0;
          const vortexBoost = 1 + Math.min(2.5, localVort * 6.0);
          const wakeEffect = wakeDepth * downFall * latFall * vortexBoost;
          pIdx -= Math.min(Vref * Vref * 0.7, wakeEffect * Vref * Vref * 0.45);
        }
      }

      pIdx = Math.max(-Vref * Vref, Math.min(Vref * Vref, pIdx));
      pressureGrid[gy * gridCols + gx] = pIdx;
    }
  }
}

