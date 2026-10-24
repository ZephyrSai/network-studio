'use strict';
// node --test tests/   — Router.route quality, robustness and speed.
const test = require('node:test');
const assert = require('node:assert');
const Router = require('../js/router.js');

const V = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
const box = (id, x, y, w = 80, h = 60) => ({ id, x, y, w, h });
// port in the middle of a side (f = position along the side, 0..1)
const port = (b, side, f = 0.5) =>
  side === 'up' ? { x: b.x + b.w * f, y: b.y, dir: side } : side === 'down' ? { x: b.x + b.w * f, y: b.y + b.h, dir: side }
    : side === 'left' ? { x: b.x, y: b.y + b.h * f, dir: side } : { x: b.x + b.w, y: b.y + b.h * f, dir: side };
const segHitsBox = (p, q, b, m) =>
  Math.min(p[0], q[0]) < b.x + b.w + m && Math.max(p[0], q[0]) > b.x - m && Math.min(p[1], q[1]) < b.y + b.h + m && Math.max(p[1], q[1]) > b.y - m;
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

// Structural checks every route must pass; returns a list of problems (empty = ok).
function problems(path, a, b, obstacles, opts = {}) {
  const out = [], margin = opts.margin ?? 12;
  if (!Array.isArray(path) || path.length < 2) return ['not a polyline'];
  if (path.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) out.push('non-finite point');
  if (path[0][0] !== a.x || path[0][1] !== a.y) out.push('does not start at a');
  if (path.at(-1)[0] !== b.x || path.at(-1)[1] !== b.y) out.push('does not end at b');
  for (let i = 1; i < path.length; i++) {
    const [p, q] = [path[i - 1], path[i]];
    if (p[0] !== q[0] && p[1] !== q[1]) out.push(`diagonal segment ${i}`);
    if (path.length > 2 && p[0] === q[0] && p[1] === q[1]) out.push(`duplicate point ${i}`);
  }
  for (let i = 1; i < path.length - 1; i++) {
    const [p, c, n] = [path[i - 1], path[i], path[i + 1]];
    if ((p[0] === c[0] && c[0] === n[0]) || (p[1] === c[1] && c[1] === n[1])) out.push(`collinear point ${i}`);
  }
  if (a.dir && path.length > 1) {
    const d = [sign(path[1][0] - path[0][0]), sign(path[1][1] - path[0][1])];
    if (d[0] !== V[a.dir][0] || d[1] !== V[a.dir][1]) out.push('first segment ignores a.dir');
  }
  if (b.dir && path.length > 1) {
    const d = [sign(path.at(-1)[0] - path.at(-2)[0]), sign(path.at(-1)[1] - path.at(-2)[1])];
    if (d[0] !== -V[b.dir][0] || d[1] !== -V[b.dir][1]) out.push('last segment does not arrive against b.dir');
  }
  for (let i = 1; i < path.length; i++) {
    for (const o of obstacles) {
      const own = o.id === opts.sourceId || o.id === opts.targetId;
      if ((o.id === opts.sourceId && i === 1) || (o.id === opts.targetId && i === path.length - 1)) continue;   // the stubs
      const m = own ? (opts.ownClearance ?? margin - 1) : margin - 1;
      if (segHitsBox(path[i - 1], path[i], o, m)) out.push(`segment ${i} enters ${o.id}${own ? ' (endpoint shape)' : ''}`);
    }
  }
  return out;
}
const ok = (path, a, b, obstacles, opts) => assert.deepStrictEqual(problems(path, a, b, obstacles, opts), [], JSON.stringify(path));
const R = (a, b, obs, opts) => { const p = Router.route(a, b, obs, opts); ok(p, a, b, obs, opts); return p; };

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// devices on a jittered grid, at least 40 px apart
function scatter(n, seed, cell = 160) {
  const r = mulberry32(seed), cols = Math.ceil(Math.sqrt(n * 1.4)), cells = [...Array(cols * cols).keys()], out = [];
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  for (let k = 0; k < n; k++) {
    const c = cells[k], w = 40 + Math.floor(r() * 70), h = 30 + Math.floor(r() * 50);
    out.push({ id: 'n' + k, w, h, x: (c % cols) * cell + Math.floor(r() * (cell - 40 - w)), y: Math.floor(c / cols) * cell + Math.floor(r() * (cell - 40 - h)) });
  }
  return out;
}
const SIDES = ['up', 'down', 'left', 'right'];

