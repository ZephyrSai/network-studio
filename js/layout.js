/* Port Network Studio v3 — auto-layout for network topologies (pure JS, no deps).
 *
 *   Layout.hierarchical(nodes, edges, opts) -> Map(id -> {x, y})   top-left positions
 *   Layout.grid / circular / radial / force (same shape), Layout.bounds(map, nodes) -> {x,y,w,h}
 *
 * nodes: [{id, w, h, rank?, group?, name?}], edges: [{from, to}] (undirected links; self loops,
 * duplicates and unknown ids are ignored). All layouts are deterministic.
 */
const Layout = (() => {
  'use strict';
  const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const TAU = Math.PI * 2;

  // ---------- shared input handling ----------
  function setup(nodes, edges, o, swap) {
    const N = [], idx = new Map();
    for (const n of Array.isArray(nodes) ? nodes : []) {
      if (!n || n.id == null || idx.has(n.id)) continue;
      const r = n.rank == null || n.rank === '' ? NaN : +n.rank;
      let w = Math.max(1, fin(+n.w, 80)), h = Math.max(1, fin(+n.h, 60));
      if (swap) [w, h] = [h, w];                              // LR = TB with axes swapped
      idx.set(n.id, N.length);
      N.push({ id: n.id, w, h, rank: Number.isFinite(r) ? r : undefined, group: n.group == null || n.group === '' ? undefined : String(n.group), name: n.name, i: N.length });
    }
    const adj = N.map(() => []), E = [], seen = new Set();
    for (const e of Array.isArray(edges) ? edges : []) {
      if (!e) continue;
      const a = idx.get(e.from), b = idx.get(e.to);
      if (a === undefined || b === undefined || a === b) continue;
      const u = Math.min(a, b), v = Math.max(a, b), k = u * N.length + v;
      if (seen.has(k)) continue;
      seen.add(k); E.push([u, v]); adj[u].push(v); adj[v].push(u);
    }
    for (const l of adj) l.sort((p, q) => p - q);
    const og = o.origin;
    const origin = Array.isArray(og) ? [fin(+og[0], 60), fin(+og[1], 60)] : og && typeof og === 'object' ? [fin(+og.x, 60), fin(+og.y, 60)] : [60, 60];
    return { N, adj, E, origin, nodeSep: Math.max(0, fin(+o.nodeSep, 60)), rankSep: Math.max(0, fin(+o.rankSep, 110)) };
  }
  const isLR = o => String(o.direction || 'TB').toUpperCase() === 'LR';

  // Write top-left positions (computed in TB space) into a Map, normalised to origin, axes swapped for LR.
  function emit(N, X, Y, origin, lr) {
    let mx = Infinity, my = Infinity;
    for (let i = 0; i < N.length; i++) { const x = lr ? Y[i] : X[i], y = lr ? X[i] : Y[i]; mx = Math.min(mx, x); my = Math.min(my, y); }
    const out = new Map();
    for (let i = 0; i < N.length; i++) {
      const x = lr ? Y[i] : X[i], y = lr ? X[i] : Y[i];
      out.set(N[i].id, { x: round(x - mx + origin[0]), y: round(y - my + origin[1]) });
    }
    return out;
  }
  const round = v => Math.round(v * 100) / 100;

  function components(n, adj) {
    const comp = new Int32Array(n).fill(-1), comps = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const C = [s]; comp[s] = comps.length;
      for (let k = 0; k < C.length; k++) for (const u of adj[C[k]]) if (comp[u] < 0) { comp[u] = comps.length; C.push(u); }
      comps.push(C.sort((p, q) => p - q));
    }
    return comps;
  }

  // natural, locale-independent compare ("sw2" < "sw10")
  function natCmp(a, b) {
    const A = String(a ?? '').match(/\d+|\D+/g) || [], B = String(b ?? '').match(/\d+|\D+/g) || [];
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      let x = A[i], y = B[i];
      if (x === y) continue;
      if (/^\d/.test(x) && /^\d/.test(y)) {
        x = x.replace(/^0+(?=\d)/, ''); y = y.replace(/^0+(?=\d)/, '');
        if (x.length !== y.length) return x.length - y.length;
        if (x !== y) return x < y ? -1 : 1;
        continue;
      }
      const lx = x.toLowerCase(), ly = y.toLowerCase();
      if (lx !== ly) return lx < ly ? -1 : 1;
      return x < y ? -1 : 1;
    }
    return A.length - B.length;
  }
  const byTier = (p, q) => (p.rank === undefined) - (q.rank === undefined) || (p.rank ?? 0) - (q.rank ?? 0) ||
    (p.group === undefined) - (q.group === undefined) || natCmp(p.group, q.group) || natCmp(p.name ?? p.id, q.name ?? q.id) || p.i - q.i;

  // ======================= hierarchical (Sugiyama) =======================
  function hierarchical(nodes, edges, opts) {
    const o = opts || {}, lr = isLR(o);
    const { N, adj, E, origin, nodeSep, rankSep } = setup(nodes, edges, o, lr);
    const n = N.length;
    if (!n) return new Map();
    const rank = N.map(v => (o.useRanks !== false ? v.rank : undefined));
    const comps = components(n, adj);
    const iso = adj.map(a => a.length === 0);

    // (1) BFS distance from the lowest-rank nodes (or the busiest node when unranked), and an
    // effective rank for unranked nodes = mean of their neighbours (harmonic interpolation).
    const dist = new Int32Array(n), eff = new Float64Array(n);
    for (const C of comps) {
      if (C.length === 1) continue;
      const ranked = C.filter(v => rank[v] !== undefined);
      let roots;
      if (ranked.length) { const mr = Math.min(...ranked.map(v => rank[v])); roots = ranked.filter(v => rank[v] === mr); }
      else { let b = C[0]; for (const v of C) if (adj[v].length > adj[b].length) b = v; roots = [b]; }
      const seen = new Set(roots);
      for (const r of roots) dist[r] = 0;
      for (let k = 0, Q = roots.slice(); k < Q.length; k++) for (const u of adj[Q[k]]) if (!seen.has(u)) { seen.add(u); dist[u] = dist[Q[k]] + 1; Q.push(u); }
      if (ranked.length) {
        const mean = ranked.reduce((s, v) => s + rank[v], 0) / ranked.length, un = C.filter(v => rank[v] === undefined);
        for (const v of C) eff[v] = rank[v] !== undefined ? rank[v] : mean;
        for (let it = 0; it < 60 && un.length; it++) for (const v of un) { let s = 0; for (const u of adj[v]) s += eff[u]; eff[v] = s / adj[v].length; }
        for (const v of un) eff[v] = Math.round(eff[v] * 1e6) / 1e6;
      }
    }

    // Orient each link low -> high by (rank, BFS distance). The key is a per-node total preorder, so
    // the result is acyclic by construction (this is the cycle breaking). Equal keys and equal ranks
    // become "flat" links that want both ends on the same layer.
    const succ = N.map(() => []), flat = [];
    for (const [u, v] of E) {
      const c = rank[u] !== undefined && rank[v] !== undefined ? rank[u] - rank[v] : eff[u] - eff[v] || dist[u] - dist[v];
      if (c === 0) flat.push([u, v]); else if (c < 0) succ[u].push(v); else succ[v].push(u);
    }
    // Same-layer clusters: flat-linked nodes, then every node of a given rank, merged unless a
    // directed path between them forces separation (a flat link then becomes a downward edge).
    // `fuf` tracks only the flat-link clusters; they are kept contiguous within their layer.
    const uf = Int32Array.from({ length: n }, (_, i) => i), fuf = uf.slice(), members = N.map((_, i) => [i]), mark = new Int32Array(n);
    const root = (U, x) => { while (U[x] !== x) { U[x] = U[U[x]]; x = U[x]; } return x; };
    const find = x => root(uf, x), ffind = x => root(fuf, x);
    let stamp = 0;
    const reach = (a, b) => {
      const st = members[a].slice(); mark[a] = ++stamp;
      while (st.length) for (const y of succ[st.pop()]) { const r = find(y); if (r === b) return true; if (mark[r] !== stamp) { mark[r] = stamp; st.push(...members[r]); } }
      return false;
    };
    const merge = (a, b) => { const r = Math.min(a, b), s = Math.max(a, b); uf[s] = r; members[r] = members[r].concat(members[s]); members[s] = []; };
    const sameLayer = [];                                       // flat links that stay flat
    for (const [u, v] of flat) {
      const a = find(u), b = find(v);
      if (a !== b) {
        if (reach(a, b)) { succ[u].push(v); continue; }
        if (reach(b, a)) { succ[v].push(u); continue; }
        merge(a, b);
      }
      sameLayer.push([u, v]);
      const fa = ffind(u), fb = ffind(v);
      if (fa !== fb) fuf[Math.max(fa, fb)] = Math.min(fa, fb);
    }
    const byRank = new Map();
    for (let v = 0; v < n; v++) if (!iso[v] && rank[v] !== undefined) { if (!byRank.has(rank[v])) byRank.set(rank[v], []); byRank.get(rank[v]).push(v); }
    for (const list of byRank.values()) for (const v of list) {
      const a = find(list[0]), b = find(v);
      if (a !== b && !reach(a, b) && !reach(b, a)) merge(a, b);
    }

    // (2) Layering: longest path over the cluster DAG plus zero-weight "tier" constraints so a node
    // of rank r sits at or below every lower-rank node; then pull nodes with more down- than
    // up-links closer to their children (a light network-simplex step).
    const lay = new Int32Array(n);
    const live = [];
    for (let v = 0; v < n; v++) if (!iso[v]) live.push(v);
    if (live.length) {
      const cl = new Int32Array(n).fill(-1), clRank = [];
      let nc = 0;
      for (const v of live) { const r = find(v); if (cl[r] < 0) { cl[r] = nc++; clRank.push(undefined); } cl[v] = cl[r]; if (rank[v] !== undefined) clRank[cl[v]] = rank[v]; }
      const tiers = [...new Set(live.filter(v => rank[v] !== undefined).map(v => rank[v]))].sort((p, q) => p - q);
      const tierOf = new Map(tiers.map((r, i) => [r, i]));
      const M = nc + tiers.length, out = Array.from({ length: M }, () => []), indeg = new Int32Array(M);
      const inCnt = new Int32Array(nc), outCnt = new Int32Array(nc);
      const add = (a, b, w) => { out[a].push([b, w]); indeg[b]++; };
      for (const u of live) for (const v of succ[u]) { add(cl[u], cl[v], 1); outCnt[cl[u]]++; inCnt[cl[v]]++; }
      for (let c = 0; c < nc; c++) if (clRank[c] !== undefined) { const t = tierOf.get(clRank[c]); add(c, nc + t, 0); if (t > 0) add(nc + t - 1, c, 0); }
      for (let t = 1; t < tiers.length; t++) add(nc + t - 1, nc + t, 0);
      const L = new Int32Array(M), topo = [], Q = [];
      for (let c = 0; c < M; c++) if (!indeg[c]) Q.push(c);
      for (let k = 0; k < Q.length; k++) { const a = Q[k]; if (a < nc) topo.push(a); for (const [b, w] of out[a]) { L[b] = Math.max(L[b], L[a] + w); if (--indeg[b] === 0) Q.push(b); } }
      if (Q.length < M) for (let c = 0; c < nc; c++) L[c] = 0;   // cannot happen (DAG by construction); stay safe
      if (Q.length === M) {
        for (let pass = 0; pass < 3; pass++) {
          const minT = new Array(tiers.length + 1).fill(Infinity);   // minT[t] = min layer of clusters with tier >= t
          for (let c = 0; c < nc; c++) if (clRank[c] !== undefined) { const t = tierOf.get(clRank[c]); minT[t] = Math.min(minT[t], L[c]); }
          for (let t = tiers.length - 1; t >= 0; t--) minT[t] = Math.min(minT[t], minT[t + 1]);
          for (let k = topo.length - 1; k >= 0; k--) {
            const c = topo[k];
            if (outCnt[c] <= inCnt[c]) continue;
            let lim = Infinity;
            for (const [b, w] of out[c]) if (w === 1) lim = Math.min(lim, L[b] - 1);
            if (clRank[c] !== undefined) lim = Math.min(lim, minT[tierOf.get(clRank[c]) + 1]);
            if (lim < Infinity && lim > L[c]) L[c] = lim;
          }
        }
      }
      // compress away layers that hold no real node
      const used = [...new Set(live.map(v => L[cl[v]]))].sort((p, q) => p - q), remap = new Map(used.map((l, i) => [l, i]));
      for (const v of live) lay[v] = remap.get(L[cl[v]]);
    }
    // isolated nodes: the layer of their rank (or just below lower ranks); unranked -> bottom layer
    let nLayers = 0;
    for (const v of live) nLayers = Math.max(nLayers, lay[v] + 1);
    const isoList = N.filter((_, v) => iso[v]).sort(byTier).map(p => p.i);
    if (!live.length) {
      // no links at all: one row per rank tier, wrapped so the result stays roughly square
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
      let row = -1, prev = null, inRow = 0;
      for (const v of isoList) {
        const t = rank[v] === undefined ? 'u' : rank[v];
        if (t !== prev || inRow >= cols) { row++; inRow = 0; prev = t; }
        lay[v] = row; inRow++;
      }
      nLayers = row + 1;
    } else {
      for (const v of isoList) {
        if (rank[v] === undefined) { lay[v] = nLayers - 1; continue; }
        let same = Infinity, below = 0;
        for (const u of live) if (rank[u] !== undefined) { if (rank[u] === rank[v]) same = Math.min(same, lay[u]); else if (rank[u] < rank[v]) below = Math.max(below, lay[u]); }
        lay[v] = same < Infinity ? same : below;
      }
    }

    // (3)-(5) per connected component: dummies, crossing minimisation, Brandes–Köpf x placement;
    // components are then packed left to right.
    const cx = new Float64Array(n), layerRight = new Float64Array(nLayers).fill(-Infinity);
    const compGap = Math.max(nodeSep * 1.5, 40), dGap = Math.min(nodeSep, 20);
    const liveComps = comps.filter(C => !iso[C[0]]).map(C => ({ C, top: Math.min(...C.map(v => lay[v])) }))
      .sort((p, q) => p.top - q.top || q.C.length - p.C.length || p.C[0] - q.C[0]);
    let curX = 0;
    for (const { C } of liveComps) {
      const G = buildLayered(C, succ, lay, N, ffind, sameLayer);
      orderLayers(G, N);
      const x = brandesKopf(G, nodeSep, dGap);
      let left = Infinity, right = -Infinity;
      for (let v = 0; v < G.W.length; v++) { left = Math.min(left, x[v] - G.W[v] / 2); right = Math.max(right, x[v] + G.W[v] / 2); }
      const off = curX - left;
      for (let v = 0; v < G.W.length; v++) {
        if (G.real[v] >= 0) cx[G.real[v]] = x[v] + off;
        const l = G.lay[v];
        layerRight[l] = Math.max(layerRight[l], x[v] + off + G.W[v] / 2);
      }
      curX = right + off + compGap;
    }
    // isolated nodes appended at the end of their layer
    for (const v of isoList) {
      const l = lay[v], start = layerRight[l] === -Infinity ? 0 : layerRight[l] + nodeSep;
      cx[v] = start + N[v].w / 2; layerRight[l] = start + N[v].w;
    }
    // (6) layer tops; nodes of different heights are centred vertically within their layer
    const LH = new Float64Array(nLayers);
    for (let v = 0; v < n; v++) LH[lay[v]] = Math.max(LH[lay[v]], N[v].h);
    const top = new Float64Array(nLayers);
    for (let l = 1; l < nLayers; l++) top[l] = top[l - 1] + LH[l - 1] + rankSep;
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let v = 0; v < n; v++) { X[v] = cx[v] - N[v].w / 2; Y[v] = top[lay[v]] + (LH[lay[v]] - N[v].h) / 2; }
    return emit(N, X, Y, origin, lr);
  }

  // Layered graph of one component with dummy vertices on long edges.
  function buildLayered(C, succ, lay, N, find, sameLayer) {
    const G = { W: [], lay: [], dummy: [], real: [], up: [], down: [], seg: [], flat: [] };
    const addV = (l, w, r) => { G.W.push(w); G.lay.push(l); G.dummy.push(r < 0 ? 1 : 0); G.real.push(r); G.up.push([]); G.down.push([]); return G.W.length - 1; };
    const vid = new Map();
    for (const v of C) vid.set(v, addV(lay[v], N[v].w, v));
    for (const u of C) for (const v of succ[u]) {
      let a = vid.get(u);
      for (let l = lay[u] + 1; l < lay[v]; l++) { const d = addV(l, 0, -1); G.down[a].push(d); G.up[d].push(a); a = d; }
      const b = vid.get(v); G.down[a].push(b); G.up[b].push(a);
    }
    G.flat = G.W.map(() => []);
    for (const [u, v] of sameLayer) if (vid.has(u) && vid.has(v)) { G.flat[vid.get(u)].push(vid.get(v)); G.flat[vid.get(v)].push(vid.get(u)); }
    G.minL = Math.min(...C.map(v => lay[v]));
    const maxL = Math.max(...C.map(v => lay[v]));
    G.layers = Array.from({ length: maxL - G.minL + 1 }, () => []);
    // Segment = run of vertices that must stay contiguous in a layer: same group, or same flat cluster.
    const clusterCount = new Map();
    for (const v of C) { const k = lay[v] + ':' + find(v); clusterCount.set(k, (clusterCount.get(k) || 0) + 1); }
    const segIds = new Map();
    G.seg = G.W.map((_, x) => {
      const r = G.real[x];
      let key = 'v' + x;
      if (r >= 0 && N[r].group !== undefined) key = 'g' + N[r].group;
      else if (r >= 0 && clusterCount.get(lay[r] + ':' + find(r)) > 1) key = 'c' + find(r);
      key = G.lay[x] + '|' + key;
      if (!segIds.has(key)) segIds.set(key, segIds.size);
      return segIds.get(key);
    });
    G.segSize = new Int32Array(segIds.size);
    for (const s of G.seg) G.segSize[s]++;
    return G;
  }

  // (4) crossing minimisation: DFS initial order, alternating median/barycenter sweeps + adjacent
  // transpositions, groups kept contiguous; keeps the best order seen.
  function orderLayers(G, N) {
    const V = G.W.length, pos = new Int32Array(V), layers = G.layers, minL = G.minL;
    const seen = new Uint8Array(V);
    const starts = G.W.map((_, v) => v).sort((p, q) => G.lay[p] - G.lay[q] || p - q);
    for (const s of starts) {
      const st = [s];
      while (st.length) {
        const v = st.pop();
        if (seen[v]) continue;
        seen[v] = 1; layers[G.lay[v] - minL].push(v);
        for (let k = G.down[v].length - 1; k >= 0; k--) if (!seen[G.down[v][k]]) st.push(G.down[v][k]);
      }
    }
    // pre-group: stable sort by first appearance of each segment so groups start contiguous
    for (const layer of layers) {
      const first = new Map();
      layer.forEach((v, i) => { if (!first.has(G.seg[v])) first.set(G.seg[v], i); });
      layer.sort((p, q) => first.get(G.seg[p]) - first.get(G.seg[q]));
    }
    const setPos = () => { for (const l of layers) l.forEach((v, i) => { pos[v] = i; }); };
    setPos();
    const crossings = () => {
      let total = 0;
      for (let i = 0; i + 1 < layers.length; i++) {
        const m = layers[i + 1].length, bit = new Int32Array(m + 1);
        let cnt = 0;
        for (const v of layers[i]) {
          const ps = G.down[v].map(w => pos[w]).sort((p, q) => p - q);
          for (const p of ps) {
            let s = 0;
            for (let j = p + 1; j > 0; j -= j & -j) s += bit[j];
            total += cnt - s; cnt++;
            for (let j = p + 1; j <= m; j += j & -j) bit[j]++;
          }
        }
      }
      return total;
    };
    const reorder = (layer, nb, median, refLen) => {
      if (layer.length < 2) return;
      const val = new Map(), scale = refLen > 1 && layer.length > 1 ? (refLen - 1) / (layer.length - 1) : 1;
      for (const v of layer) {
        const ps = nb[v].map(w => pos[w]).sort((p, q) => p - q);
        let x;
        if (!ps.length) x = pos[v] * scale;                     // no neighbours: hold position
        else if (median) { const m = ps.length >> 1; x = ps.length & 1 ? ps[m] : (ps[m - 1] + ps[m]) / 2; }
        else x = ps.reduce((s, p) => s + p, 0) / ps.length;
        val.set(v, x);
      }
      const segSum = new Map(), segN = new Map();
      for (const v of layer) { const s = G.seg[v]; segSum.set(s, (segSum.get(s) || 0) + val.get(v)); segN.set(s, (segN.get(s) || 0) + 1); }
      const sv = s => segSum.get(s) / segN.get(s);
      layer.sort((p, q) => sv(G.seg[p]) - sv(G.seg[q]) || G.seg[p] - G.seg[q] || val.get(p) - val.get(q) || pos[p] - pos[q]);
      layer.forEach((v, i) => { pos[v] = i; });
    };
    // crossings caused by v sitting just left of w: inter-layer edges, plus same-layer links of v
    // (or w) that would have to pass over the other one
    const pairCross = (v, w) => {
      let c = 0;
      for (const nb of [G.up, G.down]) for (const a of nb[v]) for (const b of nb[w]) if (pos[a] > pos[b]) c++;
      for (const z of G.flat[v]) if (z !== w && pos[z] > pos[w]) c++;
      for (const z of G.flat[w]) if (z !== v && pos[z] < pos[v]) c++;
      return c;
    };
    const transpose = () => {
      for (let round = 0, improved = true; improved && round < 4; round++) {
        improved = false;
        for (const layer of layers) for (let i = 0; i + 1 < layer.length; i++) {
          const v = layer[i], w = layer[i + 1];
          if (G.seg[v] !== G.seg[w] && (G.segSize[G.seg[v]] > 1 || G.segSize[G.seg[w]] > 1)) continue;
          if (pairCross(v, w) > pairCross(w, v)) { layer[i] = w; layer[i + 1] = v; pos[w] = i; pos[v] = i + 1; improved = true; }
        }
      }
    };
    let best = layers.map(l => l.slice()), bestC = crossings();
    for (let it = 0; it < 24 && bestC > 0; it++) {
      const median = ((it >> 1) & 1) === 0;
      if (it % 2 === 0) for (let i = 1; i < layers.length; i++) reorder(layers[i], G.up, median, layers[i - 1].length);
      else for (let i = layers.length - 2; i >= 0; i--) reorder(layers[i], G.down, median, layers[i + 1].length);
      transpose();
      const c = crossings();
      if (c < bestC) { bestC = c; best = layers.map(l => l.slice()); }
    }
    for (let i = 0; i < layers.length; i++) layers[i] = best[i];
    setPos();
    G.crossings = bestC;
  }

  // (5) Brandes–Köpf horizontal coordinates (4 alignments, block-graph compaction, balanced median).
  function brandesKopf(G, nodeSep, dGap) {
    const V = G.W.length, layers = G.layers, up = G.up, down = G.down, W = G.W, D = G.dummy;
    const pos = new Int32Array(V);
    layers.forEach(l => l.forEach((v, i) => { pos[v] = i; }));
    // type-1 conflicts: a non-inner segment crossing an inner (dummy-dummy) segment
    const conflict = new Set();
    for (let li = 1; li < layers.length; li++) {
      const prev = layers[li - 1], layer = layers[li];
      let k0 = 0, scan = 0;
      for (let l = 0; l < layer.length; l++) {
        const v = layer[l];
        let w = -1;
        if (D[v]) for (const u of up[v]) if (D[u]) { w = u; break; }
        if (w >= 0 || l === layer.length - 1) {
          const k1 = w >= 0 ? pos[w] : prev.length;
          for (let s = scan; s <= l; s++) {
            const sv = layer[s];
            for (const u of up[sv]) if ((pos[u] < k0 || pos[u] > k1) && !(D[u] && D[sv])) { conflict.add(u * V + sv); conflict.add(sv * V + u); }
          }
          scan = l + 1; k0 = k1;
        }
      }
    }
    const sep = (u, v) => (W[u] + W[v]) / 2 + ((D[u] ? dGap : nodeSep) + (D[v] ? dGap : nodeSep)) / 2;
    const xss = [];
    for (const vert of [0, 1]) for (const horiz of [0, 1]) {
      let L = vert === 0 ? layers : layers.slice().reverse();
      if (horiz) L = L.map(l => l.slice().reverse());
      const p = new Int32Array(V), root = new Int32Array(V), al = new Int32Array(V);
      L.forEach(l => l.forEach((v, i) => { p[v] = i; }));
      for (let v = 0; v < V; v++) { root[v] = v; al[v] = v; }
      for (const layer of L) {                                   // vertical alignment with medians
        let prevIdx = -1;
        for (const v of layer) {
          const ws0 = vert === 0 ? up[v] : down[v];
          if (!ws0.length) continue;
          const ws = ws0.slice().sort((a, b) => p[a] - p[b]), mp = (ws.length - 1) / 2;
          for (let i = Math.floor(mp); i <= Math.ceil(mp); i++) {
            const w = ws[i];
            if (al[v] === v && prevIdx < p[w] && !conflict.has(w * V + v)) { al[w] = v; al[v] = root[v] = root[w]; prevIdx = p[w]; }
          }
        }
      }
      // block graph: separation edges between blocks of horizontally adjacent vertices
      const bOut = new Map(), indeg = new Map();
      for (const layer of L) for (let i = 1; i < layer.length; i++) {
        const ru = root[layer[i - 1]], rv = root[layer[i]], s = sep(layer[i - 1], layer[i]);
        let m = bOut.get(ru); if (!m) bOut.set(ru, m = new Map());
        if (!m.has(rv)) indeg.set(rv, (indeg.get(rv) || 0) + 1);
        if (!(m.get(rv) >= s)) m.set(rv, s);
      }
      const blocks = [];
      for (const layer of L) for (const v of layer) if (root[v] === v) blocks.push(v);
      const topo = blocks.filter(b => !indeg.get(b)), xs = new Float64Array(V);
      for (let k = 0; k < topo.length; k++) {
        const m = bOut.get(topo[k]);
        if (m) for (const [c, s] of m) { xs[c] = Math.max(xs[c], xs[topo[k]] + s); indeg.set(c, indeg.get(c) - 1); if (!indeg.get(c)) topo.push(c); }
      }
      for (let k = topo.length - 1; k >= 0; k--) {               // pull blocks right toward their successors
        const m = bOut.get(topo[k]);
        if (!m) continue;
        let mn = Infinity;
        for (const [c, s] of m) mn = Math.min(mn, xs[c] - s);
        if (mn < Infinity) xs[topo[k]] = Math.max(xs[topo[k]], mn);
      }
      const x = new Float64Array(V);
      for (let v = 0; v < V; v++) x[v] = horiz ? -xs[root[v]] : xs[root[v]];
      xss.push(x);
    }
    // align all four to the narrowest one, then take the average median per vertex
    const ext = xss.map(x => { let a = Infinity, b = -Infinity, lo = Infinity, hi = -Infinity; for (let v = 0; v < V; v++) { a = Math.min(a, x[v] - W[v] / 2); b = Math.max(b, x[v] + W[v] / 2); lo = Math.min(lo, x[v]); hi = Math.max(hi, x[v]); } return { w: b - a, lo, hi }; });
    let bi = 0;
    for (let k = 1; k < 4; k++) if (ext[k].w < ext[bi].w) bi = k;
    xss.forEach((x, k) => { const d = k & 1 ? ext[bi].hi - ext[k].hi : ext[bi].lo - ext[k].lo; for (let v = 0; v < V; v++) x[v] += d; });
    const res = new Float64Array(V), t = [0, 0, 0, 0];
    for (let v = 0; v < V; v++) { for (let k = 0; k < 4; k++) t[k] = xss[k][v]; t.sort((p, q) => p - q); res[v] = (t[1] + t[2]) / 2; }
    for (const layer of layers) for (let i = 1; i < layer.length; i++) {   // safety net (should be a no-op)
      const need = res[layer[i - 1]] + sep(layer[i - 1], layer[i]);
      if (res[layer[i]] < need - 1e-6) res[layer[i]] = need;
    }
    return res;
  }

  // ======================= grid =======================
  function grid(nodes, opts) {
    const o = opts || {}, lr = isLR(o);
    const { N, origin, nodeSep } = setup(nodes, [], o, lr);
    const n = N.length;
    if (!n) return new Map();
    const order = N.slice().sort(byTier);
    const cols = Math.max(1, Math.floor(fin(+o.columns, 0)) || Math.ceil(Math.sqrt(n * 1.6)));
    const cw = Math.max(...N.map(v => v.w)), ch = Math.max(...N.map(v => v.h)), gy = Math.max(0, fin(+o.rowSep, nodeSep));
    const X = new Float64Array(n), Y = new Float64Array(n);
    order.forEach((v, k) => {
      const c = k % cols, r = Math.floor(k / cols);
      X[v.i] = c * (cw + nodeSep) + (cw - v.w) / 2; Y[v.i] = r * (ch + gy) + (ch - v.h) / 2;
    });
    return emit(N, X, Y, origin, lr);
  }

  // Circle order: BFS tree from the busiest node of each component (biggest component first),
  // emitted "in order" so each subtree is contiguous and sits next to its parent — tree links
  // then span short arcs and rarely cross.
  function circleOrder(N, adj) {
    const comps = components(N.length, adj).sort((p, q) => q.length - p.length || p[0] - q[0]);
    const seen = new Uint8Array(N.length), order = [];
    let hub = -1;
    for (const C of comps) {
      let s = C[0];
      for (const v of C) if (adj[v].length > adj[s].length) s = v;
      if (hub < 0) hub = s;
      const kids = new Map([[s, []]]), Q = [s];
      seen[s] = 1;
      for (let k = 0; k < Q.length; k++) for (const u of adj[Q[k]]) if (!seen[u]) { seen[u] = 1; kids.get(Q[k]).push(u); kids.set(u, []); Q.push(u); }
      // side 0 = hub (children split around it), -1 = left of its parent (children first, so the
      // node ends up next to its parent), +1 = right of its parent (node first)
      const st = [[s, 0, false]];
      while (st.length) {
        const [v, side, emit] = st.pop();
        if (emit) { order.push(v); continue; }
        const ks = kids.get(v), h = side === 0 ? ks.length >> 1 : side < 0 ? ks.length : 0;
        for (let i = ks.length - 1; i >= h; i--) st.push([ks[i], 1, false]);
        st.push([v, side, true]);
        for (let i = h - 1; i >= 0; i--) st.push([ks[i], -1, false]);
      }
    }
    return { order, hub };
  }


  // ======================= circular =======================
  function circular(nodes, edges, opts) {
    const o = opts || {};
    const { N, adj, origin, nodeSep } = setup(nodes, edges, o, false);
    const n = N.length;
    if (!n) return new Map();
    const { order, hub } = circleOrder(N, adj), dmax = Math.max(...N.map(v => Math.hypot(v.w, v.h)));
    // chord between neighbours >= biggest diagonal + nodeSep, so no two boxes can touch
    const r = n === 1 ? 0 : (dmax + nodeSep) / (2 * Math.sin(Math.PI / n));
    const X = new Float64Array(n), Y = new Float64Array(n);
    const k0 = order.indexOf(hub);                                // rotate the main hub to 12 o'clock
    order.forEach((v, k) => {
      const a = -Math.PI / 2 + (TAU * (k - k0)) / n;
      X[v] = r * Math.cos(a) - N[v].w / 2; Y[v] = r * Math.sin(a) - N[v].h / 2;
    });
    return emit(N, X, Y, origin, false);
  }

  // Place items (in the given circular order) as close as possible to their desired angles with a
  // minimum angular gap: cut the circle at the widest empty arc, then isotonic regression (PAV).
  function spreadOnCircle(want, gap) {
    const n = want.length;
    if (n < 2) return want;
    const a = want.map(([, t]) => ((t % TAU) + TAU) % TAU);
    const ord = a.map((_, i) => i).sort((p, q) => a[p] - a[q] || p - q);
    let cut = 0, best = -1;
    for (let i = 0; i < n; i++) { const g = (i + 1 < n ? a[ord[i + 1]] : a[ord[0]] + TAU) - a[ord[i]]; if (g > best) { best = g; cut = (i + 1) % n; } }
    const seq = [], th = [];
    for (let i = 0; i < n; i++) { const j = ord[(cut + i) % n]; seq.push(j); th.push(a[j] + (cut + i >= n ? TAU : 0)); }
    const val = [], cnt = [];
    th.forEach((t, i) => {
      val.push(t - i * gap); cnt.push(1);
      while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
        const cb = cnt.pop(), b = val.pop(), ca = cnt.pop(), x = val.pop();
        val.push((x * ca + b * cb) / (ca + cb)); cnt.push(ca + cb);
      }
    });
    const x = [];
    val.forEach((v, k) => { for (let c = 0; c < cnt[k]; c++) x.push(v + x.length * gap); });
    if (x[n - 1] - x[0] > TAU - gap) for (let i = 1; i < n; i++) x[i] = x[0] + (TAU * i) / n;   // too crowded: even spacing
    return seq.map((j, i) => [want[j][0], x[i]]);
  }

  // ======================= radial (hub and spoke) =======================
  function radial(nodes, edges, opts) {
    const o = opts || {};
    const { N, adj, origin, nodeSep, rankSep } = setup(nodes, edges, o, false);
    const n = N.length;
    if (!n) return new Map();
    const X = new Float64Array(n), Y = new Float64Array(n), diag = N.map(v => Math.hypot(v.w, v.h));
    const ringGap = Math.max(nodeSep, rankSep * 0.6);
    const comps = components(n, adj).sort((p, q) => q.length - p.length || p[0] - q[0]);
    const boxes = [];                                            // per component bbox for packing
    for (const C of comps) {
      let root = C[0];
      const want = o.root != null ? C.find(v => N[v].id === o.root) : undefined;
      if (want !== undefined) root = want;
      else for (const v of C) {
        const d = adj[v].length - adj[root].length;
        if (d > 0 || (d === 0 && (N[v].rank ?? Infinity) < (N[root].rank ?? Infinity))) root = v;
      }
      // BFS tree from the hub; ring k = depth k
      const depth = new Map([[root, 0]]), kids = new Map([[root, []]]), Q = [root];
      for (let k = 0; k < Q.length; k++) for (const u of adj[Q[k]]) if (!depth.has(u)) { depth.set(u, depth.get(Q[k]) + 1); kids.set(u, []); kids.get(Q[k]).push(u); Q.push(u); }
      const leaves = new Map();
      for (let k = Q.length - 1; k >= 0; k--) { const v = Q[k], ks = kids.get(v); leaves.set(v, ks.length ? ks.reduce((s, c) => s + leaves.get(c), 0) : 1); }
      const rings = [];
      for (const v of Q) (rings[depth.get(v)] = rings[depth.get(v)] || []).push(v);
      const R = [0], ang = new Map([[root, 0]]);
      for (let k = 1; k < rings.length; k++) {
        const ring = rings[k], m = ring.length, dk = Math.max(...ring.map(v => diag[v])), dp = Math.max(...rings[k - 1].map(v => diag[v]));
        const chord = dk + nodeSep;                              // centre distance that keeps boxes apart
        // radius: clear the previous ring, and leave 10% slack around the circle for this ring
        R.push(Math.max(R[k - 1] + (dk + dp) / 2 + ringGap, m > 1 ? chord / (2 * Math.sin((0.9 * Math.PI) / m)) : 0));
        const gap = 2 * Math.asin(Math.min(1, chord / (2 * R[k])));
        // desired angles: ring 1 = centres of leaf-proportional wedges; deeper rings fan around the parent
        const want = [];
        if (k === 1) { let a = 0; for (const c of ring) { const span = (TAU * leaves.get(c)) / leaves.get(root); want.push([c, a + span / 2]); a += span; } }
        else for (const p of rings[k - 1].slice().sort((u, v) => ang.get(u) - ang.get(v))) {
          const ks = kids.get(p);
          ks.forEach((c, j) => want.push([c, ang.get(p) + (j - (ks.length - 1) / 2) * gap]));
        }
        for (const [c, a] of spreadOnCircle(want, gap)) ang.set(c, a);
      }
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const v of Q) {
        const a = ang.get(v) - Math.PI / 2, r = R[depth.get(v)];
        X[v] = r * Math.cos(a) - N[v].w / 2; Y[v] = r * Math.sin(a) - N[v].h / 2;
        x1 = Math.min(x1, X[v]); y1 = Math.min(y1, Y[v]); x2 = Math.max(x2, X[v] + N[v].w); y2 = Math.max(y2, Y[v] + N[v].h);
      }
      boxes.push({ Q, x1, y1, x2, y2 });
    }
    // pack components left to right, top-aligned
    let cur = 0;
    for (const b of boxes) { for (const v of b.Q) { X[v] += cur - b.x1; Y[v] -= b.y1; } cur += b.x2 - b.x1 + nodeSep * 1.5; }
    return emit(N, X, Y, origin, false);
  }

  // ======================= force-directed =======================
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function force(nodes, edges, opts) {
    const o = opts || {};
    const { N, E, origin, nodeSep } = setup(nodes, edges, o, false);
    const n = N.length;
    if (!n) return new Map();
    const rnd = mulberry32(Math.floor(fin(+o.seed, 1)));
    const iters = Math.max(1, Math.floor(fin(+o.iterations, 300)));
    const avg = N.reduce((s, v) => s + Math.hypot(v.w, v.h), 0) / n;
    const k = avg + nodeSep, k2 = k * k, side = k * Math.sqrt(n);
    const px = new Float64Array(n), py = new Float64Array(n), dx = new Float64Array(n), dy = new Float64Array(n);
    for (let i = 0; i < n; i++) { px[i] = rnd() * side; py[i] = rnd() * side; }
    // Repulsion only acts within `cut` (Fruchterman–Reingold's grid variant): keeps big graphs
    // compact and makes each iteration ~O(n) via a spatial hash.
    const cut = 2.5 * k, cut2 = cut * cut, cells = new Map();
    for (let it = 0; it < iters; it++) {
      const temp = side * 0.1 * (1 - it / iters) + k * 0.02;      // linear cooling
      dx.fill(0); dy.fill(0); cells.clear();
      for (let i = 0; i < n; i++) {
        const key = Math.floor(px[i] / cut) * 73856093 ^ Math.floor(py[i] / cut) * 19349663;
        const c = cells.get(key); if (c) c.push(i); else cells.set(key, [i]);
      }
      for (let i = 0; i < n; i++) {
        const gx = Math.floor(px[i] / cut), gy = Math.floor(py[i] / cut);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const c = cells.get((gx + ox) * 73856093 ^ (gy + oy) * 19349663);
          if (c) for (const j of c) {
            if (j <= i) continue;
            let ddx = px[i] - px[j], ddy = py[i] - py[j], d2 = ddx * ddx + ddy * ddy;
            if (d2 > cut2) continue;
            if (d2 < 1e-4) { ddx = (rnd() - 0.5) * 0.1; ddy = (rnd() - 0.5) * 0.1; d2 = ddx * ddx + ddy * ddy; }
            const f = k2 / d2;                                    // k^2/d along the unit vector
            dx[i] += ddx * f; dy[i] += ddy * f; dx[j] -= ddx * f; dy[j] -= ddy * f;
          }
        }
      }
      for (const [u, v] of E) {                                   // attraction d^2/k
        const ddx = px[u] - px[v], ddy = py[u] - py[v], d = Math.sqrt(ddx * ddx + ddy * ddy) + 1e-9, f = d / k;
        dx[u] -= ddx * f; dy[u] -= ddy * f; dx[v] += ddx * f; dy[v] += ddy * f;
      }
      let mx = 0, my = 0;
      for (let i = 0; i < n; i++) { mx += px[i]; my += py[i]; }
      mx /= n; my /= n;
      for (let i = 0; i < n; i++) {
        dx[i] += (mx - px[i]) * 0.02; dy[i] += (my - py[i]) * 0.02;    // mild gravity keeps components together
        const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
        if (d > 0) { const s = Math.min(d, temp) / d; px[i] += dx[i] * s; py[i] += dy[i] * s; }
      }
    }
    removeOverlaps(N, px, py, Math.max(4, nodeSep / 2));
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = px[i] - N[i].w / 2; Y[i] = py[i] - N[i].h / 2; }
    return emit(N, X, Y, origin, false);
  }

  // Push overlapping boxes (centres px/py, padded by pad) apart along the axis of least overlap;
  // a final left-to-right sweep guarantees termination with zero overlaps.
  function removeOverlaps(N, px, py, pad) {
    const n = N.length, idx = N.map((_, i) => i);
    const over = (i, j) => {
      const ox = (N[i].w + N[j].w) / 2 + pad - Math.abs(px[i] - px[j]), oy = (N[i].h + N[j].h) / 2 + pad - Math.abs(py[i] - py[j]);
      return ox > 1e-6 && oy > 1e-6 ? [ox, oy] : null;
    };
    const maxW = Math.max(...N.map(v => v.w));
    for (let pass = 0; pass < 200; pass++) {
      let moved = false;
      idx.sort((a, b) => px[a] - px[b] || a - b);
      for (let a = 0; a < n; a++) {
        const i = idx[a];
        for (let b = a + 1; b < n; b++) {
          const j = idx[b];
          if (px[j] - px[i] > maxW + pad) break;
          const ov = over(i, j);
          if (!ov) continue;
          moved = true;
          if (ov[0] < ov[1]) { const s = px[i] <= px[j] ? 1 : -1, h = ov[0] / 2 + 0.01; px[i] -= s * h; px[j] += s * h; }
          else { const s = py[i] < py[j] || (py[i] === py[j] && i < j) ? 1 : -1, h = ov[1] / 2 + 0.01; py[i] -= s * h; py[j] += s * h; }
        }
      }
      if (!moved) return;
    }
    idx.sort((a, b) => px[a] - px[b] || a - b);
    const placed = [];
    for (const i of idx) {
      for (let again = true; again;) { again = false; for (const j of placed) { if (over(i, j)) { px[i] = px[j] + (N[i].w + N[j].w) / 2 + pad + 0.01; again = true; } } }
      placed.push(i);
    }
  }

  // ======================= helpers =======================
  function bounds(map, nodes) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const list = Array.isArray(nodes) ? nodes : [];
    for (const nd of list) {
      const p = nd && map && map.get(nd.id);
      if (!p) continue;
      const w = fin(+nd.w, 80), h = fin(+nd.h, 60);
      x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x + w); y2 = Math.max(y2, p.y + h);
    }
    return x1 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  return { hierarchical, grid, circular, radial, force, bounds };
})();
if (typeof module !== 'undefined') module.exports = Layout;
