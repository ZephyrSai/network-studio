'use strict';
// node --test tests/   — Layout: hierarchical (Sugiyama), grid, circular, radial, force.
const test = require('node:test');
const assert = require('node:assert');
const Layout = require('../js/layout.js');

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// random network: spanning-ish tree + extra links (cycles), some junk edges, mixed ranks/groups
function randomGraph(n, m, seed, { ranks = true, groups = true } = {}) {
  const r = mulberry32(seed), nodes = [], edges = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: 'n' + i, w: 40 + Math.floor(r() * 80), h: 30 + Math.floor(r() * 50), name: 'dev' + i,
      rank: ranks && r() < 0.85 ? Math.floor(r() * 6) : undefined, group: groups && r() < 0.3 ? 'z' + Math.floor(r() * 3) : undefined });
  }
  for (let i = 1; i < n; i++) if (r() < 0.92) edges.push({ from: 'n' + i, to: 'n' + Math.floor(r() * i) });
  while (edges.length < m) edges.push({ from: 'n' + Math.floor(r() * n), to: 'n' + Math.floor(r() * n) });   // incl. self loops / duplicates
  edges.push({ from: 'n0', to: 'ghost' }, { from: 'n1', to: 'n1' }, null);
  return { nodes, edges };
}
// all pairs: separated by >= sx horizontally or >= sy vertically
function overlaps(map, nodes, sx, sy) {
  const P = nodes.map(nd => ({ ...map.get(nd.id), w: nd.w, h: nd.h, id: nd.id })), bad = [];
  for (const p of P) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad.push(['non-finite', p.id]);
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j];
    const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    if (gx < sx - 1e-6 && gy < sy - 1e-6) bad.push([a.id, b.id, gx, gy]);
  }
  return bad;
}
const cy = (map, n) => map.get(n.id).y + n.h / 2;
const cx = (map, n) => map.get(n.id).x + n.w / 2;
const sameMap = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.has(k) && b.get(k).x === v.x && b.get(k).y === v.y);

function enterprise() {
  const nodes = [{ id: 'internet', w: 100, h: 70, rank: 0 }], edges = [];
  for (const f of ['fw1', 'fw2']) { nodes.push({ id: f, w: 80, h: 50, rank: 1 }); edges.push({ from: 'internet', to: f }); }
  edges.push({ from: 'fw1', to: 'fw2' });                                       // HA link
  for (const c of ['core1', 'core2']) { nodes.push({ id: c, w: 90, h: 50, rank: 2 }); edges.push({ from: 'fw1', to: c }, { from: 'fw2', to: c }); }
  edges.push({ from: 'core1', to: 'core2' });                                   // stack cable
  for (let a = 1; a <= 4; a++) {
    nodes.push({ id: 'acc' + a, w: 80, h: 40, rank: 3 });
    edges.push({ from: 'core1', to: 'acc' + a }, { from: 'core2', to: 'acc' + a });
    for (let e = 1; e <= 3; e++) { nodes.push({ id: `pc${a}_${e}`, w: 50, h: 50, rank: 5 }); edges.push({ from: 'acc' + a, to: `pc${a}_${e}` }); }
  }
  return { nodes, edges };
}
function ascii(map, nodes, scale = 9) {
  const rows = new Map();
  for (const n of nodes) { const p = map.get(n.id), r = Math.round((p.y + n.h / 2) / 20); if (!rows.has(r)) rows.set(r, []); rows.get(r).push([Math.round(p.x / scale), Math.round((p.x + n.w) / scale), n.id]); }
  const lines = [];
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    let line = '';
    for (const [x1, x2, id] of rows.get(r).sort((a, b) => a[0] - b[0])) { line = line.padEnd(x1); const w = Math.max(3, x2 - x1); line += ('[' + id).slice(0, w - 1).padEnd(w - 1, '-') + ']'; }
    lines.push(line);
  }
  return lines.join('\n');
}

