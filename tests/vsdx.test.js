/* Tests for js/vsdx.js (VsdxWriter).  Run: node --test tests/vsdx.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const VsdxWriter = require(path.join(__dirname, '..', 'js', 'vsdx.js'));

/* ------------------------------------------------------------------ */
/* Independent helpers: ZIP reader, strict XML parser, xmllint         */
/* ------------------------------------------------------------------ */
function refCrc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf) >>> 0;
  let c, crc = 0xFFFFFFFF;
  for (const b of buf) { c = (crc ^ b) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = c ^ (crc >>> 8); }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function readZip(u8) {
  const b = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  const eocd = b.length - 22;
  assert.equal(b.readUInt32LE(eocd), 0x06054b50, 'EOCD signature at end (no comment)');
  const count = b.readUInt16LE(eocd + 10);
  assert.equal(b.readUInt16LE(eocd + 8), count);
  const cdSize = b.readUInt32LE(eocd + 12), cdOff = b.readUInt32LE(eocd + 16);
  assert.equal(cdOff + cdSize, eocd, 'central directory ends at EOCD');
  const entries = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50, 'central header signature');
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString('utf8');
    assert.equal(b.readUInt32LE(lo), 0x04034b50, 'local header signature ' + name);
    assert.equal(b.readUInt16LE(lo + 6), flags, 'local flags match');
    assert.equal(b.readUInt32LE(lo + 14), crc, 'local crc matches central');
    const lnl = b.readUInt16LE(lo + 26), lxl = b.readUInt16LE(lo + 28);
    assert.equal(b.subarray(lo + 30, lo + 30 + lnl).toString('utf8'), name, 'local name matches central');
    const data = b.subarray(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + csize);
    assert.equal(method, 0, 'STORE');
    assert.equal(csize, usize);
    assert.equal(refCrc32(data), crc, 'CRC-32 of ' + name);
    entries.push({ name, flags, data: Buffer.from(data) });
    p += 46 + nl + xl + cl;
  }
  return entries;
}

function parseXml(src) {
  let i = 0;
  const n = src.length;
  const doc = { name: '#document', attrs: {}, children: [] };
  const stack = [doc];
  let rootSeen = false;
  const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
  const err = (m) => { throw new Error(m + ' @' + i + ' near ' + JSON.stringify(src.slice(Math.max(0, i - 40), i + 40))); };
  const decode = (raw, attr) => {
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/.test(raw)) err('illegal XML char');
    for (let k = 0; k < raw.length; k++) {
      const c = raw.charCodeAt(k);
      if (c >= 0xD800 && c <= 0xDBFF) { const d = raw.charCodeAt(k + 1); if (!(d >= 0xDC00 && d <= 0xDFFF)) err('lone surrogate'); k++; } else if (c >= 0xDC00 && c <= 0xDFFF) err('lone surrogate');
    }
    const s = attr ? raw.replace(/[\t\n\r]/g, ' ') : raw.replace(/\r\n?/g, '\n');
    return s.replace(/&([^;&\s]*);?/g, (m, ref) => {
      if (m[m.length - 1] !== ';') err('unterminated entity ' + m);
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (named[ref]) return named[ref];
      if (/^#x[0-9a-fA-F]+$/.test(ref)) return String.fromCodePoint(parseInt(ref.slice(2), 16));
      if (/^#[0-9]+$/.test(ref)) return String.fromCodePoint(parseInt(ref.slice(1), 10));
      return err('unknown entity &' + ref + ';');
    });
  };
  const text = (t) => {
    const top = stack[stack.length - 1];
    if (top === doc) { if (/\S/.test(t)) err('text outside root'); return; }
    top.children.push(decode(t, false));
  };
  const skipWs = () => { const s = i; while (i < n && /[ \t\r\n]/.test(src[i])) i++; return i > s; };
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<?', i)) { const e = src.indexOf('?>', i); if (e < 0) err('PI'); i = e + 2; continue; }
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); if (e < 0) err('comment'); i = e + 3; continue; }
    if (src.startsWith('<!', i)) err('unexpected <!');
    if (src[i + 1] === '/') {
      NAME.lastIndex = i + 2; const m = NAME.exec(src); if (!m) err('bad end tag');
      const top = stack.pop();
      if (top === doc || top.name !== m[0]) err('mismatched </' + m[0] + '>');
      i = NAME.lastIndex; skipWs(); if (src[i] !== '>') err('expected >'); i++; continue;
    }
    NAME.lastIndex = i + 1; const m = NAME.exec(src); if (!m) err('bad start tag');
    const parent = stack[stack.length - 1];
    if (parent === doc) { if (rootSeen) err('multiple roots'); rootSeen = true; }
    const el = { name: m[0], attrs: {}, children: [], parent };
    i = NAME.lastIndex;
    let self = false;
    for (;;) {
      const ws = skipWs();
      if (src[i] === '/' && src[i + 1] === '>') { i += 2; self = true; break; }
      if (src[i] === '>') { i++; break; }
      if (!ws) err('expected whitespace');
      NAME.lastIndex = i; const a = NAME.exec(src); if (!a) err('bad attribute');
      i = NAME.lastIndex; skipWs(); if (src[i] !== '=') err('expected ='); i++; skipWs();
      const q = src[i]; if (q !== '"' && q !== "'") err('expected quote');
      const e = src.indexOf(q, i + 1); if (e < 0) err('unterminated attribute');
      const raw = src.slice(i + 1, e); if (raw.indexOf('<') !== -1) err('< in attribute');
      if (Object.prototype.hasOwnProperty.call(el.attrs, a[0])) err('duplicate attribute ' + a[0]);
      el.attrs[a[0]] = decode(raw, true); i = e + 1;
    }
    parent.children.push(el);
    if (!self) stack.push(el);
  }
  if (stack.length !== 1) err('unclosed <' + stack[stack.length - 1].name + '>');
  const root = doc.children.find((c) => typeof c === 'object');
  if (!root) err('no root element');
  return root;
}

