/*
Flow field module: handles obstacle canvas, silhouette extraction and building a coarse grid of vectors.
Exports:
 - createFlowField(ctxContainer)
 - setObstacleData(imageOrNull)
 - buildFlowField(params)
 - sampleFlow(x,y)   (used internally by particles via import)
 - computeDragIndex()
 - resizeFlow({width,height})
*/

let canvas, ctx;
let obstacleCanvas, obstacleCtx;
let obstacleData = null;
let obstacleBounds = null;

const GRID_SIZE = 6;
let gridCols = 0;
let gridRows = 0;
let flowGrid = null;
let width = 0;
let height = 0;

// dynamic params (kept here for field computations)
let baseWindSpeed = 80;
let vortexStrengthGlobal = 0.9;
let turbulenceGlobal = 0.18;
let gustsEnabledGlobal = false;
let _time = 0;

export function createFlowField({ canvas: mainCanvas, ctx: mainCtx }) {
  canvas = mainCanvas;
  ctx = mainCtx;

  obstacleCanvas = document.createElement("canvas");
  obstacleCtx = obstacleCanvas.getContext("2d");
}

// new tick function to advance temporal state used by sampleFlow
export function tick(tSeconds = 0) {
  _time = tSeconds;
}

export function resizeFlow({ width: w, height: h }) {
  width = w;
  height = h;
  if (!obstacleCanvas) return;
  obstacleCanvas.width = width;
  obstacleCanvas.height = height;

  gridCols = Math.max(2, Math.ceil(width / GRID_SIZE));
  gridRows = Math.max(2, Math.ceil(height / GRID_SIZE));
  flowGrid = new Float32Array(gridCols * gridRows * 2);
}

export function setObstacleData(imgOrNull) {
  if (!imgOrNull) {
    obstacleData = null;
    obstacleBounds = null;
    if (obstacleCtx) obstacleCtx.clearRect(0, 0, width, height);
    buildFlowField();
    return;
  }

  // if an Image object is passed, draw it centered and create silhouette
  const img = imgOrNull;
  obstacleCtx.clearRect(0, 0, width, height);

  const maxSize = Math.min(width, height) * 0.6;
  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (width - drawW) / 2;
  const y = (height - drawH) / 2;

  obstacleCtx.save();
  obstacleCtx.translate(x, y);
  obstacleCtx.drawImage(img, 0, 0, drawW, drawH);
  obstacleCtx.restore();

  const data = obstacleCtx.getImageData(0, 0, width, height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 10) {
      d[i] = 40;
      d[i + 1] = 40;
      d[i + 2] = 40;
      d[i + 3] = 255;
    } else {
      d[i + 3] = 0;
    }
  }
  obstacleCtx.putImageData(data, 0, 0);
  obstacleData = data;

  // compute bounds
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;
  for (let yPix = 0; yPix < height; yPix++) {
    for (let xPix = 0; xPix < width; xPix++) {
      const idx = (yPix * width + xPix) * 4;
      if (d[idx + 3] > 10) {
        found = true;
        if (xPix < minX) minX = xPix;
        if (xPix > maxX) maxX = xPix;
        if (yPix < minY) minY = yPix;
        if (yPix > maxY) maxY = yPix;
      }
    }
  }
  obstacleBounds = found ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;

  buildFlowField();
}

// small coherent noise helper (cheap, fast, smooth-ish)
function softNoise(x, y, z = 0) {
  // combine few sines with different frequencies and phases to create a coherent field
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

  if (!obstacleData) {
    // fill a simple rightward field
    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        const idxGrid = (gy * gridCols + gx) * 2;
        const speed = Math.max(10, baseWindSpeed);
        flowGrid[idxGrid] = speed;
        flowGrid[idxGrid + 1] = 0;
      }
    }
    return;
  }

  const d = obstacleData.data;
  const influenceRadius = Math.max(10, Math.round(Math.min(width, height) * 0.06));

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const cx = (gx + 0.5) * GRID_SIZE;
      const cy = (gy + 0.5) * GRID_SIZE;

      let windFactor = baseWindSpeed / 80;
      let vx = 1.2 * windFactor;
      let vy = (cy < height * 0.5 ? -0.06 : 0.06) * windFactor;

      let repX = 0, repY = 0, repWeight = 0;

      const sx0 = Math.max(0, Math.floor((cx - influenceRadius)));
      const sy0 = Math.max(0, Math.floor((cy - influenceRadius)));
      const sx1 = Math.min(width - 1, Math.ceil(cx + influenceRadius));
      const sy1 = Math.min(height - 1, Math.ceil(cy + influenceRadius));
      const step = 2;

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

      if (repWeight > 0) {
        repX /= repWeight;
        repY /= repWeight;
        vx += repX * 5.2;
        vy += repY * 5.2;
      }

      if (obstacleBounds) {
        const oCenterX = obstacleBounds.x + obstacleBounds.w * 0.5;
        if (cx > oCenterX) {
          const relX = (cx - oCenterX) / Math.max(1, width - oCenterX);
          const swirlStrength = Math.exp(-relX * 3) * 1.0 * vortexStrengthGlobal;
          const above = cy < obstacleBounds.y + obstacleBounds.h * 0.5 ? -1 : 1;
          const phase = Math.sin((cx * 0.06) + (cy * 0.03));
          vx += -above * phase * swirlStrength * 1.2;
          vy += phase * swirlStrength * 1.2;
        }
      }

      // base magnitude and normalization
      const mag = Math.hypot(vx, vy) + 0.0001;
      const speed = Math.max(12, Math.min(600, (baseWindSpeed * 0.8) + Math.min(420, mag * 160)));
      const nx = (vx / mag) * speed;
      const ny = (vy / mag) * speed;

      const idxGrid = (gy * gridCols + gx) * 2;
      // store base static field; temporal perturbations applied in sampleFlow
      flowGrid[idxGrid + 0] = nx;
      flowGrid[idxGrid + 1] = ny;
    }
  }
}