test('straight line when ports face each other and are aligned', () => {
  const s = box('s', 0, 0), t = box('t', 300, 0), o = { sourceId: 's', targetId: 't' };
  assert.deepStrictEqual(R(port(s, 'right'), port(t, 'left'), [s, t], o), [[80, 30], [300, 30]]);
  const u = box('u', 0, 300);   // vertical too
  assert.deepStrictEqual(R(port(s, 'down'), port(u, 'up'), [s, u], { sourceId: 's', targetId: 'u' }), [[40, 60], [40, 300]]);
});

test('single elbow for perpendicular ports when clear', () => {
  const s = box('s', 0, 0), t = box('t', 300, 160), o = { sourceId: 's', targetId: 't' };
  assert.deepStrictEqual(R(port(s, 'right'), port(t, 'up'), [s, t], o), [[80, 30], [340, 30], [340, 160]]);
});

test('offset facing ports give a Z with the jog centred between them', () => {
  const s = box('s', 0, 0), t = box('t', 300, 120);
  assert.deepStrictEqual(R(port(s, 'right'), port(t, 'left'), [s, t], { sourceId: 's', targetId: 't' }), [[80, 30], [190, 30], [190, 150], [300, 150]]);
});

test('goes around an obstacle placed between the endpoints', () => {
  const s = box('s', 0, 0), t = box('t', 380, 0), m = box('m', 170, -30, 80, 120), o = { sourceId: 's', targetId: 't' };
  const p = R(port(s, 'right'), port(t, 'left'), [s, t, m], o);
  assert.ok(p.length >= 4, 'needs a detour');
  // a tall wall forces a long way round, still clean
  const w = box('w', 180, -200, 40, 460);
  const q = R(port(s, 'right'), port(t, 'left'), [s, t, w], o);
  assert.ok(Math.max(...q.map(pt => pt[1])) >= 272 || Math.min(...q.map(pt => pt[1])) <= -212, 'goes past the end of the wall');
});

test('U-turn when both ports face the same way', () => {
  const s = box('s', 0, 40), t = box('t', 300, 0), o = { sourceId: 's', targetId: 't' };
  const p = R(port(s, 'up'), port(t, 'up'), [s, t], o);
  assert.deepStrictEqual(p, [[40, 40], [40, -18], [340, -18], [340, 0]]);
  const q = R(port(s, 'right'), port(t, 'right'), [s, t], o);           // both facing right
  assert.ok(q.length >= 4);
});

test('ports facing away from each other', () => {
  const s = box('s', 300, 0), t = box('t', 0, 120), o = { sourceId: 's', targetId: 't' };
  const p = R(port(s, 'right'), port(t, 'left'), [s, t], o);
  assert.strictEqual(p.length, 6, 'leave right, come round, enter from the left: 4 bends');
  const q = R(port(s, 'right'), port(box('t2', 0, 0), 'left'), [s, box('t2', 0, 0)], { sourceId: 's', targetId: 't2' });   // same row
  assert.ok(q.length >= 6);
});

test('close facing ports share the gap instead of looping', () => {
  const s = box('s', 0, 0), t = box('t', 110, 40);
  const p = R(port(s, 'right'), port(t, 'left'), [s, t], { sourceId: 's', targetId: 't', ownClearance: 0 });
  assert.deepStrictEqual(p, [[80, 30], [95, 30], [95, 70], [110, 70]]);
});

test('self loop between two ports of the same device', () => {
  const s = box('s', 0, 0);
  const p = R(port(s, 'right'), port(s, 'up'), [s], { sourceId: 's', targetId: 's' });
  assert.deepStrictEqual(p, [[80, 30], [98, 30], [98, -18], [40, -18], [40, 0]]);
});