const kids = (el, name) => el.children.filter((c) => typeof c === 'object' && (!name || c.name === name));
const kid = (el, name) => kids(el, name)[0];
const cells = (el) => { const m = {}; for (const c of kids(el, 'Cell')) m[c.attrs.N] = c.attrs; return m; };
const V = (el, n) => { const c = cells(el)[n]; return c ? c.V : undefined; };
const num = (el, n) => Number(V(el, n));
const sections = (el, n) => kids(el, 'Section').filter((s) => s.attrs.N === n);
const textContent = (el) => el.children.filter((c) => typeof c === 'string').join('');
function allShapes(container) {
  const out = [];
  const walk = (el) => { for (const s of kids(el, 'Shape')) { out.push(s); const sub = kid(s, 'Shapes'); if (sub) walk(sub); } };
  const top = kid(container, 'Shapes');
  if (top) walk(top);
  return out;
}

const XMLLINT = (() => {
  const r = spawnSync('xmllint', ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? 'xmllint' : null;
})();

function open(bytes) {
  const entries = readZip(bytes);
  const map = new Map(entries.map((e) => [e.name, e.data]));
  const str = (n) => { assert.ok(map.has(n), 'part exists: ' + n); return map.get(n).toString('utf8'); };
  const xml = (n) => parseXml(str(n));
  const pagesDoc = xml('visio/pages/pages.xml');
  const pageRels = kids(xml('visio/pages/_rels/pages.xml.rels'), 'Relationship');
  const pages = kids(pagesDoc, 'Page').map((p) => {
    const rid = kid(p, 'Rel').attrs['r:id'];
    const rel = pageRels.find((r) => r.attrs.Id === rid);
    assert.ok(rel, 'page rel ' + rid);
    const part = 'visio/pages/' + rel.attrs.Target;
    return { el: p, part, sheet: kid(p, 'PageSheet'), xml: xml(part) };
  });
  return { entries, map, str, xml, pagesDoc, pages };
}
const shapeByName = (page, name) => allShapes(page.xml).find((s) => s.attrs.NameU === name);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function multiStyleShape(extra) {
  return Object.assign({
    id: 1, kind: 'shape', name: 'Router', x: 1, y: 2, w: 2, h: 1, angle: 0,
    geoms: [
      { closed: true, fill: '#ffffff', stroke: '#2f5ea8', weight: 0.75, dash: 0, fillOpacity: 1, points: rect(0, 0, 2, 1) },
      { closed: true, fill: '#2f5ea8', stroke: null, weight: 0, dash: 0, points: rect(0.2, 0.2, 0.2, 0.2) },
      { closed: true, fill: '#2f5ea8', stroke: null, weight: 0, dash: 0, points: rect(0.6, 0.2, 0.2, 0.2) },
      { closed: false, fill: null, stroke: '#ef6b32', weight: 1, dash: 0, points: [[1.2, 0.5], [1.8, 0.5]] },
    ],
    text: 'Core switch - 1\n10.0.0.1', textColor: '#34465e', textSize: 9, bold: true, italic: true, font: 'Segoe UI', align: 'center',
    textBox: { x: -0.3, y: 1.05, w: 2.6, h: 0.35 },
    data: [{ label: 'Hostname', value: 'core-sw-01' }, { label: 'IP address', value: '10.0.0.1' }],
    hyperlink: 'https://example.com/a?b=1&c=2', layers: [0, 2],
  }, extra || {});
}

function fullIR() {
  return {
    title: 'Network <architecture> & "more"', author: 'Tester', company: 'ACME & Co', description: 'desc',
    created: '2026-01-02T03:04:05Z',
    pages: [
      {
        name: 'Logical architecture', width: 16.54, height: 11.69, background: false, backPage: 1,
        layers: [{ name: 'Devices', visible: true, print: true, locked: false }, { name: 'Links', visible: false, print: false, locked: true }, { name: 'Notes' }],
        shapes: [
          multiStyleShape(),
          { id: 2, kind: 'shape', name: 'Box', x: 6, y: 2, w: 1, h: 1, geoms: [{ closed: true, fill: '#ff0000', stroke: '#000000', weight: 1, points: rect(0, 0, 1, 1) }], layers: [1] },
          { id: 3, kind: 'connector', points: [[3, 2.5], [4.5, 2.5], [4.5, 4], [6.5, 4], [6.5, 3]], stroke: '#ef6b32', weight: 1.5, dash: 1, beginArrow: 'dot', endArrow: 'arrow', text: '10G', textColor: '#ef6b32', textSize: 8, from: 1, to: 2, data: [{ label: 'Speed', value: '10G' }], layers: [1] },
          { id: 4, kind: 'text', x: 1, y: 6, w: 3, h: 1, text: 'Notes', textColor: '#333', textSize: 12, bold: false, italic: false, font: 'Arial', align: 'left', fill: '#fffbe6', stroke: null, layers: [2] },
          { id: 5, kind: 'image', x: 10, y: 1, w: 1, h: 0.5, mime: 'image/png', data: Uint8Array.from(Buffer.from(PNG_1PX, 'base64')), layers: [] },
          { id: 6, kind: 'image', x: 12, y: 1, w: 1, h: 0.5, mime: 'image/png', data: 'data:image/png;base64,' + PNG_1PX },
        ],
      },
      {
        name: 'Background', width: 16.54, height: 11.69, background: true, backPage: null, layers: [],
        shapes: [{ id: 1, kind: 'text', x: 0.5, y: 11, w: 5, h: 0.4, text: 'Footer', textSize: 8 }],
      },
    ],
  };
}
const oneShapeIR = (shape, page) => ({ created: '2026-01-01T00:00:00Z', pages: [Object.assign({ name: 'P', width: 11, height: 10, layers: [], shapes: [shape] }, page || {})] });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(Number(a) - b) <= eps, `expected ${a} ~ ${b}`);

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */
test('crc32 known vectors', () => {
  assert.equal(VsdxWriter.crc32('123456789'), 0xCBF43926);
  assert.equal(VsdxWriter.crc32(new Uint8Array(0)), 0);
  const buf = Buffer.from('The quick brown fox jumps over the lazy dog');
  assert.equal(VsdxWriter.crc32(new Uint8Array(buf)), refCrc32(buf));
});