test('hierarchical: rank ordering top to bottom (TB)', () => {
  const nodes = [{ id: 'cloud', w: 100, h: 60, rank: 0 }, { id: 'core', w: 90, h: 50, rank: 2 }, { id: 'pc', w: 50, h: 50, rank: 5 }, { id: 'fw', w: 80, h: 50, rank: 1 }];
  const edges = [{ from: 'pc', to: 'core' }, { from: 'core', to: 'cloud' }, { from: 'fw', to: 'cloud' }];   // given "upside down"
  const m = Layout.hierarchical(nodes, edges);
  const [cloud, core, pc] = nodes;
  assert.ok(cy(m, cloud) < cy(m, core) && cy(m, core) < cy(m, pc), JSON.stringify([...m]));
  // ranks win over BFS distance: a rank-5 node hanging directly off the cloud still sits below the core
  const m2 = Layout.hierarchical(nodes, [...edges, { from: 'cloud', to: 'pc' }]);
  assert.ok(cy(m2, core) < cy(m2, pc));
  // useRanks:false ignores them (BFS from the busiest node)
  const m3 = Layout.hierarchical(nodes, edges, { useRanks: false });
  assert.ok(cy(m3, cloud) < cy(m3, pc));
});

test('hierarchical: equal-rank linked pair stays on the same layer', () => {
  const nodes = [{ id: 'fw', w: 80, h: 50, rank: 1 }, { id: 'core1', w: 90, h: 50, rank: 2 }, { id: 'core2', w: 90, h: 60, rank: 2 }, { id: 'sw', w: 80, h: 40, rank: 3 }];
  // core2 hangs off core1 only (stack cable) — BFS alone would push it a layer down
  const m = Layout.hierarchical(nodes, [{ from: 'fw', to: 'core1' }, { from: 'core1', to: 'core2' }, { from: 'core2', to: 'sw' }]);
  assert.strictEqual(cy(m, nodes[1]), cy(m, nodes[2]));
  assert.ok(Math.abs(cx(m, nodes[1]) - cx(m, nodes[2])) <= 90 + 60 + 1, 'side by side');
  assert.ok(cy(m, nodes[0]) < cy(m, nodes[1]) && cy(m, nodes[2]) < cy(m, nodes[3]));
  // unlinked nodes of one rank share a layer too
  const n2 = [...nodes, { id: 'dmz', w: 80, h: 40, rank: 3 }];
  const m2 = Layout.hierarchical(n2, [{ from: 'fw', to: 'core1' }, { from: 'core1', to: 'sw' }, { from: 'fw', to: 'dmz' }, { from: 'core1', to: 'core2' }]);
  assert.strictEqual(cy(m2, n2[3]), cy(m2, n2[4]));
});

test('hierarchical: no overlaps on random graphs (TB and LR, sizes 5-200)', () => {
  for (const n of [5, 12, 40, 100, 200]) for (const seed of [1, 2, 3, 4]) {
    const g = randomGraph(n, Math.round(n * 1.4), seed * 13 + n, { ranks: seed !== 4 });
    const tb = Layout.hierarchical(g.nodes, g.edges);
    assert.deepStrictEqual(overlaps(tb, g.nodes, 30, 55), [], `TB n=${n} seed=${seed}`);
    const lr = Layout.hierarchical(g.nodes, g.edges, { direction: 'LR', nodeSep: 40, rankSep: 80 });
    assert.deepStrictEqual(overlaps(lr, g.nodes, 40, 20), [], `LR n=${n} seed=${seed}`);
    assert.strictEqual(tb.size, n);
  }
});

test('hierarchical: deterministic', () => {
  const g = randomGraph(120, 170, 42);
  const a = Layout.hierarchical(g.nodes, g.edges), b = Layout.hierarchical(JSON.parse(JSON.stringify(g.nodes)), JSON.parse(JSON.stringify(g.edges)));
  assert.ok(sameMap(a, b));
});

