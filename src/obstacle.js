/*
Obstacle handling module: manages obstacle canvas, silhouette creation, and provides accessors.
This file takes the obstacle-related parts previously in flowFieldCore.js.
Exports:
 - createFlowField({canvas, ctx})
 - setObstacleData(imgOrNull, buildCallback, options)
 - renderObstacleOverlay(mainCtx)
 - getObstacleData()
 - setSmoothingEnabled(flag)
*/

let canvas, ctx;
let obstacleCanvas, obstacleCtx;
let originalCanvas, originalCtx;
let obstacleData = null;
let obstacleBounds = null;
let width = 0, height = 0;

// smoothing is simulated automatically (always enabled)
let smoothingEnabled = true;

export function createFlowField({ canvas: mainCanvas, ctx: mainCtx }) {
  canvas = mainCanvas;
  ctx = mainCtx;

  obstacleCanvas = document.createElement("canvas");
  obstacleCtx = obstacleCanvas.getContext("2d");
  // canvas to hold the visible (unsmoothed) image for overlay
  originalCanvas = document.createElement("canvas");
  originalCtx = originalCanvas.getContext("2d");
}

export function setSize(w, h) {
  width = w;
  height = h;
  if (obstacleCanvas) {
    obstacleCanvas.width = width;
    obstacleCanvas.height = height;
    originalCanvas.width = width;
    originalCanvas.height = height;
  }
}

// New: allow toggling smoothing before thresholding
export function setSmoothingEnabled(flag = true) {
  smoothingEnabled = !!flag;
}