test('zip round-trip: headers, central directory, CRCs, UTF-8 names', () => {
  const bin = Uint8Array.from([0, 1, 2, 3, 254, 255]);
  const z = VsdxWriter.zip([{ name: 'a.txt', data: 'hello ü' }, { name: 'dir/ünï-名.bin', data: bin }, { name: 'empty.txt', data: '' }], { date: new Date(2026, 0, 2, 3, 4, 6) });
  const entries = readZip(z);
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir/ünï-名.bin', 'empty.txt']);
  assert.equal(entries[0].data.toString('utf8'), 'hello ü');
  assert.deepEqual([...entries[1].data], [...bin]);
  assert.equal(entries[2].data.length, 0);
  for (const e of entries) assert.equal(e.flags & 0x0800, 0x0800, 'UTF-8 flag');
  // DOS date/time in local header
  const b = Buffer.from(z);
  const time = b.readUInt16LE(10), date = b.readUInt16LE(12);
  assert.equal(date >> 9, 2026 - 1980); assert.equal((date >> 5) & 15, 1); assert.equal(date & 31, 2);
  assert.equal(time >> 11, 3); assert.equal((time >> 5) & 63, 4); assert.equal((time & 31) * 2, 6);
});

test('package: required parts, content types, relationships resolve', () => {
  const pkg = open(VsdxWriter.build(fullIR()));
  const names = pkg.entries.map((e) => e.name);
  assert.equal(names[0], '[Content_Types].xml', 'content types first');
  for (const p of ['_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'visio/document.xml', 'visio/_rels/document.xml.rels',
    'visio/pages/pages.xml', 'visio/pages/_rels/pages.xml.rels', 'visio/pages/page1.xml', 'visio/pages/page2.xml', 'visio/windows.xml']) {
    assert.ok(names.includes(p), 'has ' + p);
  }
  assert.equal(new Set(names).size, names.length, 'no duplicate entries');
  const ct = pkg.xml('[Content_Types].xml');
  const overrides = new Map(kids(ct, 'Override').map((o) => [o.attrs.PartName, o.attrs.ContentType]));
  const defaults = new Map(kids(ct, 'Default').map((d) => [d.attrs.Extension, d.attrs.ContentType]));
  for (const n of names) {
    if (n === '[Content_Types].xml') continue;
    const ext = n.split('.').pop();
    assert.ok(overrides.has('/' + n) || defaults.has(ext), 'content type for ' + n);
  }
  for (const pn of overrides.keys()) assert.ok(names.includes(pn.slice(1)), 'override target exists ' + pn);
  assert.equal(overrides.get('/visio/document.xml'), 'application/vnd.ms-visio.drawing.main+xml');
  assert.equal(overrides.get('/visio/pages/pages.xml'), 'application/vnd.ms-visio.pages+xml');
  assert.equal(overrides.get('/visio/pages/page1.xml'), 'application/vnd.ms-visio.page+xml');
  assert.equal(overrides.get('/visio/windows.xml'), 'application/vnd.ms-visio.windows+xml');
  assert.equal(defaults.get('png'), 'image/png');
  // every relationship target exists, ids unique per rels part
  for (const n of names.filter((x) => x.endsWith('.rels'))) {
    const rels = kids(pkg.xml(n), 'Relationship');
    const ids = rels.map((r) => r.attrs.Id);
    assert.equal(new Set(ids).size, ids.length, 'unique rIds in ' + n);
    const srcDir = path.posix.dirname(path.posix.dirname(n));
    for (const r of rels) {
      const target = path.posix.normalize(path.posix.join(srcDir === '.' ? '' : srcDir, r.attrs.Target));
      assert.ok(names.includes(target), `${n}: ${r.attrs.Id} -> ${target}`);
    }
  }
  const root = kids(pkg.xml('_rels/.rels'), 'Relationship');
  assert.ok(root.some((r) => r.attrs.Type === 'http://schemas.microsoft.com/visio/2010/relationships/document' && r.attrs.Target === 'visio/document.xml'));
  const docRels = kids(pkg.xml('visio/_rels/document.xml.rels'), 'Relationship').map((r) => r.attrs.Type);
  assert.ok(docRels.includes('http://schemas.microsoft.com/visio/2010/relationships/pages'));
  assert.ok(docRels.includes('http://schemas.microsoft.com/visio/2010/relationships/windows'));
});

test('every XML part is well-formed (strict parser + xmllint when available)', () => {
  const pkg = open(VsdxWriter.build(fullIR()));
  for (const e of pkg.entries) {
    if (!/\.(xml|rels)$/.test(e.name)) continue;
    const s = e.data.toString('utf8');
    assert.ok(s.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), 'declaration in ' + e.name);
    parseXml(s);
    if (XMLLINT) {
      const r = spawnSync(XMLLINT, ['--noout', '-'], { input: e.data });
      assert.equal(r.status, 0, `xmllint ${e.name}: ${r.stderr}`);
    }
  }
  const doc = pkg.xml('visio/document.xml');
  assert.equal(doc.attrs.xmlns, 'http://schemas.microsoft.com/office/visio/2012/main');
  const style0 = kids(kid(doc, 'StyleSheets'), 'StyleSheet').find((s) => s.attrs.ID === '0');
  assert.ok(style0, 'style 0 exists');
  for (const n of ['LineWeight', 'LineColor', 'LinePattern', 'FillForegnd', 'FillPattern', 'VerticalAlign']) assert.ok(V(style0, n) !== undefined, 'style 0 ' + n);
  assert.ok(sections(style0, 'Character').length && sections(style0, 'Paragraph').length);
});