test('free (null) dirs leave/enter through the nearest side of the shape', () => {
  const s = box('s', 0, 0), t = box('t', 300, 150), o = { sourceId: 's', targetId: 't' };
  const a = { x: 40, y: 30, dir: null }, b = { x: 340, y: 180 };
  const p = Router.route(a, b, [s, t], o);
  assert.deepStrictEqual(problems(p, a, b, [s, t], { ...o, ownClearance: -1e9 }), []);
  assert.deepStrictEqual(p, [[40, 30], [340, 30], [340, 180]]);
  const q = Router.route({ x: 0, y: 0 }, { x: 100, y: 50 }, [], {});    // no shapes at all
  assert.deepStrictEqual(q[0], [0, 0]); assert.deepStrictEqual(q.at(-1), [100, 50]);
  assert.ok(q.length === 3);
});

test('overlapping avoidSegments produce a visibly offset route', () => {
  const s = box('s', 0, 0), t = box('t', 300, 0), o = { sourceId: 's', targetId: 't' };
  const a = port(s, 'right'), b = port(t, 'left');
  const p1 = R(a, b, [s, t], o);
  const p2 = R(a, b, [s, t], { ...o, avoidSegments: Router.segments(p1) });
  const p3 = R(a, b, [s, t], { ...o, avoidSegments: Router.segments(p1).concat(Router.segments(p2)) });
  const runY = p => { const seg = Router.segments(p).reduce((m, sg) => (Math.abs(sg[2] - sg[0]) > Math.abs(m[2] - m[0]) ? sg : m)); return seg[1]; };
  const ys = [runY(p1), runY(p2), runY(p3)].sort((x, y) => x - y);
  assert.ok(ys[1] - ys[0] >= 8 && ys[2] - ys[1] >= 8, `long runs separated: ${ys}`);
  // a Z-shaped neighbour: the second link's middle segment must not sit on the first one
  const u = box('u', 300, 200), oz = { sourceId: 's', targetId: 'u' };
  const z1 = R(a, port(u, 'left'), [s, u], oz);
  const z2 = R(port(s, 'right', 0.8), port(u, 'left', 0.2), [s, u], { ...oz, avoidSegments: Router.segments(z1) });
  const jx = p => p.find((q, i) => i > 0 && p[i - 1][0] === q[0] && Math.abs(p[i - 1][1] - q[1]) > 50)[0];
  assert.ok(Math.abs(jx(z1) - jx(z2)) >= 8, `jogs ${jx(z1)} vs ${jx(z2)}`);
});

test('never enters any obstacle on random layouts; dirs always respected', () => {
  let routes = 0;
  for (const n of [12, 60, 200]) for (const seed of [1, 2, 3]) {
    const obs = scatter(n, seed * 101 + n), r = mulberry32(seed);
    let avoid = [];
    for (let k = 0; k < 60; k++) {
      const i = Math.floor(r() * n), j = (i + 1 + Math.floor(r() * (n - 1))) % n;
      const a = port(obs[i], SIDES[Math.floor(r() * 4)], 0.2 + r() * 0.6), b = port(obs[j], SIDES[Math.floor(r() * 4)], 0.2 + r() * 0.6);
      const opts = { sourceId: obs[i].id, targetId: obs[j].id, avoidSegments: k % 2 ? avoid : undefined };
      const p = Router.route(a, b, obs, opts);
      assert.deepStrictEqual(problems(p, a, b, obs, opts), [], `n=${n} seed=${seed} k=${k} ${JSON.stringify([a, b, p])}`);
      avoid = avoid.concat(Router.segments(p)).slice(-200);
      routes++;
    }
  }
  assert.strictEqual(routes, 540);
});

test('degenerate input never throws and never returns NaN', () => {
  const finite = p => Array.isArray(p) && p.length >= 2 && p.every(q => Number.isFinite(q[0]) && Number.isFinite(q[1]));
  assert.deepStrictEqual(Router.route({ x: 5, y: 5, dir: 'up' }, { x: 5, y: 5, dir: 'down' }, [], {}), [[5, 5], [5, 5]]);   // a == b
  assert.ok(finite(Router.route({ x: 0, y: 0, dir: 'right' }, { x: 100, y: 40, dir: 'left' }, [])));
  assert.ok(finite(Router.route({ x: 0, y: 0 }, { x: 100, y: 40 })));
  assert.ok(finite(Router.route(null, undefined, null, null)));
  assert.ok(finite(Router.route({ x: NaN, y: 'x', dir: 'sideways' }, { x: Infinity, y: 3 }, [{ x: NaN, y: 0, w: 5, h: 5 }], { margin: NaN })));
  assert.ok(finite(Router.route({ x: 0, y: 0, dir: 'right' }, { x: 100, y: 0, dir: 'left' }, [{ x: 50, y: -5, w: 0, h: 0, id: 'z' }])));
  assert.ok(finite(Router.route({ x: 0, y: 0, dir: 'right' }, { x: 100, y: 0, dir: 'left' }, [{ x: 60, y: 20, w: -40, h: -40, id: 'neg' }])));
});

