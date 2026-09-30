import { Body, G } from "./physics.js";

export const PALETTE = ["#8fb8ff", "#e87a5d", "#9ad1a8", "#c9a4f5", "#6fd3e0", "#f29fb5", "#e8e4da"];
const STAR = "#ffd89a";
const STAR_BLUE = "#bcd4ff";

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Place a body on a circular orbit around a parent.
function orbit(parent, r, angle, m, color, opts = {}) {
  const v = Math.sqrt(G * parent.m / r) * (opts.dir ?? 1);
  return new Body({
    x: parent.x + Math.cos(angle) * r,
    y: parent.y + Math.sin(angle) * r,
    vx: parent.vx - Math.sin(angle) * v,
    vy: parent.vy + Math.cos(angle) * v,
    m, color, massless: opts.massless,
  });
}

// Remove net momentum so the system does not drift off screen.
function zeroMomentum(bodies) {
  let px = 0, py = 0, m = 0;
  for (const b of bodies) if (!b.massless && !b.fixed) { px += b.vx * b.m; py += b.vy * b.m; m += b.m; }
  if (!m) return;
  const vx = px / m, vy = py / m;
  for (const b of bodies) if (!b.fixed) { b.vx -= vx; b.vy -= vy; }
}

function disk(core, n, rMin, rMax, colorFn, dir = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rMin + (rMax - rMin) * Math.random() ** 1.3; // denser toward the core
    out.push(orbit(core, r, rand(0, Math.PI * 2), 0, colorFn(r), { massless: true, dir }));
  }
  return out;
}

export const SCENARIOS = [
  {
    key: "solar",
    name: "Solar system",
    blurb: "A star, six planets, a moon and an asteroid belt. Tap anywhere to drop a new world into orbit.",
    zoom: 0.9,
    build() {
      const sun = new Body({ x: 0, y: 0, m: 4000, color: STAR });
      const out = [sun];
      const planets = [
        [72, 0.6, "#c9a4f5"], [112, 2.5, "#e87a5d"], [160, 3, "#8fb8ff"],
        [196, 1.4, "#f29fb5"], [360, 14, "#e0b27a"], [475, 3, "#6fd3e0"],
      ];
      for (const [r, m, c] of planets) out.push(orbit(sun, r, rand(0, Math.PI * 2), m, c));
      const giant = out[5];
      out.push(orbit(giant, 16, 0, 0.05, "#e8e4da"));
      for (let i = 0; i < 260; i++) {
        out.push(orbit(sun, rand(228, 262), rand(0, Math.PI * 2), 0, "#8d8a82", { massless: true }));
      }
      zeroMomentum(out);
      return out;
    },
  },
  {
    key: "binary",
    name: "Binary star",
    blurb: "Two suns locked in a waltz, with a circumbinary planet like Kepler-16b and a debris ring.",
    zoom: 0.95,
    build() {
      const m = 1600, sep = 110;
      const v = Math.sqrt(G * m / (2 * sep));
      const a = new Body({ x: -sep / 2, y: 0, vy: -v, m, color: STAR });
      const b = new Body({ x: sep / 2, y: 0, vy: v, m, color: STAR_BLUE });
      const com = { x: 0, y: 0, vx: 0, vy: 0, m: 2 * m };
      const out = [a, b, orbit(com, 330, 1, 4, "#9ad1a8")];
      for (let i = 0; i < 360; i++) {
        const r = rand(210, 420);
        out.push(orbit(com, r, rand(0, Math.PI * 2), 0, r > 300 ? "#6fd3e0" : "#8fb8ff", { massless: true }));
      }
      return out;
    },
  },
  {
    key: "eight",
    name: "Figure-eight",
    blurb: "Chenciner & Montgomery's choreography: three equal masses chasing each other on one figure-eight.",
    zoom: 1.35,
    merge: false,
    build() {
      const L = 150, M = 1500, vs = Math.sqrt(G * M / L);
      const x1 = 0.97000436, y1 = -0.24308753;
      const vx3 = -0.93240737, vy3 = -0.86473146;
      return [
        new Body({ x: x1 * L, y: y1 * L, vx: (-vx3 / 2) * vs, vy: (-vy3 / 2) * vs, m: M, color: "#e87a5d" }),
        new Body({ x: -x1 * L, y: -y1 * L, vx: (-vx3 / 2) * vs, vy: (-vy3 / 2) * vs, m: M, color: "#8fb8ff" }),
        new Body({ x: 0, y: 0, vx: vx3 * vs, vy: vy3 * vs, m: M, color: STAR }),
      ];
    },
  },
  {
    key: "trojans",
    name: "Trojans",
    blurb: "Asteroids herded into Jupiter's L4 and L5 Lagrange points — 60° ahead of and behind the planet.",
    zoom: 1,
    build() {
      // Set up the rotating frame around the barycentre so L4/L5 are true equilibria.
      const M = 4000, mJ = 40, R = 280, tot = M + mJ;
      const w = Math.sqrt(G * tot / R ** 3);
      const spin = (x, y, m, color, massless = false) =>
        new Body({ x, y, vx: -w * y, vy: w * x, m, color, massless });
      const sx = -R * mJ / tot;
      const out = [spin(sx, 0, M, STAR), spin(R * M / tot, 0, mJ, "#e0b27a")];
      for (const lag of [Math.PI / 3, -Math.PI / 3]) {
        for (let i = 0; i < 180; i++) {
          const r = R + rand(-3, 3), a = lag + rand(-0.16, 0.16);
          out.push(spin(sx + r * Math.cos(a), r * Math.sin(a), 0, lag > 0 ? "#9ad1a8" : "#c9a4f5", true));
        }
      }
      return out;
    },
  },
  {
    key: "galaxies",
    name: "Galaxy merger",
    blurb: "Two disk galaxies on a close pass. Watch tidal tails peel away, as Toomre & Toomre showed in 1972.",
    zoom: 0.6,
    merge: false,
    build() {
      // Bound, off-axis encounter: they swing past, fling tails, then fall back together.
      const A = new Body({ x: -330, y: -150, vx: 1.05, vy: 0, m: 3200, color: STAR, r: 9 });
      const B = new Body({ x: 330, y: 150, vx: -1.4, vy: 0, m: 2400, color: STAR_BLUE, r: 8 });
      const warm = (r) => (r < 70 ? "#ffd89a" : r < 120 ? "#f2b45a" : "#e87a5d");
      const cool = (r) => (r < 60 ? "#e8f0ff" : r < 100 ? "#8fb8ff" : "#6fd3e0");
      return [A, B, ...disk(A, 1100, 24, 170, warm, 1), ...disk(B, 850, 20, 140, cool, -1)];
    },
  },
  {
    key: "pythagorean",
    name: "Pythagorean",
    blurb: "Burrau's 1913 problem: masses 3, 4 and 5 released at rest on a 3-4-5 triangle. Pure chaos until one is flung out.",
    zoom: 1.1,
    merge: false,
    build() {
      const s = 42, k = 220;
      return [
        new Body({ x: 1 * s, y: 3 * s, m: 3 * k, color: "#8fb8ff" }),
        new Body({ x: -2 * s, y: -1 * s, m: 4 * k, color: "#9ad1a8" }),
        new Body({ x: 1 * s, y: -1 * s, m: 5 * k, color: "#e87a5d" }),
      ];
    },
  },
];

export const randomColor = () => pick(PALETTE);