test('cells: every Cell has N and V; numbers have no exponent/NaN; styles referenced exist', () => {
  const ir = fullIR();
  ir.pages[0].shapes.push({ id: 50, kind: 'shape', x: 1e-9, y: NaN, w: 1e-12, h: 3, geoms: [{ closed: true, fill: '#abc', points: [[0, 0], [1e-12, 0], [1e-12, 3]] }] });
  const pkg = open(VsdxWriter.build(ir));
  let count = 0;
  const check = (el) => {
    for (const c of kids(el)) {
      if (c.name === 'Cell') {
        count++;
        assert.ok(c.attrs.N, 'Cell N');
        assert.ok(c.attrs.V !== undefined, 'Cell V for ' + c.attrs.N);
        assert.ok(!/^-?\d+(\.\d+)?e[-+]?\d+$/i.test(c.attrs.V), 'exponent in ' + c.attrs.N + '=' + c.attrs.V);
        assert.ok(!/^(NaN|-?Infinity|undefined|null)$/.test(c.attrs.V), 'bad value ' + c.attrs.N + '=' + c.attrs.V);
        if (c.attrs.U !== 'STR' && /^-?[\d.]+$/.test(c.attrs.V)) assert.match(c.attrs.V, /^-?\d+(\.\d*[1-9])?$/, 'canonical number ' + c.attrs.V);
      }
      check(c);
    }
  };
  for (const p of pkg.pages) { check(p.xml); check(p.sheet); }
  check(pkg.xml('visio/document.xml'));
  assert.ok(count > 100);
  for (const p of pkg.pages) for (const s of allShapes(p.xml)) {
    for (const a of ['LineStyle', 'FillStyle', 'TextStyle']) assert.equal(s.attrs[a], '0');
  }
});

test('shape IDs are unique per page (including group members) and names unique', () => {
  const ir = fullIR();
  for (let k = 0; k < 5; k++) ir.pages[0].shapes.push(multiStyleShape({ id: 100 + k }));
  const pkg = open(VsdxWriter.build(ir));
  for (const p of pkg.pages) {
    const shapes = allShapes(p.xml);
    const ids = shapes.map((s) => s.attrs.ID);
    assert.equal(new Set(ids).size, ids.length, 'unique IDs on ' + p.part);
    for (const id of ids) assert.match(id, /^[1-9]\d*$/);
    const names = shapes.map((s) => s.attrs.NameU).filter(Boolean).map((x) => x.toLowerCase());
    assert.equal(new Set(names).size, names.length, 'unique NameU on ' + p.part);
  }
});

test('coordinate flip: 2D pin, rotation sign, geometry, text box under icon', () => {
  const s = { id: 1, kind: 'shape', x: 1, y: 2, w: 2, h: 1, angle: 90, geoms: [{ closed: true, fill: '#fff', stroke: '#000', weight: 1, points: [[0, 0], [2, 0], [2, 0.5]] }], text: 'L', textBox: { x: -0.3, y: 1.1, w: 2.6, h: 0.4 } };
  const pkg = open(VsdxWriter.build(oneShapeIR(s)));
  const sh = allShapes(pkg.pages[0].xml)[0];
  near(V(sh, 'PinX'), 2); near(V(sh, 'PinY'), 10 - 2.5);
  near(V(sh, 'Width'), 2); near(V(sh, 'Height'), 1);
  near(V(sh, 'LocPinX'), 1); near(V(sh, 'LocPinY'), 0.5);
  near(V(sh, 'Angle'), -Math.PI / 2, 1e-9); // clockwise in SVG = negative in Visio
  const rows = kids(sections(sh, 'Geometry')[0], 'Row');
  assert.deepEqual(rows.map((r) => r.attrs.T), ['RelMoveTo', 'RelLineTo', 'RelLineTo', 'RelLineTo']);
  // IR (0,0) top-left -> Visio local (0, H) -> relative (0, 1)
  near(V(rows[0], 'X'), 0); near(V(rows[0], 'Y'), 1);
  near(V(rows[1], 'X'), 1); near(V(rows[1], 'Y'), 1);
  near(V(rows[2], 'X'), 1); near(V(rows[2], 'Y'), 0.5);
  near(V(rows[3], 'X'), 0); near(V(rows[3], 'Y'), 1); // closed back to start
  // text box: centre at y = 1.1 + 0.2 below the top -> local Y = 1 - 1.3 = -0.3 (below the shape)
  near(V(sh, 'TxtPinY'), -0.3); near(V(sh, 'TxtPinX'), 1);
  assert.ok(num(sh, 'TxtWidth') >= 2.6 - 1e-9);
  near(V(sh, 'TxtHeight'), 0.4);
  near(V(sh, 'TxtLocPinX'), num(sh, 'TxtWidth') / 2); near(V(sh, 'TxtLocPinY'), 0.2);
});

test('coordinate flip: connector begin/end, page-aligned local frame, geometry relative to begin', () => {
  const c = { id: 9, kind: 'connector', points: [[1, 1], [1, 3], [4, 3]], stroke: '#123456', weight: 2, dash: 0, beginArrow: 'none', endArrow: 'arrow', text: 'x' };
  const pkg = open(VsdxWriter.build(oneShapeIR(c)));
  const sh = allShapes(pkg.pages[0].xml)[0];
  near(V(sh, 'BeginX'), 1); near(V(sh, 'BeginY'), 9); near(V(sh, 'EndX'), 4); near(V(sh, 'EndY'), 7);
  near(V(sh, 'Width'), 3); near(V(sh, 'Height'), -2); near(V(sh, 'Angle'), 0);
  near(V(sh, 'PinX'), 2.5); near(V(sh, 'PinY'), 8);
  near(Number(V(sh, 'PinX')) - Number(V(sh, 'LocPinX')), 1); // local origin == begin point
  near(Number(V(sh, 'PinY')) - Number(V(sh, 'LocPinY')), 9);
  assert.equal(V(sh, 'ObjType'), '2');
  near(V(sh, 'LineWeight'), 2 / 72);
  assert.equal(cells(sh).LineWeight.U, 'PT');
  assert.equal(V(sh, 'LineColor'), '#123456');
  const rows = kids(sections(sh, 'Geometry')[0], 'Row');
  assert.deepEqual(rows.map((r) => [r.attrs.T, Number(V(r, 'X')), Number(V(r, 'Y'))]), [['MoveTo', 0, 0], ['LineTo', 0, -2], ['LineTo', 3, -2]]);
  assert.equal(V(sections(sh, 'Geometry')[0], 'NoFill'), '1');
  // label at path midpoint (length 5 -> 2.5 along: (1,3)+(0.5,0) in IR -> (1.5, 7) page -> local (0.5, -2))
  near(V(sh, 'TxtPinX'), 0.5); near(V(sh, 'TxtPinY'), -2);
  assert.equal(V(sh, 'ShapeRouteStyle'), '1', 'orthogonal route style');
});

