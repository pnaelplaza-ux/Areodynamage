/*
  main.js refactored: moved core logic into modules under /src/.
  Tombstone comments below indicate removed blocks from the original large file.
*/

import { createFlowField, buildFlowField, sampleFlow, setObstacleData, computeDragIndex, resizeFlow, renderObstacleOverlay, tick as tickFlowField } from "./src/flowField.js";
import { createParticles, initParticles, updateParticles, renderParticles, setParticleParams, resetParticles } from "./src/particles.js";
import { setupUI, getUIState } from "./src/ui.js";

const canvas = document.getElementById("flowCanvas");
const ctx = canvas.getContext("2d", { alpha: false });

// Tombstone: removed large inline UI and flow/particle logic that lived here
// removed function resize() {}
// removed function initParticles() {}
// removed function isSolidAt() {}
// removed function buildFlowField() {}
// removed function sampleFlow() {}
// removed function updateParticles() {}
// removed function sampleAlphaGradient() {}
// removed function renderBackground() {}
// removed function renderObstacleOverlay() {}
// removed function renderParticles() {}
// removed function computeDragIndex() {}
// removed function placeImageInCanvas() {}
// removed file-level constants and variables moved into modules.

let width = 0;
let height = 0;
let lastTime = performance.now();
let paused = false;

// initialize modules
createFlowField({ canvas, ctx });
createParticles({ canvas, ctx });

// wire UI
setupUI({
  onTogglePause: (p) => (paused = p),
  onExport: () => {
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "aero_export.png";
      a.click();
    } catch (err) {
      console.warn("Export failed", err);
    }
  },
  onReset: () => {
    setObstacleData(null);
    resetParticles();
    computeDragIndex();
  },
  onImageLoad: async (img) => {
    // let flowField handle placing the image and rebuilding
    setObstacleData(img);
    // re-seed particles for visual clarity
    initParticles();
    computeDragIndex();
  },
  onParamsChange: (params) => {
    // forward some params to modules
    setParticleParams(params);
    buildFlowField(params);
  },
});

// handle resize and start loop
function handleResize() {
  const dpr = window.devicePixelRatio || 1;
  width = canvas.clientWidth || window.innerWidth;
  height = canvas.clientHeight || window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  resizeFlow({ width, height });
  initParticles(); // re-init particles on resize
}
window.addEventListener("resize", handleResize, { passive: true });
handleResize();

function renderBackground() {
  // subtle gradient (kept small and local)
  const g = ctx.createLinearGradient(0, 0, width, 0);
  g.addColorStop(0, "#eae8e0");
  g.addColorStop(1, "#faf8f2");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(0,0,0,0.03)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.04);
  lastTime = now;

  const uiState = getUIState();

  // advance flow field temporal state (seconds)
  tickFlowField(now / 1000);

  if (!paused) updateParticles(dt, uiState);

  renderBackground();
  // draw the placed obstacle image overlay (visible silhouette)
  renderObstacleOverlay(ctx);
  // particles render themselves via particle module
  renderParticles(uiState);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);