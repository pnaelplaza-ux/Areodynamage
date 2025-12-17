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
      a.download = "dynamage_export.png";
      a.click();
    } catch (err) {
      console.warn("Export failed", err);
    }
  },
  onExportVideo: () => {
    // Show progress feedback
    const exportBtn = document.getElementById("exportVideoBtn");
    if (!exportBtn) return;
    const origText = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = "Recording... 0%";

    // Video recording: 30s total, three 10s segments at speeds 50,100,200
    const segments = [
      { speed: 50, duration: 10 },
      { speed: 100, duration: 10 },
      { speed: 200, duration: 10 },
    ];
    const fps = 30;
    const totalSeconds = segments.reduce((s, seg) => s + seg.duration, 0);
    
    // Use more compatible codec (webm with vp8 fallback)
    let mimeType = "video/webm;codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "video/webm;codecs=vp8";
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "video/webm";
    }

    const stream = canvas.captureStream(fps);
    const recordedChunks = [];
    const rec = new MediaRecorder(stream, { mimeType });
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) recordedChunks.push(ev.data); };
    rec.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dynamage_flow_${new Date().toISOString().slice(0,10)}.webm`;
      a.click();
      
      // Show success feedback
      exportBtn.textContent = "✓ Saved!";
      setTimeout(() => {
        exportBtn.textContent = origText;
        exportBtn.disabled = false;
        URL.revokeObjectURL(url);
      }, 2000);
    };

    // prepare UI and simulation state
    const prevPaused = paused;
    paused = false;
    rec.start();

    // schedule segment changes
    let elapsed = 0;
    let segIndex = 0;
    function applySegment(seg) {
      buildFlowField({ baseWindSpeed: seg.speed });
    }

    applySegment(segments[0]);

    const startTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      elapsed = (now - startTime) / 1000;
      const progress = Math.round((elapsed / totalSeconds) * 100);
      exportBtn.textContent = `Recording... ${Math.min(progress, 99)}%`;
      
      // determine current segment
      let cum = 0, idx = 0;
      for (; idx < segments.length; idx++) {
        cum += segments[idx].duration;
        if (elapsed < cum) break;
      }
      if (idx >= segments.length) {
        // finished
        clearInterval(interval);
        setTimeout(() => {
          rec.stop();
          paused = prevPaused;
          buildFlowField(getUIState()); // restore UI params
        }, 120); // small delay to flush a few frames
        return;
      }
      if (idx !== segIndex) {
        segIndex = idx;
        applySegment(segments[segIndex]);
      }
    }, 200);
  },
  onReset: () => {
    setObstacleData(null);
    resetParticles();
    computeDragIndex();
  },
  onImageLoad: async (img, opts = {}) => {
    // smoothing is simulated automatically in obstacle module
    // provide a build callback so obstacle processing can trigger a reset
    setObstacleData(img, () => {
      // reset particle positions so none start embedded in the new silhouette
      initParticles();
      // rebuild the flow so pressure/velocity fields reflect the new obstacle
      buildFlowField(getUIState());
      // refresh diagnostics display
      computeDragIndex();
    });
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

 // show a brief intro banner on first load, swipe-to-dismiss or auto-slide-up
(function showIntroOnce() {
  const banner = document.getElementById("introBanner");
  if (!banner) return;

  // do not show again if user previously dismissed
  try {
    const dismissed = localStorage.getItem("dynamageIntroDismissed");
    if (dismissed === "1") {
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      return;
    }
  } catch (e) { /* ignore storage errors */ }

  // robust swipe: use pointer capture and track velocity for touch & mouse
  banner.style.touchAction = "none";
  banner.style.transition = "transform 320ms cubic-bezier(.2,.9,.2,1), opacity 320ms ease";

  let startX = 0, startY = 0, curX = 0, curY = 0;
  let dragging = false;
  let startTime = 0;
  let lastMoveTime = 0;
  let lastMoveX = 0;
  let pointerId = null;
  const threshold = 80; // px to consider a dismiss
  const velocityThreshold = 0.6; // px/ms
  const activeClass = "intro-dragging";

  function setTransform(x, y, scale = 1, op = 1) {
    banner.style.transform = `translateX(${x}px) translateY(${y}px) scale(${scale})`;
    banner.style.opacity = String(op);
  }

  function getEventPoint(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function startDrag(e) {
    const p = getEventPoint(e);
    startX = p.x;
    startY = p.y;
    curX = 0; curY = 0;
    dragging = true;
    startTime = performance.now();
    lastMoveTime = startTime;
    lastMoveX = startX;
    banner.classList.add(activeClass);
    banner.style.transition = "none";
    if (e.pointerId) {
      pointerId = e.pointerId;
      try { banner.setPointerCapture(pointerId); } catch (err) {}
    }
  }

  function moveDrag(e) {
    if (!dragging) return;
    const p = getEventPoint(e);
    curX = p.x - startX;
    curY = p.y - startY;
    // restrict mostly horizontal but allow slight vertical offset
    const dampY = Math.max(-40, Math.min(40, curY * 0.6));
    const dampX = curX;
    const rot = Math.max(-8, Math.min(8, dampX * 0.02));
    const opacity = Math.max(0.25, 1 - Math.abs(dampX) / 420);
    setTransform(dampX, dampY, 1, opacity);
    banner.style.rotate = `${rot}deg`;

    // update velocity sample
    const now = performance.now();
    lastMoveTime = now;
    lastMoveX = p.x;
  }

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    banner.classList.remove(activeClass);
    banner.style.transition = "transform 320ms cubic-bezier(.2,.9,.2,1), opacity 240ms ease";

    // compute approximate velocity (px/ms)
    const now = performance.now();
    const dt = Math.max(1, now - startTime);
    const avgVel = (curX) / dt;
    // compute short-term velocity if possible
    const shortDt = Math.max(1, now - lastMoveTime);
    const shortVel = (getEventPoint(e).x - lastMoveX) / shortDt;

    const effectiveVel = Math.abs(shortVel) > 0 ? shortVel : avgVel;

    // decide if it should dismiss based on displacement or velocity
    if (Math.abs(curX) > threshold || Math.abs(effectiveVel) > velocityThreshold) {
      const dir = (curX > 0 || effectiveVel > 0) ? 1 : -1;
      // slide off screen and remove
      setTransform(dir * (window.innerWidth + 160), curY * 0.4, 1, 0);
      banner.addEventListener("transitionend", () => {
        try { localStorage.setItem("dynamageIntroDismissed", "1"); } catch (e) {}
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      }, { once: true });
    } else {
      // snap back and remain; then schedule auto slide-up if not interacted with
      setTransform(0, 0, 1, 1);
      banner.style.rotate = `0deg`;
      scheduleAutoSlide();
    }

    if (pointerId !== null) {
      try { banner.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;
    }
  }

  function cancelDrag() {
    if (!dragging) return;
    dragging = false;
    banner.classList.remove(activeClass);
    banner.style.transition = "transform 220ms ease, opacity 220ms ease";
    setTransform(0, 0, 1, 1);
    banner.style.rotate = `0deg`;
    if (pointerId !== null) {
      try { banner.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;
    }
    scheduleAutoSlide();
  }

  // Pointer & touch binding
  banner.addEventListener("pointerdown", (e) => { startDrag(e); }, { passive: true });
  banner.addEventListener("pointermove", (e) => { moveDrag(e); }, { passive: true });
  banner.addEventListener("pointerup", (e) => { endDrag(e); }, { passive: true });
  banner.addEventListener("pointercancel", cancelDrag, { passive: true });

  // Fallback touch listeners for older browsers
  banner.addEventListener("touchstart", (e) => { startDrag(e); }, { passive: true });
  window.addEventListener("touchmove", (e) => { moveDrag(e); }, { passive: true });
  window.addEventListener("touchend", (e) => { endDrag(e); }, { passive: true });
  window.addEventListener("touchcancel", cancelDrag, { passive: true });

  // Also allow mouse drag (for non-pointer-supporting browsers)
  banner.addEventListener("mousedown", (e) => { startDrag(e); });
  window.addEventListener("mousemove", (e) => { moveDrag(e); });
  window.addEventListener("mouseup", (e) => { endDrag(e); });

  // Auto slide-up behavior (if no user interaction)
  let autoTimer = null;
  function scheduleAutoSlide() {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      // slide up like a notification and remove
      banner.style.transition = "transform 520ms cubic-bezier(.2,.9,.2,1), opacity 420ms ease";
      setTransform(0, -48, 0.985, 0);
      banner.addEventListener("transitionend", () => {
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      }, { once: true });
    }, 3500);
  }

  // Manual dismiss button (immediate removal)
  const closeBtn = banner.querySelector(".intro-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // remove without animation delay for instant dismissal
      if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    }, { passive: true });
  }

  // start scheduled auto-slide initially
  scheduleAutoSlide();
})();

// logo easter egg: click spam to reveal chips gif
(function setupLogoEasterEgg() {
  const logoContainer = document.getElementById("logoContainer");
  if (!logoContainer) return;
  const logoImg = logoContainer.querySelector("img");
  const logoGif = logoContainer.querySelector("img[data-gif]");
  let clickCount = 0;
  let resetTimeout = null;
  
  logoContainer.addEventListener("click", () => {
    clickCount++;
    if (resetTimeout) clearTimeout(resetTimeout);
    
    if (clickCount >= 5) {
      // show chips gif
      if (logoImg) logoImg.style.display = "none";
      if (logoGif) logoGif.style.display = "block";
      clickCount = 0;
    }
    
    // reset after 2s of inactivity
    resetTimeout = setTimeout(() => {
      clickCount = 0;
      if (logoImg) logoImg.style.display = "block";
      if (logoGif) logoGif.style.display = "none";
    }, 2000);
  });
})();

function renderBackground(uiState = {}) {
  // Use uiState.backgroundColor to tint a subtle horizontal gradient.
  const base = uiState.backgroundColor || "#f4f3ef";
  // create a lighter variant for the far edge
  function lightenHex(hex, amt = 12) {
    const h = hex.replace("#", "");
    const num = parseInt(h, 16);
    let r = (num >> 16) + amt;
    let g = ((num >> 8) & 0xff) + amt;
    let b = (num & 0xff) + amt;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return "#" + (r << 16 | g << 8 | b).toString(16).padStart(6, "0");
  }
  const far = lightenHex(base, 10);
  const g = ctx.createLinearGradient(0, 0, width, 0);
  g.addColorStop(0, base);
  g.addColorStop(1, far);
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

  renderBackground(uiState);
  // draw the placed obstacle image overlay (visible silhouette)
  renderObstacleOverlay(ctx);
  // particles render themselves via particle module
  renderParticles(uiState);
  // flow-shaping removed

  // update diagnostics (drag/lift/yaw) so UI readouts stay current
  computeDragIndex();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);