test('escaping of <&>"\' and unicode in text, data, names, doc props', () => {
  const nasty = 'A<b>&"c"\'d\' ü 日本 🚀\u0001\uD800x\r\nline2';
  const expected = 'A<b>&"c"\'d\' ü 日本 🚀x\nline2';
  const s = {
    id: 1, kind: 'shape', name: 'N<&>"\'', x: 0, y: 0, w: 1, h: 1, geoms: [{ closed: true, fill: '#fff', points: rect(0, 0, 1, 1) }],
    text: nasty, data: [{ label: 'Lbl <&>', value: 'v1\nv2 & "q" <x>' }], hyperlink: 'https://e.com/?a=1&b="2"',
  };
  const ir = oneShapeIR(s, { name: 'Pg <1> & "x"' });
  ir.title = 'T <&> "q" \'a\' ✓';
  const pkg = open(VsdxWriter.build(ir));
  const sh = allShapes(pkg.pages[0].xml)[0];
  assert.equal(textContent(kid(sh, 'Text')), expected);
  assert.equal(sh.attrs.NameU, 'N<&>"\'');
  const row = kids(sections(sh, 'Property')[0], 'Row')[0];
  assert.equal(V(row, 'Value'), 'v1\nv2 & "q" <x>', 'newline survives attribute normalisation');
  assert.equal(V(row, 'Label'), 'Lbl <&>');
  assert.equal(V(kids(sections(sh, 'Hyperlink')[0], 'Row')[0], 'Address'), 'https://e.com/?a=1&b="2"');
  assert.equal(pkg.pages[0].el.attrs.NameU, 'Pg <1> & "x"');
  const core = pkg.xml('docProps/core.xml');
  assert.equal(textContent(kid(core, 'dc:title')), 'T <&> "q" \'a\' ✓');
  const rawPage = pkg.str(pkg.pages[0].part);
  const body = rawPage.slice(rawPage.indexOf('?>') + 2).replace(/^\r\n/, '');
  assert.ok(!body.includes('\u0001') && !body.includes('\r'), 'control chars and CR stripped');
});

test('arrow and dash mapping', () => {
  const expectArrows = { none: 0, arrow: 13, openArrow: 1, dot: 10, circle: 20, diamond: 22, bar: 24 };
  const shapes = Object.keys(expectArrows).map((k, i) => ({ id: i + 1, kind: 'connector', points: [[0, i], [2, i]], beginArrow: k, endArrow: k, dash: i % 4 }));
  shapes.push({ id: 99, kind: 'connector', points: [[0, 9], [2, 9]], beginArrow: 'bogus', endArrow: undefined });
  const pkg = open(VsdxWriter.build(oneShapeIR(null, { shapes })));
  const out = allShapes(pkg.pages[0].xml);
  Object.keys(expectArrows).forEach((k, i) => {
    assert.equal(Number(V(out[i], 'BeginArrow')), expectArrows[k], 'begin ' + k);
    assert.equal(Number(V(out[i], 'EndArrow')), expectArrows[k], 'end ' + k);
    assert.equal(Number(V(out[i], 'LinePattern')), [1, 2, 3, 4][i % 4], 'dash ' + (i % 4));
  });
  const last = out[out.length - 1];
  assert.equal(V(last, 'BeginArrow'), '0'); assert.equal(V(last, 'EndArrow'), '0'); assert.equal(V(last, 'LinePattern'), '1');
  // dash on 2D geometry
  const g = { id: 1, kind: 'shape', x: 0, y: 0, w: 1, h: 1, geoms: [{ closed: true, fill: null, stroke: '#000', dash: 3, weight: 2, points: rect(0, 0, 1, 1) }] };
  const sh = allShapes(open(VsdxWriter.build(oneShapeIR(g))).pages[0].xml)[0];
  assert.equal(V(sh, 'LinePattern'), '4');
  assert.equal(V(sh, 'FillPattern'), '0');
  assert.equal(V(sections(sh, 'Geometry')[0], 'NoFill'), '1');
});

test('multi-style shape becomes a Group; label, data and link sit on the group', () => {
  const pkg = open(VsdxWriter.build(oneShapeIR(multiStyleShape(), { layers: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] })));
  const top = kids(kid(pkg.pages[0].xml, 'Shapes'), 'Shape');
  assert.equal(top.length, 1);
  const g = top[0];
  assert.equal(g.attrs.Type, 'Group');
  assert.equal(sections(g, 'Geometry').length, 0, 'group has no own geometry');
  assert.ok(kid(g, 'Text'));
  assert.equal(sections(g, 'Property').length, 1);
  assert.equal(sections(g, 'Hyperlink').length, 1);
  assert.equal(V(g, 'LayerMember'), '0;2');
  const members = kids(kid(g, 'Shapes'), 'Shape');
  // white body | blue dots + orange detail line (fill-only and line-only geoms share one sub-shape)
  assert.equal(members.length, 2);
  for (const m of members) {
    assert.equal(m.attrs.Type, 'Shape');
    assert.ok(!kid(m, 'Text') && !sections(m, 'Property').length && !sections(m, 'Hyperlink').length);
    assert.equal(V(m, 'LayerMember'), '0;2', 'members carry layers too');
    near(V(m, 'Width'), 2); near(V(m, 'PinX'), 1);
    assert.equal(cells(m).Width.F, 'Sheet.' + g.attrs.ID + '!Width');
  }
  const [body, accent] = members;
  assert.equal(V(body, 'FillForegnd'), '#FFFFFF'); assert.equal(V(body, 'LineColor'), '#2F5EA8');
  assert.deepEqual(sections(body, 'Geometry').map((s) => [V(s, 'NoFill'), V(s, 'NoLine')]), [['0', '0']]);
  assert.equal(V(accent, 'FillForegnd'), '#2F5EA8'); assert.equal(V(accent, 'LineColor'), '#EF6B32');
  near(V(accent, 'LineWeight'), 1 / 72);
  assert.deepEqual(sections(accent, 'Geometry').map((s) => [V(s, 'NoFill'), V(s, 'NoLine')]), [['0', '1'], ['0', '1'], ['1', '0']]);
  // a third, incompatible style forces a third member
  const three = multiStyleShape();
  three.geoms.push({ closed: true, fill: '#00ff00', stroke: null, points: rect(1.5, 0.1, 0.1, 0.1) });
  const g3 = kids(kid(open(VsdxWriter.build(oneShapeIR(three))).pages[0].xml, 'Shapes'), 'Shape')[0];
  assert.equal(kids(kid(g3, 'Shapes'), 'Shape').length, 3);
  // text formatting on the group
  const ch = kids(sections(g, 'Character')[0], 'Row')[0];
  near(V(ch, 'Size'), 9 / 72); assert.equal(cells(ch).Size.U, 'PT');
  assert.equal(V(ch, 'Style'), '3'); assert.equal(V(ch, 'Color'), '#34465E'); assert.equal(V(ch, 'Font'), 'Segoe UI');
  assert.equal(V(kids(sections(g, 'Paragraph')[0], 'Row')[0], 'HorzAlign'), '1');
});

