/*
 * Port Network Studio v3 - Microsoft Visio (.vsdx) export writer.
 *
 * Pure vanilla JS, no dependencies, works as a classic browser script and as a
 * Node module. Takes the flattened drawing IR produced by the editor (lengths in
 * inches, page origin top-left, Y down) and returns the bytes of a Visio 2013+
 * OPC package (Visio 2012 XML namespace).
 *
 *   const bytes = VsdxWriter.build(ir);            // Uint8Array
 *   const zipBytes = VsdxWriter.zip([{name, data}]); // STORE-only ZIP
 *   const c = VsdxWriter.crc32(bytesOrString);
 */
const VsdxWriter = (() => {
  'use strict';

  const VERSION = '3.0.0';

  /* ------------------------------------------------------------------ */
  /* Namespaces, relationship types, content types                       */
  /* ------------------------------------------------------------------ */
  const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const REL = {
    document: 'http://schemas.microsoft.com/visio/2010/relationships/document',
    pages: 'http://schemas.microsoft.com/visio/2010/relationships/pages',
    page: 'http://schemas.microsoft.com/visio/2010/relationships/page',
    windows: 'http://schemas.microsoft.com/visio/2010/relationships/windows',
    core: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
    app: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
    image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  };
  const CT = {
    rels: 'application/vnd.openxmlformats-package.relationships+xml',
    xml: 'application/xml',
    document: 'application/vnd.ms-visio.drawing.main+xml',
    pages: 'application/vnd.ms-visio.pages+xml',
    page: 'application/vnd.ms-visio.page+xml',
    windows: 'application/vnd.ms-visio.windows+xml',
    core: 'application/vnd.openxmlformats-package.core-properties+xml',
    app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  };
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  /* IR arrow names -> Visio line-end indices (BeginArrow / EndArrow cells). */
  const ARROWS = {
    none: 0,
    arrow: 13,        // filled triangular arrowhead
    openArrow: 1,     // open "V" (two strokes)
    dot: 10,          // filled circle
    circle: 20,       // open (unfilled) circle
    diamond: 22,      // diamond (Visio's built-in set 0-45 has only an open diamond)
    // extra aliases accepted
    filledArrow: 13, triangle: 4, openTriangle: 14, classic: 5,
    openCircle: 20, openDiamond: 22, filledCircle: 10, square: 11, openSquare: 21,
    bar: 24, tee: 24,  // perpendicular bar at the line end
  };
  /* IR dash code -> Visio LinePattern (1 solid, 2 dash, 3 dot, 4 dash-dot). */
  const DASH_PATTERNS = [1, 2, 3, 4];

  const PT = 1 / 72; // inches per point
  const EPS = 1e-9;

  /* ------------------------------------------------------------------ */
  /* Small utilities                                                    */
  /* ------------------------------------------------------------------ */
  const enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;

  function utf8(s) {
    if (enc) return enc.encode(s);
    // Fallback (very old engines): manual UTF-8 encoding.
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function toNum(v, d) {
    const n = Number(v);
    return (v === null || v === undefined || v === '' || !isFinite(n)) ? d : n;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(toNum(v, 0), 0, 1); }

  /* Format a number for a V attribute: fixed decimals, no exponent, no NaN, '.' decimal. */
  function fmt(v, digits) {
    let n = Number(v);
    if (!isFinite(n)) n = 0;
    if (n > 1e12) n = 1e12; else if (n < -1e12) n = -1e12;
    let s = n.toFixed(digits === undefined ? 10 : digits);
    if (s.indexOf('.') !== -1) s = s.replace(/\.?0+$/, '');
    if (s === '-0' || s === '' || s === '-') s = '0';
    return s;
  }

  /* Remove characters that are not allowed in XML 1.0 (controls, lone surrogates, U+FFFE/F). */
  function clean(s) {
    s = (s === null || s === undefined) ? '' : String(s);
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/.test(s)) return s;
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { out += s[i] + s[i + 1]; i++; }
        continue;
      }
      if (c >= 0xDC00 && c <= 0xDFFF) continue;
      if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) continue;
      if (c === 0xFFFE || c === 0xFFFF) continue;
      out += s[i];
    }
    return out;
  }
  function escText(s) {
    return clean(s).replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return clean(s).replace(/\r\n?/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
  }

  const NAMED_COLORS = {
    black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', gray: '808080',
    grey: '808080', orange: 'FFA500', yellow: 'FFFF00', silver: 'C0C0C0', navy: '000080', teal: '008080',
    purple: '800080', maroon: '800000', lime: '00FF00', aqua: '00FFFF', cyan: '00FFFF', magenta: 'FF00FF',
    fuchsia: 'FF00FF', olive: '808000',
  };
  /* Parse a CSS-ish colour. Returns {hex:'#RRGGBB', alpha} or null for none/transparent. */
  function parseColor(c) {
    if (c === null || c === undefined || c === false) return null;
    const s = String(c).trim().toLowerCase();
    if (!s || s === 'none' || s === 'transparent') return null;
    if (s[0] === '#') {
      let h = s.slice(1);
      if (/^[0-9a-f]{3,4}$/.test(h)) h = h.split('').map((ch) => ch + ch).join('');
      if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) {
        return { hex: '#' + h.slice(0, 6).toUpperCase(), alpha: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
      }
      return { hex: '#000000', alpha: 1 };
    }
    const m = /^rgba?\(([^)]*)\)$/.exec(s);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      const chan = (t) => {
        if (t === undefined) return 0;
        const v = t.slice(-1) === '%' ? parseFloat(t) * 2.55 : parseFloat(t);
        return clamp(Math.round(toNum(v, 0)), 0, 255);
      };
      let a = 1;
      if (p[3] !== undefined) a = p[3].slice(-1) === '%' ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      const hex = '#' + [0, 1, 2].map((i) => (chan(p[i]) + 256).toString(16).slice(1)).join('').toUpperCase();
      return { hex, alpha: clamp01(toNum(a, 1)) };
    }
    if (NAMED_COLORS[s]) return { hex: '#' + NAMED_COLORS[s], alpha: 1 };
    return { hex: '#000000', alpha: 1 };
  }

  function arrowIndex(a) {
    if (a === null || a === undefined || a === false) return 0;
    if (typeof a === 'number') return (a >= 0 && a <= 45) ? Math.round(a) : 0;
    const k = String(a);
    if (Object.prototype.hasOwnProperty.call(ARROWS, k)) return ARROWS[k];
    const lk = k.toLowerCase().replace(/[\s_-]/g, '');
    for (const key in ARROWS) if (key.toLowerCase() === lk) return ARROWS[key];
    return 0;
  }
  function linePattern(d) {
    if (d === null || d === undefined || d === false || d === 0) return 1;
    if (d === true) return 2;
    if (typeof d === 'number') return DASH_PATTERNS[Math.round(d)] || 1;
    const s = String(d).toLowerCase();
    if (/^\d+$/.test(s)) return DASH_PATTERNS[+s] || 1;
    if (s.indexOf('dot') !== -1 && s.indexOf('dash') !== -1) return 4;
    if (s.indexOf('dot') !== -1) return 3;
    if (s.indexOf('dash') !== -1) return 2;
    return 1;
  }

  function normPoints(pts) {
    const out = [];
    if (!pts || typeof pts.length !== 'number') return out;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let x, y;
      if (Array.isArray(p) || (p && typeof p.length === 'number')) { x = Number(p[0]); y = Number(p[1]); }
      else if (p && typeof p === 'object') { x = Number(p.x); y = Number(p.y); }
      else continue;
      if (!isFinite(x) || !isFinite(y)) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - x) < EPS && Math.abs(last[1] - y) < EPS) continue;
      out.push([x, y]);
    }
    return out;
  }

  function bboxOf(pts, margin) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    const m = margin || 0;
    return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  }
  function overlaps(a, b) { return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1; }

  /* bytes from Uint8Array | ArrayBuffer | number[] | base64 string | data: URL */
  function toBytes(d) {
    if (d === null || d === undefined) return new Uint8Array(0);
    if (d instanceof Uint8Array) return d;
    if (typeof ArrayBuffer !== 'undefined') {
      if (d instanceof ArrayBuffer) return new Uint8Array(d);
      if (ArrayBuffer.isView && ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    }
    if (Array.isArray(d)) return Uint8Array.from(d);
    if (typeof d === 'string') {
      const comma = d.indexOf(',');
      const b64 = /^data:/i.test(d) ? d.slice(comma + 1) : d;
      return b64decode(b64);
    }
    return new Uint8Array(0);
  }
  function b64decode(s) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lut = new Int16Array(128).fill(-1);
    for (let i = 0; i < 64; i++) lut[A.charCodeAt(i)] = i;
    lut[45] = 62; lut[95] = 63; // url-safe '-' '_'
    const out = [];
    let buf = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const v = c < 128 ? lut[c] : -1;
      if (v < 0) continue;
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
    }
    return Uint8Array.from(out);
  }
  function sniffMime(bytes, mime) {
    const m = String(mime || '').toLowerCase();
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (m === 'image/jpg') return 'image/jpeg';
    return m;
  }
  const IMAGE_TYPES = {
    'image/png': { ext: 'png', compression: 'PNG' },
    'image/jpeg': { ext: 'jpeg', compression: 'JPEG' },
    'image/gif': { ext: 'gif', compression: 'GIF' },
  };

  /* ------------------------------------------------------------------ */
  /* CRC-32 + STORE-only ZIP writer                                      */
  /* ------------------------------------------------------------------ */
  let CRC_TABLE = null;
  function crc32(data) {
    const bytes = typeof data === 'string' ? utf8(data) : toBytes(data);
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    const d = (date instanceof Date && !isNaN(date)) ? date : new Date();
    let y = d.getFullYear();
    if (y < 1980) return { time: 0, date: (1 << 5) | 1 };
    if (y > 2107) y = 2107;
    return {
      time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
      date: (((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
    };
  }

  /* zip(files:[{name, data:Uint8Array|string}], opts?:{date}) -> Uint8Array (method 0 STORE). */
  function zip(files, opts) {
    const dt = dosDateTime(opts && opts.date);
    const entries = [];
    let localSize = 0, centralSize = 0;
    for (const f of files || []) {
      const nameBytes = utf8(String(f.name).replace(/\\/g, '/').replace(/^\/+/, ''));
      const data = typeof f.data === 'string' ? utf8(f.data) : toBytes(f.data);
      const e = { nameBytes, data, crc: crc32(data), offset: localSize };
      entries.push(e);
      localSize += 30 + nameBytes.length + data.length;
      centralSize += 46 + nameBytes.length;
    }
    if (entries.length > 0xFFFF || localSize + centralSize > 0xFFFFFFFF) throw new Error('VsdxWriter.zip: archive too large (ZIP64 not supported)');
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let p = 0;
    const FLAGS = 0x0800; // bit 11: names are UTF-8
    for (const e of entries) {
      view.setUint32(p, 0x04034B50, true);
      view.setUint16(p + 4, 20, true);          // version needed 2.0
      view.setUint16(p + 6, FLAGS, true);
      view.setUint16(p + 8, 0, true);           // STORE
      view.setUint16(p + 10, dt.time, true);
      view.setUint16(p + 12, dt.date, true);
      view.setUint32(p + 14, e.crc, true);
      view.setUint32(p + 18, e.data.length, true);
      view.setUint32(p + 22, e.data.length, true);
      view.setUint16(p + 26, e.nameBytes.length, true);
      view.setUint16(p + 28, 0, true);
      out.set(e.nameBytes, p + 30);
      out.set(e.data, p + 30 + e.nameBytes.length);
      p += 30 + e.nameBytes.length + e.data.length;
    }
    const cdStart = p;
    for (const e of entries) {
      view.setUint32(p, 0x02014B50, true);
      view.setUint16(p + 4, 20, true);          // version made by (MS-DOS, 2.0)
      view.setUint16(p + 6, 20, true);          // version needed
      view.setUint16(p + 8, FLAGS, true);
      view.setUint16(p + 10, 0, true);
      view.setUint16(p + 12, dt.time, true);
      view.setUint16(p + 14, dt.date, true);
      view.setUint32(p + 16, e.crc, true);
      view.setUint32(p + 20, e.data.length, true);
      view.setUint32(p + 24, e.data.length, true);
      view.setUint16(p + 28, e.nameBytes.length, true);
      view.setUint16(p + 30, 0, true);          // extra
      view.setUint16(p + 32, 0, true);          // comment
      view.setUint16(p + 34, 0, true);          // disk
      view.setUint16(p + 36, 0, true);          // internal attrs
      view.setUint32(p + 38, 0, true);          // external attrs
      view.setUint32(p + 42, e.offset, true);
      out.set(e.nameBytes, p + 46);
      p += 46 + e.nameBytes.length;
    }
    view.setUint32(p, 0x06054B50, true);
    view.setUint16(p + 4, 0, true);
    view.setUint16(p + 6, 0, true);
    view.setUint16(p + 8, entries.length, true);
    view.setUint16(p + 10, entries.length, true);
    view.setUint32(p + 12, p - cdStart, true);
    view.setUint32(p + 16, cdStart, true);
    view.setUint16(p + 20, 0, true);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* ShapeSheet XML helpers                                              */
  /* ------------------------------------------------------------------ */
  /* Numeric cell. */
  function cN(n, v, u, f) {
    return '<Cell N="' + n + '" V="' + fmt(v) + '"' + (u ? ' U="' + u + '"' : '') + (f ? ' F="' + escAttr(f) + '"' : '') + '/>';
  }
  /* String cell (colour, font, text values). */
  function cS(n, v, u, f) {
    return '<Cell N="' + n + '" V="' + escAttr(v) + '"' + (u ? ' U="' + u + '"' : '') + (f ? ' F="' + escAttr(f) + '"' : '') + '/>';
  }
  function bool(b) { return b ? 1 : 0; }

  /* Visio row names must be identifiers: ASCII letters/digits/underscore, not starting with a digit. */
  function rowName(label, used, fallback) {
    let s = clean(label);
    if (s.normalize) s = s.normalize('NFKD');
    s = s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = fallback;
    if (/^[0-9]/.test(s)) s = 'P_' + s;
    if (s.length > 60) s = s.slice(0, 60);
    let name = s, i = 2;
    while (used[name.toLowerCase()]) name = s + '_' + (i++);
    used[name.toLowerCase()] = true;
    return name;
  }

  /* ------------------------------------------------------------------ */
  /* Text                                                                */
  /* ------------------------------------------------------------------ */
  function charEm(ch) {
    const c = ch.charCodeAt(0);
    if (ch === ' ') return 0.29;
    if ('iljI.,:;|!\'`'.indexOf(ch) !== -1) return 0.28;
    if ('ftr()[]{}-/\\"*'.indexOf(ch) !== -1) return 0.39;
    if ('mwMW@%'.indexOf(ch) !== -1) return 0.88;
    if (c >= 65 && c <= 90) return 0.66;
    if (c >= 48 && c <= 57) return 0.58;
    if (c >= 0x2E80) return 1.0;
    return 0.57;
  }
  function measure(ti) {
    let maxEm = 0;
    for (const line of ti.lines) {
      let em = 0;
      for (const ch of line) em += charEm(ch);
      if (em > maxEm) maxEm = em;
    }
    const k = (ti.bold ? 1.07 : 1) * ti.size * PT;
    return { w: maxEm * k, h: ti.lines.length * ti.size * 1.2 * PT };
  }

  const HALIGN = { left: 0, start: 0, center: 1, middle: 1, right: 2, end: 2, justify: 3 };
  const VALIGN = { top: 0, middle: 1, center: 1, bottom: 2 };

  function textInfo(o) {
    if (o.text === null || o.text === undefined) return null;
    const text = clean(String(o.text)).replace(/\r\n?/g, '\n');
    if (!text.length) return null;
    const col = parseColor(o.textColor) || { hex: '#000000', alpha: 1 };
    const a = String(o.align || 'center').toLowerCase();
    const va = String(o.valign || o.verticalAlign || 'middle').toLowerCase();
    return {
      text,
      lines: text.split('\n'),
      size: clamp(toNum(o.textSize, 9), 1, 1600),
      color: col.hex,
      colorTrans: 1 - col.alpha,
      bold: !!o.bold,
      italic: !!o.italic,
      underline: !!o.underline,
      font: clean(o.font || 'Segoe UI') || 'Segoe UI',
      align: HALIGN[a] !== undefined ? HALIGN[a] : 1,
      valign: VALIGN[va] !== undefined ? VALIGN[va] : 1,
      padding: toNum(o.padding, null),
    };
  }

  /*
   * Widen a text box (shape-local, Y down) so Visio does not wrap lines that the
   * editor shows on one line (font metrics differ slightly). mode 'grow' always
   * fits the longest explicit line; 'tolerant' only fixes small overflows so
   * deliberately wrapped text blocks keep wrapping.
   */
  function fitBox(ti, box, mode, padIn) {
    const m = measure(ti);
    let x = box.x, w = box.w;
    const need = m.w * 1.1 + 2 * padIn + 0.04;
    if (need > w && (mode === 'grow' || need <= w * 1.3 + 0.1)) {
      const dw = need - w;
      if (ti.align === 1 || ti.align === 3) x -= dw / 2;
      else if (ti.align === 2) x -= dw;
      w = need;
    }
    return { x, y: box.y, w, h: Math.max(box.h, 1e-4) };
  }

  /* Text transform + text block cells. box is Visio-local (Y up) {cx, cy, w, h}. */
  function textCells(ti, box, padIn, bkgnd, autoSize) {
    const out = [];
    out.push(cN('TxtPinX', box.cx), cN('TxtPinY', box.cy));
    // autoSize: label box follows text edits in Visio (like the Dynamic connector master).
    out.push(cN('TxtWidth', box.w, null, autoSize ? 'TEXTWIDTH(TheText)' : null),
      cN('TxtHeight', box.h, null, autoSize ? 'TEXTHEIGHT(TheText,TxtWidth)' : null));
    out.push(cN('TxtLocPinX', box.w / 2, null, 'TxtWidth*0.5'), cN('TxtLocPinY', box.h / 2, null, 'TxtHeight*0.5'), cN('TxtAngle', 0));
    out.push(cN('LeftMargin', padIn, 'PT'), cN('RightMargin', padIn, 'PT'), cN('TopMargin', padIn, 'PT'), cN('BottomMargin', padIn, 'PT'));
    out.push(cN('VerticalAlign', ti.valign));
    if (bkgnd) out.push(cS('TextBkgnd', bkgnd), cN('TextBkgndTrans', 0));
    else out.push(cN('TextBkgnd', 0));
    return out.join('');
  }
  function textSections(ti) {
    const style = (ti.bold ? 1 : 0) | (ti.italic ? 2 : 0) | (ti.underline ? 4 : 0);
    return '<Section N="Character"><Row IX="0">' +
      cS('Font', ti.font) + cS('Color', ti.color) + cN('Style', style) + cN('Case', 0) + cN('Pos', 0) +
      cN('FontScale', 1) + cN('Size', ti.size * PT, 'PT') + cN('DblUnderline', 0) + cN('Overline', 0) +
      cN('Strikethru', 0) + cN('Letterspace', 0) + cN('ColorTrans', clamp01(ti.colorTrans)) +
      '</Row></Section>' +
      '<Section N="Paragraph"><Row IX="0">' +
      cN('IndFirst', 0) + cN('IndLeft', 0) + cN('IndRight', 0) + cN('SpLine', -1.2, 'PER') + cN('SpBefore', 0) +
      cN('SpAfter', 0) + cN('HorzAlign', ti.align) + cN('Bullet', 0) + cN('Flags', 0) +
      '</Row></Section>';
  }
  function textElement(ti) {
    return '<Text><cp IX="0"/><pp IX="0"/>' + escText(ti.text) + '</Text>';
  }

  /* ------------------------------------------------------------------ */
  /* Shape Data, hyperlinks, layers                                      */
  /* ------------------------------------------------------------------ */
  function propSection(data) {
    if (!Array.isArray(data) || !data.length) return '';
    const used = {};
    const rows = [];
    data.forEach((d, i) => {
      if (!d) return;
      const label = clean(d.label !== undefined ? d.label : (d.name !== undefined ? d.name : ''));
      const value = d.value === null || d.value === undefined ? '' : String(d.value);
      const name = rowName(d.name || label, used, 'Prop' + (i + 1));
      rows.push('<Row N="' + escAttr(name) + '">' + cS('Value', value, 'STR') + cS('Label', label || name) +
        cN('Type', 0) + cN('Invisible', bool(d.invisible)) + cN('Verify', 0) + '</Row>');
    });
    return rows.length ? '<Section N="Property">' + rows.join('') + '</Section>' : '';
  }
  /* User cells: what the item was in the editor (zone, device type), read back when the file is imported again. */
  function userSection(user) {
    const rows = Object.entries(user || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => '<Row N="' + escAttr(k) + '">' + cS('Value', String(v), 'STR') + cS('Prompt', '') + '</Row>');
    return rows.length ? '<Section N="User">' + rows.join('') + '</Section>' : '';
  }
  function hyperlinkSection(h) {
    if (!h) return '';
    const list = Array.isArray(h) ? h : [h];
    const rows = [];
    list.forEach((it) => {
      const o = typeof it === 'string' ? { address: it } : (it || {});
      const addr = clean(o.address || o.url || o.href || '');
      const sub = clean(o.subAddress || '');
      if (!addr && !sub) return;
      rows.push('<Row N="Row_' + (rows.length + 1) + '">' + cS('Description', o.description || addr) + cS('Address', addr) +
        (sub ? cS('SubAddress', sub) : '') + cN('NewWindow', bool(o.newWindow)) + cN('Default', rows.length === 0 ? 1 : 0) +
        cN('Invisible', 0) + '</Row>');
    });
    return rows.length ? '<Section N="Hyperlink">' + rows.join('') + '</Section>' : '';
  }
  function layerCell(layers, count) {
    if (!Array.isArray(layers) || !count) return '';
    const seen = {};
    const ix = [];
    for (const l of layers) {
      const n = Math.round(Number(l));
      if (isFinite(n) && n >= 0 && n < count && !seen[n]) { seen[n] = true; ix.push(n); }
    }
    return ix.length ? cS('LayerMember', ix.join(';')) : '';
  }

  /* ------------------------------------------------------------------ */
  /* Geometry & style buckets                                            */
  /* ------------------------------------------------------------------ */
  function prepGeom(g) {
    const pts = normPoints(g && g.points);
    if (pts.length < 2) return null;
    const closed = !!g.closed && pts.length >= 3;
    const fc = closed ? parseColor(g.fill) : null;
    const sc = parseColor(g.stroke);
    const weight = toNum(g.weight, 0.75);
    const fill = fc ? { hex: fc.hex, trans: clamp01(1 - clamp01(toNum(g.fillOpacity, 1)) * fc.alpha) } : null;
    const line = (sc && weight > 0) ? {
      hex: sc.hex,
      trans: clamp01(1 - clamp01(toNum(g.strokeOpacity, 1)) * sc.alpha),
      weight,
      pattern: linePattern(g.dash),
    } : null;
    if (fill && fill.trans >= 0.999) return { pts, closed, fill: null, line, bb: bboxOf(pts, line ? weight * PT / 2 + 0.002 : 0.002) };
    return { pts, closed, fill, line, bb: bboxOf(pts, line ? weight * PT / 2 + 0.002 : 0.002) };
  }
  function fillKey(f) { return f.hex + '|' + fmt(f.trans, 4); }
  function lineKey(l) { return l.hex + '|' + fmt(l.trans, 4) + '|' + fmt(l.weight, 4) + '|' + l.pattern; }
  function compatible(b, g) {
    if (g.fill && b.fill && fillKey(g.fill) !== fillKey(b.fill)) return false;
    if (g.line && b.line && lineKey(g.line) !== lineKey(b.line)) return false;
    return true;
  }
  /*
   * Split a shape's geometries into style buckets (one Visio shape each), keeping
   * the visual stacking order: a geometry may only join an earlier bucket when it
   * does not overlap anything drawn in between, and never in a way that would put
   * an earlier outline above its fill (Visio paints a shape's fills before lines).
   */
  function bucketize(geoms) {
    const buckets = [];
    for (const g of geoms) {
      if (!g || (!g.fill && !g.line)) continue;
      let placed = false;
      for (let k = buckets.length - 1; k >= 0; k--) {
        const b = buckets[k];
        if (compatible(b, g)) {
          const conflict = g.fill && b.geoms.some((h) => h.line && overlaps(h.bb, g.bb));
          if (!conflict) {
            b.geoms.push(g);
            if (!b.fill && g.fill) b.fill = g.fill;
            if (!b.line && g.line) b.line = g.line;
            placed = true;
            break;
          }
        }
        if (b.geoms.some((h) => overlaps(h.bb, g.bb))) break;
      }
      if (!placed) buckets.push({ geoms: [g], fill: g.fill, line: g.line });
    }
    return buckets;
  }

  function lineFillCells(b) {
    const out = [];
    if (b.line) {
      out.push(cN('LineWeight', b.line.weight * PT, 'PT'), cS('LineColor', b.line.hex), cN('LinePattern', b.line.pattern),
        cN('LineColorTrans', b.line.trans), cN('LineCap', 0), cN('Rounding', 0));
    } else {
      out.push(cN('LinePattern', 0));
    }
    if (b.fill) {
      out.push(cS('FillForegnd', b.fill.hex), cN('FillForegndTrans', b.fill.trans), cS('FillBkgnd', b.fill.hex),
        cN('FillBkgndTrans', b.fill.trans), cN('FillPattern', 1));
    } else {
      out.push(cN('FillPattern', 0));
    }
    out.push(cN('ShdwPattern', 0));
    return out.join('');
  }

  /* One Geometry section. pts are shape-local IR coords (Y down); W,H shape size. */
  function geomSection(ix, pts, closed, noFill, noLine, W, H) {
    const p = pts.slice();
    if (closed) {
      const a = p[0], z = p[p.length - 1];
      if (Math.abs(a[0] - z[0]) > EPS || Math.abs(a[1] - z[1]) > EPS) p.push([a[0], a[1]]);
    }
    const rel = W > 1e-6 && H > 1e-6;
    let s = '<Section N="Geometry" IX="' + ix + '">' + cN('NoFill', bool(noFill)) + cN('NoLine', bool(noLine)) +
      cN('NoShow', 0) + cN('NoSnap', 0) + cN('NoQuickDrag', 0);
    for (let i = 0; i < p.length; i++) {
      const lx = p[i][0], ly = H - p[i][1];
      const t = (i === 0 ? 'MoveTo' : 'LineTo');
      s += '<Row T="' + (rel ? 'Rel' + t : t) + '" IX="' + (i + 1) + '">' +
        cN('X', rel ? lx / W : lx) + cN('Y', rel ? ly / H : ly) + '</Row>';
    }
    return s + '</Section>';
  }
  function bucketGeometry(b, W, H) {
    return b.geoms.map((g, i) => geomSection(i, g.pts, g.closed, !(g.fill && g.closed), !g.line, W, H)).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Per-page shape emission                                             */
  /* ------------------------------------------------------------------ */
  function xform2D(x, y, w, h, angleDeg, pageH) {
    let a = -toNum(angleDeg, 0) * Math.PI / 180;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) < 1e-12) a = 0;
    return cN('PinX', x + w / 2) + cN('PinY', pageH - (y + h / 2)) + cN('Width', w) + cN('Height', h) +
      cN('LocPinX', w / 2, null, 'Width*0.5') + cN('LocPinY', h / 2, null, 'Height*0.5') + cN('Angle', a) +
      cN('FlipX', 0) + cN('FlipY', 0) + cN('ResizeMode', 0);
  }

  function boxOf(s) {
    const x = toNum(s.x, 0), y = toNum(s.y, 0);
    const w = Math.max(0, toNum(s.w !== undefined ? s.w : s.width, 0));
    const h = Math.max(0, toNum(s.h !== undefined ? s.h : s.height, 0));
    return { x, y, w, h };
  }

  function shapeOpen(id, type, name) {
    const nm = name ? escAttr(name) : '';
    return '<Shape ID="' + id + '"' + (nm ? ' NameU="' + nm + '" IsCustomNameU="1" Name="' + nm + '" IsCustomName="1"' : '') +
      ' Type="' + type + '" LineStyle="0" FillStyle="0" TextStyle="0">';
  }

  function inferKind(s) {
    const k = String(s.kind || '').toLowerCase();
    if (k === 'shape' || k === 'connector' || k === 'text' || k === 'image') return k;
    if (k === 'line' || k === 'edge' || k === 'link') return 'connector';
    if (Array.isArray(s.points) && s.w === undefined) return 'connector';
    if (s.data && s.mime) return 'image';
    if (Array.isArray(s.geoms)) return 'shape';
    return 'text';
  }

  function uniqueName(ctx, base, id) {
    const b = clean(base).replace(/\s+/g, ' ').trim();
    if (!b) return '';
    const key = b.toLowerCase();
    if (!ctx.names[key]) { ctx.names[key] = true; return b; }
    let n = b + '.' + id, k = 2;
    while (ctx.names[n.toLowerCase()]) n = b + '.' + id + '_' + (k++);
    ctx.names[n.toLowerCase()] = true;
    return n;
  }

  /* Text box for a 2D element, returned in Visio local coords. */
  function textBoxLocal(ti, tb, H, mode, padIn) {
    const fb = fitBox(ti, tb, mode, padIn);
    return { cx: fb.x + fb.w / 2, cy: H - (fb.y + fb.h / 2), w: fb.w, h: fb.h };
  }

  function emitShape(ctx, item, pageH) {
    const s = item.ir;
    const { x, y, w, h } = item.box;
    const ti = textInfo(s);
    const padIn = ti && ti.padding !== null ? ti.padding * PT : 0;
    const layer = layerCell(s.layers, ctx.layerCount);
    const name = uniqueName(ctx, s.name || '', item.id);
    const buckets = item.buckets;
    const isGroup = buckets.length > 1;
    let out = shapeOpen(item.id, isGroup ? 'Group' : 'Shape', name);
    out += xform2D(x, y, w, h, s.angle, pageH);
    if (layer) out += layer;
    if (isGroup) {
      out += cN('SelectMode', 1) + cN('DisplayMode', 2) + cN('IsTextEditTarget', 1) + cN('LinePattern', 0) + cN('FillPattern', 0);
    } else if (buckets.length === 1) {
      out += lineFillCells(buckets[0]);
    } else {
      out += cN('LinePattern', 0) + cN('FillPattern', 0);
    }
    if (ti) {
      const tb = s.textBox ? boxOf(s.textBox) : { x: 0, y: 0, w, h };
      out += textCells(ti, textBoxLocal(ti, tb, h, 'grow', padIn), padIn, null);
    }
    out += propSection(s.data) + userSection(item.user || s.user) + hyperlinkSection(s.hyperlink);
    if (ti) out += textSections(ti);
    if (!isGroup) {
      if (buckets.length === 1) out += bucketGeometry(buckets[0], w, h);
      else out += geomSection(0, [[0, 0], [w, 0], [w, h], [0, h]], true, true, true, w, h); // invisible hit area
    }
    if (ti) out += textElement(ti);
    if (isGroup) {
      out += '<Shapes>';
      buckets.forEach((b, i) => {
        const gid = item.id;
        out += shapeOpen(item.memberIds[i], 'Shape', '');
        out += cN('PinX', w / 2, null, 'Sheet.' + gid + '!Width*0.5') + cN('PinY', h / 2, null, 'Sheet.' + gid + '!Height*0.5') +
          cN('Width', w, null, 'Sheet.' + gid + '!Width') + cN('Height', h, null, 'Sheet.' + gid + '!Height') +
          cN('LocPinX', w / 2, null, 'Width*0.5') + cN('LocPinY', h / 2, null, 'Height*0.5') + cN('Angle', 0) +
          cN('FlipX', 0) + cN('FlipY', 0) + cN('ResizeMode', 0);
        if (layer) out += layer;
        out += lineFillCells(b) + bucketGeometry(b, w, h) + '</Shape>';
      });
      out += '</Shapes>';
    }
    return out + '</Shape>';
  }

  function emitText(ctx, item, pageH) {
    const s = item.ir;
    const { x, y, w, h } = item.box;
    const ti = textInfo(s);
    const fc = parseColor(s.fill);
    const sc = parseColor(s.stroke);
    const weight = toNum(s.weight, 0.75);
    const b = {
      fill: fc ? { hex: fc.hex, trans: clamp01(1 - clamp01(toNum(s.fillOpacity, 1)) * fc.alpha) } : null,
      line: sc && weight > 0 ? { hex: sc.hex, trans: 1 - sc.alpha, weight, pattern: linePattern(s.dash) } : null,
    };
    const padPt = ti && ti.padding !== null ? ti.padding : ((b.fill || b.line) ? 3 : 0);
    const name = uniqueName(ctx, s.name || '', item.id);
    let out = shapeOpen(item.id, 'Shape', name) + xform2D(x, y, w, h, s.angle, pageH);
    const layer = layerCell(s.layers, ctx.layerCount);
    if (layer) out += layer;
    out += lineFillCells(b);
    if (ti) out += textCells(ti, textBoxLocal(ti, { x: 0, y: 0, w, h }, h, 'tolerant', padPt * PT), padPt * PT, null);
    out += propSection(s.data) + userSection(item.user || s.user) + hyperlinkSection(s.hyperlink);
    if (ti) out += textSections(ti);
    out += geomSection(0, [[0, 0], [w, 0], [w, h], [0, h]], true, !b.fill, !b.line, w, h);
    if (ti) out += textElement(ti);
    return out + '</Shape>';
  }

  function emitImage(ctx, item, pageH, pageCtx) {
    const s = item.ir;
    const { x, y, w, h } = item.box;
    const name = uniqueName(ctx, s.name || '', item.id);
    const layer = layerCell(s.layers, ctx.layerCount);
    const img = item.image;
    if (!img) {
      // Unsupported/empty image data: keep the footprint as a light placeholder box.
      return emitText(ctx, Object.assign({}, item, {
        ir: Object.assign({}, s, { kind: 'text', text: s.text || '', fill: '#F2F2F2', stroke: '#A6A6A6' }),
      }), pageH);
    }
    const rid = addPageImage(ctx, pageCtx, img);
    let out = shapeOpen(item.id, 'Foreign', name) + xform2D(x, y, w, h, s.angle, pageH);
    if (layer) out += layer;
    out += cN('ImgOffsetX', 0, null, 'ImgWidth*0') + cN('ImgOffsetY', 0, null, 'ImgHeight*0') +
      cN('ImgWidth', w, null, 'Width*1') + cN('ImgHeight', h, null, 'Height*1') + cN('LinePattern', 0) + cN('FillPattern', 0);
    out += propSection(s.data) + hyperlinkSection(s.hyperlink);
    out += geomSection(0, [[0, 0], [w, 0], [w, h], [0, h]], true, true, true, w, h);
    out += '<ForeignData ForeignType="Bitmap" CompressionType="' + img.compression + '"><Rel r:id="' + rid + '"/></ForeignData>';
    return out + '</Shape>';
  }

  function polylineMidpoint(P) {
    let total = 0;
    for (let i = 1; i < P.length; i++) total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    let half = total / 2;
    for (let i = 1; i < P.length; i++) {
      const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (L >= half && L > 0) {
        const t = half / L;
        return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t];
      }
      half -= L;
    }
    return P[Math.floor(P.length / 2)];
  }

  function emitConnector(ctx, item, pageH, connects) {
    const s = item.ir;
    // Visio page coordinates (Y up).
    const P = item.points.map((p) => [p[0], pageH - p[1]]);
    const B = P[0], E = P[P.length - 1];
    const W = E[0] - B[0], H = E[1] - B[1];
    const sc = parseColor(s.stroke) || { hex: '#000000', alpha: 1 };
    const weight = toNum(s.weight, 0.75);
    const ortho = P.every((p, i) => i === 0 || Math.abs(p[0] - P[i - 1][0]) < 1e-6 || Math.abs(p[1] - P[i - 1][1]) < 1e-6);
    const fromId = item.fromId, toId = item.toId;
    const ti = textInfo(s);
    const name = uniqueName(ctx, s.name || 'Dynamic connector', item.id);
    let out = shapeOpen(item.id, 'Shape', name);
    // Same cell pattern as Visio's Dynamic connector master: page-aligned local frame
    // (Angle 0), local origin at the begin point, Width/Height may be negative.
    out += cN('PinX', (B[0] + E[0]) / 2, null, 'GUARD((BeginX+EndX)/2)') + cN('PinY', (B[1] + E[1]) / 2, null, 'GUARD((BeginY+EndY)/2)') +
      cN('Width', W, null, 'GUARD(EndX-BeginX)') + cN('Height', H, null, 'GUARD(EndY-BeginY)') +
      cN('LocPinX', W / 2, null, 'GUARD(Width*0.5)') + cN('LocPinY', H / 2, null, 'GUARD(Height*0.5)') +
      cN('Angle', 0, null, 'GUARD(0DA)') + cN('FlipX', 0, null, 'GUARD(FALSE)') + cN('FlipY', 0, null, 'GUARD(FALSE)') +
      cN('ResizeMode', 0);
    out += cN('BeginX', B[0], null, fromId ? '_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)' : null) +
      cN('BeginY', B[1], null, fromId ? '_WALKGLUE(BegTrigger,EndTrigger,WalkPreference)' : null) +
      cN('EndX', E[0], null, toId ? '_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)' : null) +
      cN('EndY', E[1], null, toId ? '_WALKGLUE(EndTrigger,BegTrigger,WalkPreference)' : null);
    if (fromId) out += cN('BegTrigger', 2, null, '_XFTRIGGER(Sheet.' + fromId + '!EventXFMod)');
    if (toId) out += cN('EndTrigger', 2, null, '_XFTRIGGER(Sheet.' + toId + '!EventXFMod)');
    // Routing: keep the stored route (re-route only when Visio decides it must).
    out += cN('ObjType', 2) + cN('ShapeRouteStyle', ortho ? 1 : 2) + cN('ConLineRouteExt', 1) +
      cN('ConFixedCode', 1) + cN('NoAlignBox', 1);
    const layer = layerCell(s.layers, ctx.layerCount);
    if (layer) out += layer;
    out += cN('LineWeight', weight * PT, 'PT') + cS('LineColor', sc.hex) + cN('LinePattern', weight > 0 ? linePattern(s.dash) : 0) +
      cN('LineColorTrans', clamp01(1 - sc.alpha * clamp01(toNum(s.strokeOpacity, 1)))) + cN('LineCap', 0) + cN('Rounding', 0) +
      cN('BeginArrow', arrowIndex(s.beginArrow)) + cN('EndArrow', arrowIndex(s.endArrow)) +
      cN('BeginArrowSize', clamp(Math.round(toNum(s.arrowSize, 2)), 0, 6)) + cN('EndArrowSize', clamp(Math.round(toNum(s.arrowSize, 2)), 0, 6)) +
      cN('FillPattern', 0) + cN('ShdwPattern', 0);
    if (ti) {
      let L;
      if (Array.isArray(s.textPos) && isFinite(s.textPos[0]) && isFinite(s.textPos[1])) L = [Number(s.textPos[0]), pageH - Number(s.textPos[1])];
      else L = polylineMidpoint(P);
      const padIn = (ti.padding !== null ? ti.padding : 1.5) * PT;
      const m = measure(ti);
      const tw = m.w * 1.15 + 2 * padIn + 0.04, th = m.h + 2 * padIn;
      out += textCells(ti, { cx: L[0] - B[0], cy: L[1] - B[1], w: tw, h: th }, padIn, '#FFFFFF', true);
    }
    out += propSection(s.data) + userSection(s.user) + hyperlinkSection(s.hyperlink);
    if (ti) out += textSections(ti);
    let g = '<Section N="Geometry" IX="0">' + cN('NoFill', 1) + cN('NoLine', 0) + cN('NoShow', 0) + cN('NoSnap', 0) + cN('NoQuickDrag', 0);
    P.forEach((p, i) => {
      g += '<Row T="' + (i === 0 ? 'MoveTo' : 'LineTo') + '" IX="' + (i + 1) + '">' + cN('X', p[0] - B[0]) + cN('Y', p[1] - B[1]) + '</Row>';
    });
    out += g + '</Section>';
    if (ti) out += textElement(ti);
    out += '</Shape>';
    if (fromId) connects.push('<Connect FromSheet="' + item.id + '" FromCell="BeginX" FromPart="9" ToSheet="' + fromId + '" ToCell="PinX" ToPart="3"/>');
    if (toId) connects.push('<Connect FromSheet="' + item.id + '" FromCell="EndX" FromPart="12" ToSheet="' + toId + '" ToCell="PinX" ToPart="3"/>');
    return out;
  }

  function addPageImage(ctx, pageCtx, img) {
    let media = ctx.mediaByKey[img.key];
    if (!media) {
      const n = ctx.media.length + 1;
      media = { file: 'image' + n + '.' + img.ext, bytes: img.bytes, ext: img.ext, mime: img.mime };
      ctx.media.push(media);
      ctx.mediaByKey[img.key] = media;
    }
    if (!pageCtx.relByFile[media.file]) {
      const rid = 'rId' + (pageCtx.rels.length + 1);
      pageCtx.rels.push({ id: rid, type: REL.image, target: '../media/' + media.file });
      pageCtx.relByFile[media.file] = rid;
    }
    return pageCtx.relByFile[media.file];
  }

  /* Build PageContents XML for one page. */
  function buildPage(ctx, page, pageCtx) {
    const pageH = page.height;
    const shapesIn = Array.isArray(page.ir.shapes) ? page.ir.shapes : [];
    // Pass 1: classify + assign unique IDs (group members included).
    let nextId = 1;
    const items = [];
    const idMap = {};
    const anyId = {};
    for (const s of shapesIn) {
      if (!s || typeof s !== 'object') continue;
      const kind = inferKind(s);
      const item = { ir: s, kind };
      if (kind === 'connector') {
        item.points = normPoints(s.points);
        if (item.points.length < 2) continue;
      } else {
        item.box = boxOf(s);
        if (kind === 'shape') {
          item.buckets = bucketize((Array.isArray(s.geoms) ? s.geoms : []).map(prepGeom));
        } else if (kind === 'image') {
          const bytes = toBytes(s.data);
          const mime = sniffMime(bytes, s.mime);
          const t = IMAGE_TYPES[mime];
          if (t && bytes.length) item.image = { bytes, mime, ext: t.ext, compression: t.compression, key: mime + ':' + bytes.length + ':' + crc32(bytes) };
        }
      }
      item.id = nextId++;
      if (kind === 'shape' && item.buckets.length > 1) item.memberIds = item.buckets.map(() => nextId++);
      if (kind !== 'connector' && s.id !== undefined && s.id !== null && idMap[String(s.id)] === undefined) idMap[String(s.id)] = item.id;
      if (s.id !== undefined && s.id !== null && anyId[String(s.id)] === undefined) anyId[String(s.id)] = item.id;
      items.push(item);
    }
    // User.PortOwner names another IR shape: point it at that shape's Visio ID.
    for (const it of items) {
      const u = it.ir.user;
      if (u && u.PortOwner !== undefined && u.PortOwner !== null) it.user = Object.assign({}, u, { PortOwner: anyId[String(u.PortOwner)] });
    }
    for (const it of items) {
      if (it.kind !== 'connector') continue;
      const f = it.ir.from, t = it.ir.to;
      it.fromId = (f !== null && f !== undefined) ? (idMap[String(f)] || 0) : 0;
      it.toId = (t !== null && t !== undefined) ? (idMap[String(t)] || 0) : 0;
    }
    // Pass 2: emit.
    const connects = [];
    const body = [];
    ctx.names = {};
    ctx.layerCount = page.layers.length;
    for (const it of items) {
      if (it.kind === 'connector') body.push(emitConnector(ctx, it, pageH, connects));
      else if (it.kind === 'shape') body.push(emitShape(ctx, it, pageH));
      else if (it.kind === 'image') body.push(emitImage(ctx, it, pageH, pageCtx));
      else body.push(emitText(ctx, it, pageH));
    }
    let xml = XML_DECL + '<PageContents xmlns="' + NS + '" xmlns:r="' + NS_R + '" xml:space="preserve">';
    if (body.length) xml += '<Shapes>' + body.join('') + '</Shapes>';
    if (connects.length) xml += '<Connects>' + connects.join('') + '</Connects>';
    xml += '</PageContents>';
    pageCtx.shapeCount = nextId - 1;
    return xml;
  }

  /* ------------------------------------------------------------------ */
  /* Document-level parts                                                */
  /* ------------------------------------------------------------------ */
  const PAPER = [ // [w, h, PaperKind] inches, portrait
    [8.5, 11, 1], [11, 17, 3], [8.5, 14, 5], [11.69, 16.54, 8], [8.27, 11.69, 9], [5.83, 8.27, 11],
  ];
  function paperKind(w, h) {
    const a = Math.min(w, h), b = Math.max(w, h);
    for (const p of PAPER) if (Math.abs(p[0] - a) < 0.06 && Math.abs(p[1] - b) < 0.06) return p[2];
    return 0;
  }

  function pageSheetXml(page) {
    const w = page.width, h = page.height;
    let s = '<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">' +
      cN('PageWidth', w, 'IN') + cN('PageHeight', h, 'IN') + cN('ShdwOffsetX', 0.125) + cN('ShdwOffsetY', -0.125) +
      cN('PageScale', 1, 'IN_F') + cN('DrawingScale', 1, 'IN_F') + cN('DrawingSizeType', 3) + cN('DrawingScaleType', 0) +
      cN('InhibitSnap', 0) + cN('PageLockReplace', 0, 'BOOL') + cN('PageLockDuplicate', 0, 'BOOL') + cN('UIVisibility', 0) +
      cN('ShdwType', 0) + cN('ShdwObliqueAngle', 0) + cN('ShdwScaleFactor', 1) + cN('DrawingResizeType', 1) +
      cN('PageShapeSplit', 1) + cN('PrintPageOrientation', w > h ? 2 : 1);
    const pk = paperKind(w, h);
    if (pk) s += cN('PaperKind', pk);
    if (page.layers.length) {
      s += '<Section N="Layer">';
      page.layers.forEach((l, i) => {
        s += '<Row IX="' + i + '">' + cS('Name', l.name) + cN('Color', 255) + cN('Status', 0) + cN('Visible', bool(l.visible)) +
          cN('Print', bool(l.print)) + cN('Active', 0) + cN('Lock', bool(l.locked)) + cN('Snap', 1) + cN('Glue', 1) +
          cS('NameUniv', l.name) + cN('ColorTrans', 0) + '</Row>';
      });
      s += '</Section>';
    }
    return s + '</PageSheet>';
  }

  function styleSheetsXml() {
    return '<StyleSheets>' +
      '<StyleSheet ID="0" NameU="No Style" IsCustomNameU="1" Name="No Style" IsCustomName="1">' +
      cN('EnableLineProps', 1) + cN('EnableFillProps', 1) + cN('EnableTextProps', 1) + cN('HideForApply', 0) +
      cN('LineWeight', 0.75 * PT, 'PT') + cS('LineColor', '#000000') + cN('LinePattern', 1) + cN('Rounding', 0) +
      cN('EndArrowSize', 2) + cN('BeginArrow', 0) + cN('EndArrow', 0) + cN('LineCap', 0) + cN('BeginArrowSize', 2) +
      cN('LineColorTrans', 0) + cN('CompoundType', 0) +
      cS('FillForegnd', '#FFFFFF') + cS('FillBkgnd', '#000000') + cN('FillPattern', 1) + cS('ShdwForegnd', '#000000') +
      cN('ShdwPattern', 0) + cN('FillForegndTrans', 0) + cN('FillBkgndTrans', 0) + cN('ShdwForegndTrans', 0) +
      cN('ShapeShdwType', 0) + cN('ShapeShdwOffsetX', 0) + cN('ShapeShdwOffsetY', 0) + cN('ShapeShdwObliqueAngle', 0) +
      cN('ShapeShdwScaleFactor', 1) + cN('ShapeShdwBlur', 0) + cN('ShapeShdwShow', 0) +
      cN('LeftMargin', 0, 'PT') + cN('RightMargin', 0, 'PT') + cN('TopMargin', 0, 'PT') + cN('BottomMargin', 0, 'PT') +
      cN('VerticalAlign', 1) + cN('TextBkgnd', 0) + cN('DefaultTabStop', 0.5) + cN('TextDirection', 0) + cN('TextBkgndTrans', 0) +
      '<Section N="Character"><Row IX="0">' + cS('Font', 'Calibri') + cS('Color', '#000000') + cN('Style', 0) + cN('Case', 0) +
      cN('Pos', 0) + cN('FontScale', 1) + cN('Size', 12 * PT, 'PT') + cN('DblUnderline', 0) + cN('Overline', 0) +
      cN('Strikethru', 0) + cN('Letterspace', 0) + cN('ColorTrans', 0) + '</Row></Section>' +
      '<Section N="Paragraph"><Row IX="0">' + cN('IndFirst', 0) + cN('IndLeft', 0) + cN('IndRight', 0) +
      cN('SpLine', -1.2, 'PER') + cN('SpBefore', 0) + cN('SpAfter', 0) + cN('HorzAlign', 1) + cN('Bullet', 0) + cN('Flags', 0) +
      '</Row></Section>' +
      '</StyleSheet></StyleSheets>';
  }

  function documentXml(topPageId) {
    return XML_DECL + '<VisioDocument xmlns="' + NS + '" xmlns:r="' + NS_R + '" xml:space="preserve">' +
      '<DocumentSettings TopPage="' + topPageId + '" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">' +
      '<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions><SnapAngles/>' +
      '<DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>' +
      '<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds></DocumentSettings>' +
      styleSheetsXml() +
      '<DocumentSheet NameU="TheDoc" IsCustomNameU="1" Name="TheDoc" IsCustomName="1" LineStyle="0" FillStyle="0" TextStyle="0">' +
      cN('OutputFormat', 0) + cN('LockPreview', 0) + cN('AddMarkup', 0) + cN('ViewMarkup', 0) + cN('PreviewQuality', 0) +
      cN('PreviewScope', 0) + '</DocumentSheet>' +
      '</VisioDocument>';
  }

  function relsXml(rels) {
    return XML_DECL + '<Relationships xmlns="' + NS_REL + '">' +
      rels.map((r) => '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + escAttr(r.target) + '"/>').join('') +
      '</Relationships>';
  }

  function isoDate(d) {
    const dt = (d instanceof Date) ? d : (d ? new Date(d) : new Date());
    const ok = isNaN(dt) ? new Date() : dt;
    return ok.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function coreXml(ir, created, modified) {
    const t = (tag, v) => (v ? '<' + tag + '>' + escText(v) + '</' + tag + '>' : '');
    return XML_DECL + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
      ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
      ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      t('dc:title', ir.title) + t('dc:subject', ir.subject) + t('dc:creator', ir.author) + t('cp:keywords', ir.keywords) +
      t('dc:description', ir.description) + t('cp:lastModifiedBy', ir.author) +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + created + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + modified + '</dcterms:modified>' +
      '</cp:coreProperties>';
  }

  function appXml(ir, pageNames) {
    const n = pageNames.length;
    return XML_DECL + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"' +
      ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>' + escText(ir.application || 'Port Network Studio') + '</Application>' +
      '<ScaleCrop>false</ScaleCrop>' +
      '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Pages</vt:lpstr></vt:variant>' +
      '<vt:variant><vt:i4>' + n + '</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
      '<TitlesOfParts><vt:vector size="' + n + '" baseType="lpstr">' +
      pageNames.map((p) => '<vt:lpstr>' + escText(p) + '</vt:lpstr>').join('') + '</vt:vector></TitlesOfParts>' +
      (ir.company ? '<Company>' + escText(ir.company) + '</Company>' : '') +
      '<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>' +
      '</Properties>';
  }

  function windowsXml(topPage) {
    return XML_DECL + '<Windows ClientWidth="1600" ClientHeight="900" xmlns="' + NS + '" xmlns:r="' + NS_R + '" xml:space="preserve">' +
      '<Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="-8" WindowTop="-31" WindowWidth="1616" WindowHeight="939"' +
      ' ContainerType="Page" Page="' + topPage.id + '" ViewScale="-1" ViewCenterX="' + fmt(topPage.width / 2) +
      '" ViewCenterY="' + fmt(topPage.height / 2) + '">' +
      '<ShowRulers>1</ShowRulers><ShowGrid>1</ShowGrid><ShowPageBreaks>0</ShowPageBreaks><ShowGuides>1</ShowGuides>' +
      '<ShowConnectionPoints>1</ShowConnectionPoints><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings>' +
      '<SnapExtensions>34</SnapExtensions><SnapAngles/><DynamicGridEnabled>1</DynamicGridEnabled><TabSplitterPos>0.5</TabSplitterPos>' +
      '</Window></Windows>';
  }

  /* Normalise IR pages: names, sizes, layers, background relationships, order. */
  function normalisePages(ir) {
    const src = Array.isArray(ir.pages) && ir.pages.length ? ir.pages : [{ name: 'Page-1', shapes: [] }];
    const usedNames = {};
    const pages = src.map((p, i) => {
      p = p || {};
      let base = clean(p.name || '').replace(/\s+/g, ' ').trim() || ('Page-' + (i + 1));
      let name = base, k = 2;
      while (usedNames[name.toLowerCase()]) name = base + ' (' + (k++) + ')';
      usedNames[name.toLowerCase()] = true;
      const layersIn = Array.isArray(p.layers) ? p.layers : [];
      const lnames = {};
      const layers = layersIn.map((l, j) => {
        l = l || {};
        let ln = clean(l.name || '').trim() || ('Layer ' + (j + 1));
        let lb = ln, q = 2;
        while (lnames[ln.toLowerCase()]) ln = lb + ' ' + (q++);
        lnames[ln.toLowerCase()] = true;
        return { name: ln, visible: l.visible !== false, print: l.print !== false, locked: !!l.locked };
      });
      return {
        ir: p, index: i, id: i, name,
        width: Math.max(0.01, toNum(p.width, 11)), height: Math.max(0.01, toNum(p.height, 8.5)),
        layers, background: p.background === true || p.background === 1 || p.isBackground === true, backPage: null,
      };
    });
    // Resolve background references (target page becomes a background page).
    pages.forEach((p) => {
      const b = p.ir.backPage;
      if (b === null || b === undefined || b === '' || b === false) return;
      const bi = Math.round(Number(b));
      if (isFinite(bi) && bi >= 0 && bi < pages.length && bi !== p.index) {
        p.backPage = bi;
        pages[bi].background = true;
      }
    });
    // Drop cycles in background chains.
    pages.forEach((p) => {
      const seen = {};
      let cur = p;
      seen[cur.index] = true;
      while (cur.backPage !== null) {
        if (seen[cur.backPage]) { cur.backPage = null; break; }
        seen[cur.backPage] = true;
        cur = pages[cur.backPage];
      }
    });
    let fg = pages.filter((p) => !p.background);
    const bg = pages.filter((p) => p.background);
    if (!fg.length) {
      const first = bg[0];
      const blank = {
        ir: { shapes: [] }, index: pages.length, id: pages.length, name: usedNames['page-1'] ? 'Page-' + (pages.length + 1) : 'Page-1',
        width: first.width, height: first.height, layers: [], background: false, backPage: first.index,
      };
      pages.push(blank);
      fg = [blank];
    }
    // Visio lists foreground pages first, then background pages.
    return fg.concat(bg);
  }

  /* ------------------------------------------------------------------ */
  /* build                                                               */
  /* ------------------------------------------------------------------ */
  function build(ir) {
    ir = ir || {};
    const created = isoDate(ir.created);
    const modified = isoDate(ir.modified || ir.created);
    const pages = normalisePages(ir);
    const ctx = { media: [], mediaByKey: {}, names: {}, layerCount: 0 };
    const files = [];
    const pageParts = [];
    pages.forEach((page, i) => {
      const pageCtx = { rels: [], relByFile: {} };
      const xml = buildPage(ctx, page, pageCtx);
      pageParts.push({ page, file: 'page' + (i + 1) + '.xml', xml, rels: pageCtx.rels });
    });

    const top = pages[0];
    const ct = ['<Default Extension="rels" ContentType="' + CT.rels + '"/>', '<Default Extension="xml" ContentType="' + CT.xml + '"/>'];
    const exts = {};
    ctx.media.forEach((m) => { if (!exts[m.ext]) { exts[m.ext] = true; ct.push('<Default Extension="' + m.ext + '" ContentType="' + m.mime + '"/>'); } });
    ct.push('<Override PartName="/docProps/core.xml" ContentType="' + CT.core + '"/>');
    ct.push('<Override PartName="/docProps/app.xml" ContentType="' + CT.app + '"/>');
    ct.push('<Override PartName="/visio/document.xml" ContentType="' + CT.document + '"/>');
    ct.push('<Override PartName="/visio/pages/pages.xml" ContentType="' + CT.pages + '"/>');
    pageParts.forEach((pp) => ct.push('<Override PartName="/visio/pages/' + pp.file + '" ContentType="' + CT.page + '"/>'));
    ct.push('<Override PartName="/visio/windows.xml" ContentType="' + CT.windows + '"/>');
    files.push({ name: '[Content_Types].xml', data: XML_DECL + '<Types xmlns="' + NS_CT + '">' + ct.join('') + '</Types>' });

    files.push({ name: '_rels/.rels', data: relsXml([
      { id: 'rId1', type: REL.document, target: 'visio/document.xml' },
      { id: 'rId2', type: REL.core, target: 'docProps/core.xml' },
      { id: 'rId3', type: REL.app, target: 'docProps/app.xml' },
    ]) });
    files.push({ name: 'docProps/core.xml', data: coreXml(ir, created, modified) });
    files.push({ name: 'docProps/app.xml', data: appXml(ir, pages.map((p) => p.name)) });
    files.push({ name: 'visio/document.xml', data: documentXml(top.id) });
    files.push({ name: 'visio/_rels/document.xml.rels', data: relsXml([
      { id: 'rId1', type: REL.pages, target: 'pages/pages.xml' },
      { id: 'rId2', type: REL.windows, target: 'windows.xml' },
    ]) });

    let pagesXml = XML_DECL + '<Pages xmlns="' + NS + '" xmlns:r="' + NS_R + '" xml:space="preserve">';
    pageParts.forEach((pp, i) => {
      const p = pp.page;
      const nm = escAttr(p.name);
      pagesXml += '<Page ID="' + p.id + '" NameU="' + nm + '" IsCustomNameU="1" Name="' + nm + '" IsCustomName="1"' +
        (p.background ? ' Background="1"' : '') + (p.backPage !== null ? ' BackPage="' + p.backPage + '"' : '') +
        ' ViewScale="-1" ViewCenterX="' + fmt(p.width / 2) + '" ViewCenterY="' + fmt(p.height / 2) + '">' +
        pageSheetXml(p) + '<Rel r:id="rId' + (i + 1) + '"/></Page>';
    });
    pagesXml += '</Pages>';
    files.push({ name: 'visio/pages/pages.xml', data: pagesXml });
    files.push({ name: 'visio/pages/_rels/pages.xml.rels', data: relsXml(pageParts.map((pp, i) => ({ id: 'rId' + (i + 1), type: REL.page, target: pp.file }))) });
    pageParts.forEach((pp) => {
      files.push({ name: 'visio/pages/' + pp.file, data: pp.xml });
      if (pp.rels.length) files.push({ name: 'visio/pages/_rels/' + pp.file + '.rels', data: relsXml(pp.rels) });
    });
    ctx.media.forEach((m) => files.push({ name: 'visio/media/' + m.file, data: m.bytes }));
    files.push({ name: 'visio/windows.xml', data: windowsXml(top) });

    return zip(files, { date: new Date(modified) });
  }

  return {
    build, zip, crc32, VERSION, ARROWS,
    // exposed for unit tests / debugging
    _internal: { fmt, escText, escAttr, parseColor, arrowIndex, linePattern, bucketize, prepGeom, rowName, b64decode },
  };
})();
if (typeof module !== 'undefined') module.exports = VsdxWriter;