export function sampleFlow(x, y) {
  if (!flowGrid) return { x: Math.max(10, baseWindSpeed), y: 0 };
  const gx = (x / GRID_SIZE) - 0.5;
  const gy = (y / GRID_SIZE) - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const x00 = clamp(x0, 0, gridCols - 1);
  const x10 = clamp(x0 + 1, 0, gridCols - 1);
  const y00 = clamp(y0, 0, gridRows - 1);
  const y01 = clamp(y0 + 1, 0, gridRows - 1);

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

  // apply smooth temporal perturbation based on position and internal time
  // this creates coherent gusts rather than sharp random jolts
  const nx = softNoise(x * 0.8, y * 0.8, _time * 0.6); // low frequency spatial field
  const smallShear = softNoise((x + 200) * 0.6, (y - 100) * 0.6, _time * 0.9);

  // scale perturbation by turbulence setting and optional gust toggling
  const gustFactor = gustsEnabledGlobal ? 1.6 : 1.0;
  const perturbStrength = (Math.max(0, turbulenceGlobal) * 0.9) * gustFactor;

  // derive a vector perturbation oriented roughly orthogonal to base flow for lift-like effects
  const baseMag = Math.hypot(vx, vy) + 1e-6;
  const ux = vx / baseMag;
  const uy = vy / baseMag;

  // orthogonal components (unit)
  const ox = -uy;
  const oy = ux;

  // sinusoidal evolving gusts (slow)
  const timeWave = Math.sin(_time * 0.8 + (x + y) * 0.002);
  // compose small coherent perturbations
  vx += (ox * nx + ux * smallShear * 0.2) * perturbStrength * baseMag * 0.06 + ux * timeWave * perturbStrength * 12;
  vy += (oy * nx + uy * smallShear * 0.2) * perturbStrength * baseMag * 0.06 + uy * timeWave * perturbStrength * 12;

  // --- Simple aerodynamic-style adjustments: lift (perp) and drag (opposing) scaled by proximity to obstacle ---
  let proximity = 0.0;
  if (obstacleBounds) {
    // proximity based on distance to obstacle center relative to an influence radius
    const cx = obstacleBounds.x + obstacleBounds.w * 0.5;
    const cy = obstacleBounds.y + obstacleBounds.h * 0.5;
    const dx = x - cx;
    const dy = y - cy;
    const influenceRadius = Math.max(10, Math.round(Math.min(width, height) * 0.28)); // wider influence
    const dist = Math.hypot(dx, dy);
    proximity = Math.max(0, 1 - dist / influenceRadius);
    // soften
    proximity = proximity * proximity;
  }

  if (proximity > 0) {
    // Lift magnitude proportional to dynamic pressure ~ baseMag^2, scaled by vortexStrengthGlobal and turbulence
    // coefficients tuned for visual stability
    const liftCoef = 0.00045 * vortexStrengthGlobal * (1 + turbulenceGlobal * 1.6);
    const liftMag = liftCoef * baseMag * baseMag * proximity;

    // Drag opposing the velocity, scaled by proximity
    const dragCoef = 0.0009 * (1 + turbulenceGlobal) * (1 + vortexStrengthGlobal * 0.2);
    const dragMag = dragCoef * baseMag * proximity;

    // apply lift perpendicular to flow (positive/negative determined by small noise to create asymmetry)
    const liftSign = Math.sign(softNoise(x * 0.3, y * 0.3, _time * 0.4));
    vx += ox * liftMag * liftSign;
    vy += oy * liftMag * liftSign;

    // apply drag reducing components along the flow direction
    const reduce = Math.max(0, 1 - dragMag / (baseMag + 1e-6));
    vx *= reduce;
    vy *= reduce;
  }

  return { x: vx, y: vy };
}