test('single-style and fill+same-line shapes stay plain shapes', () => {
  const fw = {
    id: 1, kind: 'shape', x: 0, y: 0, w: 1, h: 0.7,
    geoms: [{ closed: true, fill: '#d9534f', stroke: '#8b2e2b', weight: 1, points: rect(0, 0, 1, 0.7) },
      { closed: false, fill: null, stroke: '#8b2e2b', weight: 1, points: [[0, 0.35], [1, 0.35]] },
      { closed: false, fill: null, stroke: '#8b2e2b', weight: 1, points: [[0.5, 0], [0.5, 0.35]] }],
  };
  const sh = allShapes(open(VsdxWriter.build(oneShapeIR(fw))).pages[0].xml);
  assert.equal(sh.length, 1);
  assert.equal(sh[0].attrs.Type, 'Shape');
  assert.equal(sections(sh[0], 'Geometry').length, 3);
  assert.equal(V(sh[0], 'FillForegnd'), '#D9534F');
});

test('style bucketing keeps stacking order', () => {
  const { bucketize, prepGeom } = VsdxWriter._internal;
  const A = { closed: true, fill: '#ffffff', stroke: '#000000', weight: 1, points: rect(0, 0, 1, 1) };
  const B = { closed: true, fill: '#ff0000', points: rect(0.5, 0.5, 1, 1) };
  const C = { closed: true, fill: '#ffffff', stroke: '#000000', weight: 1, points: rect(1, 1, 1, 1) };
  assert.equal(bucketize([A, B, C].map(prepGeom)).length, 3, 'C overlaps B so it cannot drop below it');
  const Cfar = { closed: true, fill: '#ffffff', stroke: '#000000', weight: 1, points: rect(5, 5, 1, 1) };
  assert.equal(bucketize([A, B, Cfar].map(prepGeom)).length, 2, 'non-overlapping C may join A');
  // a fill must not be merged under an earlier outline it covers (Visio paints fills before lines)
  const over = { closed: true, fill: '#ffffff', stroke: '#000000', weight: 1, points: rect(0.5, 0, 1, 1) };
  assert.equal(bucketize([A, over].map(prepGeom)).length, 2);
  // invisible geometry is dropped
  assert.equal(bucketize([{ closed: true, fill: null, stroke: null, points: rect(0, 0, 1, 1) }].map(prepGeom)).length, 0);
});

test('empty page and empty document', () => {
  const pkg = open(VsdxWriter.build({ pages: [{ name: 'Empty', width: 8.5, height: 11, shapes: [] }] }));
  assert.equal(pkg.pages.length, 1);
  assert.equal(kids(pkg.pages[0].xml).length, 0, 'no <Shapes>/<Connects> on empty page');
  near(V(pkg.pages[0].sheet, 'PageWidth'), 8.5);
  assert.equal(V(pkg.pages[0].sheet, 'PrintPageOrientation'), '1');
  const none = open(VsdxWriter.build({}));
  assert.equal(none.pages.length, 1, 'a document always has one page');
  assert.equal(none.pages[0].el.attrs.Name, 'Page-1');
  const nul = open(VsdxWriter.build({ pages: [{ shapes: [null, 5, { kind: 'connector', points: [[1, 1]] }] }] }));
  assert.equal(kids(nul.pages[0].xml).length, 0, 'invalid shapes skipped');
});

test('two-page document with a background page', () => {
  const pkg = open(VsdxWriter.build(fullIR()));
  const [fg, bg] = pkg.pages;
  assert.equal(fg.el.attrs.Name, 'Logical architecture');
  assert.equal(fg.el.attrs.Background, undefined);
  assert.equal(bg.el.attrs.Background, '1');
  assert.equal(fg.el.attrs.BackPage, bg.el.attrs.ID);
  assert.notEqual(fg.el.attrs.ID, bg.el.attrs.ID);
  assert.equal(V(fg.sheet, 'PrintPageOrientation'), '2', 'landscape');
  assert.equal(V(fg.sheet, 'PaperKind'), '8', 'A3');
  near(V(fg.sheet, 'PageScale'), 1); near(V(fg.sheet, 'DrawingScale'), 1);
  const doc = pkg.xml('visio/document.xml');
  assert.equal(kid(doc, 'DocumentSettings').attrs.TopPage, fg.el.attrs.ID);
  // background listed in IR first: becomes background via backPage, foreground pages listed first
  const ir = fullIR();
  ir.pages.reverse();
  ir.pages[0].background = false; // implied by the reference below
  ir.pages[1].backPage = 0;
  const p2 = open(VsdxWriter.build(ir));
  assert.equal(p2.pages[0].el.attrs.Name, 'Logical architecture');
  assert.equal(p2.pages[1].el.attrs.Background, '1');
  assert.equal(p2.pages[0].el.attrs.BackPage, p2.pages[1].el.attrs.ID);
  // all-background input still yields a foreground page
  const p3 = open(VsdxWriter.build({ pages: [{ name: 'Only bg', background: true, shapes: [] }] }));
  assert.equal(p3.pages.length, 2);
  assert.equal(p3.pages[0].el.attrs.Background, undefined);
  assert.equal(p3.pages[0].el.attrs.BackPage, p3.pages[1].el.attrs.ID);
  // windows.xml points at the top page
  assert.equal(kid(pkg.xml('visio/windows.xml'), 'Window').attrs.Page, fg.el.attrs.ID);
});

