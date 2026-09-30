// Gravitas physics core.
// Units: G = 1, distance in world pixels, time in "sim units".
// Integrator: velocity Verlet (kick-drift-kick), symplectic and time-reversible,
// so orbits stay stable over long runs instead of spiralling in or out.

export const G = 1;
export const SOFTENING = 4; // Plummer softening length; keeps close passes finite
const EPS2 = SOFTENING * SOFTENING;

export const radiusFor = (m) => Math.max(1.6, Math.cbrt(m) * 2.2);

let nextId = 1;

export class Body {
  constructor({ x, y, vx = 0, vy = 0, m = 1, color = "#e8e4da", fixed = false, massless = false, r }) {
    this.id = nextId++;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.ax = 0; this.ay = 0;
    this.m = massless ? 0 : m;
    this.massless = massless;
    this.fixed = fixed;
    this.color = color;
    this.r = massless ? 1 : (r ?? radiusFor(m));
    this.trail = [];
    this.alive = true;
  }
}

export class World {
  constructor() {
    this.massive = [];   // bodies that attract (O(n²) between themselves)
    this.particles = []; // massless test particles (feel gravity, exert none)
    this.time = 0;
    this.merge = true;
    this.events = 0;     // bumps whenever bodies are merged/absorbed
  }

  get count() { return this.massive.length + this.particles.length; }

  add(body) {
    (body.massless ? this.particles : this.massive).push(body);
    this.events++;
    return body;
  }

  clear() {
    this.massive = [];
    this.particles = [];
    this.time = 0;
    this.events++;
  }

  computeAccelerations() {
    const M = this.massive;
    const n = M.length;
    for (let i = 0; i < n; i++) { M[i].ax = 0; M[i].ay = 0; }

    for (let i = 0; i < n; i++) {
      const a = M[i];
      for (let j = i + 1; j < n; j++) {
        const b = M[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + EPS2;
        const inv = G / (d2 * Math.sqrt(d2));
        a.ax += dx * inv * b.m; a.ay += dy * inv * b.m;
        b.ax -= dx * inv * a.m; b.ay -= dy * inv * a.m;
      }
    }

    const P = this.particles;
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      let ax = 0, ay = 0;
      for (let i = 0; i < n; i++) {
        const a = M[i];
        const dx = a.x - p.x, dy = a.y - p.y;
        const d2 = dx * dx + dy * dy + EPS2;
        const inv = G * a.m / (d2 * Math.sqrt(d2));
        ax += dx * inv; ay += dy * inv;
      }
      p.ax = ax; p.ay = ay;
    }
  }

  step(dt) {
    const all = this.massive.concat(this.particles);
    const h = dt * 0.5;
    for (const b of all) {
      if (b.fixed) continue;
      b.vx += b.ax * h; b.vy += b.ay * h;
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
    this.computeAccelerations();
    for (const b of all) {
      if (b.fixed) { b.vx = 0; b.vy = 0; continue; }
      b.vx += b.ax * h; b.vy += b.ay * h;
    }
    this.time += dt;
    this.resolveCollisions();
  }

  resolveCollisions() {
    const M = this.massive;
    let changed = false;

    if (this.merge) {
      for (let i = 0; i < M.length; i++) {
        const a = M[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < M.length; j++) {
          const b = M[j];
          if (!b.alive) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const rr = (a.r + b.r) * 0.8;
          if (dx * dx + dy * dy < rr * rr) {
            mergeInto(a, b);
            changed = true;
          }
        }
      }
      if (changed) this.massive = M.filter((b) => b.alive);
    }

    // Test particles that fall into a massive body are swallowed.
    const P = this.particles;
    let swallowed = false;
    for (const p of P) {
      for (const a of this.massive) {
        const dx = a.x - p.x, dy = a.y - p.y;
        if (dx * dx + dy * dy < a.r * a.r * 0.5) { p.alive = false; swallowed = true; break; }
      }
    }
    if (swallowed) this.particles = P.filter((p) => p.alive);
    if (changed || swallowed) this.events++;
  }

  // Total mechanical energy of the massive system (softened potential).
  energy() {
    const M = this.massive;
    let ke = 0, pe = 0;
    for (let i = 0; i < M.length; i++) {
      const a = M[i];
      if (!a.fixed) ke += 0.5 * a.m * (a.vx * a.vx + a.vy * a.vy);
      for (let j = i + 1; j < M.length; j++) {
        const b = M[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        pe -= G * a.m * b.m / Math.sqrt(dx * dx + dy * dy + EPS2);
      }
    }
    return ke + pe;
  }

  centerOfMass() {
    let m = 0, x = 0, y = 0;
    for (const b of this.massive) { m += b.m; x += b.x * b.m; y += b.y * b.m; }
    if (m === 0) return null;
    return { x: x / m, y: y / m, m };
  }

  // The body whose pull is strongest at (x, y) — used for "tap to orbit".
  dominantAttractor(x, y) {
    let best = null, bestPull = 0;
    for (const b of this.massive) {
      const d2 = (b.x - x) ** 2 + (b.y - y) ** 2 + EPS2;
      const pull = b.m / d2;
      if (pull > bestPull) { bestPull = pull; best = b; }
    }
    return best;
  }

  // Cheap forward simulation of a hypothetical body against the current massive set.
  predict(ghost, steps = 900, dt = 0.35) {
    const bodies = this.massive.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, m: b.m, r: b.r, fixed: b.fixed, ax: 0, ay: 0 }));
    const g = { x: ghost.x, y: ghost.y, vx: ghost.vx, vy: ghost.vy, m: ghost.m, r: ghost.r, fixed: ghost.fixed, ax: 0, ay: 0 };
    bodies.push(g);
    const path = [g.x, g.y];
    if (g.fixed) return path;

    const accel = () => {
      for (const b of bodies) { b.ax = 0; b.ay = 0; }
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + EPS2;
          const inv = G / (d2 * Math.sqrt(d2));
          a.ax += dx * inv * b.m; a.ay += dy * inv * b.m;
          b.ax -= dx * inv * a.m; b.ay -= dy * inv * a.m;
        }
      }
    };

    accel();
    const h = dt * 0.5;
    for (let s = 0; s < steps; s++) {
      for (const b of bodies) {
        if (b.fixed) continue;
        b.vx += b.ax * h; b.vy += b.ay * h;
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
      accel();
      for (const b of bodies) {
        if (b.fixed) continue;
        b.vx += b.ax * h; b.vy += b.ay * h;
      }
      if (s % 3 === 0) path.push(g.x, g.y);
      // Stop when the ghost would hit something.
      for (let i = 0; i < bodies.length - 1; i++) {
        const b = bodies[i];
        const rr = (b.r + g.r) * 0.8;
        if ((b.x - g.x) ** 2 + (b.y - g.y) ** 2 < rr * rr) { path.push(g.x, g.y); return path; }
      }
    }
    return path;
  }
}

function mergeInto(a, b) {
  const m = a.m + b.m;
  const big = a.m >= b.m ? a : b;
  if (a.fixed || b.fixed) {
    const f = a.fixed ? a : b;
    a.x = f.x; a.y = f.y; a.vx = 0; a.vy = 0; a.fixed = true;
  } else {
    a.x = (a.x * a.m + b.x * b.m) / m;
    a.y = (a.y * a.m + b.y * b.m) / m;
    a.vx = (a.vx * a.m + b.vx * b.m) / m;
    a.vy = (a.vy * a.m + b.vy * b.m) / m;
  }
  a.color = big.color;
  if (big === b) a.trail = b.trail;
  a.m = m;
  a.r = radiusFor(m);
  b.alive = false;
}