export function setObstacleData(imgOrNull, buildCallback, options = {}) {
  // options can override smoothing for this operation
  const useSmoothing = options.smoothing !== undefined ? !!options.smoothing : smoothingEnabled;

  // ensure obstacle canvas matches current size
  if (obstacleCanvas) {
    obstacleCanvas.width = width || obstacleCanvas.width;
    obstacleCanvas.height = height || obstacleCanvas.height;
    originalCanvas.width = obstacleCanvas.width;
    originalCanvas.height = obstacleCanvas.height;
  }

  if (!imgOrNull) {
    obstacleData = null;
    obstacleBounds = null;
    if (obstacleCtx) {
      obstacleCtx.clearRect(0, 0, obstacleCanvas.width, obstacleCanvas.height);
    }
    if (originalCtx) originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    if (typeof buildCallback === "function") buildCallback();
    return;
  }

  const img = imgOrNull;

  obstacleCtx.clearRect(0, 0, obstacleCanvas.width, obstacleCanvas.height);
  obstacleCtx.globalCompositeOperation = "source-over";

  // draw original image to originalCanvas (visible overlay) WITHOUT smoothing
  originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
  originalCtx.save();
  originalCtx.imageSmoothingEnabled = false;
  const maxSize = Math.min(originalCanvas.width, originalCanvas.height) * 0.6;
  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (originalCanvas.width - drawW) / 2;
  const y = (originalCanvas.height - drawH) / 2;
  originalCtx.translate(x, y);
  originalCtx.drawImage(img, 0, 0, drawW, drawH);
  originalCtx.restore();

  // compute layout for obstacleCanvas separately (avoid redeclaring variables used above)
  const maxSize2 = Math.min(obstacleCanvas.width, obstacleCanvas.height) * 0.6;
  const scale2 = Math.min(maxSize2 / img.width, maxSize2 / img.height, 1);
  const drawW2 = img.width * scale2;
  const drawH2 = img.height * scale2;
  const x2 = (obstacleCanvas.width - drawW2) / 2;
  const y2 = (obstacleCanvas.height - drawH2) / 2;

  // Smooth low-res / blocky images before thresholding if enabled:
  // To prevent blur from bleeding transparent pixels into opaque areas,
  // first draw the image unfiltered into a temp canvas and capture its alpha mask,
  // then draw the (optionally) blurred image and apply the unblurred alpha mask so
  // transparent background pixels never become solid due to filtering.
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = obstacleCanvas.width;
  tempCanvas.height = obstacleCanvas.height;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCtx.save();
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.translate(x2, y2);
  tempCtx.drawImage(img, 0, 0, drawW2, drawH2);
  tempCtx.restore();

  // capture unblurred alpha mask
  const origImgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

  // now draw into obstacleCtx with optional blur
  obstacleCtx.save();
  obstacleCtx.imageSmoothingEnabled = true;
  if (useSmoothing) {
    obstacleCtx.filter = "blur(1.6px)";
  } else {
    obstacleCtx.filter = "none";
  }
  obstacleCtx.translate(0, 0);
  obstacleCtx.drawImage(tempCanvas, 0, 0);
  obstacleCtx.restore();
  obstacleCtx.filter = "none";

  // threshold and create solid silhouette
  const data = obstacleCtx.getImageData(0, 0, obstacleCanvas.width, obstacleCanvas.height);
  const d = data.data;
  const orig = origImgData.data;
  // Use original (unblurred) alpha to decide solidity so blurred edges don't create spurious opaque pixels.
  for (let i = 0; i < d.length; i += 4) {
    const aOrig = orig[i + 3];
    if (aOrig > 10) {
      d[i] = 40; d[i + 1] = 40; d[i + 2] = 40; d[i + 3] = 255;
    } else {
      d[i + 3] = 0; d[i] = d[i + 1] = d[i + 2] = 0;
    }
  }

  // small morphological cleanup: remove isolated/small protrusion pixels
  // create a copy of alpha channel as Uint8Array for neighbor checks
  const w = obstacleCanvas.width;
  const h = obstacleCanvas.height;
  const alpha = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      alpha[yy * w + xx] = d[(yy * w + xx) * 4 + 3] > 10 ? 1 : 0;
    }
  }
  // 3x3 majority filter: keep pixel only if at least 3 neighbors (including itself) are opaque
  const cleanedAlpha = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = xx + ox, ny = yy + oy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (alpha[ny * w + nx]) count++;
        }
      }
      cleanedAlpha[yy * w + xx] = count >= 3 ? 1 : 0;
    }
  }
  // write cleaned alpha back into image data, then dilate mask to avoid flow leakage
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const idx = (yy * w + xx) * 4;
      if (cleanedAlpha[yy * w + xx]) {
        d[idx] = 40; d[idx + 1] = 40; d[idx + 2] = 40; d[idx + 3] = 255;
      } else {
        d[idx] = 0; d[idx + 1] = 0; d[idx + 2] = 0; d[idx + 3] = 0;
      }
    }
  }

  // dilation: expand opaque pixels by a small radius to create a smooth, slightly padded silhouette
  const dilRadius = 2; // pixels
  if (dilRadius > 0) {
    const dilated = new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const idx = (yy * w + xx) * 4;
        if (d[idx + 3] > 10) {
          for (let oy = -dilRadius; oy <= dilRadius; oy++) {
            const ny = yy + oy;
            if (ny < 0 || ny >= h) continue;
            for (let ox = -dilRadius; ox <= dilRadius; ox++) {
              const nx = xx + ox;
              if (nx < 0 || nx >= w) continue;
              const dist2 = ox * ox + oy * oy;
              if (dist2 <= dilRadius * dilRadius) {
                dilated[ny * w + nx] = 1;
              }
            }
          }
        }
      }
    }
    // write dilated mask back into image data with a soft edge (anti-aliased alpha)
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const idx = (yy * w + xx) * 4;
        if (dilated[yy * w + xx]) {
          d[idx] = 40; d[idx + 1] = 40; d[idx + 2] = 40; d[idx + 3] = 255;
        } else {
          d[idx + 3] = 0;
        }
      }
    }
  }

  obstacleCtx.putImageData(data, 0, 0);
  obstacleData = data;

  // compute bounds of the silhouette
  let minX = obstacleCanvas.width, minY = obstacleCanvas.height, maxX = 0, maxY = 0;
  let found = false;
  for (let yy = 0; yy < obstacleCanvas.height; yy++) {
    for (let xx = 0; xx < obstacleCanvas.width; xx++) {
      const idx = (yy * obstacleCanvas.width + xx) * 4;
      if (d[idx + 3] > 10) {
        found = true;
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy;
        if (yy > maxY) maxY = yy;
      }
    }
  }
  obstacleBounds = found ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;

  if (typeof buildCallback === "function") buildCallback();
}

export function renderObstacleOverlay(mainCtx) {
  // Draw the original (unsmoothed) image overlay for visual fidelity,
  // while the solver continues to use the smoothed silhouette stored in obstacleCanvas.
  if (!originalCanvas) return;
  mainCtx.save();
  mainCtx.globalAlpha = 0.98;
  mainCtx.drawImage(originalCanvas, 0, 0);
  mainCtx.restore();

  // Safely draw bounds only when obstacleBounds is available
  if (!obstacleBounds) return;

  mainCtx.save();
  mainCtx.strokeStyle = "rgba(0,0,0,0.18)";
  mainCtx.lineWidth = 1;
  mainCtx.setLineDash([4, 3]);
  const { x, y, w, h } = obstacleBounds;
  mainCtx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  mainCtx.restore();
}

export function getObstacleData() {
  return { obstacleData, obstacleBounds, width, height };
}