test('layers: PageSheet Layer section and LayerMember', () => {
  const pkg = open(VsdxWriter.build(fullIR()));
  const rows = kids(sections(pkg.pages[0].sheet, 'Layer')[0], 'Row');
  assert.deepEqual(rows.map((r) => [r.attrs.IX, V(r, 'Name'), V(r, 'Visible'), V(r, 'Print'), V(r, 'Lock')]),
    [['0', 'Devices', '1', '1', '0'], ['1', 'Links', '0', '0', '1'], ['2', 'Notes', '1', '1', '0']]);
  assert.equal(V(shapeByName(pkg.pages[0], 'Box'), 'LayerMember'), '1');
  const s = Object.assign(multiStyleShape(), { layers: [2, 0, 7, -1, 'x', 2] });
  const sh = allShapes(open(VsdxWriter.build(oneShapeIR(s, { layers: [{ name: 'a' }, { name: 'a' }, { name: 'c' }] }))).pages[0].xml)[0];
  assert.equal(V(sh, 'LayerMember'), '2;0', 'invalid indices dropped, duplicates removed');
});

test('shape data: sanitised unique row names, labels kept, string values', () => {
  const s = Object.assign(multiStyleShape(), {
    data: [{ label: 'IP address', value: '10.0.0.1' }, { label: 'IP-address', value: 'dup' }, { label: '1st owner', value: 'NOC' },
      { label: 'Größe', value: 42 }, { label: '', value: 'anon' }, { label: '名前', value: 'x' }],
  });
  const sh = allShapes(open(VsdxWriter.build(oneShapeIR(s))).pages[0].xml)[0];
  const rows = kids(sections(sh, 'Property')[0], 'Row');
  const names = rows.map((r) => r.attrs.N);
  assert.equal(names[0], 'IP_address'); assert.equal(names[1], 'IP_address_2'); assert.equal(names[2], 'P_1st_owner');
  for (const n of names) assert.match(n, /^[A-Za-z_][A-Za-z0-9_]*$/);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  assert.deepEqual(rows.map((r) => V(r, 'Label')), ['IP address', 'IP-address', '1st owner', 'Größe', names[4], '名前']);
  assert.equal(V(rows[3], 'Value'), '42');
  for (const r of rows) { assert.equal(cells(r).Value.U, 'STR'); assert.equal(V(r, 'Type'), '0'); }
});

