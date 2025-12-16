/*
Obstacle handling module: manages obstacle canvas, silhouette creation, and provides accessors.
This file takes the obstacle-related parts previously in flowFieldCore.js.
Exports:
 - createFlowField({canvas, ctx})
 - setObstacleData(imgOrNull)
 - renderObstacleOverlay(mainCtx)
 - getObstacleData()
*/

let canvas, ctx;
let obstacleCanvas, obstacleCtx;
let obstacleData = null;
let obstacleBounds = null;
let width = 0, height = 0;

export function createFlowField({ canvas: mainCanvas, ctx: mainCtx }) {
  canvas = mainCanvas;
  ctx = mainCtx;

  obstacleCanvas = document.createElement("canvas");
  obstacleCtx = obstacleCanvas.getContext("2d");
}

export function setSize(w, h) {
  width = w;
  height = h;
  if (obstacleCanvas) {
    obstacleCanvas.width = width;
    obstacleCanvas.height = height;
  }
}

export function setObstacleData(imgOrNull, buildCallback) {
  // ensure obstacle canvas matches current size
  if (obstacleCanvas) {
    obstacleCanvas.width = width || obstacleCanvas.width;
    obstacleCanvas.height = height || obstacleCanvas.height;
  }

  if (!imgOrNull) {
    obstacleData = null;
    obstacleBounds = null;
    if (obstacleCtx) {
      obstacleCtx.clearRect(0, 0, obstacleCanvas.width, obstacleCanvas.height);
    }
    if (typeof buildCallback === "function") buildCallback();
    return;
  }

  const img = imgOrNull;

  obstacleCtx.clearRect(0, 0, obstacleCanvas.width, obstacleCanvas.height);
  obstacleCtx.globalCompositeOperation = "source-over";

  const maxSize = Math.min(obstacleCanvas.width, obstacleCanvas.height) * 0.6;
  const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (obstacleCanvas.width - drawW) / 2;
  const y = (obstacleCanvas.height - drawH) / 2;

  obstacleCtx.save();
  obstacleCtx.translate(x, y);
  obstacleCtx.drawImage(img, 0, 0, drawW, drawH);
  obstacleCtx.restore();

  // threshold and create solid silhouette
  const data = obstacleCtx.getImageData(0, 0, obstacleCanvas.width, obstacleCanvas.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 10) {
      d[i] = 40; d[i + 1] = 40; d[i + 2] = 40; d[i + 3] = 255;
    } else {
      d[i + 3] = 0; d[i] = d[i + 1] = d[i + 2] = 0;
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
  return { obstacleData, obstacleBounds, width, height };
}

