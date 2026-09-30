import { World, Body, G, radiusFor } from "./physics.js";
import { SCENARIOS, randomColor } from "./scenarios.js";

const $ = (id) => document.getElementById(id);
const canvas = $("sky");
const ctx = canvas.getContext("2d");

const world = new World();
const cam = { x: 0, y: 0, zoom: 1 };
const state = {
  running: true,
  speed: 1,
  trails: true,
  predict: true,
  scenario: null,
  baseEnergy: null,
  energyEvents: -1,
  frame: 0,
};
const TRAIL_LEN = 220;
const DT_MAX = 0.05;
let W = 0, H = 0, DPR = 1;

// ---------- Background starfield ----------
let stars = [];
function makeStars() {
  const n = Math.round((W * H) / 2600);
  stars = Array.from({ length: n }, () => ({
    x: Math.random(), y: Math.random(),
    z: Math.random() * 0.9 + 0.1,
    a: Math.random() * 0.32 + 0.06,
  }));
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  makeStars();
}
window.addEventListener("resize", resize);
resize();

// ---------- Coordinates ----------
const toScreen = (x, y) => [(x - cam.x) * cam.zoom + W / 2, (y - cam.y) * cam.zoom + H / 2];
const toWorld = (sx, sy) => [(sx - W / 2) / cam.zoom + cam.x, (sy - H / 2) / cam.zoom + cam.y];

// ---------- UI wiring ----------
const massSlider = $("mass");
const massFromSlider = () => {
  const v = +massSlider.value;
  const m = 0.5 * Math.pow(10, v / 25);
  return m < 10 ? Math.round(m * 10) / 10 : Math.round(m);
};
const fmt = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + "k" : String(m));
massSlider.addEventListener("input", () => ($("massOut").textContent = fmt(massFromSlider())));
$("massOut").textContent = fmt(massFromSlider());

const speedSlider = $("speed");
speedSlider.addEventListener("input", () => {
  state.speed = +speedSlider.value / 10;
  $("speedOut").textContent = state.speed.toFixed(1) + "×";
});

$("trails").addEventListener("change", (e) => setTrails(e.target.checked));
$("merge").addEventListener("change", (e) => (world.merge = e.target.checked));
$("predict").addEventListener("change", (e) => (state.predict = e.target.checked));
$("play").addEventListener("click", togglePlay);
$("step").addEventListener("click", () => { if (state.running) togglePlay(); advance(1); });
$("clear").addEventListener("click", () => { world.clear(); markScenario(null); toast("Empty space. Drag to launch, tap to orbit."); });
$("recenter").addEventListener("click", () => recenter(true));

const panel = $("panel");
$("panelToggle").addEventListener("click", () => {
  const hidden = panel.classList.toggle("hidden");
  $("panelToggle").textContent = hidden ? "Show panel" : "Hide panel";
  $("panelToggle").setAttribute("aria-expanded", String(!hidden));
});

const presetBox = $("presets");
SCENARIOS.forEach((s, i) => {
  const b = document.createElement("button");
  b.innerHTML = `<small>${i + 1}</small>${s.name}`;
  b.dataset.key = s.key;
  b.title = s.blurb;
  b.addEventListener("click", () => loadScenario(i));
  presetBox.appendChild(b);
});

function markScenario(key) {
  state.scenario = key;
  for (const b of presetBox.children) b.classList.toggle("active", b.dataset.key === key);
}

function setTrails(on) {
  state.trails = on;
  $("trails").checked = on;
  if (!on) for (const b of world.massive) b.trail.length = 0;
}

function togglePlay() {
  state.running = !state.running;
  $("play").textContent = state.running ? "Pause" : "Play";
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 4200);
}

function loadScenario(i) {
  const s = SCENARIOS[i];
  world.clear();
  for (const b of s.build()) world.add(b);
  world.merge = s.merge ?? true;
  $("merge").checked = world.merge;
  world.computeAccelerations();
  cam.x = 0; cam.y = 0;
  cam.zoom = s.zoom * Math.min(W, H) / 900;
  markScenario(s.key);
  toast(s.blurb);
}

function recenter(fit) {
  const com = world.centerOfMass();
  if (!com) { cam.x = 0; cam.y = 0; return; }
  cam.x = com.x; cam.y = com.y;
  if (fit && world.massive.length) {
    let r = 60;
    for (const b of world.massive) r = Math.max(r, Math.hypot(b.x - com.x, b.y - com.y) + b.r);
    cam.zoom = Math.min(4, Math.max(0.05, (Math.min(W, H) * 0.42) / r));
  }
}

// ---------- Keyboard ----------
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === "range") return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key === "s" || e.key === "S") { if (state.running) togglePlay(); advance(1); }
  else if (e.key === "c" || e.key === "C") $("clear").click();
  else if (e.key === "t" || e.key === "T") setTrails(!state.trails);
  else if (e.key === "f" || e.key === "F") recenter(true);
  else if (/^[1-9]$/.test(e.key) && SCENARIOS[+e.key - 1]) loadScenario(+e.key - 1);
});