test('images: Foreign shape, media part, rels, de-duplication', () => {
  const pkg = open(VsdxWriter.build(fullIR()));
  const media = pkg.entries.filter((e) => e.name.startsWith('visio/media/'));
  assert.equal(media.length, 1, 'identical images share one media part');
  assert.equal(media[0].name, 'visio/media/image1.png');
  assert.deepEqual([...media[0].data.subarray(0, 4)], [0x89, 0x50, 0x4E, 0x47]);
  const page = pkg.pages[0];
  const rels = kids(pkg.xml('visio/pages/_rels/' + path.posix.basename(page.part) + '.rels'), 'Relationship');
  assert.equal(rels.length, 1);
  assert.equal(rels[0].attrs.Type, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
  assert.equal(rels[0].attrs.Target, '../media/image1.png');
  const foreign = allShapes(page.xml).filter((s) => s.attrs.Type === 'Foreign');
  assert.equal(foreign.length, 2);
  for (const f of foreign) {
    const fd = kid(f, 'ForeignData');
    assert.equal(fd.attrs.ForeignType, 'Bitmap'); assert.equal(fd.attrs.CompressionType, 'PNG');
    assert.equal(kid(fd, 'Rel').attrs['r:id'], rels[0].attrs.Id);
    near(V(f, 'ImgWidth'), 1); near(V(f, 'ImgHeight'), 0.5);
  }
  near(V(foreign[0], 'PinX'), 10.5); near(V(foreign[0], 'PinY'), 11.69 - 1.25);
  // unsupported image data degrades to a placeholder box, no media
  const bad = open(VsdxWriter.build(oneShapeIR({ id: 1, kind: 'image', x: 0, y: 0, w: 1, h: 1, mime: 'image/webp', data: new Uint8Array([1, 2, 3]) })));
  assert.equal(bad.entries.filter((e) => e.name.startsWith('visio/media/')).length, 0);
  assert.equal(allShapes(bad.pages[0].xml)[0].attrs.Type, 'Shape');
});

test('connectors: glue formulas and Connects entries', () => {
  const pkg = open(VsdxWriter.build(fullIR()));
  const page = pkg.pages[0];
  const shapes = allShapes(page.xml);
  const router = shapeByName(page, 'Router'), box = shapeByName(page, 'Box');
  const conn = shapes.find((s) => V(s, 'ObjType') === '2');
  assert.equal(cells(conn).BeginX.F, '_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)');
  assert.equal(cells(conn).EndY.F, '_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)');
  assert.equal(cells(conn).BegTrigger.F, `_XFTRIGGER(Sheet.${router.attrs.ID}!EventXFMod)`);
  assert.equal(cells(conn).EndTrigger.F, `_XFTRIGGER(Sheet.${box.attrs.ID}!EventXFMod)`);
  const connects = kids(kid(page.xml, 'Connects'), 'Connect').map((c) => c.attrs);
  assert.deepEqual(connects, [
    { FromSheet: conn.attrs.ID, FromCell: 'BeginX', FromPart: '9', ToSheet: router.attrs.ID, ToCell: 'PinX', ToPart: '3' },
    { FromSheet: conn.attrs.ID, FromCell: 'EndX', FromPart: '12', ToSheet: box.attrs.ID, ToCell: 'PinX', ToPart: '3' },
  ]);
  assert.equal(kids(sections(conn, 'Geometry')[0], 'Row').length, 5, 'all bends preserved');
  assert.equal(V(conn, 'TextBkgnd'), '#FFFFFF');
  // unglued / unknown targets: no formula, no Connect
  const loose = open(VsdxWriter.build(oneShapeIR({ id: 1, kind: 'connector', points: [[0, 0], [1, 1]], from: 42, to: null })));
  const ls = allShapes(loose.pages[0].xml)[0];
  assert.equal(cells(ls).BeginX.F, undefined);
  assert.equal(kid(loose.pages[0].xml, 'Connects'), undefined);
  assert.equal(V(ls, 'ShapeRouteStyle'), '2', 'free (diagonal) route -> straight style');
});

test('user cells: Port item markers on shapes, text and connectors; owners follow renumbered IDs', () => {
  const ir = oneShapeIR(null);
  ir.pages[0].shapes = [
    multiStyleShape({ id: 'a', user: { PortKind: 'node', PortType: 'router', PortProps: '{"ports":[[0,0.5,"Gi0/1"]]}' } }), // a group: its members take IDs too
    { id: 'b', kind: 'shape', name: 'Zone', x: 0, y: 5, w: 4, h: 3, geoms: [{ closed: true, fill: '#eef', stroke: '#99a', weight: 1, points: rect(0, 0, 4, 3) }], user: { PortKind: 'zone', PortType: null } },
    { id: 'c', kind: 'connector', points: [[2, 2], [2, 5]], from: 'a', to: 'b', user: { PortKind: 'edge', PortProps: '{"linkType":"fiber10g"}' } },
    { id: 'd', kind: 'text', x: 3, y: 5, w: 2, h: 0.3, text: 'VLAN 10', user: { PortKind: 'auto', PortOwner: 'b' } },
    { id: 'e', kind: 'text', x: 2, y: 3, w: 1, h: 0.3, text: 'Gi0/1', user: { PortKind: 'auto', PortOwner: 'c' } },
  ];
  const pkg = open(VsdxWriter.build(ir)), shapes = kids(kid(pkg.pages[0].xml, 'Shapes'), 'Shape');
  const user = (sh) => Object.fromEntries(kids(sections(sh, 'User')[0] || { children: [] }, 'Row').map((r) => [r.attrs.N, V(r, 'Value')]));
  const [router, zone, conn, cap, port] = shapes;
  assert.deepEqual(user(router), { PortKind: 'node', PortType: 'router', PortProps: '{"ports":[[0,0.5,"Gi0/1"]]}' });
  assert.deepEqual(user(zone), { PortKind: 'zone' }, 'empty values are left out');
  assert.equal(user(conn).PortKind, 'edge');
  assert.notEqual(zone.attrs.ID, '2', 'the group\'s members shifted the numbering');
  assert.equal(user(cap).PortOwner, zone.attrs.ID, 'owner is the zone\'s Visio ID, not its IR id');
  assert.equal(user(port).PortOwner, conn.attrs.ID, 'connectors can own text too');
  for (const sh of [router, zone, conn, cap]) for (const r of kids(sections(sh, 'User')[0], 'Row')) assert.equal(cells(r).Value.U, 'STR');
});

test('text-only shape: fill/stroke box, alignment, valign, padding', () => {
  const t = { id: 1, kind: 'text', x: 2, y: 1, w: 3, h: 1, text: 'Hello', textColor: 'rgb(255, 0, 0)', textSize: 12, align: 'right', valign: 'top', fill: '#fffbe6', stroke: '#e0c060', underline: true };
  const sh = allShapes(open(VsdxWriter.build(oneShapeIR(t))).pages[0].xml)[0];
  assert.equal(V(sh, 'FillForegnd'), '#FFFBE6'); assert.equal(V(sh, 'LineColor'), '#E0C060');
  assert.equal(V(sh, 'VerticalAlign'), '0');
  assert.equal(V(kids(sections(sh, 'Paragraph')[0], 'Row')[0], 'HorzAlign'), '2');
  const ch = kids(sections(sh, 'Character')[0], 'Row')[0];
  assert.equal(V(ch, 'Color'), '#FF0000'); assert.equal(V(ch, 'Style'), '4'); near(V(ch, 'Size'), 12 / 72);
  near(V(sh, 'LeftMargin'), 3 / 72);
  const g = sections(sh, 'Geometry')[0];
  assert.equal(V(g, 'NoFill'), '0'); assert.equal(V(g, 'NoLine'), '0');
  const plain = allShapes(open(VsdxWriter.build(oneShapeIR({ id: 1, kind: 'text', x: 0, y: 0, w: 1, h: 1, text: 'x' }))).pages[0].xml)[0];
  assert.equal(V(plain, 'LinePattern'), '0'); assert.equal(V(plain, 'FillPattern'), '0');
});

test('document properties and determinism', () => {
  const a = VsdxWriter.build(fullIR());
  const b = VsdxWriter.build(fullIR());
  assert.deepEqual(Buffer.from(a), Buffer.from(b), 'same IR + created date -> identical bytes');
  const pkg = open(a);
  const core = pkg.xml('docProps/core.xml');
  assert.equal(textContent(kid(core, 'dc:title')), 'Network <architecture> & "more"');
  assert.equal(textContent(kid(core, 'dc:creator')), 'Tester');
  assert.equal(textContent(kid(core, 'dc:description')), 'desc');
  assert.equal(textContent(kid(core, 'dcterms:created')), '2026-01-02T03:04:05Z');
  assert.equal(kid(core, 'dcterms:created').attrs['xsi:type'], 'dcterms:W3CDTF');
  const app = pkg.xml('docProps/app.xml');
  assert.equal(textContent(kid(app, 'Company')), 'ACME & Co');
  const titles = kid(kid(app, 'TitlesOfParts'), 'vt:vector');
  assert.equal(titles.attrs.size, '2');
  assert.deepEqual(kids(titles, 'vt:lpstr').map(textContent), ['Logical architecture', 'Background']);
});

test('number formatting helper', () => {
  const { fmt } = VsdxWriter._internal;
  assert.equal(fmt(1e-12), '0'); assert.equal(fmt(-0), '0'); assert.equal(fmt(NaN), '0'); assert.equal(fmt(Infinity), '0');
  assert.equal(fmt(0.1 + 0.2), '0.3'); assert.equal(fmt(10), '10'); assert.equal(fmt(-2.50), '-2.5'); assert.equal(fmt(1e21), '1000000000000');
  assert.equal(fmt(0.75 / 72), '0.0104166667');
});
