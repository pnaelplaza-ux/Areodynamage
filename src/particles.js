/*
Particle system module: manages particle creation, update and draw.
Exports:
 - createParticles({canvas,ctx})
 - initParticles(count?)
 - updateParticles(dt, uiState)
 - renderParticles(uiState)
 - setParticleParams(params)
 - resetParticles()
*/

let canvas, ctx;
let particles = [];
let width = 0, height = 0;
let particleCount = 900;
let turbulence = 0.18;
let gustsEnabled = false;
let colorMode = "mono";

import { getObstacleData, sampleFlow, samplePressure } from "./flowField.js";

export function createParticles({ canvas: c, ctx: ct }) {
  canvas = c;
  ctx = ct;
}

export function setParticleParams(params = {}) {
  if (params.particleCount !== undefined) particleCount = params.particleCount;
  if (params.turbulence !== undefined) turbulence = params.turbulence;
  if (params.gustsEnabled !== undefined) gustsEnabled = params.gustsEnabled;
  if (params.colorMode !== undefined) colorMode = params.colorMode;
}

export function initParticles(count = particleCount) {
  particles.length = 0;
  particleCount = count;
  width = canvas.clientWidth || window.innerWidth;
  height = canvas.clientHeight || window.innerHeight;
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 0,
      vy: 0,
      age: Math.random() * 4,
    });
  }
}

export function resetParticles() {
  initParticles();
}

function isSolidAt(x, y) {
  const od = getObstacleData().obstacleData;
  if (!od) return false;
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const ix = x | 0;
  const iy = y | 0;
  const idx = (iy * od.width + ix) * 4;
  return od.data[idx + 3] > 10;
}

function sampleAlphaGradientLocal(x, y) {
  const od = getObstacleData().obstacleData;
  if (!od) return { gx: 0, gy: 0 };
  const iw = od.width;
  const ix = Math.max(1, Math.min(iw - 2, Math.round(x)));
  const iy = Math.max(1, Math.min(od.height - 2, Math.round(y)));
  const idx = (iy * iw + ix) * 4;

  const idxL = (iy * iw + (ix - 1)) * 4;
  const idxR = (iy * iw + (ix + 1)) * 4;
  const idxU = ((iy - 1) * iw + ix) * 4;
  const idxD = ((iy + 1) * iw + ix) * 4;

  const aL = od.data[idxL + 3] / 255;
  const aR = od.data[idxR + 3] / 255;
  const aU = od.data[idxU + 3] / 255;
  const aD = od.data[idxD + 3] / 255;

  const gx = (aL - aR) * 0.5;
  const gy = (aU - aD) * 0.5;
  const len = Math.hypot(gx, gy) + 1e-6;
  return { gx: gx / len, gy: gy / len };
}

export function updateParticles(dt, uiState = {}) {
  // sync parameters if provided
  if (uiState.turbulence !== undefined) turbulence = uiState.turbulence;
  if (uiState.gustsEnabled !== undefined) gustsEnabled = uiState.gustsEnabled;
  if (uiState.particleCount !== undefined && uiState.particleCount !== particleCount) {
    initParticles(uiState.particleCount);
  }
  if (uiState.colorMode !== undefined) colorMode = uiState.colorMode;

  width = canvas.clientWidth || window.innerWidth;
  height = canvas.clientHeight || window.innerHeight;

  const flowSample = sampleFlow;

  for (const p of particles) {
    const f = flowSample(p.x, p.y);

    const blend = 0.12;
    p.vx += (f.x - p.vx) * blend;
    p.vy += (f.y - p.vy) * blend;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    const turbScale = 6 * (0.2 + turbulence);
    p.vx += (Math.random() - 0.5) * turbScale * dt;
    p.vy += (Math.random() - 0.5) * turbScale * dt;

    if (gustsEnabled && Math.random() < 0.003) {
      const gustStrength = 200 + Math.random() * 260;
      p.vx += gustStrength * (0.6 + Math.random() * 0.9);
      p.vy += (Math.random() - 0.5) * gustStrength * 0.2;
    }

    if (p.x > width + 20 || p.y < -40 || p.y > height + 40) {
      p.x = -10 - Math.random() * 40;
      p.y = Math.random() * height;
      p.vx = 0;
      p.vy = 0;
    }

    if (isSolidAt(p.x, p.y)) {
      p.x -= p.vx * dt * 1.5;
      p.y -= p.vy * dt * 1.5;

      const g = sampleAlphaGradientLocal(p.x, p.y);
      p.vx += g.gx * 60;
      p.vy += g.gy * 60;
      p.vx *= 0.4;
      p.vy *= 0.4;
    }
  }
}

export function renderParticles(uiState = {}) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  // color/pressure visualization: adjust stroke per-particle based on local pressure (pressure proxy)
  const flowSample = sampleFlow;
  const pressureSample = samplePressure;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";

  for (const p of particles) {
    const speed = Math.hypot(p.vx, p.vy);
    const len = Math.min(18, 2 + speed * 0.06);
    const px = p.x;
    const py = p.y;
    const nx = px - (p.vx / (speed + 1e-6)) * len;
    const ny = py - (p.vy / (speed + 1e-6)) * len;

    // sample pressure and map to color: high pressure -> warm (red/yellow), low pressure -> cool (blue/cyan)
    let pVal = 0;
    try {
      pVal = pressureSample(px, py);
    } catch (e) { pVal = 0; }
    // Normalize pVal to -Vref^2..+Vref^2 -> map to 0..1
    const Vref = Math.max(1, uiState.baseWindSpeed || 80);
    const norm = Math.max(-Vref * Vref, Math.min(Vref * Vref, pVal));
    const t = (norm + Vref * Vref) / (2 * Vref * Vref); // 0..1 scale: 0=cold,1=hot

    let strokeColor = "rgba(20,20,20,0.12)";
    if (uiState.colorMode === "blue") {
      const r = Math.round(40 + 200 * t);
      const g = Math.round(80 + 40 * (1 - t));
      const b = Math.round(200 - 120 * t);
      strokeColor = `rgba(${r},${g},${b},0.16)`;
    } else if (uiState.colorMode === "warm") {
      const r = Math.round(120 + 120 * t);
      const g = Math.round(60 - 20 * t);
      const b = Math.round(40 - 20 * t);
      strokeColor = `rgba(${r},${g},${b},0.16)`;
    } else {
      const r = 20 + Math.round(200 * t);
      const g = 20 + Math.round(160 * (1 - t));
      const b = 30 + Math.round(120 * (1 - t));
      strokeColor = `rgba(${r},${g},${b},0.14)`;
    }
    ctx.strokeStyle = strokeColor;

    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(px, py);
    ctx.stroke();
  }
  ctx.restore();

  // also render obstacle overlay from flowField module for cohesion
  const flow = getObstacleData();
  if (flow) {
    const { obstacleData, obstacleBounds } = flow;
    if (obstacleData && obstacleBounds) {
      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.restore();
    }
  }
}