// ---------- Pointer: launch, pan, pinch ----------
const pointers = new Map();
let drag = null;      // { mode: 'launch' | 'pan', ... }
let pinch = null;
let ghostPath = null;

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    drag = null; ghostPath = null;
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, mid: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2) };
    return;
  }

  const pan = e.button === 2 || e.button === 1 || e.shiftKey;
  if (pan) {
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    canvas.classList.add("panning");
  } else {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    drag = { mode: "launch", sx: e.clientX, sy: e.clientY, wx, wy, cx: e.clientX, cy: e.clientY, m: massFromSlider(), color: randomColor() };
    updateGhost();
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    cam.zoom = clampZoom(pinch.zoom * (d / pinch.dist));
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.x = pinch.mid[0] - (mx - W / 2) / cam.zoom;
    cam.y = pinch.mid[1] - (my - H / 2) / cam.zoom;
    return;
  }
  if (!drag) return;
  if (drag.mode === "pan") {
    cam.x = drag.cx - (e.clientX - drag.sx) / cam.zoom;
    cam.y = drag.cy - (e.clientY - drag.sy) / cam.zoom;
  } else {
    drag.cx = e.clientX; drag.cy = e.clientY;
    updateGhost();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
  if (!drag) return;
  if (drag.mode === "launch" && e.type === "pointerup") world.add(makeGhost());
  drag = null; ghostPath = null;
  canvas.classList.remove("panning");
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [wx, wy] = toWorld(e.clientX, e.clientY);
  cam.zoom = clampZoom(cam.zoom * Math.exp(-e.deltaY * 0.0015));
  cam.x = wx - (e.clientX - W / 2) / cam.zoom;
  cam.y = wy - (e.clientY - H / 2) / cam.zoom;
}, { passive: false });

const clampZoom = (z) => Math.min(8, Math.max(0.03, z));

// A tap (tiny drag) drops the body into a circular orbit around whatever pulls hardest.
function makeGhost() {
  const fixed = $("anchor").checked;
  const dx = drag.sx - drag.cx, dy = drag.sy - drag.cy;
  let vx = 0, vy = 0;
  if (!fixed) {
    if (Math.hypot(dx, dy) < 6) {
      const host = world.dominantAttractor(drag.wx, drag.wy);
      if (host) {
        const rx = drag.wx - host.x, ry = drag.wy - host.y;
        const r = Math.hypot(rx, ry) || 1;
        const v = Math.sqrt(G * host.m / r);
        vx = host.vx - (ry / r) * v;
        vy = host.vy + (rx / r) * v;
      }
    } else {
      vx = (dx / cam.zoom) * 0.045;
      vy = (dy / cam.zoom) * 0.045;
    }
  }
  return new Body({ x: drag.wx, y: drag.wy, vx, vy, m: drag.m, color: drag.color, fixed });
}

function updateGhost() {
  if (!state.predict || !drag || drag.mode !== "launch") { ghostPath = null; return; }
  const g = makeGhost();
  g.r = radiusFor(g.m);
  ghostPath = world.predict(g);
}

// ---------- Simulation ----------
function advance(simUnits) {
  const n = Math.max(1, Math.ceil(simUnits / DT_MAX));
  const dt = simUnits / n;
  for (let i = 0; i < n; i++) world.step(dt);
}

function recordTrails() {
  if (!state.trails) return;
  for (const b of world.massive) {
    b.trail.push(b.x, b.y);
    if (b.trail.length > TRAIL_LEN * 2) b.trail.splice(0, 2);
  }
}

// ---------- Rendering ----------
function drawBackground() {
  ctx.fillStyle = "#07080c";
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.2, Math.max(W, H) * 0.9);
  g.addColorStop(0, "rgba(40, 34, 60, 0.35)");
  g.addColorStop(1, "rgba(7, 8, 12, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#e8e4da";
  for (const s of stars) {
    // Gentle parallax: distant stars shift less with the camera.
    let x = (s.x * W - cam.x * s.z * 0.08) % W; if (x < 0) x += W;
    let y = (s.y * H - cam.y * s.z * 0.08) % H; if (y < 0) y += H;
    ctx.globalAlpha = s.a;
    ctx.fillRect(x, y, s.z > 0.8 ? 1.4 : 1, s.z > 0.8 ? 1.4 : 1);
  }
  ctx.globalAlpha = 1;
}