test('hierarchical: LR is TB with the axes swapped', () => {
  const g = randomGraph(60, 80, 7);
  const lr = Layout.hierarchical(g.nodes, g.edges, { direction: 'LR' });
  const swapped = g.nodes.map(n => ({ ...n, w: n.h, h: n.w }));
  const tb = Layout.hierarchical(swapped, g.edges);
  for (const n of g.nodes) assert.deepStrictEqual(lr.get(n.id), { x: tb.get(n.id).y, y: tb.get(n.id).x });
  const e = enterprise(), m = Layout.hierarchical(e.nodes, e.edges, { direction: 'lr' });
  assert.ok(m.get('internet').x < m.get('fw1').x && m.get('fw1').x < m.get('core1').x && m.get('core1').x < m.get('pc1_1').x);
});

test('hierarchical: nodes sharing a group stay adjacent within their layer', () => {
  const nodes = [{ id: 'core', w: 90, h: 50, rank: 2 }], edges = [];
  const grp = ['A', 'B', 'A', 'B', 'A', 'B', undefined];
  grp.forEach((g, i) => { nodes.push({ id: 's' + i, w: 70, h: 40, rank: 3, group: g }); edges.push({ from: 'core', to: 's' + i }); });
  // each switch has one endpoint; endpoints inherit nothing -> free to follow their switch
  grp.forEach((g, i) => { nodes.push({ id: 'p' + i, w: 40, h: 40, rank: 5 }); edges.push({ from: 's' + i, to: 'p' + i }); });
  const m = Layout.hierarchical(nodes, edges);
  const layer = nodes.filter(n => n.rank === 3).sort((a, b) => m.get(a.id).x - m.get(b.id).x).map(n => n.group ?? '-').join('');
  assert.match(layer, /^(A{3}B{3}-|B{3}A{3}-|-A{3}B{3}|-B{3}A{3}|A{3}-B{3}|B{3}-A{3})$/, layer);
  assert.deepStrictEqual(overlaps(m, nodes, 30, 55), []);
});

test('hierarchical: enterprise topology is symmetric', t => {
  const { nodes, edges } = enterprise();
  const m = Layout.hierarchical(nodes, edges);
  const get = id => nodes.find(n => n.id === id);
  console.log('enterprise topology (hierarchical, TB):\n' + ascii(m, nodes, 7));
  assert.strictEqual(m.get('fw1').y, m.get('fw2').y, 'firewalls on one layer');
  assert.strictEqual(m.get('core1').y, m.get('core2').y, 'cores on one layer');
  const fwMid = (cx(m, get('fw1')) + cx(m, get('fw2'))) / 2, coreMid = (cx(m, get('core1')) + cx(m, get('core2'))) / 2;
  const accMid = ['acc1', 'acc2', 'acc3', 'acc4'].reduce((s, id) => s + cx(m, get(id)), 0) / 4;
  assert.ok(Math.abs(fwMid - coreMid) < 10, `firewalls centred over cores (${fwMid} vs ${coreMid})`);
  assert.ok(Math.abs(cx(m, get('internet')) - fwMid) < 10, 'internet centred over firewalls');
  assert.ok(Math.abs(coreMid - accMid) < 10, 'cores centred over access layer');
  for (let a = 1; a <= 4; a++) {                                   // each access switch sits over its own endpoints
    const kids = [1, 2, 3].map(e => cx(m, get(`pc${a}_${e}`)));
    assert.ok(Math.abs(cx(m, get('acc' + a)) - (Math.min(...kids) + Math.max(...kids)) / 2) < 10);
  }
  const ys = ['internet', 'fw1', 'core1', 'acc1', 'pc1_1'].map(id => cy(m, get(id)));
  assert.ok(ys.every((y, i) => i === 0 || y > ys[i - 1]), 'five tiers top to bottom');
  assert.deepStrictEqual(overlaps(m, nodes, 30, 55), []);
});

