/* Port Network Studio v3 — orthogonal "dynamic connector" router (pure JS, no deps).
 *
 *   Router.route(a, b, obstacles, opts) -> [[x,y], ...]
 *
 * Method: a sparse orthogonal visibility grid (lines at every inflated obstacle edge,
 * the port stubs, the window edges and offsets of existing connector segments), then
 * A* over (grid node, heading) so every bend costs `bendPenalty`, with an admissible
 * "length + minimum bends" heuristic. The resulting path is simplified and "nudged":
 * free Z-jogs slide to the middle of their channel (the classic Visio look) without
 * touching obstacles or sitting on top of other connectors.
 * Coordinates: SVG style (x right, y down), px. Rects are {x,y,w,h} with x,y top-left.
 */
const Router = (() => {
  'use strict';
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];            // 0 right, 1 down, 2 left, 3 up
  const NONE = 4, EPS = 1e-6, INF = Infinity;
  const DIR = { right: 0, down: 1, left: 2, up: 3, bottom: 1, top: 3 };
  const opp = d => (d + 2) & 3;
  const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const dirOf = v => (v == null ? NONE : (DIR[String(v).toLowerCase()] ?? NONE));
  const pt = p => ({ x: fin(p && +p.x, 0), y: fin(p && +p.y, 0), d: dirOf(p && p.dir) });

  // ---- reusable scratch buffers (the editor routes on every drag frame; avoid GC churn) ----
  // State = node*4 + heading. STAMP[s] === 2*gen: cost known (open); 2*gen+1: closed.
  const MAX_LINES = 800;                                     // per axis; bounds memory to ~40 MB worst case
  let cap = 0, G, PAR, STAMP, gen = 0;
  let hk = new Float64Array(4096), hv = new Int32Array(4096), hn = 0;
  let blk = new Uint8Array(0), oc = new Float32Array(0);
  function ensure(states, cells, costs) {
    if (states > cap) {
      cap = Math.max(states, Math.min(cap * 2, MAX_LINES * MAX_LINES * 4));
      G = new Float32Array(cap); PAR = new Int32Array(cap); STAMP = new Uint32Array(cap); gen = 0;
    }
    if (cells * 2 > blk.length) blk = new Uint8Array(cells * 2);
    if (costs && cells * 2 > oc.length) oc = new Float32Array(cells * 2);
  }
  function hpush(k, v) {
    if (hn === hk.length) {
      const k2 = new Float64Array(hn * 2); k2.set(hk); hk = k2;
      const v2 = new Int32Array(hn * 2); v2.set(hv); hv = v2;
    }
    let i = hn++;
    while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
    hk[i] = k; hv[i] = v;
  }
  function hpop() {
    const top = hv[0], k = hk[--hn], v = hv[hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= hn) break;
      if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= k) break;
      hk[i] = hk[c]; hv[i] = hv[c]; i = c;
    }
    hk[i] = k; hv[i] = v;
    return top;
  }
  // first index with A[i] >= v
  function lb(A, v) { let lo = 0, hi = A.length; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] < v) lo = m + 1; else hi = m; } return lo; }

  // Lower bound on the number of bends to go from heading d to a point displaced by (dx,dy)
  // and then leave it heading g (exact in free space, so admissible + consistent).
  function bendsLB(d, dx, dy, g) {
    if (d === NONE || g === NONE) {
      let m = 9;
      for (let k = 0; k < 4; k++) m = Math.min(m, d === NONE ? bendsLB(k, dx, dy, g) : bendsLB(d, dx, dy, k));
      return m;
    }
    const ad = dx * DX[d] + dy * DY[d], pd = dx * DY[d] - dy * DX[d];
    const zp = Math.abs(pd) < EPS, ahead = ad > -EPS;
    if (g === d) return ahead ? (zp ? 0 : 2) : 4;
    if (g === opp(d)) return zp ? 4 : 2;
    return ahead && dx * DX[g] + dy * DY[g] > -EPS ? 1 : 3;     // perpendicular finish
  }

  // Mark grid edges whose open segment enters an (inflated) box. A node strictly inside a box
  // has all its edges blocked, so no separate node test is needed.
  function paintBlocks(X, Y, nx, ny, boxes) {
    const N = nx * ny; blk.fill(0, 0, 2 * N);
    for (const b of boxes) {
      const y0 = lb(Y, b.T + EPS), y1 = lb(Y, b.B - EPS) - 1, x0 = lb(X, b.L + EPS), x1 = lb(X, b.R - EPS) - 1;
      const e0 = Math.max(0, x0 - 1), e1 = Math.min(nx - 2, x1);
      for (let yi = y0; yi <= y1; yi++) { const r = yi * nx; for (let i = e0; i <= e1; i++) blk[r + i] = 1; }
      const f0 = Math.max(0, y0 - 1), f1 = Math.min(ny - 2, y1);
      for (let xi = x0; xi <= x1; xi++) { const c = N + xi * ny; for (let j = f0; j <= f1; j++) blk[c + j] = 1; }
    }
  }
  // Cost for running within `sep` of (and parallel to) an existing connector segment.
  function paintCosts(X, Y, nx, ny, avoid, sep, k) {
    const N = nx * ny; oc.fill(0, 0, 2 * N);
    for (const s of avoid) {
      const A = s.h ? X : Y, C = s.h ? Y : X, nA = s.h ? nx : ny;
      const c0 = lb(C, s.c - sep + EPS), c1 = lb(C, s.c + sep - EPS) - 1;
      const e0 = Math.max(0, lb(A, s.a + EPS) - 1), e1 = Math.min(nA - 2, lb(A, s.b - EPS) - 1);
      for (let ci = c0; ci <= c1; ci++) {
        const base = s.h ? ci * nx : N + ci * ny;
        for (let i = e0; i <= e1; i++) {
          const ov = Math.min(A[i + 1], s.b) - Math.max(A[i], s.a);
          if (ov > 0) oc[base + i] += ov * k + 4;            // +4: tiny fixed cost per touched edge
        }
      }
    }
  }

  // A* over states (node*4 + heading). Returns grid points start..goal or null.
  function search(X, Y, starts, goals, bp, useCost) {
    const nx = X.length, ny = Y.length, N = nx * ny;
    if (++gen >= 0x7ffffff0) { STAMP.fill(0); gen = 1; }
    hn = 0;
    const OPEN = gen * 2, SHUT = OPEN + 1;
    const nG = goals.length, gNode = new Int32Array(nG), gBest = new Float64Array(nG).fill(INF), gFrom = new Int32Array(nG).fill(-1);
    goals.forEach((g, i) => { gNode[i] = lb(Y, g.y) * nx + lb(X, g.x); });
    const heur = (x, y, d) => {
      let best = INF;
      for (let i = 0; i < nG; i++) {
        const g = goals[i], dx = g.x - x, dy = g.y - y;
        const v = Math.abs(dx) + Math.abs(dy) + g.cost + bp * bendsLB(d, dx, dy, g.g);
        if (v < best) best = v;
      }
      return best;
    };
    // key = f plus a hair of h: among equal f, expand the deeper state first
    const key = (gv, h) => gv + h * (1 + 1e-7);
    for (const s of starts) {
      // a free start (no heading) = all four headings at once, none of them paying for its first turn
      for (const d of s.d === NONE ? [0, 1, 2, 3] : [s.d]) {
        const st = (lb(Y, s.y) * nx + lb(X, s.x)) * 4 + d;
        if (STAMP[st] !== OPEN || s.cost < G[st]) { STAMP[st] = OPEN; G[st] = s.cost; PAR[st] = -1; hpush(key(s.cost, heur(s.x, s.y, d)), st); }
      }
    }
    while (hn > 0) {
      const v = hpop();
      if (v < 0) {                                           // a goal pseudo-state won
        const pts = [];
        for (let s = gFrom[-v - 1]; s !== -1; s = PAR[s]) { const nd = s >> 2; pts.push([X[nd % nx], Y[(nd / nx) | 0]]); }
        return pts.reverse();
      }
      if (STAMP[v] === SHUT) continue;
      STAMP[v] = SHUT;
      const node = v >> 2, d = v & 3, xi = node % nx, yi = (node / nx) | 0, gv = G[v];
      for (let i = 0; i < nG; i++) {
        if (gNode[i] !== node) continue;
        const want = goals[i].g;
        if (want !== NONE && d === opp(want)) continue;       // would need a U-turn in place
        const tot = gv + goals[i].cost + (want === NONE || d === want ? 0 : bp);
        if (tot < gBest[i]) { gBest[i] = tot; gFrom[i] = v; hpush(tot, -i - 1); }
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === opp(d)) continue;
        let nxi = xi, nyi = yi, e;
        if (nd === 0) { if (xi + 1 >= nx) continue; e = yi * nx + xi; nxi++; }
        else if (nd === 2) { if (xi === 0) continue; e = yi * nx + xi - 1; nxi--; }
        else if (nd === 1) { if (yi + 1 >= ny) continue; e = N + xi * ny + yi; nyi++; }
        else { if (yi === 0) continue; e = N + xi * ny + yi - 1; nyi--; }
        if (blk[e]) continue;
        const len = nd & 1 ? Math.abs(Y[nyi] - Y[yi]) : Math.abs(X[nxi] - X[xi]);
        const ng = gv + len + (nd !== d ? bp : 0) + (useCost ? oc[e] : 0);
        const ns = (nyi * nx + nxi) * 4 + nd, st = STAMP[ns];
        if (st === SHUT) continue;
        if (st !== OPEN || ng < G[ns] - 1e-3) {
          STAMP[ns] = OPEN; G[ns] = ng; PAR[ns] = v;
          hpush(key(ng, heur(X[nxi], Y[nyi], nd)), ns);
        }
      }
    }
    return null;
  }

  // Remove duplicate and collinear interior points (keeps the exact first/last point).
  function simplify(P) {
    const out = [];
    const same = (p, q) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;
    for (const p of P) {
      if (out.length && same(out[out.length - 1], p)) { if (out.length > 1) out[out.length - 1] = p; continue; }
      while (out.length >= 2) {
        const q = out[out.length - 2], r = out[out.length - 1];
        const col = (Math.abs(q[0] - r[0]) < EPS && Math.abs(r[0] - p[0]) < EPS) || (Math.abs(q[1] - r[1]) < EPS && Math.abs(r[1] - p[1]) < EPS);
        if (!col) break;
        out.pop();
      }
      out.push(p);
    }
    return out;
  }

  // Slide each free Z-jog (neighbours leave on opposite sides) to the centre of the range where
  // it stays clear of obstacles, keeps the end stubs, and doesn't land on/extend along other
  // connectors. U-shaped caps are left hugging their obstacle (that is already the shortest).
  function nudge(P, boxes, avoid, firstMin, lastMin) {
    const n = P.length;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i <= n - 3; i++) {
        const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
        const vert = Math.abs(p1[0] - p2[0]) < EPS, ax = vert ? 0 : 1, ay = 1 - ax;
        const c = p1[ax], c0 = p0[ax], c3 = p3[ax];
        if ((c0 - c) * (c3 - c) >= 0) continue;
        let lo = Math.min(c0, c3) + 0.5, hi = Math.max(c0, c3) - 0.5;
        if (i === 1 && firstMin > 0) { if (c0 < c) lo = Math.max(lo, c0 + firstMin); else hi = Math.min(hi, c0 - firstMin); }
        if (i + 2 === n - 1 && lastMin > 0) { if (c3 < c) lo = Math.max(lo, c3 + lastMin); else hi = Math.min(hi, c3 - lastMin); }
        const s1 = Math.min(p1[ay], p2[ay]), s2 = Math.max(p1[ay], p2[ay]), y1 = p1[ay], y2 = p2[ay];
        const test = (bl, bh, pl, ph, span, lines) => {
          if (span && pl < s2 - EPS && ph > s1 + EPS) {             // the moved segment itself
            if (bl >= c - EPS) hi = Math.min(hi, bl); else if (bh <= c + EPS) lo = Math.max(lo, bh);
          }
          if (!lines) return;
          for (const [yy, cf] of [[y1, c0], [y2, c3]]) {            // neighbours that get longer
            if (!(yy > pl + EPS && yy < ph - EPS)) continue;
            if (c > cf) { if (bh > c + EPS) hi = Math.min(hi, Math.max(c, bl)); }
            else if (bl < c - EPS) lo = Math.max(lo, Math.min(c, bh));
          }
        };
        for (const b of boxes) vert ? test(b.L, b.R, b.T, b.B, true, true) : test(b.T, b.B, b.L, b.R, true, true);
        for (const s of avoid) {
          // parallel connector => blocks the moved segment; perpendicular one => blocks extension of the neighbours
          if (s.h !== vert) test(s.c - s.sep, s.c + s.sep, s.a, s.b, true, false);
          else test(s.a, s.b, s.c - s.sep, s.c + s.sep, false, true);
        }
        if (lo > hi) continue;
        const nc = (lo + hi) / 2;
        if (Math.abs(nc - c) > 0.5) { p1[ax] = nc; p2[ax] = nc; }
      }
    }
    return P;
  }

  function elbow(A, B) {                                     // last-resort, obstacle-blind
    if (Math.abs(A.x - B.x) < EPS || Math.abs(A.y - B.y) < EPS) return [[A.x, A.y], [B.x, B.y]];
    const hFirst = A.d === NONE ? Math.abs(B.x - A.x) >= Math.abs(B.y - A.y) : (A.d & 1) === 0;
    return hFirst ? [[A.x, A.y], [B.x, A.y], [B.x, B.y]] : [[A.x, A.y], [A.x, B.y], [B.x, B.y]];
  }
  const inside = (b, p) => p.x > b.L + EPS && p.x < b.R - EPS && p.y > b.T + EPS && p.y < b.B - EPS;
  function segHits(b, x1, y1, x2, y2) {                      // orthogonal segment vs open box
    const lx = Math.min(x1, x2), hx = Math.max(x1, x2), ly = Math.min(y1, y2), hy = Math.max(y1, y2);
    return lx < b.R - EPS && hx > b.L + EPS && ly < b.B - EPS && hy > b.T + EPS;
  }
  function ownBox(obs, id, E) {
    if (id != null) { const r = obs.find(o => o.id === id); if (r) return r; }
    let best = null;                                         // else: smallest shape the port sits on
    for (const r of obs) {
      if (E.x >= r.x - 1 && E.x <= r.x + r.w + 1 && E.y >= r.y - 1 && E.y <= r.y + r.h + 1 && (!best || r.w * r.h < best.w * best.h)) best = r;
    }
    return best;
  }
  // distance from E (inside the box inflated by m) to that box's boundary along d
  function exitDist(r, m, E, d) {
    const L = r.x - m, R = r.x + r.w + m, T = r.y - m, B = r.y + r.h + m;
    if (E.x < L - EPS || E.x > R + EPS || E.y < T - EPS || E.y > B + EPS) return 0;
    return Math.max(0, d === 0 ? R - E.x : d === 2 ? E.x - L : d === 1 ? B - E.y : E.y - T);
  }

  function solve(A, B, obstacles, o) {
    const margin = Math.max(0, fin(o.margin, 12)), stubIn = Math.max(0, fin(o.stub, 18));
    const bp = Math.max(0, fin(o.bendPenalty, 40)), sep = Math.max(0, fin(o.spacing, 10));
    const ovk = Math.max(0, fin(o.overlapPenalty, 3)), pad0 = Math.max(40, fin(o.searchPad, 300));
    if (Math.abs(A.x - B.x) < EPS && Math.abs(A.y - B.y) < EPS) return [[A.x, A.y], [B.x, B.y]];

    const obs = [];
    for (const r of obstacles) {
      if (!r) continue;
      let x = +r.x, y = +r.y, w = +r.w, h = +r.h;
      if (!Number.isFinite(x + y + w + h)) continue;
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      obs.push({ x, y, w, h, id: r.id });
    }
    const src = ownBox(obs, o.sourceId, A), tgt = ownBox(obs, o.targetId, B);

    const avoidAll = [];
    for (const s of Array.isArray(o.avoidSegments) ? o.avoidSegments : []) {
      if (!s || s.length < 4) continue;
      const [x1, y1, x2, y2] = s.map(Number);
      if (!Number.isFinite(x1 + y1 + x2 + y2)) continue;
      if (Math.abs(y1 - y2) < EPS && Math.abs(x1 - x2) > EPS) avoidAll.push({ h: true, c: y1, a: Math.min(x1, x2), b: Math.max(x1, x2), sep });
      else if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) > EPS) avoidAll.push({ h: false, c: x1, a: Math.min(y1, y2), b: Math.max(y1, y2), sep });
    }

    // Stubs: at least clear the margin. Ports that face each other across a small gap share it.
    const stubBase = Math.max(stubIn, margin + 1);
    let sA = stubBase, sB = stubBase;
    if (A.d !== NONE && B.d === opp(A.d)) {
      const gap = (B.x - A.x) * DX[A.d] + (B.y - A.y) * DY[A.d], perp = (B.x - A.x) * DY[A.d] - (B.y - A.y) * DX[A.d];
      if (gap > EPS) {
        if (Math.abs(perp) < EPS) {                          // aligned & facing: straight if clear
          // ...unless another connector already runs there (then let A* offset this one)
          let clear = !avoidAll.some(s => s.h === ((A.d & 1) === 0) && Math.abs(s.c - (s.h ? A.y : A.x)) < sep - EPS &&
            Math.min(s.b, Math.max(s.h ? A.x : A.y, s.h ? B.x : B.y)) - Math.max(s.a, Math.min(s.h ? A.x : A.y, s.h ? B.x : B.y)) > 1);
          for (const r of obs) {
            if (!clear) break;
            if (r === src || r === tgt) continue;
            if (segHits({ L: r.x - margin, R: r.x + r.w + margin, T: r.y - margin, B: r.y + r.h + margin }, A.x, A.y, B.x, B.y)) { clear = false; break; }
          }
          if (clear) return [[A.x, A.y], [B.x, B.y]];
        }
        // Share a short gap (stubs of gap/2) when the gap is roomy enough for a clean Z, or when full
        // stubs would poke into the other shape (side-by-side shapes); otherwise keep full stubs (S-route).
        const poke = (r, E, d) => r && inside({ L: r.x - margin, R: r.x + r.w + margin, T: r.y - margin, B: r.y + r.h + margin },
          { x: E.x + DX[d] * stubBase, y: E.y + DY[d] * stubBase });
        if (gap < 2 * stubBase && (gap >= 2 * margin || poke(tgt, A, A.d) || poke(src, B, B.d))) sA = sB = gap / 2;
      }
    }
    const mA = A.d !== NONE ? Math.min(margin, Math.max(0, sA - 1)) : margin;
    const mB = B.d !== NONE ? Math.min(margin, Math.max(0, sB - 1)) : margin;
    const boxOf = (r, m) => ({ L: r.x - m, T: r.y - m, R: r.x + r.w + m, B: r.y + r.h + m, own: r === src || r === tgt });
    const others = obs.filter(r => r !== src && r !== tgt).map(r => boxOf(r, margin));

    // Start/goal candidates: one per given dir, or one per side of the own shape when dir is free.
    const ends = (E, box, s, m, isGoal) => {
      if (E.d === NONE && !box) return [{ x: E.x, y: E.y, d: NONE, g: NONE, cost: 0 }];
      const list = [];
      for (const d of E.d !== NONE ? [E.d] : [0, 1, 2, 3]) {
        let len = E.d !== NONE ? s : stubBase;
        if (box) len = Math.max(len, exitDist(box, m, E, d) + Math.min(1, len)); // port not on the edge
        const c = { x: E.x + DX[d] * len, y: E.y + DY[d] * len, d, g: opp(d), cost: len };
        if (isGoal) c.d = NONE; else c.g = NONE;
        list.push(c);
      }
      if (E.d === NONE) {                                    // free dir: drop sides that start inside a neighbour
        const ok = list.filter(c => !others.some(b => inside(b, c)));
        if (ok.length) return ok;
      }
      return list;
    };
    const starts = ends(A, src, sA, mA, false), goals = ends(B, tgt, sB, mB, true);

    const boxes = [];
    for (const r of obs) {
      let m = margin;
      if (r === src) m = mA;
      if (r === tgt) m = Math.min(r === src ? m : margin, mB);
      const b = boxOf(r, m);
      // overlapping shapes: a box that swallows an endpoint or stub point can't be avoided -> ignore it
      if (starts.some(p => inside(b, p)) || goals.some(p => inside(b, p))) continue;
      if (!b.own && (inside(b, A) || inside(b, B))) continue;
      boxes.push(b);
    }

    let ex1 = Math.min(A.x, B.x), ey1 = Math.min(A.y, B.y), ex2 = Math.max(A.x, B.x), ey2 = Math.max(A.y, B.y);
    for (const p of starts.concat(goals)) { ex1 = Math.min(ex1, p.x); ey1 = Math.min(ey1, p.y); ex2 = Math.max(ex2, p.x); ey2 = Math.max(ey2, p.y); }
    let ax1 = ex1, ay1 = ey1, ax2 = ex2, ay2 = ey2;           // extent of everything
    for (const b of boxes) { ax1 = Math.min(ax1, b.L); ay1 = Math.min(ay1, b.T); ax2 = Math.max(ax2, b.R); ay2 = Math.max(ay2, b.B); }
    const bd = o.bounds && Number.isFinite(+o.bounds.x + +o.bounds.y + +o.bounds.w + +o.bounds.h) ? o.bounds : null;

    const attempt = (W, sub) => {
      const xs = [A.x, B.x, W.x1, W.x2], ys = [A.y, B.y, W.y1, W.y2];
      for (const p of starts.concat(goals)) { xs.push(p.x); ys.push(p.y); }
      xs.push((starts[0].x + goals[0].x) / 2); ys.push((starts[0].y + goals[0].y) / 2);
      for (const b of sub) { xs.push(b.L, b.R); ys.push(b.T, b.B); }
      const av = avoidAll.filter(s => s.h
        ? s.c > W.y1 - sep && s.c < W.y2 + sep && s.b > W.x1 && s.a < W.x2
        : s.c > W.x1 - sep && s.c < W.x2 + sep && s.b > W.y1 && s.a < W.y2);
      for (const s of av) (s.h ? ys : xs).push(s.c - sep, s.c + sep);
      const mustX = new Set([A.x, B.x, W.x1, W.x2, ...starts.map(p => p.x), ...goals.map(p => p.x)]);
      const mustY = new Set([A.y, B.y, W.y1, W.y2, ...starts.map(p => p.y), ...goals.map(p => p.y)]);
      const mk = (arr, lo, hi, must) => {
        arr.sort((p, q) => p - q);
        let out = [];
        for (const v of arr) if (v >= lo && v <= hi && (!out.length || v !== out[out.length - 1])) out.push(v);
        if (out.length > MAX_LINES) {
          // huge diagrams: thin the candidate lines (blocking stays exact, so this only removes options)
          const step = (hi - lo) / (MAX_LINES - must.size), thin = [];
          for (const v of out) if (must.has(v) || !thin.length || v - thin[thin.length - 1] >= step) thin.push(v);
          out = thin;
        }
        return Float64Array.from(out);
      };
      const X = mk(xs, W.x1, W.x2, mustX), Y = mk(ys, W.y1, W.y2, mustY);
      const useCost = av.length > 0 && ovk > 0;
      ensure(X.length * Y.length * 4, X.length * Y.length, useCost);   // before painting: may reallocate
      paintBlocks(X, Y, X.length, Y.length, sub);
      if (useCost) paintCosts(X, Y, X.length, Y.length, av, sep, ovk);
      const nodes = search(X, Y, starts, goals, bp, useCost);
      if (!nodes) return null;
      const P = simplify([[A.x, A.y], ...nodes, [B.x, B.y]]);
      return simplify(nudge(P, sub, av, A.d !== NONE ? sA : 0, B.d !== NONE ? sB : 0));
    };
    const windowFor = pad => {
      const W = { x1: ex1 - pad, y1: ey1 - pad, x2: ex2 + pad, y2: ey2 + pad };
      if (bd) {
        W.x1 = Math.min(Math.max(W.x1, +bd.x), ex1 - 1); W.y1 = Math.min(Math.max(W.y1, +bd.y), ey1 - 1);
        W.x2 = Math.max(Math.min(W.x2, +bd.x + +bd.w), ex2 + 1); W.y2 = Math.max(Math.min(W.y2, +bd.y + +bd.h), ey2 + 1);
      }
      return W;
    };
    const within = (W, list) => list.filter(b => b.R > W.x1 && b.L < W.x2 && b.B > W.y1 && b.T < W.y2);

    // progressively widen the search window until it covers every obstacle
    for (let pad = pad0, prev = ''; ; pad *= 3) {
      const W = windowFor(pad), sig = [W.x1, W.y1, W.x2, W.y2].join();
      if (sig === prev) break;                               // clamped by opts.bounds: cannot grow further
      prev = sig;
      const res = attempt(W, within(W, boxes));
      if (res) return res;
      if (W.x1 <= ax1 && W.y1 <= ay1 && W.x2 >= ax2 && W.y2 >= ay2) break;
    }
    // graceful fallbacks: keep only the endpoint shapes, then ignore everything
    const W = windowFor(pad0);
    return attempt(W, boxes.filter(b => b.own)) || attempt(W, []) || elbow(A, B);
  }

  function route(a, b, obstacles, opts) {
    const A = pt(a), B = pt(b);
    try {
      const r = solve(A, B, Array.isArray(obstacles) ? obstacles : [], opts || {});
      if (r && r.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return r;
    } catch (e) { /* fall through: never throw into the editor's drag loop */ }
    return elbow(A, B);
  }

  // [[x,y],...] -> [[x1,y1,x2,y2],...]  (handy for building opts.avoidSegments)
  function segments(points) {
    const out = [];
    for (let i = 1; i < (points ? points.length : 0); i++) out.push([points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]]);
    return out;
  }

  return { route, segments, simplify };
})();
if (typeof module !== 'undefined') module.exports = Router;