function drawTrails() {
  if (!state.trails) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const CHUNKS = 10;
  for (const b of world.massive) {
    const t = b.trail;
    const pts = t.length / 2;
    if (pts < 2) continue;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = Math.min(2.2, Math.max(1, b.r * cam.zoom * 0.25));
    const per = Math.ceil(pts / CHUNKS);
    for (let c = 0; c < CHUNKS; c++) {
      const start = c * per, end = Math.min(pts - 1, (c + 1) * per);
      if (end <= start) continue;
      ctx.globalAlpha = ((c + 1) / CHUNKS) ** 1.6 * 0.55;
      ctx.beginPath();
      let [sx, sy] = toScreen(t[start * 2], t[start * 2 + 1]);
      ctx.moveTo(sx, sy);
      for (let i = start + 1; i <= end; i++) {
        [sx, sy] = toScreen(t[i * 2], t[i * 2 + 1]);
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawParticles() {
  const P = world.particles;
  if (!P.length) return;
  ctx.globalCompositeOperation = "lighter";
  const size = Math.max(1.8, Math.min(2.8, cam.zoom * 2.2));
  let last = null;
  ctx.globalAlpha = 0.9;
  for (const p of P) {
    if (p.color !== last) { ctx.fillStyle = p.color; last = p.color; }
    const [x, y] = toScreen(p.x, p.y);
    if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawBody(b, alpha = 1) {
  const [x, y] = toScreen(b.x, b.y);
  const r = Math.max(1.5, b.r * cam.zoom);
  if (x < -r * 6 || y < -r * 6 || x > W + r * 6 || y > H + r * 6) return;
  ctx.globalAlpha = alpha;

  if (b.m >= 500) {
    // Stars glow.
    const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 4.5);
    glow.addColorStop(0, hexA(b.color, 0.45));
    glow.addColorStop(1, hexA(b.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 4.5, 0, Math.PI * 2); ctx.fill();
    const core = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
    core.addColorStop(0, "#fffaf0");
    core.addColorStop(1, b.color);
    ctx.fillStyle = core;
  } else {
    // Planets get a lit hemisphere.
    const shade = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r * 1.1);
    shade.addColorStop(0, b.color);
    shade.addColorStop(1, mix(b.color, "#07080c", 0.6));
    ctx.fillStyle = shade;
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

  if (b.fixed) {
    ctx.strokeStyle = "rgba(232,228,218,0.5)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function drawLaunch() {
  if (!drag || drag.mode !== "launch") return;
  const [gx, gy] = toScreen(drag.wx, drag.wy);

  if (ghostPath && ghostPath.length > 3) {
    ctx.strokeStyle = drag.color;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 6]);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < ghostPath.length; i += 2) {
      const [x, y] = toScreen(ghostPath[i], ghostPath[i + 1]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Slingshot band.
  const dx = drag.sx - drag.cx, dy = drag.sy - drag.cy;
  if (Math.hypot(dx, dy) >= 6) {
    ctx.strokeStyle = "rgba(242,180,90,0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(drag.cx, drag.cy); ctx.stroke();
    ctx.fillStyle = "rgba(242,180,90,0.9)";
    ctx.beginPath(); ctx.arc(drag.cx, drag.cy, 3, 0, Math.PI * 2); ctx.fill();
  }

  drawBody({ x: drag.wx, y: drag.wy, r: radiusFor(drag.m), m: drag.m, color: drag.color, fixed: $("anchor").checked }, 0.8);
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function mix(h1, h2, t) {
  const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
  const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

// ---------- Stats ----------
let fpsAcc = 0, fpsFrames = 0, fps = 0;
function updateStats(dtMs) {
  fpsAcc += dtMs; fpsFrames++;
  if (fpsAcc > 500) { fps = Math.round((fpsFrames * 1000) / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
  if (state.frame % 12 !== 0) return;

  // Re-baseline energy whenever the set of bodies changes (adds, merges).
  if (state.energyEvents !== world.events) {
    state.baseEnergy = world.energy();
    state.energyEvents = world.events;
  }
  const E = world.energy();
  const drift = state.baseEnergy ? Math.abs((E - state.baseEnergy) / state.baseEnergy) * 100 : 0;
  $("statBodies").textContent = world.count.toLocaleString();
  $("statTime").textContent = Math.floor(world.time).toLocaleString();
  $("statEnergy").textContent = world.massive.length > 1 ? (drift < 0.01 ? "<0.01%" : drift.toFixed(2) + "%") : "—";
  $("statFps").textContent = fps;
}

// ---------- Main loop ----------
let last = performance.now();
function frame(now) {
  const dtMs = Math.min(64, now - last);
  last = now;
  state.frame++;

  if (state.running) {
    advance(state.speed * (dtMs / 16.67));
    recordTrails();
    if (drag && state.frame % 4 === 0) updateGhost();
  }

  drawBackground();
  drawTrails();
  drawParticles();
  for (const b of world.massive) drawBody(b);
  drawLaunch();
  updateStats(dtMs);
  requestAnimationFrame(frame);
}

// Start with a scenario from the URL hash (#galaxies) or the solar system.
const fromHash = SCENARIOS.findIndex((s) => s.key === location.hash.slice(1));
loadScenario(fromHash >= 0 ? fromHash : 0);
requestAnimationFrame(frame);

// Expose for tinkering in the console.
window.gravitas = { world, cam, SCENARIOS, loadScenario };