test('hierarchical: components side by side, isolated nodes at the end of their rank layer', () => {
  const nodes = [{ id: 'a', w: 80, h: 50, rank: 1 }, { id: 'b', w: 80, h: 50, rank: 3 }, { id: 'c', w: 60, h: 40, rank: 1 }, { id: 'd', w: 60, h: 40, rank: 3 },
    { id: 'lonely', w: 70, h: 30, rank: 3 }, { id: 'nobody', w: 50, h: 50 }];
  const m = Layout.hierarchical(nodes, [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]);
  const by = id => nodes.find(n => n.id === id);
  const span = ids => [Math.min(...ids.map(i => m.get(i).x)), Math.max(...ids.map(i => m.get(i).x + by(i).w))];
  const [l1, r1] = span(['a', 'b']), [l2, r2] = span(['c', 'd']);
  assert.ok(r1 <= l2 || r2 <= l1, 'components do not interleave');
  assert.strictEqual(cy(m, by('lonely')), cy(m, by('b')), 'isolated node in its rank layer');
  assert.ok(m.get('lonely').x > Math.max(m.get('b').x, m.get('d').x), 'at the end of the layer');
  assert.deepStrictEqual(overlaps(m, nodes, 30, 55), []);
});

test('hierarchical: 0, 1 and 500 nodes (500 nodes / 700 edges < 300 ms)', t => {
  assert.strictEqual(Layout.hierarchical([], []).size, 0);
  assert.strictEqual(Layout.hierarchical(null, null).size, 0);
  assert.deepStrictEqual([...Layout.hierarchical([{ id: 'x', w: 10, h: 10 }], [])], [['x', { x: 60, y: 60 }]]);
  assert.deepStrictEqual(Layout.hierarchical([{ id: 'x', w: 10, h: 10 }], [], { origin: [0, 5] }).get('x'), { x: 0, y: 5 });
  const iso = Layout.hierarchical(Array.from({ length: 30 }, (_, i) => ({ id: i, w: 50, h: 40, rank: i % 3 })), []);
  assert.strictEqual(iso.size, 30);
  for (const [n, m, ranks] of [[500, 700, true], [500, 700, false]]) {
    const g = randomGraph(n, m, 99, { ranks });
    Layout.hierarchical(g.nodes, g.edges);                          // warm-up
    const t0 = performance.now(), map = Layout.hierarchical(g.nodes, g.edges), ms = performance.now() - t0;
    t.diagnostic(`hierarchical ${n} nodes / ${m} edges (ranks ${ranks}): ${ms.toFixed(1)} ms`);
    assert.ok(ms < 300, `${ms} ms`);
    assert.deepStrictEqual(overlaps(map, g.nodes, 30, 55), []);
  }
});

test('grid: ordered by rank, then group, then name; columns option', () => {
  const nodes = [{ id: 'e', name: 'sw10', rank: 3, w: 60, h: 40 }, { id: 'a', name: 'cloud', rank: 0, w: 100, h: 60 }, { id: 'c', name: 'sw2', rank: 3, w: 60, h: 40 },
    { id: 'd', name: 'pc', w: 40, h: 40 }, { id: 'b', name: 'web', rank: 3, group: 'dmz', w: 60, h: 60 }];
  const m = Layout.grid(nodes, { columns: 2 });
  const order = [...nodes].sort((p, q) => m.get(p.id).y - m.get(q.id).y || m.get(p.id).x - m.get(q.id).x).map(n => n.id);
  assert.deepStrictEqual(order, ['a', 'b', 'c', 'e', 'd']);         // rank 0, rank 3 (grouped first, then sw2 < sw10), unranked
  assert.deepStrictEqual(overlaps(m, nodes, 60, 60), []);
  const g = randomGraph(200, 0, 5);
  assert.deepStrictEqual(overlaps(Layout.grid(g.nodes), g.nodes, 60, 60), []);
  assert.strictEqual(Layout.grid([]).size, 0);
});