test('endpoint inside a foreign shape (overlapping devices) still yields a sane route', () => {
  const s = box('s', 0, 0), t = box('t', 300, 100), cover = box('c', 60, 10, 80, 40), o = { sourceId: 's', targetId: 't' };
  const a = port(s, 'right'), b = port(t, 'left');
  const p = Router.route(a, b, [s, t, cover], o);
  assert.deepStrictEqual(problems(p, a, b, [s, t], o), []);           // ok w.r.t. everything but the overlapping shape
});

test('no route possible (target walled in): graceful fallback that still respects dirs', () => {
  const s = box('s', 0, 0), t = box('t', 1000, 1000);
  const walls = [box('w1', 900, 900, 300, 40), box('w2', 900, 1120, 300, 40), box('w3', 900, 900, 40, 260), box('w4', 1160, 900, 40, 260)];
  const a = port(s, 'right'), b = port(t, 'left'), o = { sourceId: 's', targetId: 't' };
  const p = Router.route(a, b, [s, t, ...walls], o);
  assert.deepStrictEqual(problems(p, a, b, [s, t], o), []);
});

test('bounds clamp the search area', () => {
  const s = box('s', 0, 0), t = box('t', 300, 0), m = box('m', 150, -40, 40, 140), o = { sourceId: 's', targetId: 't' };
  const p = R(port(s, 'right'), port(t, 'left'), [s, t, m], { ...o, bounds: { x: -100, y: -100, w: 600, h: 400 } });
  assert.ok(p.every(q => q[0] >= -100 && q[0] <= 500 && q[1] >= -100 && q[1] <= 300));
});

test('performance budget (50 obstacles < 5 ms, 300 obstacles < 40 ms per route)', t => {
  for (const [n, budget] of [[50, 5], [300, 40]]) {
    const obs = scatter(n, 7 + n), r = mulberry32(99), times = [];
    for (let k = 0; k < 300; k++) {
      const i = Math.floor(r() * n), j = (i + 1 + Math.floor(r() * (n - 1))) % n;
      const a = port(obs[i], SIDES[Math.floor(r() * 4)]), b = port(obs[j], SIDES[Math.floor(r() * 4)]);
      const t0 = performance.now();
      Router.route(a, b, obs, { sourceId: obs[i].id, targetId: obs[j].id });
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const mean = times.reduce((s, x) => s + x, 0) / times.length, p50 = times[150], p95 = times[285], max = times.at(-1);
    t.diagnostic(`${n} obstacles: mean ${mean.toFixed(2)} ms, p50 ${p50.toFixed(2)}, p95 ${p95.toFixed(2)}, max ${max.toFixed(2)} (budget ${budget} ms)`);
    assert.ok(mean < budget, `mean ${mean} ms over budget`);
    assert.ok(p95 < budget * 2, `p95 ${p95} ms`);
  }
  // worst-ish case: dense 20x15 grid of devices, corner to corner
  const g = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 15; j++) g.push(box(`g${i}_${j}`, i * 130, j * 110));
  const a = port(g[0], 'right'), b = port(g.at(-1), 'left'), o = { sourceId: g[0].id, targetId: g.at(-1).id };
  Router.route(a, b, g, o);
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) Router.route(a, b, g, o);
  const ms = (performance.now() - t0) / 20;
  t.diagnostic(`300-device grid corner to corner: ${ms.toFixed(2)} ms`);
  ok(Router.route(a, b, g, o), a, b, g, o);
  assert.ok(ms < 40);
});