export function computeDragIndex() {
  if (!obstacleData || !obstacleBounds) {
    // find labels and update if present
    const lbl = document.getElementById("dragLabel");
    const wlbl = document.getElementById("windLabel");
    const llbl = document.getElementById("liftLabel");
    if (lbl) lbl.textContent = "Drag index: –";
    if (wlbl) wlbl.textContent = "Wind: –";
    if (llbl) llbl.textContent = "Lift index: –";
    return;
  }

  const { x, w } = obstacleBounds;
  const sliceX = x + w * 0.3;
  const ix = Math.max(0, Math.min(width - 1, Math.round(sliceX)));

  let solidCount = 0;
  for (let y = 0; y < height; y++) {
    const idx = (y * obstacleData.width + ix) * 4;
    if (obstacleData.data[idx + 3] > 10) solidCount++;
  }

  const normalized = (solidCount / height) * 100;
  const dragIndex = Math.round(normalized);

  // compute local average wind speed near obstacle (sample grid cells near bounds)
  let avgWind = 0;
  let sampleCount = 0;
  if (flowGrid && gridCols > 0 && gridRows > 0 && obstacleBounds) {
    const margin = 8; // sample a band around the obstacle
    const x0 = Math.max(0, Math.floor((obstacleBounds.x - margin) / GRID_SIZE));
    const x1 = Math.min(gridCols - 1, Math.ceil((obstacleBounds.x + obstacleBounds.w + margin) / GRID_SIZE));
    const y0 = Math.max(0, Math.floor((obstacleBounds.y - margin) / GRID_SIZE));
    const y1 = Math.min(gridRows - 1, Math.ceil((obstacleBounds.y + obstacleBounds.h + margin) / GRID_SIZE));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const idxGrid = (gy * gridCols + gx) * 2;
        const vx = flowGrid[idxGrid + 0];
        const vy = flowGrid[idxGrid + 1];
        avgWind += Math.hypot(vx, vy);
        sampleCount++;
      }
    }
    if (sampleCount > 0) avgWind = avgWind / sampleCount;
  } else {
    avgWind = Math.max(10, baseWindSpeed);
  }

  // simple lift proxy: measure net perpendicular component in the wake region (right of obstacle)
  let liftSum = 0;
  let liftSamples = 0;
  if (flowGrid && obstacleBounds) {
    const startX = Math.min(width - 1, obstacleBounds.x + Math.round(obstacleBounds.w * 0.6));
    const endX = Math.min(width - 1, startX + Math.round(obstacleBounds.w * 1.4));
    const bandY0 = Math.max(0, obstacleBounds.y - Math.round(obstacleBounds.h * 0.6));
    const bandY1 = Math.min(height - 1, obstacleBounds.y + obstacleBounds.h + Math.round(obstacleBounds.h * 0.6));
    // sample a coarse grid across this wake
    const step = Math.max(6, Math.round(GRID_SIZE));
    for (let yy = bandY0; yy <= bandY1; yy += step) {
      for (let xx = startX; xx <= endX; xx += step) {
        const s = sampleFlow(xx, yy);
        const mag = Math.hypot(s.x, s.y) + 1e-6;
        // perpendicular unit (ox,oy)
        const ux = s.x / mag, uy = s.y / mag;
        const ox = -uy, oy = ux;
        // use local orthogonal projection magnitude as lift proxy
        const perp = ox * s.x + oy * s.y;
        liftSum += perp;
        liftSamples++;
      }
    }
    if (liftSamples > 0) {
      // normalize to a readable index
      const meanPerp = liftSum / liftSamples;
      // scale relative to avgWind to keep values sensible
      var liftIndex = Math.round((meanPerp / (avgWind + 1e-6)) * 100);
    } else {
      var liftIndex = 0;
    }
  } else {
    var liftIndex = 0;
  }

  const lbl = document.getElementById("dragLabel");
  const wlbl = document.getElementById("windLabel");
  const llbl = document.getElementById("liftLabel");
  if (lbl) lbl.textContent = `Drag index: ${dragIndex}`;
  if (wlbl) wlbl.textContent = `Wind: ${Math.round(avgWind)} px/s`;
  if (llbl) llbl.textContent = `Lift index: ${liftIndex}`;
}

// also expose a simple overlay render for the obstacle
export function renderObstacleOverlay(mainCtx) {
  if (!obstacleData || !obstacleBounds) return;
  mainCtx.save();
  mainCtx.globalAlpha = 0.98;
  mainCtx.drawImage(obstacleCanvas, 0, 0);
  mainCtx.restore();

  mainCtx.save();
  mainCtx.strokeStyle = "rgba(0,0,0,0.18)";
  mainCtx.lineWidth = 1;
  mainCtx.setLineDash([4, 3]);
  const { x, y, w, h } = obstacleBounds;
  mainCtx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  mainCtx.restore();
}

export function getObstacleData() {
  return { obstacleData, obstacleBounds, width, height, sampleFlow };
}

                            