test('circular / radial / force: no overlaps, deterministic, sane', t => {
  for (const n of [1, 2, 5, 40, 200]) for (const seed of [1, 2]) {
    const g = randomGraph(n, Math.round(n * 1.3), seed * 7 + n);
    for (const fn of ['circular', 'radial', 'force']) {
      const t0 = performance.now(), a = Layout[fn](g.nodes, g.edges), ms = performance.now() - t0;
      if (n === 200 && seed === 1) t.diagnostic(`${fn} ${n} nodes: ${ms.toFixed(1)} ms`);
      assert.strictEqual(a.size, n);
      assert.deepStrictEqual(overlaps(a, g.nodes, 4, 4), [], `${fn} n=${n} seed=${seed}`);
      assert.ok(sameMap(a, Layout[fn](g.nodes, g.edges)), `${fn} deterministic`);
    }
  }
  assert.strictEqual(Layout.force([], []).size, 0);
  const g = randomGraph(30, 40, 3);
  assert.ok(!sameMap(Layout.force(g.nodes, g.edges, { seed: 1 }), Layout.force(g.nodes, g.edges, { seed: 2 })), 'seed matters');
});

test('radial: hub (or opts.root) in the centre, first ring around it', () => {
  const nodes = [{ id: 'hub', w: 80, h: 60 }], edges = [];
  for (let i = 0; i < 8; i++) { nodes.push({ id: 's' + i, w: 60, h: 40 }); edges.push({ from: 'hub', to: 's' + i }); }
  for (let i = 0; i < 8; i++) { nodes.push({ id: 'p' + i, w: 40, h: 40 }); edges.push({ from: 's' + i, to: 'p' + i }); }
  const m = Layout.radial(nodes, edges), c = n => [cx(m, n), cy(m, n)];
  const [hx, hy] = c(nodes[0]);
  const d1 = nodes.slice(1, 9).map(n => Math.hypot(c(n)[0] - hx, c(n)[1] - hy)), d2 = nodes.slice(9).map(n => Math.hypot(c(n)[0] - hx, c(n)[1] - hy));
  assert.ok(Math.max(...d1) - Math.min(...d1) < 0.05 && Math.min(...d2) > Math.max(...d1), 'two rings around the hub');   // positions are rounded to 0.01
  const b = Layout.bounds(m, nodes);
  assert.ok(Math.abs(hx - (b.x + b.w / 2)) < 60 && Math.abs(hy - (b.y + b.h / 2)) < 60, 'hub roughly central');
  const r = Layout.radial(nodes, edges, { root: 's3' }), rc = n => [cx(r, n), cy(r, n)];
  const far = nodes.filter(n => n.id !== 's3').every(n => Math.hypot(rc(n)[0] - rc(nodes[4])[0], rc(n)[1] - rc(nodes[4])[1]) > 50);
  assert.ok(far && nodes.find(n => n.id === 's3'), 'opts.root is the centre');
});

test('bounds helper', () => {
  const nodes = [{ id: 'a', w: 10, h: 20 }, { id: 'b', w: 30, h: 5 }];
  const m = new Map([['a', { x: 0, y: 0 }], ['b', { x: 50, y: 40 }]]);
  assert.deepStrictEqual(Layout.bounds(m, nodes), { x: 0, y: 0, w: 80, h: 45 });
  assert.deepStrictEqual(Layout.bounds(new Map(), nodes), { x: 0, y: 0, w: 0, h: 0 });
  const { nodes: en, edges } = enterprise(), map = Layout.hierarchical(en, edges, { origin: [100, 200] }), bb = Layout.bounds(map, en);
  assert.strictEqual(bb.x, 100); assert.strictEqual(bb.y, 200);
});
